# Playbook Reference

This document explains every section and field of a diagnostic playbook, exactly how each is used in the live chat/diagnosis flow, and how the sections relate to one another.

---

## What a Playbook Is

A playbook is a structured knowledge document that drives the AI diagnostic assistant for one specific class of issue. When a session is triaged, one playbook is selected and attached to that session. From that point forward, **every LLM call during diagnosis is grounded by the playbook** — the model is told what evidence to collect, what causes to consider, what triggers should escalate the conversation, and exactly which resolution steps are allowed.

Each playbook is linked to exactly one **Label** (the issue category identifier) and optionally scoped to one or more **Product Types**.

---

## Overview: Sections and their roles

| Section | Purpose | Used in LLM prompt | Used in business logic |
|---|---|---|---|
| `title` | Human-readable name | Yes — shown in prompt header | No |
| `labelId` | Issue category ID | Yes — shown in prompt header | Yes — RAG query context |
| `symptoms` | Patterns that characterise this issue | Yes — sent to LLM | No |
| `evidenceChecklist` | Ordered list of data points to collect | Yes — sent to LLM | Yes — request validation, skip logic, photo matching |
| `candidateCauses` | Possible root causes with weighting cues | Yes — sent to LLM | No |
| `escalationTriggers` | Phrases that force immediate escalation | Yes — sent to LLM | Yes — pre-LLM substring check each turn |
| `steps` | Authoritative resolution instructions | Yes — sent to LLM | Yes — grounding validation, instruction enforcement |

---

## Section 1: `title`

**What it is:** A short, readable name for the playbook (e.g. "Fix too runny texture").

**How it is used:**

`buildPlaybookBlock()` in `diagnostic-planner.ts` writes it as the first line of the playbook section of every LLM prompt:

```
## Diagnostic playbook
Title: Fix too runny texture
Label: too_runny
```

This gives the LLM a clear statement of the scope it is working within. It also appears in the triage LLM prompt (via `playbookTitle` on the label option) so the triage model can match user language to the right playbook.

**Relation to other sections:** None directly. It is metadata that contextualises everything else.

---

## Section 2: `labelId`

**What it is:** A machine-readable identifier string that ties the playbook to a Label record (e.g. `too_runny`, `too_thick`).

**How it is used:**

1. **Triage** — `runPlaybookTriage()` in `playbook-triage.ts` presents all labels to an LLM with their associated `playbookTitle`. The LLM returns the `selectedLabelId`, which is used to look up the matching playbook from the database.

2. **LLM prompt** — `buildPlaybookBlock()` includes `Label: <labelId>` in the prompt header, so the LLM is always aware which diagnostic scope it is operating in.

3. **RAG query** — When retrieving documentation chunks each turn, the chat route appends the `labelId` to the embedding query:
   ```typescript
   const queryTextForRag = `${plannerUserMessage}\nLabel context: ${playbook.labelId}`;
   ```
   This improves retrieval relevance for issue-specific documentation.

4. **Label switch suggestion** — The LLM can output `suggested_label_switch: "<other_labelId>"` if the evidence collected contradicts the current playbook's scope. The chat route detects this and re-triages the session to a different playbook.

**Relation to other sections:** Every other section is only meaningful in the context established by `labelId`.

---

## Section 3: `symptoms`

**What it is:** A list of `{ id, description }` items describing the observable patterns a user reports that should trigger this playbook.

Example:
```json
[
  { "id": "watery", "description": "Product comes out watery or too thin" },
  { "id": "melts_fast", "description": "Product melts too fast" }
]
```

**How it is used:**

`buildPlaybookBlock()` injects the symptoms list verbatim into the LLM prompt:

```
### Symptoms
- watery: Product comes out watery or too thin
- melts_fast: Product melts too fast
```

The LLM uses this to understand what observable user-described characteristics belong to this issue. It helps the model decide whether the user's current description matches the playbook scope, and informs the `suggested_label_switch` decision if the symptoms described don't match.

