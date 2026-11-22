package com.noah.hrm;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.flywaydb.core.Flyway;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Component
final class Employees {
    private static final Logger LOG = LoggerFactory.getLogger(Employees.class);
    private static final Pattern NUMBER = Pattern.compile("[A-Z0-9][A-Z0-9_-]{0,31}");
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+\\.[^\\s@]+");
    private static final Set<String> EMPLOYMENT_TYPES = Set.of("regular", "part_time", "fixed_term", "intern");
    private static final Set<String> ROLES = Set.of("admin", "manager", "employee");
    private static final int PAGE_SIZE = 30;
    private static final int DIRECTORY_LIMIT = 500;

    private final HikariDataSource source;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final KeycloakAccounts keycloak;

    record LinkedEmployee(String employeeNumber, String displayName, String department, String keycloakUserId) {}
    record Profile(String firstName, String lastName, String email) {
        Profile validated() {
            String address = text(email, 254);
            if (!EMAIL.matcher(address).matches()) throw badRequest();
            return new Profile(text(firstName, 48), text(lastName, 48), address);
        }
    }
    record NewAccount(String employeeNumber, String nationalId, String displayName, String firstName, String lastName,
                      Long departmentId, String jobTitle, String hiredOn, String bornOn, String employmentType,
                      String email, String initialPassword, String managerEmployeeNumber, String role) {}
    record AccountUpdate(String displayName, String firstName, String lastName, Long departmentId, String jobTitle,
                         String hiredOn, String bornOn, String employmentType, String email, String nationalId,
                         String managerEmployeeNumber, String role) {}
    record DepartmentInput(String name, Long parentDepartmentId, String headEmployeeNumber) {}
    record AccountPage(List<Map<String, Object>> accounts, boolean hasMore, int pageSize) {}
    private record ManagedAccount(String subject, boolean managed, String email, String role) {}

    Employees(HrmSettings settings, KeycloakAccounts keycloak) {
        this.keycloak = keycloak;
        if (settings.databaseUrl.isBlank()) {
            source = null;
            jdbc = null;
            tx = null;
            return;
        }
        source = new HikariDataSource(databaseConfig(settings.databaseUrl));
        try {
            Flyway.configure()
                    .dataSource(source)
                    .defaultSchema("public")
                    .baselineOnMigrate(true)
                    .baselineVersion("0")
                    .load()
                    .migrate();
        } catch (RuntimeException error) {
            source.close();
            throw error;
        }
        jdbc = new JdbcTemplate(source);
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    }

    void requireDatabase() {
        if (jdbc == null) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
    }

    JdbcTemplate jdbc() {
        requireDatabase();
        return jdbc;
    }

    @PreDestroy
    void close() {
        if (source != null) source.close();
    }

    boolean isInactive(HrmIdentity.User user) {
        return jdbc != null && exists("""
                SELECT 1 FROM employees WHERE oidc_issuer=? AND oidc_subject=? AND status='inactive'
                """, user.issuer(), user.subject());
    }

