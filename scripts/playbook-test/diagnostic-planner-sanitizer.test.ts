import test from "node:test";
import assert from "node:assert/strict";
import {
  applyResolutionVerificationStepSelection,
  buildSupportedStructuredResolution,
  buildStructuredResolutionFallback,
  findSingleStructuredSupportedCause,
  validateAndSanitizePlannerOutput,
  type DiagnosticPlaybook,
  verifyDiagnosticResolutionStructured,
} from "@/lib/pipeline/diagnostic-planner";

const actionsById = new Map();

test("does not rule out a confirmed cause inside the sanitizer", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-soft-serve",
    labelId: "ss_product_too_soft_runny",
    title: "Soft serve too soft / runny",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_freeze_mode",
        type: "confirmation",
        required: true,
        description: "Machine is in FREEZE mode.",
      },
      {
        id: "ev_high_volume",
        type: "confirmation",
        required: false,
        description: "High volume/continuous serving with minimal recovery time.",
      },
      {
        id: "ev_airflow_clearance",
        type: "observation",
        required: true,
        description: "Clearance/vents unobstructed; not in direct sun/heat source.",
      },
    ],
    candidateCauses: [
      {
        id: "cause_insufficient_recovery",
        cause: "Machine is being over-pulled; not enough recovery time between serves.",
        likelihood: "high",
        rulingEvidence: [
          "ev_high_volume",
          "ev_freeze_mode",
          "ev_airflow_clearance",
        ],
      },
    ],
    steps: [
      {
        step_id: "step-adjust",
        title: "Adjust recovery settings",
        instruction:
          "Adjust the recovery settings according to the operator manual.",
        check: "Recovery settings are aligned to the documented values.",
      },
    ],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "Based on the evidence gathered, let's work on resolving the issue.",
      phase: "resolving",
      requests: [],
      hypotheses_update: [
        {
          causeId: "cause_insufficient_recovery",
          confidence: 0.91,
          reasoning: "Recovery time looks like the issue.",
          status: "confirmed",
        },
      ],
      evidence_extracted: [],
      resolution: {
        causeId: "cause_insufficient_recovery",
        diagnosis:
          "The machine is not allowing enough recovery time between servings.",
        why: "The combination of machine settings and current evidence suggests insufficient recovery time between draws is the primary issue.",
        steps: [
          {
            step_id: "step-adjust",
            instruction:
              "Adjust the recovery settings according to the operator manual.",
            check: "Recovery settings are aligned to the documented values.",
          },
        ],
      },
    },
    playbook,
    actionsById,
    true
  );

  assert.equal(output.phase, "resolving");
  assert.equal(output.resolution?.causeId, "cause_insufficient_recovery");
  assert.equal(output.hypotheses_update[0]?.status, "confirmed");
  assert.deepEqual(errors, []);
});

test("applies verifier-selected step subset while preserving original order", () => {
  const selected = applyResolutionVerificationStepSelection({
    steps: [
      {
        step_id: "step-freeze",
        instruction: "Confirm freeze mode.",
      },
      {
        step_id: "step-condenser",
        instruction: "Clean condenser.",
      },
      {
        step_id: "step-retry",
        instruction: "Retry dispensing.",
      },
    ],
    verification: {
      applicableStepIds: ["step-condenser", "step-retry"],
      redundantStepIds: ["step-freeze"],
    },
  });

  assert.deepEqual(
    selected.steps.map((step) => step.step_id),
    ["step-condenser", "step-retry"]
  );
  assert.deepEqual(selected.removedStepIds, ["step-freeze"]);
});

test("clamps hypothesis confidence without interpreting evidence semantics", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-runny-temp",
    labelId: "too_runny",
    title: "Too runny due to temperature",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "hopper_temp",
        type: "reading",
        required: true,
        description:
          "Hopper temperature reading (normal operating range typically -8°C to -4°C; above this can cause runny product)",
      },
    ],
    candidateCauses: [
      {
        id: "hopper_too_warm",
        cause: "Hopper temperature too high (product not cold enough to set properly)",
        likelihood: "high",
        rulingEvidence: ["hopper_temp"],
      },
    ],
    steps: [
      {
        step_id: "cool-hopper",
        title: "Cool hopper",
        instruction: "Allow the hopper to cool back into range.",
        check: "Hopper is back in range.",
      },
    ],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "The hopper is too warm.",
      phase: "resolving",
      requests: [],
      hypotheses_update: [
        {
          causeId: "hopper_too_warm",
          confidence: 1.4,
          reasoning: "2C is above the documented operating range.",
          status: "confirmed",
        },
      ],
      evidence_extracted: [],
      resolution: {
        causeId: "hopper_too_warm",
        diagnosis: "Hopper temperature is too high.",
        why: "2C is warmer than the documented range.",
        steps: [
          {
            step_id: "cool-hopper",
            instruction: "Allow the hopper to cool back into range.",
            check: "Hopper is back in range.",
          },
        ],
      },
    },
    playbook,
    actionsById,
    true
  );

  assert.equal(output.phase, "resolving");
  assert.equal(output.resolution?.causeId, "hopper_too_warm");
  assert.equal(output.hypotheses_update[0]?.status, "confirmed");
  assert.equal(output.hypotheses_update[0]?.confidence, 1);
  assert.deepEqual(errors, []);
});

