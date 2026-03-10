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

**What they are:** Stable issue taxonomy categories (e.g. “Good texture”, “Too runny”, “Too icy”, “Too thick”). Each has an **id** (machine-friendly) and **display name** (user-facing).

**What to do:**

- **Create** labels that match your product/process outcomes.
- **Edit** display names or descriptions.
- **Delete** only if no reference images or playbooks use that label (or update those first).

**Important:** Keep labels stable and generic. Do not put machine-specific thresholds or cause logic into labels. Business logic belongs in playbooks and actions.

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

**What they are:** Per-label diagnostic contracts. Each playbook is tied to one **label** and can include product scoping, symptoms, evidence, candidate causes, escalation triggers, and resolution steps. In the current schema-v2 model, playbooks can also carry structured cause semantics such as support rules, exclude rules, and escalation outcomes.

**Detailed guide:** For a plain-language explanation of each playbook section (Overview, Symptoms, Evidence, Causes, Triggers, Steps) and how they work together, see **[Playbook guide](PLAYBOOK_GUIDE.md)**. It's written for anyone maintaining or editing playbooks.

**What to do:**

1. **Create or edit** a playbook: choose a **label**, set a **title**, add product scoping if needed, then fill in the sections as needed.
2. Use the inline editor for:
   - symptoms
   - evidence order and descriptions
   - action links
   - evidence value contracts
   - support rules and exclude rules
   - cause outcomes
   - escalation triggers
   - authored resolution steps
3. Use **Export Excel** when you need a bulk offline edit or an external backup of the current schema-v2 playbook.
4. Re-import the workbook when you want to apply those bulk changes back into the live playbook.
5. Keep step IDs stable. The assistant will only return steps that match these step IDs.

**Tips:**

- One label can have multiple playbooks if different product types need different diagnostic paths.
- Prefer linking evidence to actions with enum, boolean, or number inputs when diagnosis depends on exact values.
- New cause rules start blank intentionally, so always pick the evidence item explicitly instead of assuming a default.
- The authored step text remains the canonical resolution text shown to the user if generated wording drifts.

### Actions — /admin/actions

**What they are:** Reusable collection contracts that tell the assistant how to ask for a piece of evidence and what input shape should come back.

**What to do:**

1. Create actions for evidence that needs a precise value or a reusable instruction.
2. Set an **expected input** that matches the real business logic:
   - `enum` for named states
   - `boolean` for yes/no confirmations
   - `number` for readings
   - `photo` for image evidence
3. Keep action IDs stable after playbooks start referencing them.

**Tips:**

- If a playbook rule depends on an exact value, avoid free text where possible.
- Make enum options match the values you want to use in workbook-authored rules.
- Use safety levels properly so technician-only actions do not leak to end users.

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
5. **Actions** — Add reusable actions for evidence that needs precise expected input.
6. **Playbooks** — Add or update playbooks, and use workbook export/import for full schema-v2 cause semantics.
7. **Test** — Use **/admin/test** with real photos and descriptions; check top matches and retrieved chunks.
8. **Iterate** — Add or replace images/docs/actions/playbooks until the test scenarios behave as you want.

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
| `/admin/actions`   | CRUD reusable evidence-collection actions            |
| `/admin/playbooks` | CRUD playbooks and workbook import/export            |
| `/admin/test`      | Analyse with debug (matches, chunks, JSON)           |
