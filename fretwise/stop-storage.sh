#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
pidfile="$(pwd)/tmp/minio.pid"
[ -f "$pidfile" ] || exit 0
pid=$(cat "$pidfile")
case "$pid" in ''|*[!0-9]*) exit 1 ;; esac
command=$(ps -p "$pid" -o command= 2>/dev/null || true)
case "$command" in
  *minio*"$(pwd)/tmp/minio-data"*) kill "$pid" ;;
  '') ;;
  *) echo "Storage PID does not match this local server; leaving it running." >&2; exit 1 ;;
esac
rm -f "$pidfile"