**Relation to other sections:**

- Symptoms describe the problem at a high level. The `evidenceChecklist` then provides the specific data points to collect to investigate those symptoms.
- Symptoms are contextual anchors — if a user describes something that matches none of the symptoms, the LLM may suggest switching labels.

---

## Section 4: `evidenceChecklist`

**What it is:** An ordered list of specific data points the assistant should collect from the user. Each item has:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Unique identifier referenced throughout the system |
| `description` | `string` | What the assistant asks or instructs the user to check |
| `type` | `"photo" \| "reading" \| "observation" \| "action" \| "confirmation"` | Determines how the chat UI renders the request |
| `required` | `boolean` | Whether this item must be collected before a diagnosis can be made |
| `actionId` | `string?` | Links to an Action record that provides the step-by-step instructions for how to collect this evidence |

**How it is used:**

1. **LLM prompt** — `buildPlaybookBlock()` serialises the full checklist into the prompt:
   ```
   ### Evidence checklist
   - hopper_temp: Hopper temperature reading, type=reading, required=true, actionId=read_hopper_temp
   - clearance_ok: Machine has adequate clearance, type=confirmation, required=true
   ```
   The LLM uses this to decide which items to request next, and to populate `evidence_extracted` and `hypotheses_update` in its response.

2. **Request validation** — `validateAndSanitizePlannerOutput()` checks that every `id` the LLM puts in its `requests` array is either a known evidence ID or a known action ID. Requests referencing unknown IDs are stripped before the response is sent to the user.

3. **Skip logic** — When the user submits a structured "I don't know" skip, the chat route identifies which outstanding request IDs map to evidence checklist items and records them as uncertain evidence:
   ```typescript
   const skipEvidenceIds = (playbook.evidenceChecklist ?? [])
     .filter((item) => outstandingRequestIds.includes(item.id) || ...)
     .map((item) => item.id);
   ```

4. **Photo matching** — When the user uploads an image, the chat route scans the checklist for `type === "photo"` items to tell the LLM which photo request IDs are likely being answered by the upload.

5. **Missing evidence summary** — `buildStateSummary()` computes which checklist IDs are not yet in the collected evidence, and tells the LLM: `Missing evidence IDs: hopper_temp, clearance_ok`. This drives the LLM to keep asking for the right things.

**Relation to other sections:**

- Each checklist item `id` is referenced in `candidateCauses.rulingEvidence` — causes list which evidence items help confirm or rule them out.
- `actionId` links to the **Actions** system (separate from playbooks) which provides the instructions, expected input format, and safety level for how to collect that evidence.
- The `required` flag determines when the LLM should consider evidence sufficiently complete to conclude.

---

## Section 5: `candidateCauses`

**What it is:** A list of possible root causes that the evidence collection is designed to narrow down. Each item has:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Unique identifier, referenced in the LLM's `hypotheses_update` and `resolution.causeId` outputs |
| `cause` | `string` | Plain-language description of the root cause shown to users in the diagnosis |
| `likelihood` | `"high" \| "medium" \| "low"` | Prior probability weighting given to the LLM |
| `rulingEvidence` | `string[]` | Evidence IDs that are directly relevant to confirming or ruling out this cause |

**How it is used:**

`buildPlaybookBlock()` sends the full list to the LLM:

```
### Candidate causes
- hopper_too_warm: Hopper temperature too high, likelihood=high, rulingEvidence=[hopper_temp]
- poor_airflow: Insufficient air circulation, likelihood=high, rulingEvidence=[clearance_ok]
- worn_scrapers: Worn scraper blades, likelihood=medium, rulingEvidence=[scraper_condition]
```

The LLM is responsible for updating hypothesis states (confidence, status) each turn via `hypotheses_update` in its JSON output. When the LLM decides a cause is confirmed, it moves to resolution and outputs `resolution.causeId` referencing one of these IDs.