test("coerces escalated planner outputs with a real resolution back to resolving", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-leak",
    labelId: "ss_excessive_internal_leak_drip_tray",
    title: "Internal leak",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_drive_shaft_gasket_leak",
        cause: "Drive shaft gasket leak.",
        likelihood: "high",
        rulingEvidence: [],
      },
    ],
    steps: [
      {
        step_id: "step-lubricate-drive-shaft-seals",
        title: "Lubricate drive shaft gasket and seals",
        instruction:
          "During cleaning, inspect the drive shaft gasket and related seals and apply the correct food-grade lubricant per the manual.",
        check: "Drive shaft gasket and seals are correctly lubricated and reinstalled.",
      },
    ],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "I need to escalate this, but here is the fix.",
      phase: "escalated",
      requests: [],
      hypotheses_update: [
        {
          causeId: "cause_drive_shaft_gasket_leak",
          confidence: 1,
          reasoning: "Skipped lubrication supports the leak.",
          status: "confirmed",
        },
      ],
      evidence_extracted: [],
      escalation_reason: "Cause confirmed due to missing lubrication.",
      resolution: {
        causeId: "cause_drive_shaft_gasket_leak",
        diagnosis: "The leak is due to skipped lubrication.",
        why: "Skipped lubrication supports a drive shaft gasket leak.",
        steps: [
          {
            step_id: "step-lubricate-drive-shaft-seals",
            instruction: "Lubricate drive shaft gasket and seals",
            check: "Ensure lubrication is applied correctly.",
          },
        ],
      },
    },
    playbook,
    actionsById,
    true
  );

  assert.equal(errors.length, 0);
  assert.equal(output.phase, "resolving");
  assert.equal(output.escalation_reason, undefined);
  assert.deepEqual(
    output.resolution?.steps.map((step) => step.step_id),
    ["step-lubricate-drive-shaft-seals"]
  );
});

test("enforces authored playbook step text without surfacing drift as a sanitization error", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-drift",
    labelId: "ss_product_too_soft_runny",
    title: "Soft serve too soft / runny",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_insufficient_recovery",
        cause: "Machine is being over-pulled; not enough recovery time between serves.",
        likelihood: "high",
        rulingEvidence: [],
      },
    ],
    steps: [
      {
        step_id: "step-reduce-pull-rate",
        title: "Reduce pull rate",
        instruction:
          "During busy periods, reduce continuous draws. Serve in smaller pulls and allow brief recovery between pulls.",
        check: "Texture improves after allowing recovery time.",
      },
    ],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "The issue is insufficient recovery time.",
      phase: "resolving",
      requests: [],
      hypotheses_update: [
        {
          causeId: "cause_insufficient_recovery",
          confidence: 0.9,
          reasoning: "High-volume serving supports insufficient recovery.",
          status: "confirmed",
        },
      ],
      evidence_extracted: [],
      resolution: {
        causeId: "cause_insufficient_recovery",
        diagnosis: "The machine is not recovering between serves.",
        why: "High-volume serving is the strongest supported cause.",
        steps: [
          {
            step_id: "step-reduce-pull-rate",
            instruction:
              "Reduce continuous draws during busy periods and give the barrel more recovery time between serves.",
            check: "Texture improves after allowing recovery time.",
          },
        ],
      },
    },
    playbook,
    actionsById,
    true
  );

  assert.deepEqual(errors, []);
  assert.equal(
    output.resolution?.steps[0]?.instruction,
    "During busy periods, reduce continuous draws. Serve in smaller pulls and allow brief recovery between pulls."
  );
});

