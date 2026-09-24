#!/bin/sh
# Railway (and most PaaS) mounts volumes root-owned; the app runs as
# node. Hand the volume to node before dropping privileges, then exec
# whatever command Railway/docker asked for.
set -e
if [ -d /data ]; then
  chown -R node:node /data 2>/dev/null || true
fi
exec su -s /bin/sh node -c "$*"