**Relation to other sections:**

- `rulingEvidence` directly references IDs from `evidenceChecklist`. This is the core cross-reference: the checklist drives what to collect, and the causes describe what to conclude from what was collected.
- `likelihood` provides the LLM with a prior. A `high` likelihood cause should be considered even without much supporting evidence; a `low` likelihood cause needs more evidence to be elevated.
- When the LLM outputs a `resolution`, it must reference a `causeId` from this list. The `cause` text from this list becomes the user-facing diagnosis description.
- `steps` are the follow-on to a confirmed cause — they describe what to do about it, not what caused it.

---

## Section 6: `escalationTriggers`

**What it is:** A list of `{ trigger, reason }` pairs. If the user's message contains the trigger text at any point, the session is immediately escalated to a human technician.

Example:
```json
[
  { "trigger": "electrical smell", "reason": "Potential electrical hazard" },
  { "trigger": "refrigerant leak", "reason": "Refrigerant handling requires certified technician" }
]
```

**How it is used:**

1. **Pre-LLM check every turn** — Before the LLM is even called, `checkEscalationTriggers()` in `diagnostic-planner.ts` runs a case-insensitive substring match on the user's message against every trigger. If matched, escalation happens immediately without calling the LLM:
   ```typescript
   const escalationFromTrigger = checkEscalationTriggers(
     message,
     playbook.escalationTriggers
   );
   if (escalationFromTrigger.triggered) {
     // escalate, skip LLM call
   }
   ```

2. **LLM prompt** — `buildPlaybookBlock()` also includes the triggers in the LLM prompt:
   ```
   ### Escalation triggers (if user mentions these, escalate)
   - "electrical smell": Potential electrical hazard
   ```
   This gives the LLM context so it can also choose to escalate if it identifies related language, even if the exact substring doesn't match.

**Relation to other sections:**

Escalation triggers operate independently of the evidence and causes flow. They act as safety overrides: regardless of how far through the evidence checklist the session has progressed, a trigger match stops the diagnostic process immediately.

---

## Section 7: `steps`

**What it is:** The authoritative resolution instructions to present to the user once a root cause is confirmed. Each step has:

| Field | Type | Purpose |
|---|---|---|
| `step_id` | `string` | Unique identifier; the LLM must reference only known step IDs |
| `title` | `string?` | Short heading shown above the instruction |
| `instruction` | `string?` | The full action text shown to the user |
| `check` | `string?` | How the user can verify the step worked |

**How it is used:**

1. **LLM prompt** — `buildPlaybookBlock()` includes all steps:
   ```
   ### Resolution steps (use these step_ids when phase is resolving)
   - step_id: cool-hopper, title: Cool hopper to operating range, instruction: Allow the machine time to cool...
   ```
   The LLM is instructed that when it moves to the `resolving` phase, its `resolution.steps` array **must only use `step_ids` from this list**.

2. **Grounding validation** — After the LLM responds with a resolution, `validateAndSanitizePlannerOutput()` calls `validateGrounding()` which:
   - Checks that every `step_id` in `resolution.steps` exists in the playbook. Steps with unknown IDs cause the resolution to be rejected and the phase to roll back to `diagnosing`.
   - Checks that the instruction text the LLM produced has sufficient word-overlap with the authoritative playbook instruction. Low overlap (`< groundingDriftThreshold`) is flagged as "instruction drift".

3. **Instruction enforcement** — If drift is detected, `enforcePlaybookInstructions()` replaces the LLM's rewritten instruction with the exact playbook text. The LLM's step selection and `check` text are preserved, but the `instruction` the user sees is always the authored text:
   ```typescript
   return {
     step_id: ls.step_id,
     instruction: pb.instruction ?? ls.instruction,  // playbook text wins
     check: pb.check ?? ls.check,
   };
   ```

**Relation to other sections:**