test("drops invalid resolution step ids but keeps remaining valid authored steps", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-door-leak",
    labelId: "fb_product_leaking_from_door",
    title: "Product leaking from door / draw valve",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_worn_door_seals",
        cause: "Worn or damaged door O-rings/gaskets.",
        likelihood: "high",
        rulingEvidence: [],
      },
    ],
    steps: [
      {
        step_id: "step-lube",
        title: "Inspect and lubricate seals",
        instruction: "Inspect O-rings/gaskets for nicks/flat spots; lubricate per manual.",
        check: "Leak reduces after correct lubrication and reassembly.",
      },
      {
        step_id: "step-replace",
        title: "Replace wear parts if overdue",
        instruction: "Replace tune-up kit / door seals if worn, flattened, or cracked.",
        check: "Leak stops after replacing worn seals.",
      },
    ],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "The leak is due to worn door seals.",
      phase: "resolving",
      requests: [],
      hypotheses_update: [
        {
          causeId: "cause_worn_door_seals",
          confidence: 0.95,
          reasoning: "Leak photo and seal inspection support worn seals.",
          status: "confirmed",
        },
      ],
      evidence_extracted: [],
      resolution: {
        causeId: "cause_worn_door_seals",
        diagnosis: "The leak is due to worn or damaged door O-rings/gaskets.",
        why: "Inspection evidence supports damaged seals.",
        steps: [
          {
            step_id: "inspect_o_rings_gaskets",
            instruction: "Inspect the condition of the door O-rings and gaskets.",
          },
          {
            step_id: "step-lube",
            instruction: "Inspect and lubricate seals",
            check: "Ensure all seals are properly lubricated.",
          },
          {
            step_id: "step-replace",
            instruction: "Replace wear parts if overdue",
            check: "Replace parts if needed.",
          },
        ],
      },
    },
    playbook,
    actionsById,
    true
  );

  assert.equal(output.phase, "resolving");
  assert.deepEqual(
    output.resolution?.steps.map((step) => step.step_id),
    ["step-lube", "step-replace"]
  );
  assert.deepEqual(errors, ["Invalid step_ids: inspect_o_rings_gaskets"]);
});

test("maps unambiguous title-like step ids back to authored playbook step ids", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-icy",
    labelId: "ss_product_too_icy",
    title: "Soft serve icy / too hard",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_worn_scraper_blades",
        cause: "Worn scraper blades not scraping cylinder wall effectively.",
        likelihood: "medium",
        rulingEvidence: [],
      },
    ],
    steps: [
      {
        step_id: "e3c0e3ae-7384-435c-a927-0be44c32b97e",
        title: "Check maintenance wear parts",
        instruction: "Confirm scraper blades and tune-up parts are within service interval.",
        check: "Wear parts are replaced if overdue.",
      },
    ],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "The scraper blades are worn.",
      phase: "resolving",
      requests: [],
      hypotheses_update: [
        {
          causeId: "cause_worn_scraper_blades",
          confidence: 0.92,
          reasoning: "Blade age supports wear.",
          status: "confirmed",
        },
      ],
      evidence_extracted: [],
      resolution: {
        causeId: "cause_worn_scraper_blades",
        diagnosis: "The icy texture is due to worn scraper blades.",
        why: "Blade age is overdue.",
        steps: [
          {
            step_id: "check_maintenance_wear_parts",
            instruction:
              "Check the wear parts like scraper blades and ensure those are replaced if worn out.",
            check: "Confirm that scraper blades are replaced if they are overdue.",
          },
        ],
      },
    },
    playbook,
    actionsById,
    true
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(
    output.resolution?.steps.map((step) => step.step_id),
    ["e3c0e3ae-7384-435c-a927-0be44c32b97e"]
  );
});

test("maps invented step ids back to authored playbook step ids using instruction text", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-auto-fill",
    labelId: "fb_auto_fill_not_refilling",
    title: "Auto-fill not refilling",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_air_leak_in_line",
        cause: "Air leak in feed line.",
        likelihood: "medium",
        rulingEvidence: [],
      },
    ],
    steps: [
      {
        step_id: "step-air-leak",
        title: "Inspect feed line connections",
        instruction:
          "Check all feed line connections for tightness and inspect tubing for cracks or damage.",
        check: "Connections are tight and tubing is free of cracks or damage.",
      },
    ],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "The issue is likely an air leak in the feed line.",
      phase: "resolving",
      requests: [],
      hypotheses_update: [
        {
          causeId: "cause_air_leak_in_line",
          confidence: 0.93,
          reasoning: "Visible bubbles support an air leak.",
          status: "confirmed",
        },
      ],
      evidence_extracted: [],
      resolution: {
        causeId: "cause_air_leak_in_line",
        diagnosis: "Air leak in the feed line.",
        why: "Visible bubbles indicate loss of prime.",
        steps: [
          {
            step_id: "b16acf44-e38f-456d-ab6d-def8f93b1acc",
            instruction:
              "Check all feed line connections for tightness and inspect tubing for cracks or damage.",
            check: "Connections are tight and tubing is free of cracks or damage.",
          },
        ],
      },
    },
    playbook,
    actionsById,
    true
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(
    output.resolution?.steps.map((step) => step.step_id),
    ["step-air-leak"]
  );
});

