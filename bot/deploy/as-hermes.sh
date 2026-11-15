#!/bin/sh
# Installed as /usr/local/bin/rooti-bot (Vinci's as-hermes.sh). Coolify's terminal opens a root shell, and a file root
# writes into /opt/data is one the gateway (user hermes) cannot read: run as hermes instead.
set -- /opt/rooti/bot/.venv/bin/rooti-bot "$@"
[ "$(id -u)" = 0 ] && set -- /command/s6-setuidgid hermes "$@"
HOME=/opt/data exec "$@"