- Steps are the resolution to a confirmed cause. The LLM links a step set to a specific `candidateCauses.causeId` — the cause explains why the issue occurred, the steps explain what to do about it.
- Steps are independent of the evidence collection process. Evidence is for diagnosis; steps are for resolution. The LLM transitions from evidence collection to steps only when it is confident in a cause.
- The `check` field on a step closes the loop: after giving the user a resolution instruction, it tells them how to verify success. This is preserved through the grounding enforcement.

---

## How the Sections Flow Together

```
User message arrives
       │
       ▼
checkEscalationTriggers()         ← uses: escalationTriggers
   triggered? → escalate immediately
       │ not triggered
       ▼
runDiagnosticPlanner()
       │
       ├── buildPlaybookBlock()   ← injects: title, labelId, symptoms,
       │                                     evidenceChecklist, candidateCauses,
       │                                     escalationTriggers, steps
       │
       ├── buildStateSummary()    ← uses: evidenceChecklist (to compute missing IDs)
       │
       └── LLM call (gpt-4o)
               │
               ▼
           LLM response (JSON)
               │
               ▼
validateAndSanitizePlannerOutput()
       │
       ├── request ID validation  ← uses: evidenceChecklist (allowed IDs)
       │
       ├── photo/skip matching    ← uses: evidenceChecklist (type=photo items)
       │
       └── resolution grounding   ← uses: steps
               │
               ├── validateGrounding()         ← checks step_ids exist, checks drift
               └── enforcePlaybookInstructions() ← replaces drifted instructions
                                                    with playbook text
```

### Concrete example of cross-section dependencies

Consider a playbook for "too runny texture":

1. **Triage** matches `labelId: too_runny` based on the user's description matching the `title` and `symptoms`.
2. The LLM is told the `evidenceChecklist` includes `hopper_temp` (required) and `clearance_ok` (required).
3. The LLM asks for `hopper_temp` → user replies "-2°C" → LLM records this in `evidence_extracted`.
4. The LLM sees `candidateCauses` says `hopper_too_warm` has `likelihood=high` and `rulingEvidence=[hopper_temp]`. Since `-2°C` is warmer than the expected `-8°C to -4°C`, it raises confidence on `hopper_too_warm`.
5. Once sufficient required evidence is collected, the LLM moves to `resolving`, cites `causeId: hopper_too_warm`, and selects steps from the `steps` list — specifically `step_id: cool-hopper`.
6. `validateGrounding` confirms `cool-hopper` exists. `enforcePlaybookInstructions` ensures the exact authored instruction text is delivered to the user, not a paraphrase.

---

## Actions (related but separate system)

Actions are not part of the playbook schema itself but interact directly with `evidenceChecklist`. An evidence item can have an `actionId` pointing to an Action record. Actions contain:

- `instructions` — step-by-step text shown alongside the evidence request
- `expectedInput` — describes what type of response to render in the UI (number, photo, boolean, enum)
- `safetyLevel` — `"safe"`, `"caution"`, or `"technician_only"`

The `safetyLevel` on an Action (not on steps) drives whether an evidence request is filtered out for end users (`technician_only`) or shown with a warning prefix (`caution`). This is evaluated in `validateAndSanitizePlannerOutput()`.

---

## Summary: The minimal playbook

All six sections and all fields within them serve active roles. The minimum viable playbook that will produce a useful diagnosis is:

| Section | Required? | Why |
|---|---|---|
| `title` | Yes | Needed for triage LLM and prompt context |
| `labelId` | Yes | Session attachment, RAG query, label switch |
| `symptoms` | Recommended | Helps LLM understand scope; aids label switch detection |
| `evidenceChecklist` | Yes | Without it, the LLM has no structured evidence targets and cannot ground requests |
| `candidateCauses` | Yes | Without causes, the LLM cannot reason about what to conclude |
| `escalationTriggers` | Recommended | Safety guardrail; omit only when no safety-relevant phrases exist |
| `steps` | Yes | Without steps, the LLM cannot produce a grounded resolution |
