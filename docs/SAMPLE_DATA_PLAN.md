# Sample Data Plan — Initial Data for Testing

This document describes a concrete plan to add **initial sample data** so you can test specific scenarios (e.g. “too runny”, “too icy”, “good texture”) and verify the full pipeline: image matching → label → docs → playbook steps.

The app is set up for **texture/consistency-style** outcomes (good texture, too runny, too icy, too thick). You can adapt labels and copy to other domains.

---

## 0. Document vs playbook — what's the difference?

| | **Documents** | **Playbooks** |
|---|---------------|----------------|
| **What** | Knowledge base: manuals, FAQs, troubleshooting prose (PDF, .txt, .md, or pasted text). | Per-label procedures: ordered steps the assistant is allowed to suggest. |
| **Structure** | Free-form text, chunked and embedded. | Structured: one playbook per **label**, each with steps (`step_id`, title, instruction, check, if_failed). |
| **How it's used** | **Retrieval (RAG):** user query + candidate labels are embedded; the most similar document chunks are fetched and passed to the LLM as context. | **Grounding:** the LLM must only output steps whose `step_id` exists in that label's playbook. It can rephrase instruction/check but cannot invent new steps. |
| **Role in the answer** | Informs *what* to say (causes, explanations, "why"); chunks can be cited. | Defines *which* steps to return (the actual "steps to fix" list). |

**Ideal pairing:** For the same scenario (e.g. "Too runny"), use **documents** for rich, searchable explanations and causes, and a **playbook** for the exact procedure (steps) the user should follow. The document chunks help the model explain and cite; the playbook ensures the steps are safe and consistent.

Below is **one scenario** ("Too runny" on a Spaceman soft-serve machine) with ideal sample data for **both** document and playbook.

### 0.1 Same scenario: ideal document (paste in Admin → Docs)

Use this as **one or more pasted documents** (or split into separate docs by cause). After adding, click **Ingest** so chunks are embedded.

```text
Too runny — Air circulation
A lack of air circulation around the machine. Make sure your Spaceman machine has a minimum clearance of 6" on all sides.

Too runny — Worn scraper blades
Worn scraper blades. Check for any wear and tear on your scraper blades which would mean they are not scraping frozen product off the freezing cylinder's walls properly.

Too runny — Over-beaten / overrun
Product has sat in the freezing cylinder for too long being spun and beaten. This causes your soft serve to lose some of its air content (overrun). It can also over-beat stabilizers and emulsifiers. To fix: pull product out a few times until fresh product from the hopper is added and dispensed.

Too runny — Blocked air tubes
Air tubes or pump are blocked or clogged; air is not being added to the mix. Clean your air tube and air tube inlet holes thoroughly every time you clean your Spaceman machine.

Too runny — Over-pulling
Over-pulling or serving too much for your model. Spaceman models have a limit on servings per hour. If you pull too often without giving the machine time to freeze fresh product, it will come out soft. Time your pulls and allow a delay between each pull.
```

### 0.2 Same scenario: ideal playbook (create in Admin → Playbooks)

- **Label:** `too_runny`
- **Title:** `Fix runny texture — Spaceman`
- **Steps:** (one row per step)

| step_id       | title            | instruction | check | if_failed |
|---------------|------------------|-------------|-------|-----------|
| clear-space   | Clear space      | Ensure minimum 6" clearance on all sides of the machine for air flow. | Verify clearance with a ruler. | Check for obstructions or relocated equipment. |
| check-scraper | Check scraper    | Inspect scraper blades for wear; replace if they don't scrape the cylinder properly. | Blades contact cylinder evenly; no visible wear. | Order replacement blades; reduce pull rate until replaced. |
| flush-old    | Flush old product| Pull product out several times so fresh mix from the hopper enters the cylinder. | Dispensed product is from fresh batch. | Extend wait time between pulls. |
| clean-air     | Clean air system | Clean air tube and air tube inlet holes thoroughly as per cleaning procedure. | No blockages; air flows. | Repeat cleaning; check pump if still blocked. |
| pace-pulls    | Pace pulls       | Time your pulls and leave a delay between each so the machine can freeze new product. | Servings per hour within model limit. | Reduce serving rate or upgrade model. |