test("structured verifier supports overdue cleaning branch over competing shaft wear", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-internal-leak",
    labelId: "fb_product_leaking_inside_machine",
    title: "Product leaking inside machine",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_cleaning_done",
        type: "confirmation",
        required: true,
        description: "When was the last full clean and lubrication completed?",
        valueDefinition: {
          kind: "enum",
          options: [
            "Within the last 72 hours",
            "More than 72 hours ago",
            "Skipped or unsure",
          ],
          unknownValues: ["Skipped", "Skipped or unsure"],
        },
      },
      {
        id: "ev_drive_shaft_gasket",
        type: "confirmation",
        required: true,
        description: "Drive shaft gasket lubricated and intact.",
        valueDefinition: {
          kind: "enum",
          options: ["Lubricated and intact", "Dry or damaged", "Skipped"],
          unknownValues: ["Skipped"],
        },
      },
      {
        id: "ev_tuneup_parts_checked",
        type: "confirmation",
        required: false,
        description: "Tune-up parts checked for wear.",
        valueDefinition: {
          kind: "enum",
          options: ["No visible wear", "Worn or damaged", "Skipped"],
          unknownValues: ["Skipped"],
        },
      },
    ],
    candidateCauses: [
      {
        id: "cause_improper_cleaning_lube",
        cause: "Incomplete cleaning or missed lubrication after reassembly.",
        likelihood: "high",
        rulingEvidence: ["ev_cleaning_done", "ev_drive_shaft_gasket"],
        supportRules: [
          {
            evidenceId: "ev_cleaning_done",
            operator: "in",
            values: ["More than 72 hours ago", "Skipped or unsure"],
          },
        ],
      },
      {
        id: "cause_drive_shaft_wear",
        cause: "Drive shaft wear despite recent cleaning and intact gasket.",
        likelihood: "medium",
        rulingEvidence: [
          "ev_cleaning_done",
          "ev_drive_shaft_gasket",
          "ev_tuneup_parts_checked",
        ],
        supportMode: "all",
        supportRules: [
          {
            evidenceId: "ev_cleaning_done",
            operator: "equals",
            values: ["Within the last 72 hours"],
          },
          {
            evidenceId: "ev_drive_shaft_gasket",
            operator: "equals",
            values: ["Lubricated and intact"],
          },
          {
            evidenceId: "ev_tuneup_parts_checked",
            operator: "equals",
            values: ["No visible wear"],
          },
        ],
      },
    ],
    steps: [
      {
        step_id: "step-clean",
        title: "Clean and lubricate",
        instruction: "Perform a full clean and lubricate drive components per the manual.",
      },
    ],
  };

  const verification = verifyDiagnosticResolutionStructured({
    playbook,
    evidence: {
      ev_cleaning_done: {
        value: "More than 72 hours ago",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 4,
      },
      ev_drive_shaft_gasket: {
        value: "Skipped",
        type: "string",
        confidence: "uncertain",
        collectedAt: new Date().toISOString(),
        turn: 4,
      },
      ev_tuneup_parts_checked: {
        value: "No visible wear",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 4,
      },
    },
    resolution: {
      causeId: "cause_improper_cleaning_lube",
      diagnosis: "Leak is due to missed cleaning/lubrication.",
      why: "Cleaning is overdue.",
      steps: [
        {
          step_id: "step-clean",
          instruction: "Perform a full clean and lubricate drive components per the manual.",
        },
      ],
    },
  });

  assert.equal(verification?.verdict, "supported");
  assert.deepEqual(verification?.supportingEvidenceIds, ["ev_cleaning_done"]);
  assert.deepEqual(verification?.competingCauseIds, []);
});

