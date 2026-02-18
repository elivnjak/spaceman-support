# RAG Support Agent — User Manual

This app is a visual + text support assistant: users upload photos and describe an issue, and get a diagnosis plus step-by-step guidance based on reference images, documents, and playbooks.

---

## For end users

### Getting a diagnosis

1. **Open the app** (e.g. [http://localhost:3000](http://localhost:3000)) and go to **“Describe issue and upload photos”** (or `/analyse`).

2. **Describe the issue** in the text box (e.g. “It’s watery and melts really fast”, “Looks too thick and lumpy”).

3. **Upload 1–3 photos** that show the problem. Use clear, well-lit shots of the texture or product. Close-ups and consistent lighting improve results.

4. **Click Analyse.** The app will:
   - Compare your photos to reference images and suggest a **label** (e.g. “Too runny”, “Good texture”).
   - Search manuals and docs for relevant **chunks**.
   - Return a **diagnosis**, **steps to fix**, and **similar reference images** (when available).

5. **Interpret the result:**
   - **Predicted label** — The system’s best guess (e.g. “Too runny”, “Unknown”).
   - **Confidence** — How sure the model is (0–1). Low confidence or “Unknown” means the system couldn’t match your photos/text to a known category; you may need to add more reference data in Admin or rephrase/retake photos.
   - **Clarifying questions / Retake tips** — Shown when the result is “Unknown” or low confidence; use these to improve the next attempt.

---

## For admins

Admin pages are under **/admin**. Use them to add and manage the data the assistant uses.

### Dashboard — /admin

- Overview: counts of labels, reference images, documents, playbooks.
- **“Test the assistant”** — Opens the test console (same as analyse but with debug info: top matches, retrieved chunks, full JSON).

### Labels — /admin/labels

**What they are:** Categories the assistant can predict (e.g. “Good texture”, “Too runny”, “Too icy”, “Too thick”). Each has an **id** (machine-friendly) and **display name** (user-facing).

**What to do:**

- **Create** labels that match your product/process outcomes.
- **Edit** display names or descriptions.
- **Delete** only if no reference images or playbooks use that label (or update those first).

Seeding creates four default labels: `good_texture`, `too_runny`, `too_icy`, `too_thick`. You can keep these or replace them with your own.

---

### Reference images — /admin/images

**What they are:** Example photos per label. The app embeds each image and uses it for similarity search; user photos are compared to these to pick a label.

**What to do:**

1. **Select a label** from the dropdown (e.g. “Too runny”).
2. **Upload one or more images** that clearly show that outcome. Use good lighting and consistent framing where possible.
3. After upload, images are **embedded** (Replicate TinyCLIP). If embedding fails, check your `REPLICATE_API_TOKEN` (or HuggingFace setup).
4. **Edit** a image’s label or notes from the grid.
5. **Bulk delete** if you need to redo a label’s set.

**Tips:**

- Add at least **2–5 images per label** so the model has variety.
- Avoid duplicates; the app does duplicate detection on upload.
- All reference images must be embedded with the **same** embedder (e.g. Replicate only); mixing providers will break similarity.

---

### Documents — /admin/docs

**What they are:** PDFs, text, or pasted content that get split into **chunks** and embedded. The assistant retrieves relevant chunks when answering and uses them to ground the diagnosis and steps.

**What to do:**

1. **Upload** a PDF or text file, or **paste** content into the text area.
2. **Preview** the extracted/pasted text, then **ingest**. Ingestion chunks the text, embeds each chunk (OpenAI), and stores it.
3. Use **search** to see which chunks exist and how they’re retrieved for a query.

**Tips:**

- Add troubleshooting guides, FAQs, or process docs.
- Chunks are searched by **semantic similarity** to the user’s description + candidate labels, so clear, descriptive text works best.

---

### Playbooks — /admin/playbooks

**What they are:** Per-label step-by-step instructions. Each playbook is tied to one **label** and has a list of **steps** (step_id, title, instruction, check, if_failed). The assistant uses these to generate the “steps to fix” in the answer.

**Detailed guide:** For a plain-language explanation of each playbook section (Overview, Symptoms, Evidence, Causes, Questions, Triggers, Steps) and how they work together, see **[Playbook guide](PLAYBOOK_GUIDE.md)**. It's written for anyone maintaining or editing playbooks.

**What to do:**

1. **Create** a playbook: choose a **label**, set a **title**, then fill in the sections as needed (see Playbook guide).
2. For each step set:
   - **Step ID** — Unique id (e.g. UUID or “step-1”).
   - **Title** — Short name for the step.
   - **Instruction** — What to do.
   - **Check** (optional) — How to verify it worked.
   - **If failed** (optional) — What to do if the check fails.
3. **Save**. The assistant will only return steps that match these step_ids (grounding).

**Tips:**

- One playbook per label is enough for the current flow.
- Steps are sent to the LLM so it can rephrase and reorder while staying grounded in your steps.

---

### Test console — /admin/test

Same flow as **Analyse**, but with **debug** panels:

- **Top matches** — Reference images that matched the user photo(s), with similarity scores.
- **Retrieved chunks** — Document chunks that were retrieved for the query.
- **Full JSON** — Raw API result (label, confidence, chunks, answer, etc.).

Use this to:

- Confirm reference images and docs are being found.
- Debug “Unknown” or low confidence (e.g. no reference images for that label, or no similar docs).
- Tune labels, reference images, and document content.

---

## Typical workflow

1. **Setup** — Run DB seed so labels (and vector indexes) exist.
2. **Labels** — Adjust or add labels to match your scenarios.
3. **Reference images** — Upload 2–5 example images per label.
4. **Documents** (optional) — Ingest troubleshooting or manual text.
5. **Playbooks** (optional) — Add one playbook per label with steps.
6. **Test** — Use **/admin/test** with real photos and descriptions; check top matches and retrieved chunks.
7. **Iterate** — Add or replace images/docs/playbooks until the test scenarios behave as you want.

---

## Quick reference

| Page               | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `/`                | Home; links to Analyse and Admin                     |
| `/analyse`         | End-user: describe issue + upload photos → diagnosis |
| `/admin`           | Dashboard and link to Test                           |
| `/admin/labels`    | CRUD labels                                          |
| `/admin/images`    | Upload and manage reference images per label         |
| `/admin/docs`      | Upload/paste docs and ingest chunks                  |
| `/admin/playbooks` | CRUD playbooks (steps per label)                     |
| `/admin/test`      | Analyse with debug (matches, chunks, JSON)           |
