#!/usr/bin/env bash
# Restore a TARC history DB snapshot from Cloudflare R2.
#
# This never overwrites the live DB. It downloads, decompresses, and verifies a
# snapshot under tmp/tarc-db-backups/, then prints manual swap-in steps.
#
# Usage:
#   scripts/tarc/restore-db.sh --list
#   scripts/tarc/restore-db.sh
#   scripts/tarc/restore-db.sh tarc-YYYYMMDD-HHMMSS.sqlite.gz
#
# Env overrides:
#   RCLONE_REMOTE  rclone remote:bucket target
#                  (default: r2louisville-db:louisville-transit-insights-db-backups)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKDIR="$REPO_DIR/tmp/tarc-db-backups"
REMOTE="${RCLONE_REMOTE:-r2louisville-db:louisville-transit-insights-db-backups}"

if [ "${1:-}" = "--list" ]; then
  rclone lsf "${REMOTE}/" | sort
  exit 0
fi

mkdir -p "$WORKDIR"

NAME="${1:-}"
if [ -z "$NAME" ]; then
  NAME="$(rclone lsf "${REMOTE}/" | sort | tail -1)"
  if [ -z "$NAME" ]; then
    echo "ERROR: no snapshots found in ${REMOTE}" >&2
    exit 1
  fi
  echo "Latest snapshot: $NAME"
fi

rclone copy "${REMOTE}/${NAME}" "$WORKDIR/" --s3-no-check-bucket

GZ="$WORKDIR/$NAME"
RESTORED="${GZ%.gz}"
gunzip -kf "$GZ"

if ! sqlite3 "$RESTORED" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
  echo "ERROR: restored snapshot failed integrity_check: $RESTORED" >&2
  exit 1
fi

echo
echo "Restored + verified: $RESTORED"
echo
echo "To swap it in as the live TARC DB:"
echo "  1. Stop the writers: scripts/tarc/install-crontab.sh --remove"
echo "  2. cp \"$RESTORED\" \"$REPO_DIR/state/tarc.sqlite\""
echo "     (delete state/tarc.sqlite-wal and state/tarc.sqlite-shm if present)."
echo "  3. Re-enable cron: scripts/tarc/install-crontab.sh"
