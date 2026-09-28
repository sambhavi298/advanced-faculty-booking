# Docker

- `postgres/init/` — scripts run once when the `db` container initialises an empty volume
  (creates the separate integration-test database).
- Dockerfiles for the API and the portals are added in **Phase 10**, together with the production
  `docker-compose` profile, so the whole system starts with one command.
