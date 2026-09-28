# API Documentation

Base URL: `http://localhost:4000/api` (the portals call `/api`, which their dev servers proxy to the API).
All request and response bodies are JSON. Timestamps are ISO 8601 with offset (`2030-01-07T05:10:00.000Z`).

This document grows with each phase; it always describes endpoints that exist and are tested.

## Conventions

### Authentication

Every endpoint except `POST /auth/login`, `GET /health` and `GET /health/ready` requires

```
Authorization: Bearer <token>
```

where `<token>` is the JWT returned by `POST /auth/login`. The API is **default-deny**: any route not
explicitly public — including unknown routes — answers `401` without a valid token.

A token is refused (401) when it is missing, malformed, signed with another key, expired, or when the
account behind it has since been deactivated or deleted. Identity headers such as `X-User-Id` are ignored.

### Errors

Every error uses one envelope; clients branch on `code`, never on `message`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Enter your login ID.",
    "details": { "issues": [{ "field": "loginId", "message": "Enter your login ID." }] },
    "requestId": "6c1f4f0e-6a9f-4c1b-9d0a-3f2a8c7e5b11"
  }
}
```

`requestId` is also sent as the `X-Request-Id` response header and appears in the server log line for the
request. `details` is present only when useful (validation issues, the violated constraint).

| Status | `code`                                                                                                                                                               | Meaning                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`                                                                                                                                                   | Input failed validation; `details.issues` lists each field                           |
| 400    | `MALFORMED_JSON`                                                                                                                                                     | Body is not valid JSON                                                               |
| 400    | `SLOT_IN_PAST`, `SLOT_BEYOND_HORIZON`, `PERIOD_ALREADY_ENDED`, `INVALID_REFERENCE`                                                                                   | Request is well-formed but not acceptable (booking rules — Phase 4/5)                |
| 401    | `UNAUTHENTICATED`                                                                                                                                                    | Missing, invalid or expired token                                                    |
| 401    | `INVALID_CREDENTIALS`                                                                                                                                                | Wrong login ID or password (identical for both)                                      |
| 403    | `FORBIDDEN`                                                                                                                                                          | Signed in, but this role may not do this                                             |
| 403    | `ACCOUNT_DISABLED`                                                                                                                                                   | Correct password, but the account is deactivated                                     |
| 403    | `WRONG_PORTAL`                                                                                                                                                       | Correct password, but the account belongs to another portal                          |
| 404    | `NOT_FOUND`, `ROUTE_NOT_FOUND`                                                                                                                                       | No such resource / no such route                                                     |
| 409    | `SLOT_CONFLICT`, `STUDENT_SCHEDULE_CONFLICT`, `FACULTY_UNAVAILABLE`, `STUDENT_HAS_CLASS`, `SLOT_NOT_OFFERED`, `INVALID_STATUS_TRANSITION`, `AVAILABILITY_OVERLAP`, … | Conflicts with current data, detected by PostgreSQL (see `DATABASE_DESIGN.md` § 4.2) |
| 409    | `TRANSACTION_CONFLICT`, `RESOURCE_BUSY`                                                                                                                              | Concurrent modification; safe to retry                                               |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                                                                                  | Body over 100 kB                                                                     |
| 429    | `TOO_MANY_REQUESTS`                                                                                                                                                  | Too many failed login attempts                                                       |
| 500    | `INTERNAL_ERROR`                                                                                                                                                     | Unexpected; details are only in the server log                                       |
| 503    | `DATABASE_UNAVAILABLE`                                                                                                                                               | Database unreachable or overloaded; retry later                                      |

---

## Health

### `GET /health` — liveness (public)

```json
200 { "status": "ok", "uptimeSeconds": 42, "timestamp": "2026-09-28T10:00:00.000Z" }
```

### `GET /health/ready` — readiness (public)

Checks that PostgreSQL is reachable and at least version 18.

```json
200 { "status": "ready", "database": { "reachable": true, "serverVersion": "18.4", "name": "advanced_faculty_booking" } }
503 { "status": "not_ready", "reason": "database_unreachable", "database": { "reachable": false, "minimumVersion": "18" } }
503 { "status": "not_ready", "reason": "unsupported_postgres_version", "database": { "reachable": true, "serverVersion": "16.4", "minimumVersion": "18" } }
```

---

## Authentication

### `POST /auth/login` (public, rate limited)