Use these step_ids exactly (clear-space, check-scraper, flush-old, clean-air, pace-pulls) so the LLM stays grounded. The document content above gives the model the explanations to cite when it returns these steps.

---

## 1. What you need before testing

| Data type          | Purpose                                           | Minimum to test        |
|--------------------|---------------------------------------------------|------------------------|
| **Labels**         | Categories the model can predict                  | Already seeded (4)     |
| **Reference images** | So user photos can match to a label             | 2–5 images per label   |
| **Documents**      | Chunks for grounding the answer                   | 1 doc or pasted text   |
| **Playbooks**      | Step-by-step fixes per label                      | 1 playbook per label   |

Without **reference images**, you will always get **Unknown** and empty top matches. Add those first.

---

## 2. Labels (already seeded)

After `npm run db:seed` you have:

| id            | displayName   | description                    |
|---------------|---------------|---------------------------------|
| good_texture  | Good texture  | Normal, desired consistency    |
| too_runny     | Too runny    | Watery, thin, melts too fast   |
| too_icy       | Too icy      | Crystalline, icy texture       |
| too_thick     | Too thick    | Overly dense or stiff          |

You can keep these or edit in **Admin → Labels**. No need to re-seed for small edits.

---

## 3. Reference images — plan per label

Goal: **2–5 clear example photos per label** so the embedder can match user uploads.

### 3.1 What to use

- **Option A — Real photos:** Take or source photos that clearly show each outcome (e.g. runny vs thick product, icy surface, “good” reference).
- **Option B — Placeholders for dev:** Use any distinct images per category (e.g. different coloured blobs, different textures) so you can test the flow; replace with real product photos later.
- **Option C — Public datasets:** If you use something like “runny_01.jpg” (as in `data/test_cases.json`), ensure that file exists under `data/test_images/` for eval; for **reference** images you upload via Admin, files go to the app’s upload directory.

### 3.2 Suggested coverage

| Label         | Min images | What to show (example)                          |
|---------------|------------|------------------------------------------------|
| good_texture  | 2–5        | Normal, ideal consistency                      |
| too_runny     | 2–5        | Watery, thin, melting                          |
| too_icy       | 2–5        | Crystalline, icy, grainy                      |
| too_thick     | 2–5        | Dense, stiff, lumpy                            |

### 3.3 Steps in Admin

1. Go to **Admin → Images**.
2. For each label (e.g. **Too runny**):
   - Select the label.
   - Upload 2–5 images.
   - Wait for embeddings to complete (Replicate); check for errors in the UI or server logs.
3. Repeat for **Good texture**, **Too icy**, **Too thick**.

After this, **Analyse** and **Test console** should return non-empty **top matches** and a non-unknown label when the user photo is similar to one of these references.

---

## 4. Sample document (for retrieved chunks)

Goal: One small document so **retrieved chunks** are non-empty and the answer can cite text.

### 4.1 Example pasted content (troubleshooting snippets)

You can paste this in **Admin → Docs** (paste area) and ingest:

```text
# Troubleshooting texture issues

## Too runny
If the product is watery or melts too fast, common causes are: temperature too high, incorrect ratio of ingredients, or insufficient setting time. Try: (1) Cool down the environment. (2) Check the recipe and ratios. (3) Allow longer setting time before use.

## Too icy
Crystalline or icy texture usually means too much cooling or crystallisation. Try: (1) Reduce cooling time. (2) Stir during cooling to avoid large crystals. (3) Store at recommended temperature.

## Too thick
Overly dense or stiff product can come from: too little liquid, over-mixing, or cold storage. Try: (1) Add a small amount of recommended thinner. (2) Warm slightly and remix. (3) Check storage temperature and use-by.

## Good texture
When texture is smooth and consistent, no action is needed. Maintain current process and storage conditions.
```

### 4.2 Steps in Admin

1. **Admin → Docs**.
2. Paste the content above (or your own short manual) into the text area.
3. Click **Ingest** (or equivalent) so chunks are created and embedded.
4. Use **Search** to confirm chunks appear.

Now **retrieved chunks** in the test console should be non-empty for queries that mention runny/icy/thick/good texture.

---

## 5. Sample playbooks (steps per label)

