# Playbook guide — what each part does

This guide explains the different sections of a **playbook** in plain language. Playbooks are the structured instructions the support assistant uses when helping users diagnose and fix a problem. If you edit playbooks in Admin, this document explains what each part is for, how the schema-v2 model works, and when to use workbook export/import instead of only editing inline.

---

## What is a playbook?

A playbook is a **diagnostic contract** for one type of issue (for example "Texture too runny" or "Machine error X"). It tells the system:

- What issue taxonomy and product scope this guide belongs to
- What information must be collected from the user
- What causes can be supported, excluded, or escalated
- When to escalate immediately to a person
- What steps to suggest once a cause is supported

You build and maintain this guide through the Admin playbook editor and, for full schema-v2 fields, through workbook export/import. The assistant then follows this guide during a chat with the user.

---

## Labels vs. Symptoms — why both exist

Before describing the playbook sections it helps to understand the difference between **labels** and **symptoms**, since they seem similar at first glance.

A **label** is the issue category — a single identifier like `too_runny` or `too_thick`. Labels live in their own table and each playbook is linked to exactly one label. During triage (before any playbook is loaded), the system first chooses **one** label based on the user's initial description, then loads the matching playbook for the current product context. A single label can have multiple playbooks if different product types need different diagnostic paths. Labels are also used as stable identifiers across the system — ticket filters, audit logs, analytics, and escalation handoffs all reference labels, so they stay the same even when a playbook is rewritten.

**Symptoms** live inside a playbook and describe the different ways a user might phrase or experience that issue (e.g. "watery output", "melts too fast", "won't hold shape"). They are sent to the diagnostic flow **after** a playbook has been selected, giving the assistant detailed context about what to look for. They also help detect when the user's actual problem doesn't match the playbook and a label switch should be suggested.

In short: labels answer "what category of problem?" and drive playbook selection; symptoms answer "what does this problem look like in the user's words?" and guide the diagnostic conversation. Detailed diagnosis logic belongs in actions and schema-v2 playbook rules, not in label names or symptom wording.

---

## The sections (tabs) and their purpose

### Overview

**What it is:** High-level routing information about this playbook — title, linked label, optional product type scoping, and the schema version.

**Why it matters:** It identifies _which_ diagnostic guide is in use. The title appears in triage so the right playbook can be selected. The label links the playbook to the issue taxonomy. Product type scoping allows different playbooks for the same label when different products need different diagnostic paths.

**Good to know:** This is the "cover page" of the playbook. Keep it short and descriptive. Schema-v2 structured cause fields are currently authored through workbook export/import rather than the inline editor alone.

---

### Symptoms

**What it is:** A list of **symptoms** — the kinds of things the user might see or describe (e.g. "Product is watery", "Melts too fast", "Won't hold shape").

**Why it matters:** Symptoms describe _what the problem looks like_. They are sent to the diagnostic LLM to help it recognise that the user's issue fits this playbook. They also help the LLM decide whether the user's actual problem matches or whether a different playbook would be more appropriate.

**Good to know:** Add the most common ways customers describe this type of issue. You don't need to list every possible phrase — a few clear descriptions are enough. Symptoms are not used during triage (only the label and title are); they guide the diagnostic conversation once the playbook is loaded.

---

### Evidence

**What it is:** The **evidence checklist** — a list of pieces of information the assistant should try to **collect** during the conversation.

Examples:

- A photo of the product or display
- A reading (e.g. temperature, pressure)
- An observation (e.g. "Is the machine making a noise?")
- A confirmation (e.g. "Did you follow the pre-heat step?")

Each item has a short description, a type (photo, reading, observation, action, or confirmation), and you can mark whether it's required or optional. You can also link an item to an **Action** (a separate record that provides the reusable instructions and expected input contract for collecting that evidence).

**Why it matters:** Evidence is _what we need to know_ before we can safely support or exclude a cause. The assistant asks for these one by one. As the user answers, the system fills in the checklist and normalizes the values. Evidence IDs are also used to validate that the assistant only asks for things defined in the playbook, and to match photos, readings, and skipped answers to the right checklist items.

**Good to know:** Order and describe evidence so that the most important or easiest-to-get items come first. Required items should be things you truly need before giving a resolution. If diagnosis depends on exact values, prefer action-backed enum, boolean, or number inputs rather than ambiguous text.

---

### Causes

**What it is:** The **candidate causes** — the possible **root causes** the assistant is trying to choose between (e.g. "Temperature too high", "Wrong ingredient ratio", "Worn scraper blades").

For each cause you can set:

- A short name and description
- Likelihood (high / medium / low) as a starting point
- **Ruling evidence** — which evidence items from the checklist help confirm or rule out this cause
- In schema v2, workbook-authored **support rules**, **exclude rules**, and optional **outcome** values

