# Deploy the Kingsen API on your Coolify server

Your Hetzner server runs **Coolify** (with Traefik on 80/443) and already hosts
artnomad.nl. We deploy the API as a new Coolify resource from GitHub — Coolify
handles HTTPS, the subdomain, restarts and logs. Your existing apps are untouched.

- **Repo:** https://github.com/kreamart-art/kingsen-server  (public, branch `main`)
- **Chosen domain:** `https://kingsen-api.artnomad.nl`  (artnomad.nl has wildcard DNS → already resolves to the server, no DNS change needed)
- **Internal port:** `8787`

## Steps in the Coolify UI

1. **Open Coolify** → `http://178.105.193.198:8000` (or your Coolify domain) and log in.

2. **+ New → Resource** → choose **Public Repository** (it's a public repo, no GitHub auth needed).
   - Repository URL: `https://github.com/kreamart-art/kingsen-server`
   - Branch: `main` → **Continue**.

3. **Build pack:** select **Dockerfile** (the repo has one). Coolify auto-detects it; if it asks, point it at `Dockerfile` in the root.

4. **Domain:** in the resource's **Configuration → General**, set the domain to:
   ```
   https://kingsen-api.artnomad.nl
   ```
   Coolify + Traefik will request a Let's Encrypt certificate automatically.

5. **Port:** set the **Ports Exposes** / internal port to **8787** (matches the Dockerfile's EXPOSE). Coolify maps the public 443 → container 8787.

6. **Persistent storage (so the gallery survives redeploys):**
   **Storages → Add** a volume mount:
   - Destination path in container: `/data`
   (Name/source is auto-managed by Coolify. The DB file is `/data/kingsen.db`.)

7. **Environment variables** (Configuration → Environment Variables) — add:
   ```
   KINGSEN_ORIGINS=*
   ```
   `*` lets any origin call the API. Fine to launch with; once the app has a fixed
   domain, change it to that domain (comma-separated) to lock it down.
   *(PORT and KINGSEN_DB are already baked into the Dockerfile — no need to set them.)*

8. **Deploy.** Watch the build logs; first build compiles the image (~1–2 min).

## Verify it's live

Once deployed, from anywhere:
```
curl https://kingsen-api.artnomad.nl/health
# -> {"ok":true,"engine":"better-sqlite3"}
curl https://kingsen-api.artnomad.nl/sets
# -> the 4 example sets (auto-seeded on first boot)
```

## Connect the app

The app already has `kingsen/.env.production` set to this URL. Build & deploy the
front-end:
```
cd kingsen
npm run build       # bakes in VITE_KINGSEN_API=https://kingsen-api.artnomad.nl
# deploy dist/ wherever you host the app (or as a second Coolify static resource)
```
In the gallery, the "lokaal (geen server)" badge disappears once it's talking to
the live API.

## Notes
- The container **auto-seeds** the 4 example sets on first boot (empty DB only).
- `better-sqlite3` builds inside the Node 20 image — no host toolchain needed.
- Logs & restarts: all in the Coolify resource view.
- Backups: the whole gallery is the single file `/data/kingsen.db` in the volume.