| Field      | Type                                    | Rules                                                                                                                     |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `loginId`  | string                                  | Registration Number (student), Employee ID (faculty) or Admin ID. Required; case-insensitive; surrounding spaces ignored. |
| `password` | string                                  | Required.                                                                                                                 |
| `role`     | `"STUDENT"` \| `"FACULTY"` \| `"ADMIN"` | Optional. The portal being used; an account of another role gets `403 WRONG_PORTAL`.                                      |

```http
POST /api/auth/login
Content-Type: application/json

{ "loginId": "RA221100301001", "password": "Password123!", "role": "STUDENT" }
```

`200 OK`

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "expiresAt": "2026-09-28T18:00:00.000Z",
  "user": {
    "id": 1,
    "loginId": "RA221100301001",
    "fullName": "Priya Sharma",
    "role": "STUDENT",
    "student": {
      "batchId": 1,
      "batchName": "Batch 1",
      "yearOfStudy": 3,
      "academicYear": "2026-2027",
      "departmentCode": "CSE",
      "departmentName": "Computer Science and Engineering"
    }
  }
}
```

A faculty `user` carries `faculty: { departmentId, departmentCode, departmentName, designation,
officeLocation, slotMinutes }`; an admin `user` has no profile object.

| Status | `code`                | When                                                                                                                                                                             |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`    | `loginId` or `password` missing, or `role` not one of the three                                                                                                                  |
| 401    | `INVALID_CREDENTIALS` | Unknown login ID **or** wrong password — deliberately indistinguishable                                                                                                          |
| 403    | `ACCOUNT_DISABLED`    | Right password, deactivated account                                                                                                                                              |
| 403    | `WRONG_PORTAL`        | Right password, other role: "This is a faculty account. Please sign in on the Faculty portal."                                                                                   |
| 429    | `TOO_MANY_REQUESTS`   | More than `LOGIN_RATE_LIMIT_MAX` failed attempts (default 10) for this client and login ID within `LOGIN_RATE_LIMIT_WINDOW` (default 15 min). Successful logins are not counted. |

Security notes: the password is compared with bcrypt; for an unknown login ID a comparison against a
dummy hash of the same cost still runs, so response time does not reveal which IDs exist. The token is an
HS256 JWT with `sub` (user id), `role`, issuer `afb-api`, audience `afb-portals`, valid for
`JWT_EXPIRES_IN` (default 8 h). The login updates `users.last_login_at`, which the audit log records as an
action by that user.

### `GET /auth/me` (any role)

Returns the same `user` object as login, for the account identified by the token. Portals call it on start-up
to restore a session.

| Status | `code`            | When                                                                                                                                                                               |
| ------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | —                 | Token valid                                                                                                                                                                        |
| 401    | `UNAUTHENTICATED` | "Please log in to continue." (no token) · "Your session has expired. Please log in again." · "Your session is no longer valid. Please log in again." (account deactivated/deleted) |

### Signing out

Tokens are stateless: a portal signs out by discarding its token (`apiClient.auth.logout()`). Deactivating an
account ends all of its sessions immediately, because every request re-checks the account.

---

## Appointments

An appointment as every endpoint returns it:

```json
{
  "id": "01999a6e-3c2b-7c41-9f4e-2d0c9a1b7e55",
  "status": "PENDING",
  "startsAt": "2026-09-29T07:50:00.000Z",
  "endsAt": "2026-09-29T08:05:00.000Z",
  "purpose": "Discuss the Advanced SQL mini project",
  "decisionNote": null,
  "createdAt": "2026-09-28T15:40:12.345Z",
  "decidedAt": null,
  "cancelledAt": null,
  "cancelledBy": null,
  "completedAt": null,
  "student": {
    "id": 1,
    "name": "Priya Sharma",
    "registrationNumber": "RA221100301001",
    "batchName": "Batch 1"
  },
  "faculty": {
    "id": 2,
    "name": "Prof. K. Rao",
    "employeeId": "FAC200",
    "designation": "Associate Professor",
    "officeLocation": "Tech Park, 7th Floor, Staff Room 712",
    "departmentCode": "CSE",
    "departmentName": "Computer Science and Engineering"
  }
}
```

`status` is one of `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `COMPLETED`. `cancelledBy` is `STUDENT`,
`FACULTY` (including automatic cancellation when the faculty member records leave) or `null`. Approved
appointments become `COMPLETED` automatically after they end, and requests nobody answered before their start
time become `REJECTED` with the note "Expired: …" — a sweep calls `process_elapsed_appointments()` every
`APPOINTMENT_SWEEP_INTERVAL` (default 1 minute).

### `POST /appointments` (student)

| Field       | Type                      | Rules                                                                                                                                                     |
| ----------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facultyId` | number                    | An existing faculty member                                                                                                                                |
| `startsAt`  | ISO timestamp with offset | The start of one of the faculty member's free slots (`GET /faculty/:id/availability`, Phase 5). The end is derived from the faculty member's slot length. |
| `purpose`   | string                    | 10–500 characters after trimming                                                                                                                          |

