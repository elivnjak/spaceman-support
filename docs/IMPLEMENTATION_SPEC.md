# Implementation Specification — RAG Support Agent

This document describes what is currently implemented: stack, data model, workflows, APIs, and evaluation.

---

## 1. Stack & configuration

| Layer                | Technology                                                          |
| -------------------- | ------------------------------------------------------------------- |
| **Framework**        | Next.js 15 (App Router), TypeScript, Tailwind CSS                   |
| **Database**         | Postgres 16 + pgvector extension                                    |
| **ORM**              | Drizzle ORM                                                         |
| **Text embeddings**  | OpenAI `text-embedding-3-small` (1536 dimensions)                   |
| **Image embeddings** | Replicate TinyCLIP (512-dim) or HuggingFace CLIP ViT-B/32 (512-dim) |
| **LLM**              | OpenAI GPT-4o (classification and answer generation)                |

**Config** (`src/lib/config.ts`):

- **Confidence**: `topM` (3), `highThreshold` (0.4), `lowThreshold` (0.2), `labelGapMinimum` (0.05), `unknownThreshold` (0.15), `imageOverrideThreshold` (0.7).
- **Retrieval**: `imageTopK` (5), `textTopN` (8), `candidateLabelsCount` (2).
- **Embeddings**: OpenAI text 1536-dim, CLIP 512-dim.
- **LLM**: `classificationModel` and `generationModel` both `gpt-4o`.

**Environment**: `OPENAI_API_KEY` (required); image embeddings: `REPLICATE_API_TOKEN` or `HUGGINGFACE_API_KEY` (+ optional `HUGGINGFACE_CLIP_URL`); `DATABASE_URL`; optional `STORAGE_PATH`.

---

## 2. Data model (Drizzle schema)

### 2.1 Tables

| Table                | Purpose                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----- | ----------------------------------------------------------------------- |
| **labels**           | Categories the assistant can predict. `id` (PK), `displayName`, `description`, `createdAt`.                                                              |
| **reference_images** | Example images per label. `id` (UUID), `labelId` (FK), `filePath`, `fileHash`, `notes`, `embedding` (vector 512), `createdAt`.                           |
| **documents**        | Uploaded/pasted docs. `id` (UUID), `title`, `filePath` (or `_pasted`), `status` (UPLOADED                                                                | INGESTING | READY | ERROR), `errorMessage`, `rawTextPreview`, `pastedContent`, `createdAt`. |
| **doc_chunks**       | Chunked document content. `id`, `documentId` (FK, cascade delete), `chunkIndex`, `content`, `metadata` (JSONB), `embedding` (vector 1536), `createdAt`.  |
| **playbooks**        | Per-label procedures. `id` (UUID), `labelId` (FK), `title`, `steps` (JSONB array of `{ step_id, title, instruction, check?, if_failed? }`), `updatedAt`. |
| **support_sessions** | Log of analyse runs. `id`, `userText`, `imagePaths`, `predictedLabelId`, `confidence`, `result` (JSONB), `createdAt`.                                    |

### 2.2 Vector indexes (HNSW)

- `reference_images.embedding` — cosine (`vector_cosine_ops`).
- `doc_chunks.embedding` — cosine.

Created by `npm run db:seed` (via `ensureVectorIndexes()` in `src/lib/db/seed.ts`). pgvector extension is created by `npm run db:init` (or by seed).

---

## 3. Core workflows

### 3.1 End-user analyse workflow

**Entry**: `/analyse` → user enters text + uploads 1–3 photos → POST `/api/analyse` (FormData: `text`, `images`).

**Pipeline** (`src/lib/pipeline/analyse.ts` — `runAnalysis`):

1. **Analysing photos**  
   For each uploaded image buffer: call CLIP embedder → collect `imageEmbeddings[]`.

2. **Finding similar**  
   For each image embedding: `searchReferenceImages(emb)` (pgvector cosine, top 5).  
   Aggregate by label: `aggregateLabelScores(allMatches)` — per label take top 3 matches, average similarity = score; sort by score.  
   Take top 2 labels as `candidateLabels`.  
   Compute `topScore`, `secondScore`, `labelGap`.

3. **Early “Unknown”**  
   If `topScore < unknownThreshold` OR (`topScore < lowThreshold` AND `labelGap < labelGapMinimum`): return immediately with `predictedLabel: "unknown"`, `labelDisplayName: "Unknown"`, `topMatches`, empty `retrievedChunks`, `clarifyingQuestions`, `retakeTips`. No document search or generation.

4. **Searching manuals**  
   Build query: `userText + candidate label ids + "troubleshooting steps checks causes"`.  
   Embed with OpenAI → `searchDocChunks(queryEmbedding)` (top 8 chunks by cosine similarity).  
   Collect `chunkTitles` (first 80 chars of each chunk).

5. **Classification**  
   `classifyLabel({ userText, imageMatchSummary, candidateLabels, chunkTitles })`: single GPT-4o call with JSON response `final_label`, `confidence`, `clarifying_questions`.  
   If result is `unknown` or low confidence or label not in candidates → treat as `unknown`.  
   **Override**: if LLM said `unknown` but `topScore >= imageOverrideThreshold`, use top candidate label and use that score as confidence.

