# RAG Support Agent POC

Visual + text RAG support assistant: upload photos and describe an issue to get a diagnosis and step-by-step fix grounded in reference images, documents, and playbooks.

## Stack

- **Next.js 15** (App Router), TypeScript, Tailwind
- **Postgres 16 + pgvector** (Docker)
- **Drizzle ORM**
- **OpenAI** (GPT-4o, text-embedding-3-small)
- **Image embeddings**: Replicate (TinyCLIP, 512-dim) or HuggingFace (CLIP ViT-B/32 via Inference Endpoints)

## Setup

1. **Clone and install**

   ```bash
   npm install
   ```

2. **Environment**

   ```bash
   cp .env.example .env
   ```

   Set in `.env`:
   - `OPENAI_API_KEY` (required)
   - Optional retrieval tuning:
     - `RETRIEVAL_TEXT_KEYWORD_RANK_WEIGHT` (default `0.4`)
     - `RETRIEVAL_TEXT_EXACT_MATCH_BOOST` (default `0.2`)
   - Optional eval gates:
     - `EVAL_MAX_WRONG_CONFIDENT` (default `0.02`)
     - `EVAL_MAX_UNSAFE_NON_ESCALATION` (default `0`)
     - `EVAL_CASE_LIMIT` (default unset; run full dataset)
   - **Image embeddings** — use one of:
     - `REPLICATE_API_TOKEN` (recommended; get it at [replicate.com/account/api](https://replicate.com/account/api)), or
     - `HUGGINGFACE_API_KEY` and optionally `HUGGINGFACE_CLIP_URL` (your Inference Endpoint URL if the default serverless API returns 410)
       `DATABASE_URL` defaults to `postgres://rag:rag@localhost:5432/rag`.

3. **Database**

   ```bash
   docker compose up -d
   npm run db:init    # create pgvector extension (required before push)
   npm run db:push
   npm run db:seed
   ```

   This starts Postgres, creates the `vector` extension, pushes the schema, then creates HNSW indexes and seeds default labels.

4. **Run**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Documentation

- **[User manual](docs/USER_MANUAL.md)** — End-user and admin guide: Analyse flow, Labels, Reference images, Docs, Playbooks, Test console.
- **[Playbook guide](docs/PLAYBOOK_GUIDE.md)** — Plain-language explanation of playbook sections (Overview, Symptoms, Evidence, Causes, Questions, Triggers, Steps) and how they work together when diagnosing. For anyone maintaining or editing playbooks.
- **[Sample data plan](docs/SAMPLE_DATA_PLAN.md)** — Plan for adding initial sample data and testing specific scenarios (reference images, sample doc, playbooks, test checklist).

## Usage

- **Home** – Link to “Describe issue and upload photos” (end-user flow) and Admin.
- **/analyse** – End-user: enter description, upload 1–3 photos, get diagnosis + steps + similar reference images.
- **/admin** – Dashboard with counts and “Test the assistant”.
- **/admin/labels** – CRUD labels (e.g. good_texture, too_runny, too_icy, too_thick).
- **/admin/images** – Upload reference images (select label first, confirm, duplicate detection), grid with inline label edit and bulk delete.
- **/admin/docs** – Upload PDF/text/md or paste text, preview, then ingest. View chunks with search.
- **/admin/playbooks** – CRUD playbooks per label with steps (step_id, title, instruction, check, if_failed).
- **/admin/test** – Test console: same as analyse but with full debug (matches, chunks, raw JSON).

## Evaluation

Holdout test set is loaded from `data/eval_cases.json` (fallback: `data/test_cases.json`). Test images must live under `data/test_images/` and **must not** be ingested as reference images.

```bash
npm run eval
```

Reports:
- Label accuracy
- Unknown rate
- Wrong-confident rate
- Escalation miss rate
- Unsafe non-escalation labels (dataset count)
- Resolved incorrect labels (dataset count)
- Average time per run

Quality gates fail the command when:
- wrong-confident rate exceeds `EVAL_MAX_WRONG_CONFIDENT` (default `0.02`)
- unsafe non-escalation rate exceeds `EVAL_MAX_UNSAFE_NON_ESCALATION` (default `0`)

## Scripts

- `npm run dev` – Next.js dev server
- `npm run build` / `npm run start` – Production
- `npm run db:push` – Push Drizzle schema to DB
- `npm run db:seed` – Seed labels and ensure vector extension + indexes
- `npm run repo-sync:export` – Export the versionable knowledge-base DB content and referenced uploaded files to `repo_sync/knowledge-base/`
- `npm run repo-sync:import` – Import `repo_sync/knowledge-base/` into the local instance and restore its uploaded files
- `npm run eval` – Run evaluation script
- `npm run playbook:test -- [--suite <name>] [--scenario <id>] [--fix]` – Run the sandboxed playbook regression harness

Detailed usage, model comparison helpers, and tester workflow notes:

- [docs/playbook-testing.md](/Users/elivnjak/Sites/ai-rag-saas/docs/playbook-testing.md)

## Repo Sync

Use the repo sync bundle when one person has updated documents, playbooks, labels, actions, or related admin content and another person needs to pull the repo and get the same knowledge base locally.

Export the current instance into the repo:

```bash
npm run repo-sync:export
```

This writes a bundle to `repo_sync/knowledge-base/`:

- `manifest.json` – export metadata, table counts, file hashes
- `data.json` – the versionable knowledge-base rows
- `files/` – copied storage-backed files referenced by those rows

Commit that folder to git.

On another machine, after pulling the repo and setting up the local database/schema, import it with:

```bash
npm run repo-sync:import
```

Important details:

- Import rewrites storage-backed file paths for the local machine's `STORAGE_PATH`.
- Import is intended for local/dev sync. It clears local support/ticket history so the content tables can be restored cleanly.
- The bundle intentionally excludes auth/secrets/transient tables such as users, sessions, password reset state, Telegram config, and support/audit history.
- If the source or target database is missing some sync tables, the scripts skip them and report that in the console and `manifest.json`.

## Playbook Regression Harness

Scenario packs live under `data/playbook_tests/<scenario-id>/` and must contain:

- `scenario.json`
- `fixtures/` for any scenario-owned placeholder images

The harness:

- clones the current diagnostic data into an isolated sandbox schema
- starts a separate app instance on an ephemeral port
- replays the real `/api/chat` workflow turn by turn
- grades per-turn workflow assertions and final outcomes
- optionally drafts ranked fix candidates and validates them against the full suite

## Troubleshooting

- **HuggingFace CLIP API error: 410** — The serverless HuggingFace API no longer serves `openai/clip-vit-base-patch32`. Fix: set `REPLICATE_API_TOKEN` in `.env` (image embeddings will use Replicate’s TinyCLIP, same 512 dimensions), or deploy the model yourself via [HuggingFace Inference Endpoints](https://ui.endpoints.huggingface.co/) and set `HUGGINGFACE_CLIP_URL` to your endpoint.

## Setting up OpenAI CLIP on HuggingFace Inference Endpoints

Using the same CLIP model (openai/clip-vit-base-patch32) on your own endpoint gives the best quality and keeps compatibility with existing reference image embeddings—but **this model is not in the Inference Endpoints catalog** and the upstream repo has **no `handler.py`**, so HuggingFace will show a warning that deployment will probably fail.

**Easiest path:** use **Replicate** instead: set `REPLICATE_API_TOKEN` in `.env`. You get 512-dim image embeddings with no deployment step (see Troubleshooting above).

**If you want to run CLIP on HuggingFace anyway**, you have to provide a custom handler:

1. **Account and billing**
   - Log in at [Hugging Face](https://huggingface.co/).
   - Go to [Settings → Billing](https://huggingface.co/settings/billing), add a payment method. Inference Endpoints is pay-as-you-go (e.g. ~$0.50/hour for a T4 GPU). Endpoints can scale to zero after 1 hour of inactivity.

2. **Custom handler (required)**
   - The `openai/clip-vit-base-patch32` repo has no `handler.py`, so one-click deploy will fail.
   - Create a **duplicate** (or new) model repo on the Hub that uses this model, and add a `handler.py` that:
     - Loads the CLIP model and processor (e.g. `AutoModel.from_pretrained("openai/clip-vit-base-patch32")` and the matching processor).
     - In `__call__`: accepts the raw image bytes from the request, runs the image encoder, returns the 512-dim embedding as a JSON array.
   - See [Custom handlers](https://huggingface.co/docs/inference-endpoints/guides/custom_handler) and the Hub repos tagged `endpoints-template` for examples (e.g. image embeddings). Your handler must implement `EndpointHandler` with `__init__` and `__call__`.

3. **Deploy and configure**
   - In [Inference Endpoints](https://ui.endpoints.huggingface.co/), click **New** and select your **duplicate repo** (the one that contains `handler.py`).
   - Choose region and instance (e.g. **NVIDIA T4**). Create the endpoint and wait until it’s **Running**.
   - Copy the **Endpoint URL** and set in `.env`:
     - `HUGGINGFACE_API_KEY` = your [Hugging Face token](https://huggingface.co/settings/tokens).
     - `HUGGINGFACE_CLIP_URL` = the Endpoint URL (no path).
   - Restart the app. The app sends `POST` with `Authorization: Bearer <token>` and the image as binary body.

## macOS

Developed on macOS. Use Docker Desktop or OrbStack for Postgres. All other deps are Node.js.
