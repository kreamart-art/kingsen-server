# Kingsen community-sets API

A tiny, self-contained API for the "Populaire sets" gallery: Node + Express + SQLite.
One small `server.js`, one database file, no external services. Runs comfortably on
the smallest Hetzner VPS.

**SQLite engine — automatic.** The server prefers [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
(fast, prebuilt binary on Node 20 — the recommended deploy). If it isn't installed,
it transparently falls back to Node's built-in `node:sqlite` (Node 22.5+), which needs
**no compile step and no native deps**. So:

- **Node 20 + `npm install`** → uses better-sqlite3 (best for production). ✅ recommended
- **Node 22.5+ without better-sqlite3** → uses node:sqlite; start with
  `node --experimental-sqlite server.js` (the flag is required until Node marks it stable).

Both are verified to behave identically against this code.

## What it does

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | liveness check |
| GET  | `/sets?q=&lang=&sort=` | list sets (`sort` = `popular`\|`likes`\|`new`) |
| GET  | `/sets/:id` | one set |
| POST | `/sets` | publish a set `{ name, author, lang, code }` |
| POST | `/sets/:id/like` | toggle like (idempotent per client) |
| POST | `/sets/:id/use` | increment play count |
| POST | `/sets/:id/report` | report; auto-hides at 5 distinct reports |

- Sets are stored as opaque `KGS1.` share-codes — the server never parses rules.
- Anonymous client identity via the `X-Client-Id` header (the app generates one).
- Rate limited: 20 writes/min/IP, 30 publishes/hour/IP.
- Duplicate publishes (same code) return the existing row instead of a copy.

## Local run

```bash
cd server
npm install
npm run seed      # optional: load the 4 example sets
npm start         # -> http://localhost:8787
curl localhost:8787/health
```

## Point the app at it

In the **app** root (not the server folder), create `.env`:

```
VITE_KINGSEN_API=http://localhost:8787
```

Rebuild/restart Vite. `src/setsApi.js` auto-switches from the localStorage mock to
HTTP whenever `VITE_KINGSEN_API` is set. With it empty, the app stays fully offline
on the mock — so the gallery works even before the server exists.

---

## Deploy to Hetzner (Ubuntu 22.04/24.04)

Assumes a fresh VPS and a domain (e.g. `api.kingsen.app`) pointed at its IP.

### 1. Install Node 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
node -v
```

(`build-essential` is needed because `better-sqlite3` compiles a native module.)

### 2. Create a user + app dir

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin kingsen
sudo mkdir -p /opt/kingsen
```

### 3. Upload the server

From your machine:

```bash
# from kingsen/server
rsync -av --exclude node_modules --exclude '*.db*' ./ root@YOUR_IP:/opt/kingsen/
```

Then on the server:

```bash
cd /opt/kingsen
sudo -u kingsen npm install --omit=dev
sudo -u kingsen npm run seed        # optional
sudo chown -R kingsen:kingsen /opt/kingsen
```

### 4. Run it as a service

```bash
sudo cp /opt/kingsen/kingsen.service /etc/systemd/system/kingsen.service
# edit the Environment=KINGSEN_ORIGINS line to your real domain(s)
sudo systemctl daemon-reload
sudo systemctl enable --now kingsen
sudo systemctl status kingsen        # should be "active (running)"
curl localhost:8787/health
```

### 5. Reverse proxy + HTTPS (Caddy = easiest)

Caddy gets you automatic Let's Encrypt TLS in two lines.

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```
api.kingsen.app {
    reverse_proxy localhost:8787
}
```

```bash
sudo systemctl reload caddy
```

Now `https://api.kingsen.app/health` works. Set the app's `.env`:

```
VITE_KINGSEN_API=https://api.kingsen.app
```

Rebuild the app (`npm run build`) and deploy the static `dist/` to your web host.

> Prefer nginx? Proxy `location / { proxy_pass http://localhost:8787; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }` and add TLS with `certbot`. The server already trusts one proxy hop (`trust proxy`, 1).

### 6. Updating later

```bash
rsync -av --exclude node_modules --exclude '*.db*' ./ root@YOUR_IP:/opt/kingsen/
ssh root@YOUR_IP 'cd /opt/kingsen && sudo -u kingsen npm install --omit=dev && systemctl restart kingsen'
```

## Moderation

The DB is a plain SQLite file. To hide a bad set manually:

```bash
sqlite3 /opt/kingsen/kingsen.db "UPDATE sets SET hidden=1 WHERE id='s_xxxx';"
```

Reported sets auto-hide at 5 distinct reports; review them with:

```bash
sqlite3 /opt/kingsen/kingsen.db "SELECT id,name,author,reports,hidden FROM sets ORDER BY reports DESC LIMIT 20;"
```

## Backups

Everything is in `kingsen.db`. A nightly cron is enough:

```bash
0 4 * * * sqlite3 /opt/kingsen/kingsen.db ".backup '/opt/kingsen/backup-$(date +\%F).db'"
```
