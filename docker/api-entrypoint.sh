#!/bin/sh
# Starts the API container: apply pending migrations, seed an empty database, then serve.
set -e

if [ -z "$JWT_SECRET" ]; then
  # No secret configured: generate a random one for this container. Sessions then last until the
  # container restarts. Set JWT_SECRET (see .env.example) to keep sessions across restarts.
  JWT_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")"
  export JWT_SECRET
  echo "JWT_SECRET not set: generated a random secret for this container."
fi

node dist/db/cli.js setup
exec node dist/server.js