6. **Unknown without playbook**  
   If after override still `unknown`: return with `retrievedChunks`, LLM `clarifyingQuestions`, retake tips. No steps.

7. **Generation (known label)**  
   Load playbook for `finalLabel`.  
   If playbook has steps: `generateAnswerWithValidation({ finalLabel, labelDisplayName, playbookSteps, textChunks, userText, imageMatchesSummary })`.
   - **Generate**: GPT-4o with system prompt that steps must use only provided `step_id`s; returns JSON `diagnosis`, `steps`, `why`, `retakeTips`, `citations`.
   - **Validate**: `validateGrounding(llmSteps, playbookSteps)` — every `step_id` must be in playbook; if invalid, retry once with stricter prompt.  
     If no playbook: answer is “No playbook found for this label” with empty steps.

8. **Response**  
   Return `predictedLabel`, `labelDisplayName`, `confidence`, `unknown`, `topMatches` (top 5), `retrievedChunks`, and when not unknown: `answer` (diagnosis, steps, why, retakeTips, citations).

**API** (`/api/analyse`): POST with FormData; response is **Server-Sent Events** (SSE): `stage` (message), `result` (full result + `sessionId`), or `error`. Each analyse run is persisted to `support_sessions`.

---

### 3.2 Reference image upload workflow

**Entry**: Admin → Images → select label, upload files → POST `/api/admin/images` (FormData: `labelId`, `notes?`, `files`).

**Flow**:

1. For each file: compute SHA-256 hash; if `referenceImages` has same `fileHash`, return existing row (duplicate), skip embed.
2. Store file under `storage/reference_images/{labelId}/{hash_prefix}_{timestamp}.{ext}`.
3. Insert row: `labelId`, `filePath`, `fileHash`, `notes`, `embedding: null`.
4. Call `clipEmbedder.embed(buffer)`; on success update row with `embedding`; on failure log (row remains with null embedding).

Response: array of `{ id, filePath, duplicate? }`.

---

### 3.3 Document ingestion workflow

**Create document**

- POST `/api/admin/docs`: either `title` + `pastedText` (then `filePath: "_pasted"`, `pastedContent` stored) or `title` + `file` (file saved under `storage/documents/`, text preview via `extractTextPreview`). Status `UPLOADED`.

**Ingest**

- POST `/api/admin/docs/[id]/ingest`: body optional `{ pastedText }`.
  - If `pastedText` provided or doc is pasted: `ingestPastedText(id, pastedText?)`.
  - Else: `ingestDocument(id)` (read file from storage, extract text, chunk, embed, write chunks).  
    Document status set to INGESTING → then READY or ERROR.

**Chunking** (`src/lib/ingestion/chunker.ts`):

- PDF: `chunkBySize` (default 600 tokens, 100 overlap, ~4 chars/token).
- Markdown: `chunkMarkdownOrText(..., "md")` → `chunkByHeadings` (heading-aware).
- Plain text: `chunkBySize`.

**Ingestor** (`document-ingestor.ts`): chunks → `openaiTextEmbedder.embedBatch(chunk texts)` → delete existing chunks for doc → insert new `doc_chunks` with `embedding`.

---

### 3.4 Playbook workflow

- **List**: GET `/api/admin/playbooks`.
- **Create/Update**: POST `/api/admin/playbooks` with `{ id?, labelId, title, steps }`. If `id` present, update; else insert. Steps are normalized: missing `step_id` get UUID; `title`/`instruction` default to `""`.

No dedicated DELETE endpoint; playbooks are per-label, one playbook per label in typical use.

---

### 3.5 Labels workflow

- **List**: GET `/api/admin/labels`.
- **Upsert**: POST `/api/admin/labels` with `{ id, displayName, description? }`. Id is slugified (lowercase, spaces → `_`, non-alphanumeric stripped). `onConflictDoUpdate` on `labels.id`.

**Seed** (`npm run db:seed`): ensures pgvector extension and HNSW indexes, then upserts four labels: `good_texture`, `too_runny`, `too_icy`, `too_thick`.

---

## 4. API reference (summary)

