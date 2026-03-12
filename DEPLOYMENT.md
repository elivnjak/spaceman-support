# Deploying ai-rag-saas

You need:

- **Postgres with pgvector** (for embeddings and vector search)
- **Node 18+** (Next.js 15)
- **Persistent storage** for uploaded docs and images (files under `storage/` or `STORAGE_PATH`)
- **Env vars**: `DATABASE_URL`, `OPENAI_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `REPLICATE_API_TOKEN`, `HUGGINGFACE_API_KEY`, `ESCALATION_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)

---

## Option 1: Railway (easiest, no Docker)

1. **Create a project** at [railway.app](https://railway.app), connect your Git repo.

2. **Add Postgres with pgvector**
   - In the project, click **+ New** → **Database** → **PostgreSQL**.
   - Railway’s Postgres supports extensions. After the DB is created, in the Postgres service open **Variables** and copy `DATABASE_URL` (you’ll use it in the app).

   If your Railway Postgres doesn’t allow `CREATE EXTENSION vector`, use **Neon** instead:
   - Create a project at [neon.tech](https://neon.tech), create a database, and copy the connection string. Neon supports pgvector by default.

3. **Add the app**
   - **+ New** → **GitHub Repo** → select this repo.
   - Railway will detect Next.js. Set the **Root Directory** if needed, and **Build Command**: `npm run build`, **Start Command**: `npm start`.

4. **Set environment variables** (in the app service → **Variables**):
   - `DATABASE_URL` — from step 2 (or Neon).
   - `OPENAI_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (required).
   - Optional: `REPLICATE_API_TOKEN`, `HUGGINGFACE_API_KEY`, `ESCALATION_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

5. **Persistent storage for uploads**
   - In the app service → **Settings** → **Volumes** → add a volume and mount it at `/app/storage` (or another path).
   - Add variable: `STORAGE_PATH=/app/storage` (or the path you chose).
   - Error logs are persisted automatically at `STORAGE_PATH/logs`. Optional override: `ERROR_LOGS_PATH=/app/storage/logs`.
   - Admin UI backups are stored on that same persistent volume under `STORAGE_PATH/__backups`. This is required if you want backup archives to survive deploys and restarts.
   - Backup creation uses temporary working files in the container temp directory, but the final backup archives and metadata stay on the mounted volume.
   - A restore replaces the app database and storage contents from the selected backup, but preserves the stored backup library itself and excludes error logs from backup/restore payloads.
   - Because full restore includes users and sessions, restoring a Railway instance may immediately log out the current admin and replace credentials with the ones from the restored backup.

6. **Migrations run automatically on Railway deploy**
   - This repo uses Railway’s **pre-deploy command** in `railway.json`: `npm run db:setup` runs before each deploy (pgvector + migrations + seed). The **start command** is `npm start` so the app starts quickly and is not killed by startup timeouts.
   - Because setup is idempotent, this is safe on repeated deploys.

   If you need to run setup manually (for recovery/debugging), Railway doesn’t have a “Shell” in the dashboard; use one of these:

   **Option A — From your computer (recommended)**  
   The app’s `DATABASE_URL` on Railway often uses the **internal** host (`Postgres.railway.internal`), which is only reachable from services running on Railway—not from your machine. So `railway run npm run db:setup` can fail with `getaddrinfo ENOTFOUND Postgres.railway.internal`.

   Use the **TCP Proxy** URL when running setup locally (not the Public Networking domain). Domains like `*.up.railway.app` are for HTTP and will timeout for Postgres:
   1. In Railway: **Postgres** service → **Settings** → **Networking** → **TCP Proxy**. If none exists, add one for internal port `5432`.
   2. Note the **TCP Proxy** host (e.g. `monorail.proxy.rlwy.net`) and **port** (e.g. `12345`). In `.env.production` set `POSTGRES_HOST` to that host and `POSTGRES_PORT` to that port, then run `npm run railway:setup:prod`.
   After that, your deployed app can keep using the internal URL; only this one-off setup uses the TCP proxy.

   **Option B — Shell inside the deployed app**  
   From your machine: `railway ssh` to open a shell in the running container, then:
   ```bash
   npm run db:setup
   ```

   **Option C — Pre-deploy (already in repo)**  
   `railway.json` sets `preDeployCommand: ["npm", "run", "db:setup"]`, so migrations and seed run automatically before each deploy. No dashboard change needed.

   `db:setup` runs migrations, enables pgvector, and seeds the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

   **If the app returns 500 or “relation users does not exist”**  
   The app is using a different database than the one you migrated. In Railway, open the **app** service → **Variables** → `DATABASE_URL` and note the **database name** in the URL (e.g. `.../railway` → name is `railway`). In `.env.production`, set `POSTGRES_DB` to that exact name, then run `npm run railway:setup:prod` again.

7. Deploy; Railway will build and run the app. Use the generated URL for the app and admin.

---

## Option 2: Docker on a VPS (one server, full control)

Use this to run the app + Postgres on a single Linux server (e.g. DigitalOcean, Hetzner, EC2).

1. **On the server**, clone the repo and go to the project root.

2. **Create a production env file** (e.g. `.env.production`), with at least:
   ```env
   POSTGRES_PASSWORD=your_secure_password_here
   OPENAI_API_KEY=sk-...
   ADMIN_EMAIL=admin@admin.com
   ADMIN_PASSWORD=choose_a_strong_password
   ```
   `DATABASE_URL` is set automatically from `POSTGRES_PASSWORD`. Do not commit `.env.production`.

3. **Start everything**:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d
   ```

4. **Run DB setup once** (pgvector + schema + seed):
   ```bash
   docker compose -f docker-compose.prod.yml exec app npm run db:push
   docker compose -f docker-compose.prod.yml exec app npx tsx scripts/init-vector-extension.ts
   docker compose -f docker-compose.prod.yml exec app npm run db:seed
   ```

5. Put a reverse proxy (e.g. Caddy, Nginx) in front of the app on port 3000 and add TLS. Example Caddy:
   ```text
   your-domain.com {
     reverse_proxy localhost:3000
   }
   ```

The app will be at `http://localhost:3000` (or your domain). Storage is persisted in the `app_storage` volume.

---

## Option 3: Vercel + external Postgres (serverless app)

- **App**: Deploy to [Vercel](https://vercel.com) (import repo, Next.js is auto-detected).
- **Database**: Use [Neon](https://neon.tech) or [Supabase](https://supabase.com) (both support pgvector). Add `DATABASE_URL` and other env vars in Vercel.
- **Caveat**: Vercel’s filesystem is ephemeral. The app currently writes uploads to the filesystem (`storage/`). For production you’d either:
  - Use a **Vercel Blob** or **S3/R2** store and change the app to use that instead of local files, or
  - Use Option 1 or 2 where the app has a persistent disk.

So Option 3 is only “easiest” if you’re okay changing the storage layer to object storage; otherwise prefer Option 1 or 2.

---

## Summary

| Option              | Effort   | Best for                          |
|---------------------|----------|-----------------------------------|
| **1. Railway**      | Lowest   | Quick live deploy, minimal ops    |
| **2. Docker (VPS)** | Medium   | One server, full control, no code changes |
| **3. Vercel + Neon**| Low*     | Serverless; needs storage changes |

\* Requires code changes for persistent file storage.
