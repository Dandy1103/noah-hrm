package com.noah.hrm;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
final class DutyRecords {
    private static final Pattern NUMBER = Pattern.compile("[A-Z0-9][A-Z0-9_-]{0,31}");
    private static final Set<String> LEAVE_TYPES = Set.of(
            "annual", "sick", "personal", "menstrual", "bereavement", "marriage", "official");
    private static final int LIST_LIMIT = 200;

    private final Employees employees;

    DutyRecords(Employees employees) {
        this.employees = employees;
    }

    List<Map<String, Object>> attendance(String issuer) {
        return list("""
                SELECT entry.attendance_id AS id, entry.employee_number AS "employeeNumber",
                       employee.display_name AS "displayName",
                       to_char(entry.work_date, 'YYYY-MM-DD') AS "workDate",
                       to_char(entry.clock_in, 'HH24:MI') AS "clockIn",
                       to_char(entry.clock_out, 'HH24:MI') AS "clockOut",
                       entry.note
                FROM attendance_records AS entry
                JOIN employees AS employee ON employee.employee_number = entry.employee_number
                WHERE employee.oidc_issuer = ?
                ORDER BY entry.work_date DESC, entry.attendance_id DESC
                LIMIT ?
                """, issuer);
    }

    List<Map<String, Object>> leave(String issuer) {
        return list("""
                SELECT entry.leave_id AS id, entry.employee_number AS "employeeNumber",
                       employee.display_name AS "displayName", entry.leave_type AS "leaveType",
                       to_char(entry.starts_on, 'YYYY-MM-DD') AS "startsOn",
                       to_char(entry.ends_on, 'YYYY-MM-DD') AS "endsOn",
                       entry.note
                FROM leave_records AS entry
                JOIN employees AS employee ON employee.employee_number = entry.employee_number
                WHERE employee.oidc_issuer = ?
                ORDER BY entry.starts_on DESC, entry.leave_id DESC
                LIMIT ?
                """, issuer);
    }

    List<Map<String, Object>> overtime(String issuer) {
        return list("""
                SELECT entry.overtime_id AS id, entry.employee_number AS "employeeNumber",
                       employee.display_name AS "displayName",
                       to_char(entry.work_date, 'YYYY-MM-DD') AS "workDate",
                       to_char(entry.starts_at, 'HH24:MI') AS "startsAt",
                       to_char(entry.ends_at, 'HH24:MI') AS "endsAt",
                       entry.reason
                FROM overtime_records AS entry
                JOIN employees AS employee ON employee.employee_number = entry.employee_number
                WHERE employee.oidc_issuer = ?
                ORDER BY entry.work_date DESC, entry.overtime_id DESC
                LIMIT ?
                """, issuer);
    }

    List<Map<String, Object>> trips(String issuer) {
        return list("""
                SELECT entry.trip_id AS id, entry.employee_number AS "employeeNumber",
                       employee.display_name AS "displayName", entry.place,
                       to_char(entry.starts_on, 'YYYY-MM-DD') AS "startsOn",
                       to_char(entry.ends_on, 'YYYY-MM-DD') AS "endsOn",
                       entry.reason
                FROM trip_records AS entry
                JOIN employees AS employee ON employee.employee_number = entry.employee_number
                WHERE employee.oidc_issuer = ?
                ORDER BY entry.starts_on DESC, entry.trip_id DESC
                LIMIT ?
                """, issuer);
    }

    void createAttendance(String issuer, AttendanceInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalDate workDate = date(input.workDate());
        LocalTime clockIn = time(input.clockIn(), false);
        LocalTime clockOut = time(input.clockOut(), false);
        requireClock(clockIn, clockOut);
        jdbc().update("""
                INSERT INTO attendance_records (employee_number, work_date, clock_in, clock_out, note)
                VALUES (?, ?, ?, ?, ?)
                """, number, workDate, clockIn, clockOut, optional(input.note(), 200));
    }

    void updateAttendance(String issuer, long id, AttendanceInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalDate workDate = date(input.workDate());
        LocalTime clockIn = time(input.clockIn(), false);
        LocalTime clockOut = time(input.clockOut(), false);
        requireClock(clockIn, clockOut);
        changed(jdbc().update("""
                UPDATE attendance_records AS entry
                SET employee_number = ?, work_date = ?, clock_in = ?, clock_out = ?, note = ?
                FROM employees AS employee
                WHERE entry.attendance_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, number, workDate, clockIn, clockOut, optional(input.note(), 200), recordId(id), issuer));
    }

    void deleteAttendance(String issuer, long id) {
        changed(jdbc().update("""
                DELETE FROM attendance_records AS entry
                USING employees AS employee
                WHERE entry.attendance_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, recordId(id), issuer));
    }

    void createLeave(String issuer, LeaveInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalDate starts = date(input.startsOn());
        LocalDate ends = date(input.endsOn());
        requireOrder(starts, ends);
        jdbc().update("""
                INSERT INTO leave_records (employee_number, leave_type, starts_on, ends_on, note)
                VALUES (?, ?, ?, ?, ?)
                """, number, leaveType(input.leaveType()), starts, ends, optional(input.note(), 200));
    }

    void updateLeave(String issuer, long id, LeaveInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalDate starts = date(input.startsOn());
        LocalDate ends = date(input.endsOn());
        requireOrder(starts, ends);
        changed(jdbc().update("""
                UPDATE leave_records AS entry
                SET employee_number = ?, leave_type = ?, starts_on = ?, ends_on = ?, note = ?
                FROM employees AS employee
                WHERE entry.leave_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, number, leaveType(input.leaveType()), starts, ends, optional(input.note(), 200), recordId(id), issuer));
    }

    void deleteLeave(String issuer, long id) {
        changed(jdbc().update("""
                DELETE FROM leave_records AS entry
                USING employees AS employee
                WHERE entry.leave_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, recordId(id), issuer));
    }

