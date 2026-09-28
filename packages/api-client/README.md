# `@afb/api-client` — typed HTTP client

Used by all three portals. One Axios instance per portal that:

- attaches `Authorization: Bearer <token>` to every request once the user has logged in,
- stores the token per portal (`createTokenStore('afb.student.session', localStorage)`, with an in-memory
  fallback when browser storage is blocked, and expiry awareness),
- turns every failure into a typed `ApiError` (`status`, `code`, `message`, `details`, `requestId`,
  plus `fieldErrors` for form validation), with `NETWORK_ERROR` when the server is unreachable,
- clears the token and calls `onSessionExpired` when an authenticated request is answered with 401,
- exposes one typed function per endpoint (`auth.login`, `auth.me`, `health.ready`, … — extended by each
  backend phase), with request/response types from `@afb/types`.

See [`docs/API_DOCUMENTATION.md`](../../docs/API_DOCUMENTATION.md#client-library-afbapi-client).
