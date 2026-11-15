#!/command/with-contenv sh
# Installed as /etc/cont-init.d/019-rooti: after Hermes' own setup, before the gateway starts.
# A failed step must not stop the container, or nobody could open a shell in it to fix the cause.
s6-setuidgid hermes /opt/rooti/bot/deploy/boot.sh || echo "[rooti] boot.sh failed: see the lines above" >&2
exit 0
