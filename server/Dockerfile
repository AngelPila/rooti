# Rooti web for Coolify: the static app plus the Vecinos API. Build context: the repo root.
#   docker build -f server/Dockerfile -t rooti-web .
FROM node:22-alpine
WORKDIR /srv/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev --no-audit --no-fund
COPY server/ ./
COPY app/ /srv/app/
ENV NODE_ENV=production PORT=3000 APP_DIR=/srv/app TRUST_PROXY=1
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
