#!/bin/bash
# Prepares Rooti on every container start, as the hermes user (deploy/cont-init.sh), like Vinci's boot.sh.
set -uo pipefail
export HOME=/opt/data
say() { echo "[rooti] $*"; }
mkdir -p "$ROOTI_DATA"

# Hermes mirrors its read-only bridge to the volume once and then keeps that copy: refresh it from the image.
rm -rf /opt/data/scripts/whatsapp-bridge
mkdir -p /opt/data/scripts && cp -a /opt/hermes/scripts/whatsapp-bridge /opt/data/scripts/

if /opt/rooti/bot/.venv/bin/rooti-bot hermes-perfil; then
  rm -f "$ROOTI_DATA/boot-failed"
else
  touch "$ROOTI_DATA/boot-failed"
  say "hermes-perfil failed: Rooti starts without its profile until the cause is fixed and the container restarts"
fi