**Why it matters:** Causes define _what we're trying to diagnose_. The assistant keeps a list of possible causes and updates confidence levels as evidence comes in. In schema v2, deterministic cause evaluation is driven by the structured rule fields maintained in the workbook, while the inline "ruling evidence" list remains a quick reference and prompt hint.

**Good to know:** The more clearly you separate sibling causes with structured rules, the more consistent the assistant's conclusions will be. The likelihood field gives the system a starting prior, but it should not be the only thing distinguishing causes. If a cause should escalate instead of resolve, set that in the schema-v2 workbook fields.

---

### Triggers

**What it is:** **Escalation triggers** — phrases or situations where the assistant should **stop diagnosing** and escalate to a person (e.g. "electrical smell", "refrigerant leak", "sparking").

For each trigger you give a short phrase (or keyword) and a reason for escalation.

**Why it matters:** Some situations shouldn't be handled by the assistant alone. Every turn, _before_ the LLM is even called, the system checks the user's message against these triggers using a simple text match. If a match is found, the session is immediately escalated without further diagnosis. The triggers are also sent to the LLM so it can recognise related language even when the exact phrase doesn't match.

**Good to know:** Use phrases customers might actually say or that your team has agreed mean "escalate". Keep the list short and clear so escalation happens when it should, without blocking normal conversations.

---

### Steps

**What it is:** The **resolution steps** — the exact **actions** the user should take once a cause has been confirmed (e.g. "Cool hopper to operating range", "Clear space around the machine", "Inspect scraper blades").

Each step has:

- A **title** — short heading shown above the instruction
- An **instruction** — the full action text the user will see
- A **check** (optional) — how the user can verify the step worked

**Why it matters:** When the assistant has enough evidence and has confirmed a cause, it must give the user something to _do_. Steps are the resolution. The assistant is strictly required to use only the step IDs you define here — it cannot invent new steps. After the assistant produces a resolution, the system validates that every step ID exists in the playbook, checks that the instruction text hasn't drifted from what you authored, and if drift is detected, replaces the generated version with your exact authored text. This keeps advice consistent and safe.

**Good to know:** Write steps in the order the user should do them. Use simple, actionable language. The "check" field is useful for helping the user know when a step actually worked (e.g. "Hopper display shows temperature within -8°C to -4°C").

---

## How the parts work together when diagnosing

A simple way to see how it all fits:

1. **Label + Title + Product scope** → during triage, the system picks _which_ playbook to use for this user.
2. **Symptoms** → once the playbook is loaded, the assistant knows _what the problem looks like_ in the user's words.
3. **Evidence + Actions** → the assistant asks for the items on the checklist, one at a time, using the linked action contracts to collect exact values.
4. **Causes** → as evidence comes in, the system narrows down _what might be wrong_, using schema-v2 support and exclude rules where available.
5. **Triggers** → every turn, the system checks the user's message; if it matches a trigger, we **escalate** immediately.
6. When one **Cause** is supported → the assistant delivers the matching **Steps** as the resolution.

So: **Symptoms** set the scene, **Evidence** is what we gather, **Actions** define how we gather it, **Causes** are what we choose between, **Triggers** tell us when to hand off, and **Steps** are the fix we deliver once we've diagnosed the issue.

---

## Tips for maintaining playbooks

- **Keep labels stable** and keep business logic out of label names. Labels are taxonomy, not diagnosis rules.
- **Prefer structured action inputs** when business logic depends on exact values. Avoid vague free text where an enum, boolean, or number would be safer.
- **Maintain support and exclude rules in the workbook** whenever sibling causes overlap or a cause should escalate instead of resolve.
- **Review triggers** from time to time so escalation still matches your current policies.
- **Test with real examples**: run through the generated scenario suite and a few sample chats and check that the right evidence is asked for, the right cause is chosen, and the right steps are shown.
- **Export after stable updates** so the workbook matches the live DB state and the structured v2 rules are versioned outside the database.

---

## Where to edit playbooks

Playbooks are edited in the Admin area of the app, under **Playbooks**. Use the inline editor for core fields like label, title, symptoms, evidence order, quick cause references, triggers, and steps. Use workbook export/import for full schema-v2 authoring such as support rules, exclude rules, value definitions, and cause outcomes. For how to use the Admin UI day to day, see the [User Manual](./USER_MANUAL.md).

For a detailed technical reference of how each field is consumed in the LLM prompts and business logic, see [PLAYBOOK_REFERENCE.md](./PLAYBOOK_REFERENCE.md).

---

_This guide is meant to be updated as the product and playbook editor change. If something in the app no longer matches this document, update this file so it stays accurate for everyone._
