# Deploying ai-rag-saas

You need:

- **Postgres with pgvector** (for embeddings and vector search)
- **Node 18+** (Next.js 15)
- **Persistent storage** for uploaded docs and images (files under `storage/` or `STORAGE_PATH`)
- **Env vars**: `DATABASE_URL`, `OPENAI_API_KEY`, `ADMIN_API_KEY`, `CHAT_API_KEY` (and optionally `REPLICATE_API_TOKEN`, `HUGGINGFACE_API_KEY`, `ESCALATION_WEBHOOK_URL`)

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
   - `OPENAI_API_KEY`, `ADMIN_API_KEY`, `CHAT_API_KEY` (required).
   - Optional: `REPLICATE_API_TOKEN`, `HUGGINGFACE_API_KEY`, `ESCALATION_WEBHOOK_URL`.

5. **Persistent storage for uploads**
   - In the app service → **Settings** → **Volumes** → add a volume and mount it at `/app/storage` (or another path).
   - Add variable: `STORAGE_PATH=/app/storage` (or the path you chose).

6. **Run DB setup once** (after first deploy):
   - Use Railway’s **Shell** for the app service, or run locally with `DATABASE_URL` pointing at the deployed DB:
   ```bash
   npm run db:push
   npx tsx scripts/init-vector-extension.ts
   npm run db:seed
   ```

7. Deploy; Railway will build and run the app. Use the generated URL for the app and admin.

---

## Option 2: Docker on a VPS (one server, full control)

Use this to run the app + Postgres on a single Linux server (e.g. DigitalOcean, Hetzner, EC2).

1. **On the server**, clone the repo and go to the project root.

2. **Create a production env file** (e.g. `.env.production`), with at least:
   ```env
   POSTGRES_PASSWORD=your_secure_password_here
   OPENAI_API_KEY=sk-...
   ADMIN_API_KEY=...
   CHAT_API_KEY=...
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