Goal: One playbook per label so the assistant can return **steps to fix** grounded in your steps.

Each playbook has: **label**, **title**, **steps**. Each step: **step_id**, **title**, **instruction**, **check** (optional), **if_failed** (optional).

### 5.1 Example playbooks (copy into Admin → Playbooks)

**Playbook 1 — Too runny**

- Label: `too_runny`
- Title: `Fix runny texture`
- Steps:

| step_id  | title        | instruction                          | check                    |
|----------|--------------|--------------------------------------|--------------------------|
| step-1   | Cool down    | Reduce temperature to recommended range. | Check with thermometer.  |
| step-2   | Check ratio  | Verify ingredient ratios per recipe.      | Compare to spec.         |
| step-3   | Wait         | Allow full setting time before use.       | Product holds shape.     |

**Playbook 2 — Too icy**

- Label: `too_icy`
- Title: `Fix icy texture`
- Steps:

| step_id  | title          | instruction                                | check                |
|----------|----------------|--------------------------------------------|----------------------|
| step-1   | Reduce cooling | Shorten cooling time next batch.           | No large crystals.   |
| step-2   | Stir           | Stir during cooling phase.                 | Even consistency.    |
| step-3   | Store correctly| Store at recommended temperature.          | Check storage temp.  |

**Playbook 3 — Too thick**

- Label: `too_thick`
- Title: `Fix thick texture`
- Steps:

| step_id  | title       | instruction                                  | check              |
|----------|-------------|-----------------------------------------------|--------------------|
| step-1   | Add thinner | Add a small amount of recommended thinner.    | Consistency softens. |
| step-2   | Warm and mix| Warm slightly and remix gently.              | No lumps.          |
| step-3   | Check storage| Ensure storage at correct temperature.       | Within spec.        |

**Playbook 4 — Good texture**

- Label: `good_texture`
- Title: `Maintain good texture`
- Steps:

| step_id  | title      | instruction                           |
|----------|------------|----------------------------------------|
| step-1   | Maintain   | Keep current process and storage. No change needed. |

### 5.2 Steps in Admin

1. **Admin → Playbooks**.
2. For each label, **Create** a playbook:
   - Select the **label**.
   - Enter **title** and add **steps** (step_id, title, instruction, check).
3. Save each playbook.

---

## 6. Test scenarios (checklist)

Use **Admin → Test** (or **Analyse**) with the following to verify behaviour.

| # | Scenario        | User text (example)              | Expected (after adding data)        |
|---|-----------------|----------------------------------|-------------------------------------|
| 1 | Too runny       | “It’s watery and melts fast”     | Label: Too runny; top matches; steps from “Fix runny texture” playbook; chunks mentioning runny. |
| 2 | Too icy         | “Looks icy and grainy”           | Label: Too icy; top matches; steps from “Fix icy texture”; chunks mentioning icy. |
| 3 | Too thick       | “Too thick and lumpy”            | Label: Too thick; top matches; steps from “Fix thick texture”; chunks mentioning thick. |
| 4 | Good texture    | “Looks normal and smooth”       | Label: Good texture; top matches; steps from “Maintain good texture”. |
| 5 | Unknown / edge  | “Weird colour and smell”        | May still be Unknown if no reference or text matches; clarifying questions / retake tips. |

For **image-based** tests, upload a photo that clearly matches one label (e.g. a runny-looking image when you have runny reference images). The eval script uses `data/test_cases.json` and images under `data/test_images/` (e.g. `runny_01.jpg`); ensure those files exist if you run `npm run eval`.

---

## 7. Order of operations (summary)

1. **DB ready** — `docker compose up -d`, `npm run db:init`, `npm run db:push`, `npm run db:seed`.
2. **Labels** — Already seeded; edit if needed.
3. **Reference images** — Upload 2–5 per label in Admin → Images.
4. **Document** — Paste sample troubleshooting text in Admin → Docs and ingest.
5. **Playbooks** — Create one playbook per label in Admin → Playbooks.
6. **Test** — Run scenarios 1–5 in Admin → Test; check top matches, retrieved chunks, and steps.

Once this is done, you have a full path: **user photo + text → embedding → reference match → label → doc chunks → playbook steps → diagnosis and steps**.
