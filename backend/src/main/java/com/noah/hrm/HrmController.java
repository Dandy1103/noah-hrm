package com.noah.hrm;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.FileSystemResource;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.TransactionException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

@RestController
final class HrmController {
    private static final Logger LOG = LoggerFactory.getLogger(HrmController.class);
    private static final String ACCOUNTS = "/api/hrm/accounts";
    private final HrmSettings settings;
    private final HrmIdentity identity;
    private final Employees employees;
    private final DutyRecords duty;

    HrmController(HrmSettings settings, HrmIdentity identity, Employees employees, DutyRecords duty) {
        this.settings = settings;
        this.identity = identity;
        this.employees = employees;
        this.duty = duty;
    }

    @ModelAttribute
    void headers(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
    }

    @GetMapping("/healthz")
    ResponseEntity<Void> health() {
        return ResponseEntity.ok().build();
    }

    @GetMapping("/auth/login")
    ResponseEntity<Void> login(HttpServletRequest request, @RequestParam(name = "next", required = false) String next,
            @RequestParam(name = "reauth", defaultValue = "false") boolean reauthenticate) {
        var returnTo = LoginDestination.resolve(next);
        if (!settings.ssoConfigured()) return signInError("unavailable", returnTo);
        try {
            return redirect(identity.begin(request, returnTo, reauthenticate));
        } catch (RuntimeException error) {
            LOG.warn("OIDC login could not start: {}", error.getClass().getSimpleName());
            return signInError("unavailable", returnTo);
        }
    }

    @GetMapping(HrmSettings.CALLBACK)
    ResponseEntity<Void> callback(HttpServletRequest request,
            @RequestParam(required = false) String code, @RequestParam(required = false) String state) {
        String returnTo = identity.pendingDestination(request, state);
        if (!settings.ssoConfigured()) return signInError("unavailable", returnTo);
        try {
            return redirect(identity.complete(request, code, state));
        } catch (RuntimeException error) {
            LOG.warn("OIDC callback failed: {}", error.getClass().getSimpleName());
            return signInError("signin", returnTo);
        }
    }

    @GetMapping("/auth/change-password")
    ResponseEntity<Void> changePassword(HttpServletRequest request, HttpServletResponse response,
            @RequestParam(name = "next", required = false) String next) {
        var destination = LoginDestination.resolve(next);
        var user = activeUser(request, response);
        if (user == null) return redirect("/auth/login?next="
                + org.springframework.web.util.UriUtils.encode(destination, java.nio.charset.StandardCharsets.UTF_8));
        try {
            return redirect(identity.changePassword(request, destination, user));
        } catch (RuntimeException error) {
            LOG.warn("Keycloak password action could not start: {}", error.getClass().getSimpleName());
            return signInError("unavailable", destination);
        }
    }

