# Rooti on Hermes Agent's official image, the same base and layout as Vinci: one container, one gateway, all state
# in /opt/data. Build from the repo root (the engine imports app/): docker build -f bot/Dockerfile .
FROM nousresearch/hermes-agent:latest@sha256:9774f4f39a9bb8c2f68ce728ed5e99ddbad282163be56764afacf88ed952b784

USER root

# ffmpeg turns Edge TTS's mp3 into voice notes and call audio.
RUN command -v ffmpeg >/dev/null || (apt-get -o Acquire::Retries=3 update && \
    apt-get -o Acquire::Retries=3 install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*)

# The WhatsApp bridge's Node deps: the image ships bridge.js without them, and /opt/hermes is read-only at runtime.
RUN cd /opt/hermes/scripts/whatsapp-bridge && \
    npm ci --no-audit --omit=dev --fetch-retries=5 && \
    npm cache clean --force

COPY app /opt/rooti/app
COPY bot /opt/rooti/bot
# Two venvs: the gateway's tools (light) and the live call (Pipecat, aiortc). Edge TTS also goes into Hermes' venv,
# which speaks the voice notes (voice.auto_tts); Microsoft refuses edge-tts 7.2.7 (403).
RUN python3 -m venv /tmp/uv && /tmp/uv/bin/pip install --no-cache-dir --disable-pip-version-check uv && \
    cd /opt/rooti/bot && \
    /tmp/uv/bin/uv venv --python /usr/local/bin/python3 .venv && \
    /tmp/uv/bin/uv pip install --no-cache --python .venv/bin/python -e . && \
    /tmp/uv/bin/uv venv --python /usr/local/bin/python3 .venv-call && \
    /tmp/uv/bin/uv pip install --no-cache --python .venv-call/bin/python -e ".[call]" && \
    /tmp/uv/bin/uv pip install --no-cache --python /opt/hermes/.venv/bin/python edge-tts==7.3.1 && \
    rm -rf /tmp/uv && \
    install -m 0755 /opt/rooti/bot/deploy/cont-init.sh /etc/cont-init.d/019-rooti && \
    for svc in rooti-avisos rooti-llamada; do \
      cp -r /opt/rooti/bot/deploy/s6/$svc /etc/s6-overlay/s6-rc.d/$svc && \
      touch /etc/s6-overlay/s6-rc.d/user/contents.d/$svc; \
    done

# Set in Coolify: DEEPSEEK_API_KEY (the model), GROQ_API_KEY (voice notes and calls), ROOTI_CALL_SECRET (signs the
# call links) and ROOTI_CALL_URL (the public address of port 7860).
ENV HERMES_HOME=/opt/data \
    ROOTI_DATA=/opt/data/rooti \
    GATEWAY_ALLOW_ALL_USERS=false \
    MALLOC_ARENA_MAX=2

EXPOSE 7860

HEALTHCHECK --interval=60s --timeout=10s --start-period=5m --retries=3 CMD ["/opt/rooti/bot/deploy/healthcheck.sh"]

CMD ["gateway", "run"]