test("structured verifier marks equally supported causes as ambiguous", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-ambiguous",
    labelId: "fb_product_leaking_inside_machine",
    title: "Product leaking inside machine",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_leak_photo",
        type: "photo",
        required: true,
        description: "Leak photo.",
      },
    ],
    candidateCauses: [
      {
        id: "cause_a",
        cause: "Cause A",
        likelihood: "high",
        rulingEvidence: ["ev_leak_photo"],
        supportRules: [{ evidenceId: "ev_leak_photo", operator: "exists" }],
      },
      {
        id: "cause_b",
        cause: "Cause B",
        likelihood: "medium",
        rulingEvidence: ["ev_leak_photo"],
        supportRules: [{ evidenceId: "ev_leak_photo", operator: "exists" }],
      },
    ],
    steps: [],
  };

  const verification = verifyDiagnosticResolutionStructured({
    playbook,
    evidence: {
      ev_leak_photo: {
        value: "Photo uploaded",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 1,
      },
    },
    resolution: {
      causeId: "cause_a",
      diagnosis: "Cause A",
      why: "Photo exists.",
      steps: [],
    },
  });

  assert.equal(verification?.verdict, "ambiguous");
  assert.deepEqual(verification?.competingCauseIds, ["cause_b"]);
});

test("structured verifier treats exact 'Skipped' evidence as supportive when the playbook rule expects it", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-internal-leak-structured",
    labelId: "ss_excessive_internal_leak_drip_tray",
    title: "Excessive leak into drip tray / under machine",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_leak_photo",
        type: "photo",
        required: true,
        description: "Photo of excessive leak.",
        valueDefinition: { kind: "photo" },
      },
      {
        id: "ev_tuneup_age",
        type: "reading",
        required: true,
        description: "Months since tune-up kit replacement.",
        valueDefinition: { kind: "number", unit: "months" },
      },
      {
        id: "ev_lube_applied",
        type: "observation",
        required: true,
        description: "Whether lubrication was applied during the last cleaning.",
        valueDefinition: {
          kind: "enum",
          options: ["Completed", "Skipped", "Unable to complete safely", "Not sure"],
          unknownValues: ["Unable to complete safely", "Not sure"],
        },
      },
      {
        id: "ev_assembly_ok",
        type: "confirmation",
        required: true,
        description: "Whether parts were assembled correctly.",
        valueDefinition: {
          kind: "enum",
          options: ["Yes", "No", "Not sure"],
          unknownValues: ["Not sure"],
        },
      },
    ],
    candidateCauses: [
      {
        id: "cause_drive_shaft_gasket_leak",
        cause: "Drive shaft gasket leak due to skipped lubrication.",
        likelihood: "high",
        rulingEvidence: [
          "ev_leak_photo",
          "ev_tuneup_age",
          "ev_lube_applied",
          "ev_assembly_ok",
        ],
        supportMode: "all",
        supportRules: [
          { evidenceId: "ev_leak_photo", operator: "exists" },
          { evidenceId: "ev_lube_applied", operator: "equals", values: ["Skipped"] },
          { evidenceId: "ev_assembly_ok", operator: "equals", values: ["Yes"] },
          { evidenceId: "ev_tuneup_age", operator: "between", min: 0, max: 6 },
        ],
        excludeRules: [
          { evidenceId: "ev_assembly_ok", operator: "equals", values: ["No"] },
        ],
      },
    ],
    steps: [
      {
        step_id: "step-lubricate-drive-shaft-seals",
        title: "Lubricate drive shaft gasket and seals",
        instruction:
          "During cleaning, inspect the drive shaft gasket and related seals and apply the correct food-grade lubricant per the manual.",
        check: "Drive shaft gasket and seals are correctly lubricated and reinstalled.",
      },
    ],
  };

  const verification = verifyDiagnosticResolutionStructured({
    playbook,
    evidence: {
      ev_leak_photo: {
        value: "attached photo showing excessive leak",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 2,
      },
      ev_tuneup_age: {
        value: 3,
        type: "number",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 3,
      },
      ev_lube_applied: {
        value: "Skipped",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 4,
      },
      ev_assembly_ok: {
        value: "Yes",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 5,
      },
    },
    resolution: {
      causeId: "cause_drive_shaft_gasket_leak",
      diagnosis: "Leak due to skipped lubrication.",
      why: "Skipped lubrication supports a gasket leak.",
      steps: [
        {
          step_id: "step-lubricate-drive-shaft-seals",
          instruction:
            "During cleaning, inspect the drive shaft gasket and related seals and apply the correct food-grade lubricant per the manual.",
        },
      ],
    },
  });

  assert.equal(verification?.verdict, "supported");
  assert.deepEqual(verification?.supportingEvidenceIds.sort(), [
    "ev_assembly_ok",
    "ev_leak_photo",
    "ev_lube_applied",
    "ev_tuneup_age",
  ]);
});