    @PostMapping("/auth/logout")
    ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        requireOrigin(request, settings.originValue());
        String refreshToken = identity.logoutToken(request);
        if (request.getSession(false) != null) endSession(request, response);
        try {
            identity.logoutFromKeycloak(refreshToken);
        } catch (RuntimeException error) {
            LOG.warn("Keycloak logout failed: {}", error.getClass().getSimpleName());
        }
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(URI.create("/auth/login?reauth=true")).build();
    }

    @GetMapping({"/", "/{*path}"})
    ResponseEntity<?> browser(@PathVariable(required = false) String path) throws IOException {
        String relative = path == null ? "" : path.replaceFirst("^/", "");
        String namespace = relative.split("/", 2)[0];
        if (namespace.equals("api") || namespace.equals("auth")) return ResponseEntity.notFound().build();
        var directory = settings.browserDirectory;
        var file = directory.resolve(relative).normalize();
        if (!file.startsWith(directory)) return ResponseEntity.notFound().build();
        if (!Files.isRegularFile(file)) {
            if (!relative.isEmpty() && file.getFileName().toString().contains(".")) {
                return ResponseEntity.notFound().build();
            }
            file = directory.resolve("index.html");
        }
        if (!Files.isRegularFile(file) || !file.toRealPath().startsWith(directory.toRealPath())) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok().contentType(MediaTypeFactory.getMediaType(file.getFileName().toString())
                .orElse(MediaType.APPLICATION_OCTET_STREAM)).body(new FileSystemResource(file));
    }

    @GetMapping("/api/session")
    Map<String, String> session(HttpServletRequest request, HttpServletResponse response) {
        return Map.of("displayName", requireUser(request, response).displayName());
    }

    @GetMapping("/api/me/employee")
    Map<String, Object> employee(HttpServletRequest request, HttpServletResponse response) {
        return employees.profile(requireUser(request, response));
    }

    @GetMapping("/api/hrm/access")
    ResponseEntity<Void> access(HttpServletRequest request, HttpServletResponse response) {
        requireHrmAdmin(request, response);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/api/hrm/employees")
    ResponseEntity<Map<String, String>> link(HttpServletRequest request, HttpServletResponse response,
            @RequestBody Employees.LinkedEmployee input) {
        var user = requireHrmMutation(request, response);
        return created(employees.link(user.issuer(), input));
    }

    @GetMapping(ACCOUNTS)
    Employees.AccountPage accounts(HttpServletRequest request, HttpServletResponse response,
            @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "0") int offset) {
        return employees.list(requireHrmAdmin(request, response), q, offset);
    }

    @PostMapping(ACCOUNTS)
    ResponseEntity<Map<String, String>> create(HttpServletRequest request, HttpServletResponse response,
            @RequestBody Employees.NewAccount input) {
        return created(employees.create(requireHrmMutation(request, response), input));
    }

    @PatchMapping(ACCOUNTS + "/{number}")
    ResponseEntity<Void> update(HttpServletRequest request, HttpServletResponse response,
            @PathVariable String number, @RequestBody Employees.AccountUpdate input) {
        employees.update(requireHrmMutation(request, response), number, input);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping(ACCOUNTS + "/{number}")
    ResponseEntity<Void> disable(HttpServletRequest request, HttpServletResponse response, @PathVariable String number) {
        employees.changeStatus(requireHrmMutation(request, response), number, false);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(ACCOUNTS + "/{number}/restore")
    ResponseEntity<Void> restore(HttpServletRequest request, HttpServletResponse response, @PathVariable String number) {
        employees.changeStatus(requireHrmMutation(request, response), number, true);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/api/hrm/departments")
    List<Map<String, Object>> departments(HttpServletRequest request, HttpServletResponse response) {
        requireHrmAdmin(request, response);
        return employees.departments();
    }

    @PostMapping("/api/hrm/departments")
    ResponseEntity<Map<String, Long>> createDepartment(HttpServletRequest request, HttpServletResponse response,
            @RequestBody Employees.DepartmentInput input) {
        long departmentId = employees.createDepartment(requireHrmMutation(request, response), input);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("departmentId", departmentId));
    }

    @PatchMapping("/api/hrm/departments/{id}")
    ResponseEntity<Void> updateDepartment(HttpServletRequest request, HttpServletResponse response,
            @PathVariable long id, @RequestBody Employees.DepartmentInput input) {
        employees.updateDepartment(requireHrmMutation(request, response), id, input);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/hrm/departments/{id}")
    ResponseEntity<Void> deleteDepartment(HttpServletRequest request, HttpServletResponse response, @PathVariable long id) {
        requireHrmMutation(request, response);
        employees.deleteDepartment(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/api/hrm/people")
    List<Map<String, Object>> people(HttpServletRequest request, HttpServletResponse response) {
        return employees.people(requireHrmAdmin(request, response));
    }

    @GetMapping("/api/hrm/attendance")
    List<Map<String, Object>> attendance(HttpServletRequest request, HttpServletResponse response) {
        return duty.attendance(requireHrmAdmin(request, response).issuer());
    }

    @PostMapping("/api/hrm/attendance")
    ResponseEntity<Void> createAttendance(HttpServletRequest request, HttpServletResponse response,
            @RequestBody DutyRecords.AttendanceInput input) {
        duty.createAttendance(requireHrmMutation(request, response).issuer(), input);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @PatchMapping("/api/hrm/attendance/{id}")
    ResponseEntity<Void> updateAttendance(HttpServletRequest request, HttpServletResponse response,
            @PathVariable long id, @RequestBody DutyRecords.AttendanceInput input) {
        duty.updateAttendance(requireHrmMutation(request, response).issuer(), id, input);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/hrm/attendance/{id}")
    ResponseEntity<Void> deleteAttendance(HttpServletRequest request, HttpServletResponse response, @PathVariable long id) {
        duty.deleteAttendance(requireHrmMutation(request, response).issuer(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/api/hrm/leave")
    List<Map<String, Object>> leave(HttpServletRequest request, HttpServletResponse response) {
        return duty.leave(requireHrmAdmin(request, response).issuer());
    }

    @PostMapping("/api/hrm/leave")
    ResponseEntity<Void> createLeave(HttpServletRequest request, HttpServletResponse response,
            @RequestBody DutyRecords.LeaveInput input) {
        duty.createLeave(requireHrmMutation(request, response).issuer(), input);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @PatchMapping("/api/hrm/leave/{id}")
    ResponseEntity<Void> updateLeave(HttpServletRequest request, HttpServletResponse response,
            @PathVariable long id, @RequestBody DutyRecords.LeaveInput input) {
        duty.updateLeave(requireHrmMutation(request, response).issuer(), id, input);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/hrm/leave/{id}")
    ResponseEntity<Void> deleteLeave(HttpServletRequest request, HttpServletResponse response, @PathVariable long id) {
        duty.deleteLeave(requireHrmMutation(request, response).issuer(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/api/hrm/overtime")
    List<Map<String, Object>> overtime(HttpServletRequest request, HttpServletResponse response) {
        return duty.overtime(requireHrmAdmin(request, response).issuer());
    }

    @PostMapping("/api/hrm/overtime")
    ResponseEntity<Void> createOvertime(HttpServletRequest request, HttpServletResponse response,
            @RequestBody DutyRecords.OvertimeInput input) {
        duty.createOvertime(requireHrmMutation(request, response).issuer(), input);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @PatchMapping("/api/hrm/overtime/{id}")
    ResponseEntity<Void> updateOvertime(HttpServletRequest request, HttpServletResponse response,
            @PathVariable long id, @RequestBody DutyRecords.OvertimeInput input) {
        duty.updateOvertime(requireHrmMutation(request, response).issuer(), id, input);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/hrm/overtime/{id}")
    ResponseEntity<Void> deleteOvertime(HttpServletRequest request, HttpServletResponse response, @PathVariable long id) {
        duty.deleteOvertime(requireHrmMutation(request, response).issuer(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/api/hrm/trips")
    List<Map<String, Object>> trips(HttpServletRequest request, HttpServletResponse response) {
        return duty.trips(requireHrmAdmin(request, response).issuer());
    }

    @PostMapping("/api/hrm/trips")
    ResponseEntity<Void> createTrip(HttpServletRequest request, HttpServletResponse response,
            @RequestBody DutyRecords.TripInput input) {
        duty.createTrip(requireHrmMutation(request, response).issuer(), input);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @PatchMapping("/api/hrm/trips/{id}")
    ResponseEntity<Void> updateTrip(HttpServletRequest request, HttpServletResponse response,
            @PathVariable long id, @RequestBody DutyRecords.TripInput input) {
        duty.updateTrip(requireHrmMutation(request, response).issuer(), id, input);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/hrm/trips/{id}")
    ResponseEntity<Void> deleteTrip(HttpServletRequest request, HttpServletResponse response, @PathVariable long id) {
        duty.deleteTrip(requireHrmMutation(request, response).issuer(), id);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Void> duplicate() {
        return ResponseEntity.status(HttpStatus.CONFLICT).build();
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class, RestClientException.class})
    ResponseEntity<Void> unavailable(RuntimeException error) {
        LOG.warn("HRM service request failed: {}", error.getClass().getSimpleName());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Void> status(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).build();
    }

    private HrmIdentity.User requireHrmMutation(HttpServletRequest request, HttpServletResponse response) {
        var user = requireHrmAdmin(request, response);
        requireOrigin(request, settings.originValue());
        return user;
    }

    private HrmIdentity.User requireHrmAdmin(HttpServletRequest request, HttpServletResponse response) {
        var user = requireUser(request, response);
        if (settings.issuer == null || !settings.issuer.toString().equals(user.issuer())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        boolean bootstrapAdmin = !settings.hrmAdminSubject.isBlank() && settings.hrmAdminSubject.equals(user.subject());
        if (!bootstrapAdmin && !employees.isAdmin(user)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return user;
    }

    private HrmIdentity.User requireUser(HttpServletRequest request, HttpServletResponse response) {
        var user = activeUser(request, response);
        if (user == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        return user;
    }

    private HrmIdentity.User activeUser(HttpServletRequest request, HttpServletResponse response) {
        var user = identity.user(request);
        if (user != null && employees.isInactive(user)) {
            endSession(request, response);
            return null;
        }
        return user;
    }

    private void endSession(HttpServletRequest request, HttpServletResponse response) {
        request.getSession(false).invalidate();
        var cookie = ResponseCookie.from(settings.cookieName(), "").path("/").httpOnly(true).secure(settings.secure())
                .sameSite("Lax").maxAge(Duration.ZERO).build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from("noah-core.sid", "").path("/").httpOnly(true)
                .sameSite("Lax").maxAge(Duration.ZERO).build().toString());
    }

    private static void requireOrigin(HttpServletRequest request, String expected) {
        if (!expected.equals(request.getHeader("Origin"))) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static ResponseEntity<Map<String, String>> created(String employeeNumber) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("employeeNumber", employeeNumber));
    }

    private static ResponseEntity<Void> signInError(String code, String destination) {
        return redirect("/?authError=" + code + LoginDestination.keep(destination));
    }

    private static ResponseEntity<Void> redirect(String path) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(path)).build();
    }
}