`201 Created` with the appointment (`status: "PENDING"`). The faculty member is notified in the same transaction.

| Status | `code`                                 | When                                                                         |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`                     | Field problems, listed per field                                             |
| 400    | `SLOT_IN_PAST` / `SLOT_BEYOND_HORIZON` | Start not in the future / more than 30 days ahead                            |
| 404    | `NOT_FOUND`                            | No such faculty member                                                       |
| 409    | `SLOT_CONFLICT`                        | Another request holds the slot — including one submitted at the same instant |
| 409    | `STUDENT_SCHEDULE_CONFLICT`            | The student already has an active appointment overlapping this time          |
| 409    | `SLOT_NOT_OFFERED`                     | Not one of the faculty member's slots (wrong time or outside availability)   |
| 409    | `FACULTY_UNAVAILABLE`                  | Faculty on leave / in a meeting / teaching / not accepting appointments      |
| 409    | `STUDENT_HAS_CLASS`                    | "You have a class (Compiler Design) at this time."                           |

All of these except validation and 404 are decided by PostgreSQL (trigger + exclusion constraints) and
passed through with the database's user-readable message.

### `GET /appointments/me` (student or faculty)

Query: `status` (optional, one status) · `limit` (1–200, default 100).
Returns the caller's appointments — as the student, or as the faculty member — upcoming first (soonest first),
then past (most recent first), plus counts per status for tab badges (not affected by the filter):

```json
{ "appointments": [ … ], "counts": { "PENDING": 1, "APPROVED": 2, "REJECTED": 0, "CANCELLED": 1, "COMPLETED": 4 } }
```

### `PATCH /appointments/:id/cancel` (student)

Body (optional): `{ "reason": "Doubt resolved in class." }` (≤ 500 characters). The student may cancel their own
`PENDING` request or `APPROVED` appointment that has not started. The faculty member is notified.

| Status | `code`                      | When                                                                                      |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------- |
| 200    | —                           | Cancelled; returns the appointment with `cancelledBy: "STUDENT"`                          |
| 404    | `NOT_FOUND`                 | No such appointment, or it is someone else's                                              |
| 409    | `INVALID_STATUS_TRANSITION` | "This appointment is already rejected and cannot be cancelled." · "…has already started…" |

### `PATCH /appointments/:id/approve` (faculty)

Body (optional): `{ "note": "Bring your ER diagram." }`. Only the faculty member the request was made to, only
while `PENDING`, only before its start time. The student is notified.

### `PATCH /appointments/:id/reject` (faculty)

Body (optional): `{ "reason": "Please attend the doubt-clearing session." }`. Same rules as approve.

| Status | `code`                      | When                                                                                              |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------- |
| 200    | —                           | Decision recorded; returns the appointment                                                        |
| 404    | `NOT_FOUND`                 | No such request, or it was made to another faculty member                                         |
| 409    | `INVALID_STATUS_TRANSITION` | "This request has already been approved." (or rejected/cancelled/completed) · time already passed |

Approve, reject and cancel lock the appointment row (`SELECT … FOR UPDATE`) for the duration of the
transaction, so two simultaneous decisions on one request are serialised: one succeeds, the other receives 409.

### `GET /faculty/pending` (faculty)

The caller's `PENDING` requests, soonest first (array of appointments).

---

## Faculty directory and availability

### `GET /faculty` (any role)

Query: `search` (optional, ≤ 60 characters — matches name substrings, Employee ID prefixes, department code or
designation; results ranked by trigram similarity to the name) · `department` (optional code, e.g. `CSE`).

```json
[
  {
    "id": 2,
    "name": "Prof. K. Rao",
    "employeeId": "FAC200",
    "designation": "Associate Professor",
    "officeLocation": "Tech Park, 7th Floor, Staff Room 712",
    "slotMinutes": 15,
    "department": { "id": 1, "code": "CSE", "name": "Computer Science and Engineering" },
    "weeklyAvailableMinutes": 580,
    "nextAvailableSlot": { "startsAt": "2026-09-29T07:50:00.000Z", "endsAt": "2026-09-29T08:05:00.000Z" }
  }
]
```

`nextAvailableSlot` is the earliest bookable slot in the next 14 days — for a student, the earliest one that
also avoids their own classes and appointments. Deactivated faculty are not listed.

### `GET /faculty/:id/availability` (any role)

Query: `from`, `to` (optional `YYYY-MM-DD`, campus dates; default today … today + 13; at most 31 days).

```json
{
  "faculty": { …FacultySummary… },
  "from": "2026-09-28",
  "to": "2026-10-11",
  "days": [
    { "date": "2026-09-28", "slots": [] },
    { "date": "2026-09-29", "slots": [ { "startsAt": "2026-09-29T07:50:00.000Z", "endsAt": "2026-09-29T08:05:00.000Z" } ] }
  ],
  "weeklyAvailability": [ { "id": 1, "dayOfWeek": 1, "startTime": "10:40", "endTime": "12:25", "durationMinutes": 105 } ],
  "teaching": [ { "dayOfWeek": 1, "startTime": "08:00", "endTime": "08:50", "courseCode": "CS301",
                  "courseTitle": "Computer Networks", "sessionType": "LECTURE", "batchName": "Batch 1", "room": "TP 401" } ]
}
```

Every date in the range appears, with its free slots from `faculty_free_slots()` — already excluding the
past, exceptions, the faculty member's teaching and held slots, and (for a student) the student's classes and
other appointments. Errors: `400 VALIDATION_ERROR` (bad dates, range over 31 days, end before start),
`404 NOT_FOUND`.

### `GET /faculty/availability` (faculty — own settings)

```json
{ "slotMinutes": 15, "windows": [ …StoredAvailabilityWindow… ], "exceptions": [ …ScheduleException (not yet ended)… ] }
```

### `PUT /faculty/availability` (faculty)

Body: `{ "windows": [ { "dayOfWeek": 1, "startTime": "10:40", "endTime": "12:25" }, … ] }` — the complete new
weekly set (≤ 50 windows, `dayOfWeek` 1 = Monday … 7 = Sunday, 24-hour times on a 5-minute grid). Adding,
editing and deleting windows are all done by sending the new set. Only the differences are written (windows
no longer present are deleted, new ones inserted, unchanged ones untouched), in one transaction attributed to
the faculty member.

Returns the new settings plus `{ "added": 2, "removed": 2 }`. Errors: `400 VALIDATION_ERROR` —
"Windows on Monday overlap (10:00–11:00 and 10:30–12:00).", "The end time must be after the start time.",
"Times must be on a 5-minute boundary (e.g. 14:05, 14:10)." — with `409 AVAILABILITY_OVERLAP` from the
database's `WITHOUT OVERLAPS` constraint as the final guard. Existing appointments are not changed.

### `POST /faculty/availability/exceptions` (faculty)

Body: `{ "kind": "LEAVE" | "MEETING" | "BLOCKED", "startsAt": ISO, "endsAt": ISO, "reason"?: string (≤ 300) }`
(at most 31 days long).

`201 Created`:

```json
{
  "exception": {
    "id": 4,
    "kind": "MEETING",
    "startsAt": "…",
    "endsAt": "…",
    "reason": "Board of Studies",
    "createdAt": "…"
  },
  "releasedAppointments": 1
}
```

In the same transaction, PostgreSQL rejects every upcoming `PENDING` request and cancels every upcoming
`APPROVED` appointment inside the period (note: "Faculty unavailable (meeting): Board of Studies") and notifies
each student; `releasedAppointments` says how many. Errors: `400 VALIDATION_ERROR`, `400 PERIOD_ALREADY_ENDED`.

### `DELETE /faculty/availability/exceptions/:id` (faculty)

`204 No Content`. `404` if it does not exist or belongs to someone else. Appointments it released stay released.

---

## Client library (`@afb/api-client`)

```ts
import { createApiClient, createTokenStore, ApiError } from '@afb/api-client';

const api = createApiClient({
  tokenStore: createTokenStore('afb.student.session', window.localStorage),
  onSessionExpired: () => navigate('/login'),
});

await api.auth.login({ loginId, password, role: 'STUDENT' }); // stores the token
const me = await api.auth.me(); // sent with Authorization: Bearer …

try {
  await api.auth.login({ loginId, password });
} catch (err) {
  if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
    /* show message */
  }
  if (err instanceof ApiError) console.log(err.fieldErrors); // { loginId: 'Enter your login ID.' }
}
```

Every call rejects with an `ApiError` (`status`, `code`, `message`, `details`, `requestId`). `NETWORK_ERROR`
means the server could not be reached. When a request that carried a token is answered with 401, the client
clears the token and calls `onSessionExpired`.
