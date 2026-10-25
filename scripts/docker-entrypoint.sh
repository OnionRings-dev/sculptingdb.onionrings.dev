#!/bin/sh
set -eu

# Compose connects to its own database, independently of the local DATABASE_URL.
# Encode the raw password so characters such as @, / and : work in a URL.
export DATABASE_URL="$(bun -e '
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) throw new Error("POSTGRES_PASSWORD is required");
  process.stdout.write(`postgresql://sculpting:${encodeURIComponent(password)}@postgres:5432/sculpting_db`);
')"

exec "$@"
