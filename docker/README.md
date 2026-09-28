# Docker

| File                | Purpose                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `api.Dockerfile`    | API image: TypeScript compiled in a build stage; runtime has production dependencies, `dist/` and `database/` |
| `api-entrypoint.sh` | Container start: generate a JWT secret if none is set, `db setup` (migrate + seed an empty DB), serve         |
| `web.Dockerfile`    | One portal (`--build-arg APP=student\|faculty\|admin`): Vite build served by nginx                            |
| `nginx/portal.conf` | SPA fallback, `/api` proxy to the API container, asset caching, security headers                              |
| `postgres/init/`    | Run once when the `db` container initialises an empty volume (creates the integration-test database)          |

`docker compose up --build` (repository root) starts everything; see `docs/DEPLOYMENT.md`.
