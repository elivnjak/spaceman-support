# Playbook guide — what each part does

This guide explains the different sections of a **playbook** in plain language. Playbooks are the instructions the support assistant uses when helping users diagnose and fix a problem. If you edit playbooks in Admin, this document will help you understand what each part is for and how they work together.

---

## What is a playbook?

A playbook is a **diagnostic guide** for one type of issue (for example “Texture problems” or “Machine error X”). It tells the assistant:

- What kind of problem this is
- What information to collect from the user
- What the possible causes are
- When to escalate to a person
- What steps to suggest once a cause is found

You build this guide by filling in the sections described below. The assistant then follows this guide during a chat with the user.

---

## The sections (tabs) and their purpose

### Overview

**What it is:** High-level information about this playbook (e.g. title, which product or category it applies to).

**Why it matters:** It identifies _which_ diagnostic guide is in use. When a user starts a chat (e.g. by sending a photo), the app uses this to pick the right playbook. Keep the title and category clear so the right guide is chosen.

**Good to know:** This is the “cover page” of the playbook—short and descriptive.

---

### Symptoms

**What it is:** A list of **symptoms**—the kinds of things the user might see or describe (e.g. “Product is watery”, “Lumps in the mixture”, “Display shows error code”).

**Why it matters:** Symptoms describe _what the problem looks like_. They help the assistant recognise that the user’s issue fits this playbook and give it context for the rest of the diagnosis.

**Good to know:** Add the most common ways customers describe this type of issue. You don’t need to list every possible phrase—a few clear descriptions are enough.

---

### Evidence

**What it is:** The **evidence checklist**—a list of pieces of information the assistant should try to **collect** during the conversation.

Examples:

- A photo of the product or display
- A reading (e.g. temperature, pressure)
- An observation (e.g. “Is the machine making a noise?”)
- A confirmation (e.g. “Did you follow the pre-heat step?”)

Each item has a short description, a type (photo, reading, observation, etc.), and you can mark whether it’s required or optional.

**Why it matters:** Evidence is _what we need to know_ before we can safely suggest a cause and fix. The assistant will ask the user for these one by one (e.g. “Can you send a photo of the mixture?” or “What temperature does the display show?”). As the user answers, the assistant fills in the checklist. When enough evidence is collected, it can narrow down the cause and suggest steps.

**Good to know:** Order and describe evidence so that the most important or easiest-to-get items come first. Required items should be things you truly need before giving a resolution.

---

### Causes

**What it is:** The **candidate causes**—the possible **root causes** the assistant is trying to choose between (e.g. “Temperature too high”, “Wrong ingredient ratio”, “Machine not calibrated”).

For each cause you can set:

- A short name and description
- Likelihood (high / medium / low) as a starting point
- **Ruling evidence**—which evidence items help rule this cause in or out

**Why it matters:** Causes define _what we’re trying to diagnose_. The assistant keeps a short list of “likely causes” and updates it as evidence comes in. For example, if the user says the temperature was 85°C and one of your causes is “Temperature too low”, that cause can be ruled out. When only one cause is left (or one is clearly best), the assistant uses the **Steps** section to tell the user what to do.

**Good to know:** The more clearly you link causes to evidence (ruling evidence), the more consistent the assistant’s conclusions will be. Include the causes your support team actually sees in practice.

---

### Questions

**What it is:** A list of **diagnostic questions**—suggested questions the assistant can ask the user, with a short note on the purpose of each (e.g. “To check if the machine was pre-heated”, “To rule out wrong settings”).

**Why it matters:** These questions help the assistant ask the _right_ things in a clear way. They can be tied to the evidence checklist (e.g. “What does the display show?” for a “display_reading” evidence item) or to ruling out certain causes. They make the conversation feel focused and helpful.

**Good to know:** Write questions as you would ask them to a customer—clear, one thing at a time, and not too technical unless your users are technical.

---

### Triggers

**What it is:** **Escalation triggers**—phrases or situations where the assistant should **stop diagnosing** and escalate to a person (e.g. “safety concern”, “smell of burning”, “error code 999”).

For each trigger you give a short phrase (or keyword) and a reason for escalation.

**Why it matters:** Some situations shouldn’t be handled by the assistant alone. When the user’s message matches a trigger, the assistant can immediately respond with “We need to escalate this” and the reason, instead of continuing to ask questions. This keeps users safe and sets the right expectations.

**Good to know:** Use phrases customers might actually say or that your team has agreed mean “escalate”. Keep the list short and clear so escalation happens when it should, without blocking normal conversations.

---

### Steps

**What it is:** The **resolution steps**—the exact **actions** the user should take once a cause has been chosen (e.g. “Set temperature to 75°C”, “Restart the cycle”, “Contact support with your serial number”).

Each step has an ID, a title, and the instruction the user will see. You can add a “check” (what to verify after doing the step) if helpful.

**Why it matters:** When the assistant has enough evidence and has picked a cause, it must give the user something to _do_. Steps are that “what to do”—the fix or next action. The assistant is instructed to use only the steps you define here, so the advice stays consistent and safe.

**Good to know:** Write steps in the order the user should do them. Use simple, actionable language. If a step is “contact support”, say what information they should have ready.

---

## How the parts work together when diagnosing

A simple way to see how it all fits:

1. **Overview** (and category) → decides _which_ playbook is used for this user.
2. **Symptoms** → describe _what kind of issue_ we’re dealing with.
3. **Evidence** → list _what we need to find out_; the assistant asks for it (using **Questions** and the checklist).
4. **Causes** → list _what might be wrong_; the assistant narrows this down as **Evidence** is collected.
5. **Triggers** → if the user says something that matches, we **escalate** instead of giving a fix.
6. When one **Cause** is chosen (or we can’t tell) → **Steps** are the fix we give (or we escalate).

So: **Symptoms** set the scene, **Evidence** is what we gather, **Causes** are what we’re choosing between, **Triggers** tell us when to hand off, and **Steps** are the fix we deliver once we’ve diagnosed the issue.

---

## Tips for maintaining playbooks

- **Keep language consistent** with how your customers and support team talk (same terms, same tone).
- **Update causes and ruling evidence** when you see new real cases or realise a cause was missing.
- **Review triggers** from time to time so escalation still matches your current policies.
- **Test with real examples**: run through a few sample chats and check that the right evidence is asked for, the right cause is chosen, and the right steps are shown.
- **Document changes**: when you change a playbook, note in your own process what you changed and why, so the next person can keep maintaining it.

---

## Where to edit playbooks

Playbooks are edited in the Admin area of the app, under **Playbooks**. You can create new playbooks, link them to a label (category), and edit all the sections described above. For how to use the Admin UI day to day, see the [User Manual](./USER_MANUAL.md).

---

_This guide is meant to be updated as the product and playbook editor change. If something in the app no longer matches this document, update this file so it stays accurate for everyone._