test("structured verifier treats exact 'Unable to complete safely' evidence as supportive when the playbook rule expects it", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-door-leak-structured",
    labelId: "ss_leak_from_door_or_spout",
    title: "Leak from dispensing door/spout",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_o_rings_condition",
        type: "observation",
        required: true,
        description: "O-rings condition.",
        valueDefinition: {
          kind: "enum",
          options: ["No visible wear", "Worn or flattened", "Damaged or cracked"],
        },
      },
      {
        id: "ev_lubrication_applied",
        type: "observation",
        required: true,
        description: "Whether lubrication was applied correctly.",
        valueDefinition: {
          kind: "enum",
          options: ["Completed", "Unable to complete safely", "Skipped"],
        },
      },
    ],
    candidateCauses: [
      {
        id: "cause_dry_or_damaged_seals",
        cause: "Dry, damaged, or worn O-rings/gaskets at draw valve/door.",
        likelihood: "high",
        rulingEvidence: ["ev_o_rings_condition", "ev_lubrication_applied"],
        supportMode: "all",
        supportRules: [
          {
            evidenceId: "ev_o_rings_condition",
            operator: "in",
            values: ["Worn or flattened", "Damaged or cracked"],
          },
          {
            evidenceId: "ev_lubrication_applied",
            operator: "equals",
            values: ["Unable to complete safely"],
          },
        ],
      },
    ],
    steps: [
      {
        step_id: "step-seals",
        title: "Address seals",
        instruction: "Inspect and address the leaking seals.",
      },
    ],
  };

  const verification = verifyDiagnosticResolutionStructured({
    playbook,
    evidence: {
      ev_o_rings_condition: {
        value: "Worn or flattened",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 1,
      },
      ev_lubrication_applied: {
        value: "Unable to complete safely",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 2,
      },
    },
    resolution: {
      causeId: "cause_dry_or_damaged_seals",
      diagnosis: "Dry or damaged seals are causing the leak.",
      why: "Worn seals plus inability to lubricate safely point to this cause.",
      steps: [
        {
          step_id: "step-seals",
          instruction: "Inspect and address the leaking seals.",
        },
      ],
    },
  });

  assert.equal(verification?.verdict, "supported");
  assert.deepEqual(verification?.supportingEvidenceIds.sort(), [
    "ev_lubrication_applied",
    "ev_o_rings_condition",
  ]);
});

test("structured verifier treats boolean false evidence as matching a playbook enum rule for 'No'", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-auger-controls",
    labelId: "fb_auger_not_turning",
    title: "Auger not turning",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_display_status",
        type: "observation",
        required: true,
        description: "Display status.",
        valueDefinition: {
          kind: "enum",
          options: ["Overload alarm shown", "No alarm shown", "Other or unclear"],
          unknownValues: ["Other or unclear"],
        },
      },
      {
        id: "ev_power_cycle",
        type: "observation",
        required: true,
        description: "Power cycle result.",
        valueDefinition: {
          kind: "enum",
          options: ["Completed", "Unable to perform safely", "Attempted but issue persists"],
          unknownValues: ["Unable to perform safely"],
        },
      },
      {
        id: "ev_product_level",
        type: "observation",
        required: true,
        description: "Product level.",
        valueDefinition: {
          kind: "enum",
          options: ["Above minimum line", "Near minimum line", "Below minimum line", "Unknown"],
          unknownValues: ["Unknown"],
        },
      },
      {
        id: "ev_abnormal_noise",
        type: "observation",
        required: true,
        description: "Abnormal noise.",
        valueDefinition: {
          kind: "enum",
          options: ["No strange noises", "Grinding noise", "Belt squeal", "Humming only", "Unknown"],
          unknownValues: ["Unknown"],
        },
      },
      {
        id: "ev_thick_product",
        type: "confirmation",
        required: true,
        description: "Whether product was thick before stop.",
        valueDefinition: {
          kind: "enum",
          options: ["Yes", "No", "Not sure"],
          unknownValues: ["Not sure"],
        },
      },
    ],
    candidateCauses: [
      {
        id: "cause_controls_fault",
        cause: "Controls fault.",
        likelihood: "medium",
        rulingEvidence: [],
        supportMode: "all",
        supportRules: [
          { evidenceId: "ev_display_status", operator: "in", values: ["No alarm shown", "Other or unclear"] },
          { evidenceId: "ev_power_cycle", operator: "equals", values: ["Attempted but issue persists"] },
          { evidenceId: "ev_product_level", operator: "in", values: ["Above minimum line", "Near minimum line"] },
          { evidenceId: "ev_abnormal_noise", operator: "equals", values: ["No strange noises"] },
          { evidenceId: "ev_thick_product", operator: "equals", values: ["No"] },
        ],
      },
    ],
    steps: [
      {
        step_id: "step-escalate-auger-drive",
        title: "Escalate auger drive issue",
        instruction:
          "Escalate to a technician for auger motor, belt, relay, or drive diagnostics if the auger still does not turn.",
        check: "Technician escalation includes the checks already completed.",
      },
    ],
  };

  const verification = verifyDiagnosticResolutionStructured({
    playbook,
    evidence: {
      ev_display_status: {
        value: "No alarm shown",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 1,
      },
      ev_power_cycle: {
        value: "Attempted but issue persists",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 2,
      },
      ev_product_level: {
        value: "Above minimum line",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 3,
      },
      ev_abnormal_noise: {
        value: "No strange noises",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 4,
      },
      ev_thick_product: {
        value: false,
        type: "boolean",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 5,
      },
    },
    resolution: {
      causeId: "cause_controls_fault",
      diagnosis: "Controls fault.",
      why: "No overload signs and no abnormal noise remain.",
      steps: [
        {
          step_id: "step-escalate-auger-drive",
          instruction:
            "Escalate to a technician for auger motor, belt, relay, or drive diagnostics if the auger still does not turn.",
        },
      ],
    },
  });

  assert.equal(verification?.verdict, "supported");
});