    void createOvertime(String issuer, OvertimeInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalTime starts = time(input.startsAt(), true);
        LocalTime ends = time(input.endsAt(), true);
        requireLater(starts, ends);
        jdbc().update("""
                INSERT INTO overtime_records (employee_number, work_date, starts_at, ends_at, reason)
                VALUES (?, ?, ?, ?, ?)
                """, number, date(input.workDate()), starts, ends, required(input.reason(), 200));
    }

    void updateOvertime(String issuer, long id, OvertimeInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalTime starts = time(input.startsAt(), true);
        LocalTime ends = time(input.endsAt(), true);
        requireLater(starts, ends);
        changed(jdbc().update("""
                UPDATE overtime_records AS entry
                SET employee_number = ?, work_date = ?, starts_at = ?, ends_at = ?, reason = ?
                FROM employees AS employee
                WHERE entry.overtime_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, number, date(input.workDate()), starts, ends, required(input.reason(), 200), recordId(id), issuer));
    }

    void deleteOvertime(String issuer, long id) {
        changed(jdbc().update("""
                DELETE FROM overtime_records AS entry
                USING employees AS employee
                WHERE entry.overtime_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, recordId(id), issuer));
    }

    void createTrip(String issuer, TripInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalDate starts = date(input.startsOn());
        LocalDate ends = date(input.endsOn());
        requireOrder(starts, ends);
        jdbc().update("""
                INSERT INTO trip_records (employee_number, place, starts_on, ends_on, reason)
                VALUES (?, ?, ?, ?, ?)
                """, number, required(input.place(), 100), starts, ends, required(input.reason(), 200));
    }

    void updateTrip(String issuer, long id, TripInput input) {
        String number = employee(issuer, input.employeeNumber());
        LocalDate starts = date(input.startsOn());
        LocalDate ends = date(input.endsOn());
        requireOrder(starts, ends);
        changed(jdbc().update("""
                UPDATE trip_records AS entry
                SET employee_number = ?, place = ?, starts_on = ?, ends_on = ?, reason = ?
                FROM employees AS employee
                WHERE entry.trip_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, number, required(input.place(), 100), starts, ends, required(input.reason(), 200), recordId(id), issuer));
    }

    void deleteTrip(String issuer, long id) {
        changed(jdbc().update("""
                DELETE FROM trip_records AS entry
                USING employees AS employee
                WHERE entry.trip_id = ?
                  AND entry.employee_number = employee.employee_number
                  AND employee.oidc_issuer = ?
                """, recordId(id), issuer));
    }

    private List<Map<String, Object>> list(String sql, String issuer) {
        return jdbc().queryForList(sql, issuer, LIST_LIMIT);
    }

    private JdbcTemplate jdbc() {
        return employees.jdbc();
    }

    private String employee(String issuer, String value) {
        if (value == null) throw badRequest();
        String number = value.strip().toUpperCase(Locale.ROOT);
        if (!NUMBER.matcher(number).matches()) throw badRequest();
        Integer found = jdbc().queryForObject(
                "SELECT COUNT(*) FROM employees WHERE employee_number = ? AND oidc_issuer = ?",
                Integer.class, number, issuer);
        if (found == null || found == 0) throw badRequest();
        return number;
    }

    private static void requireClock(LocalTime clockIn, LocalTime clockOut) {
        if (clockIn == null && clockOut == null) throw badRequest();
        if (clockIn != null && clockOut != null && clockOut.isBefore(clockIn)) throw badRequest();
    }

    private static void requireOrder(LocalDate starts, LocalDate ends) {
        if (ends.isBefore(starts)) throw badRequest();
    }

    private static void requireLater(LocalTime starts, LocalTime ends) {
        if (starts == null || ends == null || !ends.isAfter(starts)) throw badRequest();
    }

    private static String leaveType(String value) {
        if (value == null || !LEAVE_TYPES.contains(value)) throw badRequest();
        return value;
    }

    private static LocalDate date(String value) {
        if (value == null || value.isBlank()) throw badRequest();
        try {
            return LocalDate.parse(value.strip());
        } catch (DateTimeParseException error) {
            throw badRequest();
        }
    }

    private static LocalTime time(String value, boolean required) {
        if (value == null || value.isBlank()) {
            if (required) throw badRequest();
            return null;
        }
        try {
            return LocalTime.parse(value.strip());
        } catch (DateTimeParseException error) {
            throw badRequest();
        }
    }

    private static String required(String value, int max) {
        if (value == null || value.isBlank() || value.strip().length() > max) throw badRequest();
        return value.strip();
    }

    private static String optional(String value, int max) {
        if (value == null || value.isBlank()) return null;
        if (value.strip().length() > max) throw badRequest();
        return value.strip();
    }

    private static long recordId(long id) {
        if (id < 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return id;
    }

    private static void changed(int rows) {
        if (rows == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private static ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST);
    }

    record AttendanceInput(String employeeNumber, String workDate, String clockIn, String clockOut, String note) {}

    record LeaveInput(String employeeNumber, String leaveType, String startsOn, String endsOn, String note) {}

    record OvertimeInput(String workDate, String employeeNumber, String startsAt, String endsAt, String reason) {}

    record TripInput(String employeeNumber, String place, String startsOn, String endsOn, String reason) {}
}