| Method | Path                            | Purpose                                                                                       |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/api/analyse`                  | Run analysis (FormData: text, images); SSE response (stage, result, error). Persists session. |
| GET    | `/api/admin/labels`             | List labels                                                                                   |
| POST   | `/api/admin/labels`             | Upsert label (id, displayName, description)                                                   |
| GET    | `/api/admin/images`             | List reference images                                                                         |
| POST   | `/api/admin/images`             | Upload reference images (labelId, files, notes?); duplicate detection; CLIP embed             |
| PATCH  | `/api/admin/images/[id]`        | Update image labelId                                                                          |
| DELETE | `/api/admin/images/[id]`        | Delete one reference image                                                                    |
| POST   | `/api/admin/images/bulk-delete` | Delete many (body: `{ ids: string[] }`)                                                       |
| GET    | `/api/reference-image/[id]`     | Serve image file by ID                                                                        |
| GET    | `/api/admin/docs`               | List documents                                                                                |
| POST   | `/api/admin/docs`               | Create document (title + file or pastedText)                                                  |
| GET    | `/api/admin/docs/[id]`          | Get one document                                                                              |
| PATCH  | `/api/admin/docs/[id]`          | Update title and/or pastedContent (pasted only)                                               |
| DELETE | `/api/admin/docs/[id]`          | Delete document (and storage file if not pasted); chunks cascade                              |
| POST   | `/api/admin/docs/[id]/ingest`   | Ingest document (body optional pastedText)                                                    |
| GET    | `/api/admin/docs/[id]/chunks`   | List chunks for document (query `?search=` for content filter)                                |
| GET    | `/api/admin/playbooks`          | List playbooks                                                                                |
| POST   | `/api/admin/playbooks`          | Create or update playbook (id, labelId, title, steps)                                         |

---

## 5. UI pages & behaviour

| Route              | Type   | Behaviour                                                                                                                                                                                                                                |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                | Server | Home: short description, links to “Describe issue and upload photos” (`/analyse`) and Admin.                                                                                                                                             |
| `/analyse`         | Client | Form: text + 1–3 images. Submit → POST `/api/analyse`, consume SSE; show stage messages, then result: label, confidence, unknown vs answer (diagnosis, steps, why), clarifying questions/retake tips; optional similar reference images. |
| `/admin`           | Server | Dashboard: counts (reference images, documents with “ready” count, labels, playbooks); link “Test the assistant” → `/admin/test`.                                                                                                        |
| `/admin/labels`    | —      | CRUD labels (list, create, edit via POST upsert).                                                                                                                                                                                        |
| `/admin/images`    | —      | Select label, upload images (duplicate detection, embed); grid with inline label edit (PATCH), bulk delete.                                                                                                                              |
| `/admin/docs`      | —      | Upload PDF/text/md or paste; preview; ingest; list docs; search/view chunks.                                                                                                                                                             |
| `/admin/playbooks` | —      | CRUD playbooks per label (steps: step_id, title, instruction, check, if_failed).                                                                                                                                                         |
| `/admin/test`      | Client | Same as analyse (same form + POST `/api/analyse`) but debug view: top matches, retrieved chunks, full JSON result.                                                                                                                       |

---

## 6. Supporting components

- **Storage** (`src/lib/storage.ts`): `STORAGE_PATH` or `./storage`; `reference_images/{labelId}/...`, `documents/...`; helpers for write/read/delete and path normalization; `sha256(buffer)` for dedup.
- **Retry** (`src/lib/retry.ts`): `withRetry(fn, { maxAttempts: 3, delayMs: 1000 })` for embed/API calls.
- **CLIP** (`src/lib/embeddings/clip.ts`): Prefer Replicate (TinyCLIP); fallback HuggingFace (with 410 fallback to Replicate if token set). Single image → 512-dim vector.
- **OpenAI text** (`src/lib/embeddings/openai-text.ts`): `embed(text)` and `embedBatch(texts)` with retry.
- **Grounding** (`src/lib/pipeline/validate-grounding.ts`): `validateGrounding(llmSteps, playbookSteps)` ensures every LLM step `step_id` is in the playbook; used to decide whether to retry generation with stricter prompt.

---

## 7. Evaluation

- **Script**: `npm run eval` → `scripts/eval.ts`.
- **Input**: `data/test_cases.json` — array of `{ text, imagePaths, expectedLabel }`. Images must exist under paths relative to cwd (e.g. `data/test_images/runny_01.jpg`).
- **Execution**: For each case, loads image buffers and calls `runAnalysis({ userText, imageBuffers })` (no HTTP). Measures duration.
- **Metrics**: Label accuracy (predicted vs expected), unknown rate, average time per run. Top-2 accuracy is not computed (pipeline returns single label).

Reference images for production use are uploaded via Admin; test images in `data/test_images/` should not be ingested as reference images so eval reflects real usage.

---

## 8. Scripts & ops

| Script                            | Purpose                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                     | Next.js dev server                                           |
| `npm run build` / `npm run start` | Production build and start                                   |
| `npm run db:push`                 | Drizzle push schema to DB                                    |
| `npm run db:init`                 | Create pgvector extension (Postgres)                         |
| `npm run db:seed`                 | Create vector extension + HNSW indexes + seed default labels |
| `npm run eval`                    | Run evaluation from `data/test_cases.json`                   |

---

## 9. Document vs playbook (recap)

- **Documents**: Free-form knowledge (PDF, text, pasted). Chunked and embedded (OpenAI). Used for **RAG**: query = user text + candidate labels + “troubleshooting…”; top chunks passed to the LLM for diagnosis/explanation and citations.
- **Playbooks**: One per label; structured steps (`step_id`, title, instruction, check, if_failed). Used for **grounding**: the LLM may only output steps whose `step_id` exists in that label’s playbook; validation enforces this and can trigger one retry with a stricter prompt.

Together: documents inform _what_ to say and _why_; playbooks define _which_ steps the assistant is allowed to suggest.
