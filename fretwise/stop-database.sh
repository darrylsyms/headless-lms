#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
pg_ctl -D tmp/postgres stop -m fast
