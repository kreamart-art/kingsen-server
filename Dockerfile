# Kingsen community-sets API — container image for Coolify/Docker.
# Node 20 so better-sqlite3 installs its prebuilt binary (no compile toolchain
# needed in the image).
FROM node:20-bookworm-slim

# better-sqlite3 ships prebuilt binaries for node20-linux-x64; if a rebuild is
# ever needed these let it compile. Kept minimal.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# install deps first for layer caching
COPY package.json ./
RUN npm install --omit=dev

# app code
COPY . .

# DB lives here — mount this dir as a persistent volume in Coolify so the
# gallery survives redeploys.
ENV KINGSEN_DB=/data/kingsen.db
ENV PORT=8787
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

# basic container healthcheck hitting the API
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
