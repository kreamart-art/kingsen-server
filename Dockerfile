# Kingsen community-sets API — container image for Coolify/Docker.
#
# Node 22: better-sqlite3 installs its prebuilt binary AND node:sqlite is built in
# as a guaranteed fallback (the server's db.js prefers better-sqlite3, falls back
# to node:sqlite). NODE_OPTIONS enables the experimental flag the fallback needs.
FROM node:22-bookworm-slim

# Toolchain so better-sqlite3 can compile if no prebuilt binary matches. Minimal.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching. Use the lockfile for reproducibility;
# include optional deps (better-sqlite3) explicitly.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional || npm install --omit=dev --include=optional

# App code
COPY . .

# DB lives here — mount this dir as a persistent volume in Coolify so the
# gallery survives redeploys.
ENV KINGSEN_DB=/data/kingsen.db
ENV PORT=8787
# Lets node:sqlite work as a fallback if better-sqlite3 is ever unavailable.
ENV NODE_OPTIONS=--experimental-sqlite
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
