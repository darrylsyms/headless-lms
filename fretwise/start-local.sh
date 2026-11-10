#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if ! pg_ctl -D tmp/postgres status >/dev/null 2>&1; then
  pg_ctl -D tmp/postgres -l "$(pwd)/tmp/postgres.log" -o '-p 8005 -h 127.0.0.1' start
fi
exec corepack pnpm --parallel --filter @headless-lms/api --filter admin --filter student dev
