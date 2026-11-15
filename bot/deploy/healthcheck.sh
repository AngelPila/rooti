#!/bin/sh
# Unhealthy when hermes-perfil failed at boot or no gateway process runs (Vinci's healthcheck).
[ -e "${ROOTI_DATA:-/opt/data/rooti}/boot-failed" ] && exit 1
for cmdline in /proc/[0-9]*/cmdline; do
  tr '\0' ' ' < "$cmdline" 2>/dev/null | grep -q '^[^ ]*python[^ ]* .*gateway run' && exit 0
done
exit 1
