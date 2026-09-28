# syntax=docker/dockerfile:1
# One portal (student, faculty or admin) as static files served by nginx, which also forwards /api
# to the API container — the browser only ever talks to one origin.
#   docker build -f docker/web.Dockerfile --build-arg APP=student -t afb-student .

# ---- Build: Vite production bundle -----------------------------------------------------------
FROM node:22-bookworm-slim AS build
ARG APP
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui/package.json packages/ui/
COPY services/api/package.json services/api/
COPY apps/student/package.json apps/student/
COPY apps/faculty/package.json apps/faculty/
COPY apps/admin/package.json apps/admin/
COPY e2e/package.json e2e/
RUN npm ci --workspace "@afb/${APP}" --include-workspace-root --no-audit --no-fund
COPY packages packages
COPY apps/${APP} apps/${APP}
RUN npm run build --workspace "@afb/${APP}"

# ---- Runtime: nginx ---------------------------------------------------------------------------
FROM nginx:1.29-alpine
ARG APP
COPY docker/nginx/portal.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/${APP}/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
