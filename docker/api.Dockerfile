# syntax=docker/dockerfile:1
# REST API image. Build context: the repository root.
#   docker build -f docker/api.Dockerfile -t afb-api .

# ---- Build: compile TypeScript --------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Every workspace manifest first, so `npm ci` is cached until a dependency changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui/package.json packages/ui/
COPY services/api/package.json services/api/
COPY apps/student/package.json apps/student/
COPY apps/faculty/package.json apps/faculty/
COPY apps/admin/package.json apps/admin/
COPY e2e/package.json e2e/
RUN npm ci --workspace @afb/api --include-workspace-root --no-audit --no-fund
COPY packages/types packages/types
COPY services/api services/api
RUN npm run build --workspace @afb/api

# ---- Runtime: production dependencies + compiled JavaScript + SQL ----------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui/package.json packages/ui/
COPY services/api/package.json services/api/
COPY apps/student/package.json apps/student/
COPY apps/faculty/package.json apps/faculty/
COPY apps/admin/package.json apps/admin/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev --workspace @afb/api --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/services/api/dist services/api/dist
# Migrations and the seed are read at start-up (DATABASE_DIR).
COPY database database
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh

WORKDIR /app/services/api
ENV HOST=0.0.0.0 PORT=4000 DATABASE_DIR=/app/database
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["sh", "/usr/local/bin/api-entrypoint.sh"]