test("buildStructuredResolutionFallback switches to a single preferred structured cause", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-fb-soupy",
    labelId: "fb_product_not_freezing",
    title: "Frozen beverage not freezing",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_brix_too_high",
        cause:
          "Product brix is too high, so the mix contains too much sugar or alcohol to freeze properly.",
        likelihood: "high",
        rulingEvidence: [],
      },
      {
        id: "cause_warm_product_added",
        cause: "Warm product was added without pre-chilling.",
        likelihood: "medium",
        rulingEvidence: [],
      },
    ],
    steps: [
      {
        step_id: "step-confirm-mode",
        title: "Confirm correct mode and level",
        instruction: "Confirm machine is in FREEZE and mix level is adequate.",
        check: "Unit is freezing and not in low-mix stop.",
      },
      {
        step_id: "step-verify-brix",
        title: "Verify product mix/brix",
        instruction: "Confirm the recipe ratio and measure brix if possible.",
        check: "Brix within range; product begins freezing normally.",
      },
    ],
  };

  const fallback = buildStructuredResolutionFallback({
    playbook,
    verification: {
      preferredCauseId: "cause_brix_too_high",
      reasoning:
        "A different cause is more strongly supported by the playbook's structured evidence rules.",
      applicableStepIds: ["step-verify-brix"],
      redundantStepIds: ["step-confirm-mode"],
    },
    rejectedResolution: {
      causeId: "cause_warm_product_added",
      diagnosis: "Warm product was added without pre-chilling.",
      why: "The product was not pre-chilled.",
      steps: [
        {
          step_id: "step-confirm-mode",
          instruction: "Confirm machine is in FREEZE and mix level is adequate.",
          check: "Unit is freezing and not in low-mix stop.",
        },
        {
          step_id: "step-verify-brix",
          instruction: "Confirm the recipe ratio and measure brix if possible.",
          check: "Brix within range; product begins freezing normally.",
        },
      ],
    },
  });

  assert.ok(fallback);
  assert.equal(fallback?.causeId, "cause_brix_too_high");
  assert.equal(
    fallback?.diagnosis,
    "Product brix is too high, so the mix contains too much sugar or alcohol to freeze properly."
  );
  assert.deepEqual(
    fallback?.steps.map((step) => step.step_id),
    ["step-verify-brix"]
  );
});

test("buildSupportedStructuredResolution uses authored playbook steps for a supported cause", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-stiff",
    labelId: "ss_product_too_stiff_freeze_up_risk",
    title: "Soft serve too stiff",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [],
    candidateCauses: [
      {
        id: "cause_air_tube_blocked",
        cause: "Air tube blocked.",
        likelihood: "high",
        rulingEvidence: [],
      },
    ],
    steps: [
      {
        step_id: "step-clean",
        title: "Clean air system",
        instruction: "Clean the air tube and inlet path.",
        check: "Air path is clear.",
      },
      {
        step_id: "step-monitor",
        title: "Monitor result",
        instruction: "Retry dispensing after cleanup.",
        check: "Product returns to normal.",
      },
    ],
  };

  const resolution = buildSupportedStructuredResolution({
    playbook,
    causeId: "cause_air_tube_blocked",
    why: "Structured rules support this cause.",
  });

  assert.deepEqual(resolution, {
    causeId: "cause_air_tube_blocked",
    diagnosis: "Air tube blocked.",
    why: "Structured rules support this cause.",
    steps: [
      {
        step_id: "step-clean",
        instruction: "Clean the air tube and inlet path.",
        check: "Air path is clear.",
      },
      {
        step_id: "step-monitor",
        instruction: "Retry dispensing after cleanup.",
        check: "Product returns to normal.",
      },
    ],
  });
});

