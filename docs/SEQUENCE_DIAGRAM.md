# Sequence Diagrams

Each diagram shows a real flow through the code, from the portal to PostgreSQL.

## 1. Login

```mermaid
sequenceDiagram
  autonumber
  actor S as Student
  participant P as Student portal
  participant C as @afb/api-client
  participant A as API (Express)
  participant AS as AuthService
  participant DB as PostgreSQL

  S->>P: Registration Number + password
  P->>C: auth.login({ loginId, password, role: 'STUDENT' })
  C->>A: POST /api/auth/login
  A->>A: rate limiter (per client + login ID)
  A->>A: validate body (zod), upper-case loginId
  A->>AS: login(request)
  AS->>DB: SELECT id, role, password_hash, is_active FROM users WHERE login_id = $1
  DB-->>AS: row (or none)
  AS->>AS: bcrypt.compare(password, hash) — against a dummy hash if no row
  alt unknown ID or wrong password
    AS-->>A: 401 INVALID_CREDENTIALS
  else deactivated / other portal
    AS-->>A: 403 ACCOUNT_DISABLED / WRONG_PORTAL
  else valid
    AS->>DB: BEGIN, set_config('app.user_id', …), UPDATE users SET last_login_at = now(), COMMIT
    Note over DB: audit trigger records the UPDATE as done by this user
    AS->>DB: SELECT user + batch/department profile
    AS->>AS: sign JWT { sub: userId, role } (HS256, 8 h)
    AS-->>A: { token, expiresAt, user }
  end
  A-->>C: 200 JSON (or error envelope)
  C->>C: tokenStore.set(token, expiresAt)
  C-->>P: LoginResponse
  P-->>S: dashboard
```

## 2. Any authenticated request

```mermaid
sequenceDiagram
  autonumber
  participant P as Portal
  participant C as @afb/api-client
  participant A as API
  participant M as authenticate middleware
  participant DB as PostgreSQL

  P->>C: api.auth.me()  (or any other call)
  C->>C: request interceptor adds Authorization: Bearer <token>
  C->>A: GET /api/auth/me
  A->>M: default-deny: every non-public route passes here
  M->>M: verify signature, algorithm, issuer, audience, expiry
  M->>DB: SELECT role, is_active FROM users WHERE id = $1
  alt token invalid / expired / account deactivated
    M-->>C: 401 UNAUTHENTICATED
    C->>C: tokenStore.clear(), then onSessionExpired()
    C-->>P: ApiError → redirect to login
  else valid
    M->>A: req.auth = { userId, role }  (the only source of identity)
    A->>A: authorize(role) where the route requires it
    A-->>C: 200 JSON
    C-->>P: typed result
  end
```

## 3. Booking a slot — four students at the same instant

```mermaid
sequenceDiagram
  autonumber
  actor A as Student A
  actor B as Students B, C, D
  participant API as API (AppointmentService)
  participant DB as PostgreSQL

  par same instant
    A->>API: POST /api/appointments { facultyId, startsAt, purpose }
  and
    B->>API: POST /api/appointments (same faculty, same startsAt) ×3
  end
  API->>DB: 4 transactions, each: BEGIN, set_config(app.user_id), INSERT … SELECT FROM faculty
  Note over DB: BEFORE INSERT trigger check_appointment_request() — future? offered slot? faculty free? student free?
  DB->>DB: exclusion constraint appointments_no_double_booking (GiST: faculty_id =, slot &&)
  Note over DB: A's index entry goes in first. B, C, D find a conflicting entry from an uncommitted transaction and WAIT.
  DB-->>API: A: INSERT ok, notification + audit rows written, COMMIT
  DB-->>API: B, C, D: waiting ends, conflict is real, SQLSTATE 23P01
  API-->>A: 201 Created (PENDING)
  API-->>B: 409 SLOT_CONFLICT "This slot has just been taken by another request…" ×3
```

## 4. Approving a request while another decision races it

```mermaid
sequenceDiagram
  autonumber
  actor F as Faculty (tab 1: Approve)
  actor F2 as Faculty (tab 2: Reject)
  participant API as API (AppointmentService)
  participant DB as PostgreSQL

  F->>API: PATCH /api/appointments/:id/approve
  F2->>API: PATCH /api/appointments/:id/reject
  API->>DB: T1: BEGIN, SELECT … FROM appointments WHERE id = $1 FOR UPDATE
  API->>DB: T2: BEGIN, SELECT … FOR UPDATE (blocks on T1's row lock)
  API->>API: T1: status PENDING and owned by caller, so approve
  API->>DB: T1: UPDATE status = 'APPROVED'
  Note over DB: BEFORE UPDATE trigger validates the transition, sets decided_at. AFTER trigger notifies the student, audit logs it.
  API->>DB: T1: COMMIT (lock released)
  DB-->>API: T2: row returned, now APPROVED
  API->>DB: T2: ROLLBACK
  API-->>F: 200 APPROVED
  API-->>F2: 409 INVALID_STATUS_TRANSITION "This request has already been approved."
```