    Map<String, Object> profile(HrmIdentity.User user) {
        requireDatabase();
        return jdbc.queryForList("""
                SELECT e.employee_number AS "employeeNumber", e.display_name AS "displayName",
                       COALESCE(d.name, e.department) AS department, e.status,
                       e.job_title AS "jobTitle", to_char(e.hired_on, 'YYYY-MM-DD') AS "hiredOn",
                       to_char(e.born_on, 'YYYY-MM-DD') AS "bornOn",
                       e.employment_type AS "employmentType", m.display_name AS "managerName"
                FROM employees e
                LEFT JOIN departments d ON d.department_id = e.department_id
                LEFT JOIN employees m ON m.employee_number = e.manager_employee_number
                WHERE e.oidc_issuer=? AND e.oidc_subject=?
                """, user.issuer(), user.subject()).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    String link(String issuer, LinkedEmployee employee) {
        requireDatabase();
        String number = normalizeNumber(employee.employeeNumber());
        String department = text(employee.department(), 100);
        tx.executeWithoutResult(status -> {
            long departmentId = departmentIdForName(department);
            jdbc.update("""
                    INSERT INTO employees (employee_number, display_name, department, department_id, oidc_issuer, oidc_subject)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, number, text(employee.displayName(), 100), department, departmentId, issuer,
                    text(employee.keycloakUserId(), 255));
        });
        return number;
    }

    AccountPage list(HrmIdentity.User user, String query, int offset) {
        requireDatabase();
        if (query.length() > 100 || offset < 0 || offset > 99999999) throw badRequest();
        String term = query.strip();
        var rows = jdbc.queryForList("""
                SELECT e.employee_number AS "employeeNumber", e.display_name AS "displayName",
                    COALESCE(d.name, e.department) AS department, e.department_id AS "departmentId",
                    e.first_name AS "firstName", e.last_name AS "lastName", e.email, e.status,
                    e.managed_account AS managed, true AS editable, (e.oidc_subject = ?) AS self,
                    e.role AS role,
                    e.job_title AS "jobTitle", to_char(e.hired_on, 'YYYY-MM-DD') AS "hiredOn",
                    to_char(e.born_on, 'YYYY-MM-DD') AS "bornOn",
                    e.employment_type AS "employmentType",
                    e.manager_employee_number AS "managerEmployeeNumber", m.display_name AS "managerName"
                FROM employees e
                LEFT JOIN departments d ON d.department_id = e.department_id
                LEFT JOIN employees m ON m.employee_number = e.manager_employee_number
                WHERE e.oidc_issuer = ? AND (
                    strpos(lower(e.employee_number), lower(?)) > 0 OR strpos(lower(e.display_name), lower(?)) > 0
                    OR strpos(lower(COALESCE(d.name, e.department)), lower(?)) > 0
                    OR strpos(lower(COALESCE(e.email, '')), lower(?)) > 0
                    OR strpos(lower(COALESCE(e.job_title, '')), lower(?)) > 0
                )
                ORDER BY e.employee_number LIMIT ? OFFSET ?
                """, user.subject(), user.issuer(), term, term, term, term, term, PAGE_SIZE + 1, offset);
        return new AccountPage(rows.subList(0, Math.min(PAGE_SIZE, rows.size())), rows.size() > PAGE_SIZE, PAGE_SIZE);
    }

    String create(HrmIdentity.User user, NewAccount input) {
        requireDatabase();
        String number = normalizeNumber(input.employeeNumber());
        String username = NationalId.username(input.nationalId());
        var profile = new Profile(input.firstName(), input.lastName(), input.email()).validated();
        String shown = text(input.displayName(), 100);
        long departmentId = departmentId(input.departmentId());
        String title = text(input.jobTitle(), 100);
        LocalDate hired = hiredOn(input.hiredOn());
        LocalDate born = birthday(input.bornOn(), hired);
        String type = employmentType(input.employmentType());
        String assignedRole = role(input.role());
        String password = input.initialPassword();
        if (password == null || password.length() < 12 || password.length() > 128 || password.isBlank()) {
            throw badRequest();
        }

        var connection = keycloak.connect();
        String[] subject = new String[1];
        try {
            tx.executeWithoutResult(status -> {
                jdbc.query("SELECT pg_advisory_xact_lock(hashtext(?))", (rs, row) -> 1, number);
                if (exists("SELECT 1 FROM employees WHERE employee_number=?", number)) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT);
                }
                String department = departmentName(departmentId);
                String manager = optionalManager(user.issuer(), number, input.managerEmployeeNumber());
                subject[0] = connection.create(username, profile, password);
                jdbc.update("""
                        INSERT INTO employees (employee_number, display_name, department, department_id, oidc_issuer,
                                               oidc_subject, managed_account, first_name, last_name, email, job_title,
                                               hired_on, born_on, employment_type, manager_employee_number, role)
                        VALUES (?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?::date, ?::date, ?, ?::text, ?)
                        """, number, shown, department, departmentId, user.issuer(), subject[0],
                        profile.firstName(), profile.lastName(), profile.email(), title, hired, born, type, manager,
                        assignedRole);
            });
        } catch (RuntimeException error) {
            if (subject[0] == null) throw error;
            try {
                if (exists("SELECT 1 FROM employees WHERE employee_number=? AND oidc_subject=?", number, subject[0])) {
                    return number;
                }
                connection.remove(subject[0]);
            } catch (RuntimeException cleanup) {
                LOG.error("Could not reconcile HRM account creation after a database error.");
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            }
            throw error;
        }
        return number;
    }

    void update(HrmIdentity.User user, String number, AccountUpdate input) {
        requireDatabase();
        Profile profile = new Profile(input.firstName(), input.lastName(), input.email()).validated();
        String shown = text(input.displayName(), 100);
        long departmentId = departmentId(input.departmentId());
        String title = text(input.jobTitle(), 100);
        LocalDate hired = hiredOn(input.hiredOn());
        LocalDate born = birthday(input.bornOn(), hired);
        String type = employmentType(input.employmentType());
        String assignedRole = role(input.role());
        String username = input.nationalId() == null || input.nationalId().isBlank()
                ? null : NationalId.username(input.nationalId());
        ManagedAccount saved = tx.execute(status -> {
            var account = locked(user, number);
            keepAnAdmin(user, number, account.role(), assignedRole);
            String department = departmentName(departmentId);
            String manager = optionalManager(user.issuer(), number, input.managerEmployeeNumber());
            jdbc.update("""
                    UPDATE employees SET first_name=?, last_name=?, email=?, display_name=?, department=?,
                        department_id=?, job_title=?, hired_on=?::date, born_on=?::date, employment_type=?,
                        manager_employee_number=?::text, role=?
                    WHERE employee_number=?
                    """, profile.firstName(), profile.lastName(), profile.email(), shown,
                    department, departmentId, title, hired, born, type, manager, assignedRole, number);
            return account;
        });
        if (saved == null || !saved.managed) return;
        try {
            Map<String, Object> attributes = new LinkedHashMap<>();
            attributes.put("firstName", profile.firstName());
            attributes.put("lastName", profile.lastName());
            attributes.put("email", profile.email());
            if (username != null) attributes.put("username", username);
            if (saved.email == null || !saved.email.equalsIgnoreCase(profile.email())) {
                attributes.put("emailVerified", false);
            }
            keycloak.connect().update(saved.subject, attributes);
        } catch (RuntimeException error) {
            LOG.warn("Employee {} was saved, but the login account was not updated: {}", number, error.getClass().getSimpleName());
        }
    }

    void changeStatus(HrmIdentity.User user, String number, boolean enabled) {
        requireDatabase();
        tx.executeWithoutResult(status -> {
            var account = managed(user, number, false);
            jdbc.update("UPDATE employees SET status=? WHERE employee_number=?", enabled ? "active" : "inactive", number);
            keycloak.connect().update(account.subject, Map.of("enabled", enabled));
        });
    }

    List<Map<String, Object>> departments() {
        requireDatabase();
        return jdbc.queryForList("""
                SELECT d.department_id AS "departmentId", d.name,
                       d.parent_department_id AS "parentDepartmentId", parent.name AS "parentName",
                       d.head_employee_number AS "headEmployeeNumber", head.display_name AS "headName",
                       (SELECT count(*) FROM employees employee WHERE employee.department_id = d.department_id) AS "employeeCount"
                FROM departments d
                LEFT JOIN departments parent ON parent.department_id = d.parent_department_id
                LEFT JOIN employees head ON head.employee_number = d.head_employee_number
                ORDER BY d.name
                LIMIT ?
                """, DIRECTORY_LIMIT);
    }

    List<Map<String, Object>> people(HrmIdentity.User user) {
        requireDatabase();
        return jdbc.queryForList("""
                SELECT employee_number AS "employeeNumber", display_name AS "displayName", status
                FROM employees WHERE oidc_issuer=?
                ORDER BY employee_number
                LIMIT ?
                """, user.issuer(), DIRECTORY_LIMIT);
    }

    long createDepartment(HrmIdentity.User user, DepartmentInput input) {
        requireDatabase();
        String name = text(input.name(), 100);
        long[] id = new long[1];
        tx.executeWithoutResult(status -> {
            requireParent(null, input.parentDepartmentId());
            String head = optionalEmployee(user.issuer(), input.headEmployeeNumber());
            Long created = jdbc.queryForObject("""
                    INSERT INTO departments (name, parent_department_id, head_employee_number)
                    VALUES (?, ?::bigint, ?::text) RETURNING department_id
                    """, Long.class, name, input.parentDepartmentId(), head);
            if (created == null) throw badRequest();
            id[0] = created;
        });
        return id[0];
    }

    void updateDepartment(HrmIdentity.User user, long departmentId, DepartmentInput input) {
        requireDatabase();
        String name = text(input.name(), 100);
        tx.executeWithoutResult(status -> {
            if (jdbc.queryForList("SELECT 1 FROM departments WHERE department_id=? FOR UPDATE", departmentId).isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            }
            requireParent(departmentId, input.parentDepartmentId());
            String head = optionalEmployee(user.issuer(), input.headEmployeeNumber());
            jdbc.update("""
                    UPDATE departments SET name=?, parent_department_id=?::bigint, head_employee_number=?::text
                    WHERE department_id=?
                    """, name, input.parentDepartmentId(), head, departmentId);
            jdbc.update("UPDATE employees SET department=? WHERE department_id=?", name, departmentId);
        });
    }

    void deleteDepartment(long departmentId) {
        requireDatabase();
        tx.executeWithoutResult(status -> {
            if (jdbc.queryForList("SELECT 1 FROM departments WHERE department_id=? FOR UPDATE", departmentId).isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            }
            if (exists("SELECT 1 FROM employees WHERE department_id=?", departmentId)
                    || exists("SELECT 1 FROM departments WHERE parent_department_id=?", departmentId)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT);
            }
            jdbc.update("DELETE FROM departments WHERE department_id=?", departmentId);
        });
    }

    boolean isAdmin(HrmIdentity.User user) {
        return jdbc != null && exists("""
                SELECT 1 FROM employees WHERE oidc_issuer=? AND oidc_subject=? AND role='admin' AND status='active'
                """, user.issuer(), user.subject());
    }

    private ManagedAccount locked(HrmIdentity.User user, String number) {
        if (!NUMBER.matcher(number).matches()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var result = jdbc.query("""
                SELECT oidc_subject, managed_account, email, role FROM employees
                WHERE employee_number=? AND oidc_issuer=? FOR UPDATE
                """, (rs, row) -> new ManagedAccount(rs.getString(1), rs.getBoolean(2), rs.getString(3), rs.getString(4)),
                number, user.issuer());
        if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return result.getFirst();
    }

    private ManagedAccount managed(HrmIdentity.User user, String number, boolean allowSelf) {
        var account = locked(user, number);
        if (!account.managed || (!allowSelf && Objects.equals(account.subject, user.subject()))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        return account;
    }

    private void keepAnAdmin(HrmIdentity.User user, String number, String currentRole, String newRole) {
        if (!"admin".equals(currentRole) || "admin".equals(newRole)) return;
        if (!exists("""
                SELECT 1 FROM employees WHERE oidc_issuer=? AND status='active' AND role='admin' AND employee_number<>?
                """, user.issuer(), number)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT);
        }
    }

    private boolean exists(String sql, Object... args) {
        return !jdbc.queryForList(sql, args).isEmpty();
    }

    private long departmentIdForName(String name) {
        var found = jdbc.queryForList("SELECT department_id FROM departments WHERE name=?", name);
        if (!found.isEmpty()) return ((Number) found.getFirst().get("department_id")).longValue();
        Long created = jdbc.queryForObject(
                "INSERT INTO departments (name) VALUES (?) RETURNING department_id", Long.class, name);
        if (created == null) throw badRequest();
        return created;
    }

    private String departmentName(long departmentId) {
        var found = jdbc.queryForList("SELECT name FROM departments WHERE department_id=?", departmentId);
        if (found.isEmpty()) throw badRequest();
        return (String) found.getFirst().get("name");
    }

    private void requireParent(Long departmentId, Long parentId) {
        if (parentId == null) return;
        Long current = parentId;
        for (int depth = 0; depth < 20; depth++) {
            if (departmentId != null && departmentId.equals(current)) throw badRequest();
            var rows = jdbc.queryForList("SELECT parent_department_id FROM departments WHERE department_id=?", current);
            if (rows.isEmpty()) throw badRequest();
            Object parent = rows.getFirst().get("parent_department_id");
            if (parent == null) return;
            current = ((Number) parent).longValue();
        }
        throw badRequest();
    }

    private String optionalEmployee(String issuer, String number) {
        if (number == null || number.isBlank()) return null;
        String normalized = normalizeNumber(number);
        if (!exists("SELECT 1 FROM employees WHERE employee_number=? AND oidc_issuer=?", normalized, issuer)) {
            throw badRequest();
        }
        return normalized;
    }

    private String optionalManager(String issuer, String employeeNumber, String manager) {
        String normalized = optionalEmployee(issuer, manager);
        if (normalized != null && normalized.equals(employeeNumber)) throw badRequest();
        return normalized;
    }

    private static long departmentId(Long value) {
        if (value == null || value < 1) throw badRequest();
        return value;
    }

    private static LocalDate hiredOn(String value) {
        return date(value);
    }

    private static LocalDate birthday(String value, LocalDate hired) {
        LocalDate born = date(value);
        if (!born.isBefore(hired) || born.isAfter(LocalDate.now()) || java.time.Period.between(born, hired).getYears() < 15) {
            throw badRequest();
        }
        return born;
    }

    private static LocalDate date(String value) {
        if (value == null || value.isBlank()) throw badRequest();
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException error) {
            throw badRequest();
        }
    }

    private static String employmentType(String value) {
        if (value == null || !EMPLOYMENT_TYPES.contains(value)) throw badRequest();
        return value;
    }

    private static String role(String value) {
        if (value == null || !ROLES.contains(value)) throw badRequest();
        return value;
    }

    private static HikariConfig databaseConfig(String value) {
        var url = URI.create(value);
        if (!("postgresql".equals(url.getScheme()) || "postgres".equals(url.getScheme())) || url.getHost() == null) {
            throw new IllegalArgumentException("DATABASE_URL must be a PostgreSQL URL.");
        }
        var config = new HikariConfig();
        String host = url.getHost();
        String port = url.getPort() == -1 ? "" : ":" + url.getPort();
        String query = url.getRawQuery() == null ? "" : "?" + url.getRawQuery();
        config.setJdbcUrl("jdbc:postgresql://" + host + port + url.getRawPath() + query);
        if (url.getRawUserInfo() != null) {
            var parts = url.getRawUserInfo().split(":", 2);
            config.setUsername(decode(parts[0]));
            if (parts.length == 2) config.setPassword(decode(parts[1]));
        }
        config.setMaximumPoolSize(5);
        config.setConnectionTimeout(5000);
        return config;
    }

    private static String decode(String value) {
        return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    private static String normalizeNumber(String value) {
        String number = text(value, 32).toUpperCase(Locale.ROOT);
        if (!NUMBER.matcher(number).matches()) throw badRequest();
        return number;
    }

    private static String text(String value, int max) {
        if (value == null || value.isBlank() || value.strip().length() > max) throw badRequest();
        return value.strip();
    }

    private static ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST);
    }
}
