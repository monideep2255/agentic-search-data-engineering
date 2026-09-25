#!/bin/bash
# Auto-retry rsync to VPS until completion. Resumes from --partial on each drop.
# Home Wi-Fi + consumer router drops SSH sessions after ~5 min / ~1.4 GB.
#
# Required environment variables:
#   KG_SERVER_HOST  - server address to rsync to, e.g. root@203.0.113.10
#   KG_LOCAL_SRC    - local source directory to sync from
#   KG_SSH_BIN      - path to the ssh binary used by rsync's -e flag
#   KG_SSH_KEY      - path to the ssh private key
set -u
: "${KG_SERVER_HOST:?set KG_SERVER_HOST to the server address, e.g. root@203.0.113.10}"
: "${KG_LOCAL_SRC:?set KG_LOCAL_SRC to the local source directory to sync from}"
: "${KG_SSH_BIN:?set KG_SSH_BIN to the path of the ssh binary used by rsync}"
: "${KG_SSH_KEY:?set KG_SSH_KEY to the path of the ssh private key}"
MAX_RETRIES=200
i=0
while [ $i -lt $MAX_RETRIES ]; do
  i=$((i + 1))
  echo "=== attempt $i at $(date '+%H:%M:%S') ===" | tee -a /tmp/phase4_rsync.log
  MSYS_NO_PATHCONV=1 rsync -avP --compress --partial --inplace --append --timeout=600 \
    -e "$KG_SSH_BIN -i $KG_SSH_KEY -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=20 -o TCPKeepAlive=yes" \
    "$KG_LOCAL_SRC" \
    "$KG_SERVER_HOST":/root/data/kgx/merged/ 2>&1 | tee -a /tmp/phase4_rsync.log
  rc=${PIPESTATUS[0]}
  if [ $rc -eq 0 ]; then
    echo "=== rsync complete after $i attempts at $(date '+%H:%M:%S') ===" | tee -a /tmp/phase4_rsync.log
    exit 0
  fi
  echo "attempt $i exited $rc, sleeping 10s" | tee -a /tmp/phase4_rsync.log
  sleep 10
done
echo "=== gave up after $MAX_RETRIES attempts ===" | tee -a /tmp/phase4_rsync.log
exit 1