test("findSingleStructuredSupportedCause returns a single escalation-designated cause when rules fully match", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-stop4",
    labelId: "ss_stop4_temperature_sensor_error",
    title: "STOP 4 temperature sensor error",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_error_code",
        type: "observation",
        required: true,
        description: "Exact error code.",
      },
      {
        id: "ev_power_cycle",
        type: "observation",
        required: false,
        description: "Power cycle result.",
      },
      {
        id: "ev_reset_attempted",
        type: "observation",
        required: false,
        description: "Reset result.",
      },
      {
        id: "ev_recent_clean",
        type: "observation",
        required: false,
        description: "Recent cleaning.",
      },
    ],
    candidateCauses: [
      {
        id: "cause_temp_sensor_fault",
        cause: "Temperature sensor fault requiring technician service.",
        likelihood: "high",
        outcome: "escalation",
        supportMode: "all",
        supportRules: [
          { evidenceId: "ev_error_code", operator: "equals", values: ["STOP 4"] },
          {
            evidenceId: "ev_power_cycle",
            operator: "equals",
            values: ["Attempted but issue persists"],
          },
          {
            evidenceId: "ev_reset_attempted",
            operator: "equals",
            values: ["Attempted but issue persists"],
          },
          {
            evidenceId: "ev_recent_clean",
            operator: "in",
            values: ["More than 72 hours ago", "Unknown"],
          },
        ],
        rulingEvidence: [
          "ev_error_code",
          "ev_power_cycle",
          "ev_reset_attempted",
          "ev_recent_clean",
        ],
      },
      {
        id: "cause_loose_connection",
        cause: "Loose connection after recent cleaning.",
        likelihood: "medium",
        outcome: "escalation",
        supportMode: "all",
        supportRules: [
          { evidenceId: "ev_error_code", operator: "equals", values: ["STOP 4"] },
          {
            evidenceId: "ev_recent_clean",
            operator: "equals",
            values: ["Within last 72 hours"],
          },
          {
            evidenceId: "ev_power_cycle",
            operator: "equals",
            values: ["Attempted but issue persists"],
          },
        ],
        rulingEvidence: ["ev_error_code", "ev_recent_clean", "ev_power_cycle"],
      },
    ],
    steps: [],
  };

  const supported = findSingleStructuredSupportedCause({
    playbook,
    evidence: {
      ev_error_code: {
        value: "STOP 4",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 1,
      },
      ev_power_cycle: {
        value: "Attempted but issue persists",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 2,
      },
      ev_reset_attempted: {
        value: "Attempted but issue persists",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 3,
      },
      ev_recent_clean: {
        value: "More than 72 hours ago",
        type: "string",
        confidence: "exact",
        collectedAt: new Date().toISOString(),
        turn: 4,
      },
    },
  });

  assert.equal(supported?.cause.id, "cause_temp_sensor_fault");
  assert.equal(supported?.cause.outcome, "escalation");
});

test("sanitizer remaps extracted action ids to canonical evidence ids", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-airflow",
    labelId: "fb_product_not_freezing",
    title: "Frozen beverage not freezing",
    symptoms: null,
    escalationTriggers: null,
    evidenceChecklist: [
      {
        id: "ev_airflow_clear",
        actionId: "check_airflow_clearance",
        type: "observation",
        required: true,
        description: "Airflow/clearance state.",
      },
    ],
    candidateCauses: [],
    steps: [],
  };

  const { output, errors } = validateAndSanitizePlannerOutput(
    {
      message: "Please check airflow.",
      phase: "gathering_info",
      requests: [],
      hypotheses_update: [],
      evidence_extracted: [
        {
          evidenceId: "check_airflow_clearance",
          value: "Partially obstructed or tight clearance",
          confidence: "exact",
        },
      ],
    },
    playbook,
    actionsById,
    true
  );

  assert.equal(output.evidence_extracted[0]?.evidenceId, "ev_airflow_clear");
  assert.match(
    errors[0] ?? "",
    /Remapped extracted evidence check_airflow_clearance to canonical checklist ID ev_airflow_clear/
  );
});
