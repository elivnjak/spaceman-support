# Playbook SaaS Architecture

This document describes the target diagnostic architecture for a SaaS-grade playbook system.

## Problem With The Current Model

The current system stores most diagnostic meaning as prose:

- evidence descriptions
- cause descriptions
- ruling evidence lists
- authored steps

That forces the runtime to re-interpret business logic repeatedly through LLM prompts. The result is:

- planner drift
- verifier drift
- fragile sibling-cause boundaries
- repeated prompt tuning for edge cases

This is acceptable for a prototype. It is not acceptable for a SaaS product that must support many customers, machines, and playbook styles.

## Target Design

Split responsibilities cleanly:

1. Playbook data owns domain semantics
2. Code owns workflow/state/invariants
3. LLMs handle extraction, clarification, and explanation

The long-term flow should be:

1. LLM extracts normalized evidence from user text/photos
2. Deterministic evaluator scores and filters causes using structured playbook semantics
3. Code decides whether to:
   - ask for more evidence
   - resolve to a cause
   - escalate
4. LLM turns the chosen outcome into user-facing language

## Structured Schema Direction

### Evidence

Evidence should be more than an English description. It should also describe:

- canonical value kind
- normalized options
- unit
- unknown / skipped tokens

Initial additive field:

- `valueDefinition`

Example:

```json
{
  "id": "ev_parts_age",
  "description": "Tune-up kit/wear parts age.",
  "type": "confirmation",
  "required": false,
  "valueDefinition": {
    "kind": "enum",
    "options": [
      "Less than 6 months ago",
      "6-12 months ago",
      "More than 12 months ago",
      "Unknown"
    ],
    "unknownValues": ["Unknown", "Skipped"]
  }
}
```

### Causes

Causes should not rely only on prose plus `rulingEvidence`. They need structured support and exclusion logic.

Initial additive fields:

- `supportMode`
- `supportRules`
- `excludeRules`

Example:

```json
{
  "id": "cause_improper_cleaning_lube",
  "cause": "Incomplete cleaning or missed lubrication.",
  "likelihood": "high",
  "rulingEvidence": ["ev_cleaning_done", "ev_drive_shaft_gasket", "ev_leak_photo"],
  "supportMode": "all",
  "supportRules": [
    { "evidenceId": "ev_cleaning_done", "operator": "in", "values": ["More than 72 hours ago"] },
    { "evidenceId": "ev_drive_shaft_gasket", "operator": "in", "values": ["Skipped", "Unknown"] }
  ],
  "excludeRules": [
    { "evidenceId": "ev_drive_shaft_gasket", "operator": "in", "values": ["Completed"] }
  ]
}
```

## Migration Plan

### Phase 1. Additive schema

Add optional structured fields without changing runtime behavior:

- evidence `valueDefinition`
- cause `supportMode`
- cause `supportRules`
- cause `excludeRules`

This phase is backward compatible because playbooks are stored as JSONB.

### Phase 2. Authoring support

Expose the new fields in:

- workbook export/import
- admin API
- admin UI

During this phase, old prose-only playbooks still work.

### Phase 3. Deterministic evaluator

Introduce a cause evaluator that:

- reads normalized evidence
- applies `supportRules` / `excludeRules`
- computes candidate support deterministically

The LLM should no longer be the final judge of whether a cause fits the evidence.

### Phase 4. LLM role reduction

Reduce the planner/verifier LLMs to:

- extract evidence
- choose next missing question
- explain the chosen diagnosis / escalation

Do not ask LLMs to invent or arbitrate business logic that the playbook can encode directly.

## Runtime Rules That Should Remain In Code

These are the right kinds of hard rules:

- schema validation
- ID grounding
- turn limits
- one request per turn
- duplicate prevention
- escalation plumbing
- audit logging
- regression harness scoring

These are the wrong kinds of hard rules:

- product-specific thresholds encoded in code
- cause-specific contradiction rules encoded in code
- keyword heuristics that decide diagnosis semantics

## Immediate Repository Status

The repository now includes the first additive structured fields in the shared playbook schema:

- `EvidenceItem.valueDefinition`
- `CauseItem.supportMode`
- `CauseItem.supportRules`
- `CauseItem.excludeRules`

These fields are intentionally not yet used for live deterministic diagnosis. They are the contract needed before that evaluator can be implemented safely.
