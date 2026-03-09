import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackResolutionBlueprintForCause, buildGeneratedScenario } from "./generate";

test("buildGeneratedScenario creates manual intake smoke flow", () => {
  const scenario = buildGeneratedScenario({
    playbook: {
      id: "3080dfb7-85ab-4292-a596-740e6e961de1",
      labelId: "ss_product_too_soft_runny",
      title: "Soft serve too soft / runny",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Dispenses runny; won’t hold shape." }],
      evidenceChecklist: [],
      candidateCauses: [],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    productTypes: [],
    availableProductTypes: [
      { id: "pt-1", name: "Ice Cream", isOther: false },
      { id: "pt-2", name: "Acai", isOther: false },
      { id: "pt-3", name: "Other", isOther: true },
    ],
    supportedModels: ["6210-C", "6450"],
  });

  assert.equal(scenario.suite, "generated");
  assert.equal(scenario.turns[1]?.user, "I don't have a photo.");
  assert.equal(scenario.turns[4]?.expect.phase, "product_type_check");
  assert.equal(scenario.turns[5]?.user, "Ice Cream");
  assert.equal(scenario.finalExpect.playbookLabel, "ss_product_too_soft_runny");
  assert.equal(scenario.finalExpect.status, "active");
});

test("cause-specific blueprint keeps non-target air tube evidence neutral", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "61626282-ff90-4dab-a66b-7a6554d50f1f",
      labelId: "ss_product_too_soft_runny",
      title: "Soft serve too soft / runny",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Dispenses runny; won’t hold shape." }],
      evidenceChecklist: [
        {
          id: "ev_airflow_clearance",
          type: "observation",
          actionId: "check_airflow_clearance",
          required: true,
          description: "Clearance/vents unobstructed; not in direct sun/heat source.",
        },
        {
          id: "ev_condenser_dirty",
          type: "observation",
          actionId: "inspect_condenser_for_dust",
          required: false,
          description: "Visible dust/grease build-up at condenser intake/exhaust.",
        },
        {
          id: "ev_air_tube_clean",
          type: "observation",
          actionId: "clean_air_tube_starcap",
          required: false,
          description: "Air tube/star cap cleaned and installed correctly.",
        },
      ],
      candidateCauses: [
        {
          id: "cause_airflow_restriction",
          cause: "Restricted airflow / dirty condenser reducing cooling performance.",
          likelihood: "medium",
          rulingEvidence: ["ev_airflow_clearance", "ev_condenser_dirty"],
        },
        {
          id: "cause_air_system_blocked",
          cause: "Air tube/pump blockage affecting overrun and consistency.",
          likelihood: "medium",
          rulingEvidence: ["ev_air_tube_clean"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_airflow_restriction",
      cause: "Restricted airflow / dirty condenser reducing cooling performance.",
      likelihood: "medium",
      rulingEvidence: ["ev_airflow_clearance", "ev_condenser_dirty"],
    }
  );

  assert.ok(blueprint);
  assert.equal(
    blueprint?.answers.ev_air_tube_clean?.user,
    "The air tube is clean and fitted correctly."
  );
  assert.equal(blueprint?.answers.ev_airflow_clearance?.user, "Blocked or no clearance");
  assert.equal(blueprint?.answers.ev_condenser_dirty?.user, "Heavy dust or grease build-up");
});

test("wrong-mix blueprint avoids low-volume over-beaten evidence", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "3080dfb7-85ab-4292-a596-740e6e961de1",
      labelId: "too_runny",
      title: "Fix runny texture — Spaceman",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Watery texture" }],
      evidenceChecklist: [
        {
          id: "mix_ratio",
          type: "observation",
          actionId: "check_mix_ratio",
          required: false,
          description: "Current mix-to-water ratio",
        },
        {
          id: "pulls_per_hour",
          type: "reading",
          actionId: "count_pulls_hour",
          required: false,
          description: "Servings pulled per hour",
        },
      ],
      candidateCauses: [
        {
          id: "wrong_mix_ratio",
          cause: "Incorrect mix-to-water ratio",
          likelihood: "low",
          rulingEvidence: ["mix_ratio"],
        },
        {
          id: "over_beaten",
          cause: "Product over-beaten from sitting too long",
          likelihood: "medium",
          rulingEvidence: ["pulls_per_hour"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "wrong_mix_ratio",
      cause: "Incorrect mix-to-water ratio",
      likelihood: "low",
      rulingEvidence: ["mix_ratio"],
    }
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.mix_ratio?.user, "Incorrect ratio");
  assert.equal(blueprint?.answers.pulls_per_hour?.user, "30 serves per hour");
});

test("cause-specific blueprint uses exact enum option values for action-backed evidence", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-enum-1",
      labelId: "ss_product_too_icy",
      title: "Soft serve icy / too hard",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Icy/grainy texture; large ice crystals." }],
      evidenceChecklist: [
        {
          id: "ev_scraper_blade_condition",
          type: "observation",
          actionId: "inspect_scraper_blades",
          required: false,
          description: "Scraper blades condition on inspection.",
        },
      ],
      candidateCauses: [
        {
          id: "cause_worn_scraper_blades",
          cause: "Worn scraper blades not scraping cylinder wall effectively.",
          likelihood: "medium",
          rulingEvidence: ["ev_scraper_blade_condition"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_worn_scraper_blades",
      cause: "Worn scraper blades not scraping cylinder wall effectively.",
      likelihood: "medium",
      rulingEvidence: ["ev_scraper_blade_condition"],
    },
    new Map([
      [
        "inspect_scraper_blades",
        {
          id: "inspect_scraper_blades",
          title: "Inspect scraper blades",
          expectedInput: {
            type: "enum",
            options: ["Good condition", "Some wear visible", "Clearly damaged/worn"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_scraper_blade_condition?.user, "Clearly damaged/worn");
  assert.equal(blueprint?.answers.inspect_scraper_blades?.user, "Clearly damaged/worn");
});

test("cause-specific blueprint prefers non-damage handle option for non-damage causes", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-handle-1",
      labelId: "fb_draw_handle_stuck",
      title: "Draw handle stuck / hard to pull",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Handle hard to pull." }],
      evidenceChecklist: [
        {
          id: "ev_handle_photo",
          type: "observation",
          actionId: "inspect_handle_movement_condition",
          required: false,
          description: "Handle movement and visible damage condition.",
          valueDefinition: {
            kind: "enum",
            options: ["Visible bend or damage", "Stiff but no visible damage", "Unsure"],
            unknownValues: ["Unsure"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_product_overfrozen",
          cause: "Product over-frozen making dispense difficult.",
          likelihood: "high",
          rulingEvidence: ["ev_handle_photo"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_handle_photo", operator: "equals", values: ["Stiff but no visible damage"] }],
        },
        {
          id: "cause_mechanical_damage",
          cause: "Bent/sticky linkage or damaged valve components (technician).",
          likelihood: "medium",
          rulingEvidence: ["ev_handle_photo"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_handle_photo", operator: "equals", values: ["Visible bend or damage"] }],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_product_overfrozen",
      cause: "Product over-frozen making dispense difficult.",
      likelihood: "high",
      rulingEvidence: ["ev_handle_photo"],
      supportMode: "all",
      supportRules: [{ evidenceId: "ev_handle_photo", operator: "equals", values: ["Stiff but no visible damage"] }],
    }
  );

  assert.equal(blueprint?.answers.ev_handle_photo?.user, "Stiff but no visible damage");
  assert.equal(blueprint?.answers.inspect_handle_movement_condition?.user, "Stiff but no visible damage");
});

test("legacy single-value boolean support rules still generate the matching boolean answer", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-legacy-bool-1",
      labelId: "fb_chunks_or_particles_in_product",
      title: "Chunks/particles in product",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Dispense clogs or becomes inconsistent." }],
      evidenceChecklist: [
        {
          id: "ev_confirm_no_chunks",
          type: "confirmation",
          actionId: "confirm_no_frozen_chunks_added",
          required: true,
          description:
            "Whether no frozen chunks or added ice were introduced. Yes means no frozen chunks were added; No means frozen chunks or ice were added.",
          valueDefinition: { kind: "boolean" },
        },
      ],
      candidateCauses: [
        {
          id: "cause_frozen_chunks_added",
          cause: "Frozen chunks or added ice are entering the mix and causing clogs.",
          likelihood: "high",
          rulingEvidence: ["ev_confirm_no_chunks"],
          supportMode: "all",
          supportRules: [
            {
              evidenceId: "ev_confirm_no_chunks",
              operator: "equals",
              value: false,
            },
          ],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_frozen_chunks_added",
      cause: "Frozen chunks or added ice are entering the mix and causing clogs.",
      likelihood: "high",
      rulingEvidence: ["ev_confirm_no_chunks"],
      supportMode: "all",
      supportRules: [
        {
          evidenceId: "ev_confirm_no_chunks",
          operator: "equals",
          value: false,
        },
      ],
    },
    new Map([
      [
        "confirm_no_frozen_chunks_added",
        {
          id: "confirm_no_frozen_chunks_added",
          title: "Confirm no frozen chunks added",
          expectedInput: {
            type: "boolean",
            options: ["Yes", "No"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_confirm_no_chunks?.user, "No");
  assert.equal(blueprint?.answers.confirm_no_frozen_chunks_added?.user, "No");
});

test("structured enum generation prefers concrete non-unknown answers over unsure for not-equals support", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-low-mix-sensor-fault",
      labelId: "fb_low_mix_light_with_full_hopper",
      title: "Low-mix light with hopper full",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Low-mix light on even when hopper is full." }],
      evidenceChecklist: [
        {
          id: "ev_clean_sensor_area",
          type: "confirmation",
          required: false,
          description: "Sensor area cleaned during last clean.",
          valueDefinition: {
            kind: "enum",
            options: ["Yes", "No", "Unsure"],
            unknownValues: ["Unsure"],
          },
        },
        {
          id: "ev_delay_observed",
          type: "confirmation",
          required: false,
          description: "Observed short freeze delay before compressor stops.",
          valueDefinition: {
            kind: "enum",
            options: ["Yes", "No", "Unsure"],
            unknownValues: ["Unsure"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_sensor_fault",
          cause: "Sensor fault",
          likelihood: "medium",
          rulingEvidence: ["ev_clean_sensor_area"],
          supportMode: "all",
          supportRules: [
            {
              evidenceId: "ev_clean_sensor_area",
              operator: "not_equals",
              values: ["Yes"],
            },
          ],
          excludeRules: [
            {
              evidenceId: "ev_delay_observed",
              operator: "equals",
              values: ["Yes"],
            },
          ],
        },
        {
          id: "cause_sensor_misaligned",
          cause: "Sensor misaligned",
          likelihood: "high",
          rulingEvidence: ["ev_clean_sensor_area", "ev_delay_observed"],
          supportMode: "all",
          supportRules: [
            {
              evidenceId: "ev_clean_sensor_area",
              operator: "equals",
              values: ["Yes"],
            },
            {
              evidenceId: "ev_delay_observed",
              operator: "equals",
              values: ["Yes"],
            },
          ],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_sensor_fault",
      cause: "Sensor fault",
      likelihood: "medium",
      rulingEvidence: ["ev_clean_sensor_area"],
      supportMode: "all",
      supportRules: [
        {
          evidenceId: "ev_clean_sensor_area",
          operator: "not_equals",
          values: ["Yes"],
        },
      ],
      excludeRules: [
        {
          evidenceId: "ev_delay_observed",
          operator: "equals",
          values: ["Yes"],
        },
      ],
    }
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_clean_sensor_area?.user, "No");
});

test("structured enum generation prefers concrete non-excluded answers over unknowns", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-warm-product",
      labelId: "fb_product_not_freezing",
      title: "Frozen beverage not freezing",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Product remains liquid/soupy." }],
      evidenceChecklist: [
        {
          id: "ev_recipe_ratio",
          type: "observation",
          required: false,
          description: "Recipe ratio confirmed.",
          valueDefinition: {
            kind: "enum",
            options: ["Correct ratio", "Unsure of ratio", "Incorrect ratio"],
            unknownValues: ["Unsure of ratio"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_warm_product_added",
          cause: "Warm product added",
          likelihood: "medium",
          rulingEvidence: ["ev_recipe_ratio"],
          supportMode: "all",
          supportRules: [
            {
              evidenceId: "ev_recipe_ratio",
              operator: "not_equals",
              values: ["Incorrect ratio"],
            },
          ],
        },
        {
          id: "cause_refrigeration_fault",
          cause: "Refrigeration fault",
          likelihood: "medium",
          rulingEvidence: ["ev_recipe_ratio"],
          supportMode: "all",
          supportRules: [
            {
              evidenceId: "ev_recipe_ratio",
              operator: "equals",
              values: ["Correct ratio"],
            },
          ],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_warm_product_added",
      cause: "Warm product added",
      likelihood: "medium",
      rulingEvidence: ["ev_recipe_ratio"],
      supportMode: "all",
      supportRules: [
        {
          evidenceId: "ev_recipe_ratio",
          operator: "not_equals",
          values: ["Incorrect ratio"],
        },
      ],
    }
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_recipe_ratio?.user, "Correct ratio");
});

test("structured enum generation prefers a less ambiguous target-supported option over a competing concrete option", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-sensor-1",
      labelId: "fb_low_mix_light_with_full_hopper",
      title: "Low-mix light with hopper full",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Low mix light with full hopper." }],
      evidenceChecklist: [
        {
          id: "ev_clean_sensor_area",
          type: "confirmation",
          required: false,
          description: "Sensor area cleaned during last clean.",
          valueDefinition: {
            kind: "enum",
            options: ["Yes", "No", "Unsure"],
            unknownValues: ["Unsure"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_sensor_fault",
          cause: "The low-mix sensor itself is faulty or contaminated.",
          likelihood: "medium",
          rulingEvidence: ["ev_clean_sensor_area"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_clean_sensor_area", operator: "not_equals", values: ["Yes"] }],
        },
        {
          id: "cause_wiring_fault",
          cause: "The low-mix sensor wiring or connector is intermittently faulty.",
          likelihood: "low",
          rulingEvidence: ["ev_clean_sensor_area"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_clean_sensor_area", operator: "equals", values: ["No"] }],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_sensor_fault",
      cause: "The low-mix sensor itself is faulty or contaminated.",
      likelihood: "medium",
      rulingEvidence: ["ev_clean_sensor_area"],
      supportMode: "all",
      supportRules: [{ evidenceId: "ev_clean_sensor_area", operator: "not_equals", values: ["Yes"] }],
    }
  );

  assert.equal(blueprint?.answers.ev_clean_sensor_area?.user, "Unsure");
});

test("cause-specific blueprint keeps numeric support answers away from overlapping boundaries", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-number-1",
      labelId: "fb_brix_out_of_range",
      title: "Mix brix out of range / recipe issue",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Either won’t freeze or freezes up." }],
      evidenceChecklist: [
        {
          id: "ev_brix",
          type: "reading",
          actionId: "check_product_brix",
          required: true,
          description: "Measured brix reading for the product.",
          valueDefinition: { kind: "number", unit: "brix" },
        },
      ],
      candidateCauses: [
        {
          id: "cause_measurement_error",
          cause: "Measurement error causing near-normal brix results.",
          likelihood: "medium",
          rulingEvidence: ["ev_brix"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_brix", operator: "between", min: 10, max: 15.9 }],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_measurement_error",
      cause: "Measurement error causing near-normal brix results.",
      likelihood: "medium",
      rulingEvidence: ["ev_brix"],
      supportMode: "all",
      supportRules: [{ evidenceId: "ev_brix", operator: "between", min: 10, max: 15.9 }],
    },
    new Map([
      [
        "check_product_brix",
        {
          id: "check_product_brix",
          title: "Check product brix",
          expectedInput: { type: "number", unit: "brix" },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_brix?.user, "13.0");
  assert.equal(blueprint?.answers.check_product_brix?.user, "13.0");
});

test("cause-specific blueprint uses playbook enum options when no action is linked", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-enum-2",
      labelId: "ss_excessive_overrun_foamy",
      title: "Soft serve too airy/foamy",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Foamy texture with visible air pockets." }],
      evidenceChecklist: [
        {
          id: "ev_star_cap_installed",
          type: "confirmation",
          required: false,
          description: "Star cap seated correctly.",
          valueDefinition: {
            kind: "enum",
            options: ["Correct and properly seated", "Incorrect or loose", "Unsure"],
            unknownValues: ["Unsure"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_air_tube_or_starcap_misfit",
          cause: "Air tube/star cap mis-installed or damaged causing abnormal air intake.",
          likelihood: "high",
          rulingEvidence: ["ev_star_cap_installed"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_air_tube_or_starcap_misfit",
      cause: "Air tube/star cap mis-installed or damaged causing abnormal air intake.",
      likelihood: "high",
      rulingEvidence: ["ev_star_cap_installed"],
    }
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_star_cap_installed?.user, "Incorrect or loose");
});

test("sensor misalignment blueprint avoids fault-biased delay and power-cycle answers", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "418faed3-9dd7-4cd4-a896-2ebf5e15a92c",
      labelId: "fb_low_mix_light_with_full_hopper",
      title: "Low-mix light with hopper full (sensor false trip)",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Low-mix light on even when hopper is full." }],
      evidenceChecklist: [
        {
          id: "ev_delay_observed",
          type: "confirmation",
          required: false,
          description: "Observed 1-minute freeze delay before compressor stops (if applicable).",
        },
        {
          id: "ev_power_cycle",
          actionId: "power_cycle_off_on",
          type: "observation",
          required: false,
          description: "Power cycle attempted once.",
        },
      ],
      candidateCauses: [
        {
          id: "cause_sensor_misaligned",
          cause: "Sensor misalignment/positioning issue after cleaning/service.",
          likelihood: "medium",
          rulingEvidence: ["ev_delay_observed"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_sensor_misaligned",
      cause: "Sensor misalignment/positioning issue after cleaning/service.",
      likelihood: "medium",
      rulingEvidence: ["ev_delay_observed"],
    },
    new Map([
      [
        "power_cycle_off_on",
        {
          id: "power_cycle_off_on",
          title: "Power cycle",
          expectedInput: {
            type: "enum",
            options: ["Completed", "Unable to perform safely", "Attempted but issue persists"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_delay_observed?.user, "Yes.");
  assert.equal(blueprint?.answers.power_cycle_off_on?.user, "Completed");
});

test("worn tune-up parts blueprint emits numeric months answers for parts age prompts", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "e181c5d8-fac3-4c90-8452-33812fd83cec",
      labelId: "fb_product_leaking_inside_machine",
      title: "Product leaking inside machine / internal drip tray",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Product leaking inside machine / internal drip tray." }],
      evidenceChecklist: [
        {
          id: "ev_parts_age",
          type: "confirmation",
          required: false,
          description: "Tune-up kit/wear parts age (months).",
        },
      ],
      candidateCauses: [
        {
          id: "cause_worn_tuneup_parts",
          cause: "Worn tune-up kit parts (gaskets/O-rings) causing internal leak.",
          likelihood: "high",
          rulingEvidence: ["ev_parts_age"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_worn_tuneup_parts",
      cause: "Worn tune-up kit parts (gaskets/O-rings) causing internal leak.",
      likelihood: "high",
      rulingEvidence: ["ev_parts_age"],
    }
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_parts_age?.user, "18");
});

test("drive shaft wear blueprint keeps tune-up parts evidence neutral", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "e181c5d8-fac3-4c90-8452-33812fd83cec",
      labelId: "fb_product_leaking_inside_machine",
      title: "Product leaking inside machine / internal drip tray",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Product leaking inside machine / internal drip tray." }],
      evidenceChecklist: [
        {
          id: "ev_tuneup_parts_checked",
          type: "observation",
          actionId: "inspect_o_rings_gaskets",
          required: false,
          description: "O-rings/gaskets/tune-up parts inspected for damage/missing.",
        },
        {
          id: "ev_parts_age",
          type: "confirmation",
          required: false,
          description: "Tune-up kit/wear parts age (months).",
        },
      ],
      candidateCauses: [
        {
          id: "cause_drive_shaft_wear",
          cause: "Drive shaft wear/grooves require service if persistent.",
          likelihood: "medium",
          rulingEvidence: ["ev_tuneup_parts_checked"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_drive_shaft_wear",
      cause: "Drive shaft wear/grooves require service if persistent.",
      likelihood: "medium",
      rulingEvidence: ["ev_tuneup_parts_checked"],
    },
    new Map([
      [
        "inspect_o_rings_gaskets",
        {
          id: "inspect_o_rings_gaskets",
          title: "Inspect O-rings/gaskets",
          expectedInput: {
            type: "enum",
            options: ["No visible wear", "Worn or flattened", "Damaged or cracked"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_tuneup_parts_checked?.user, "No visible wear");
  assert.equal(blueprint?.answers.ev_parts_age?.user, "4");
});

test("improper cleaning blueprint emits neglected cleaning and lubrication evidence", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "e181c5d8-fac3-4c90-8452-33812fd83cec",
      labelId: "fb_product_leaking_inside_machine",
      title: "Product leaking inside machine / internal drip tray",
      enabled: true,
      schemaVersion: 1,
      symptoms: [{ id: "sym1", description: "Product leaking inside machine / internal drip tray." }],
      evidenceChecklist: [
        {
          id: "ev_cleaning_done",
          type: "observation",
          actionId: "confirm_last_full_clean",
          required: false,
          description: "Routine disassembly/cleaning and correct lubrication performed.",
        },
        {
          id: "ev_drive_shaft_gasket",
          type: "observation",
          actionId: "lubricate_o_rings_gaskets",
          required: false,
          description: "Drive shaft gasket lubricated and intact (visual during clean).",
        },
      ],
      candidateCauses: [
        {
          id: "cause_improper_cleaning_lube",
          cause: "Internal leak due to incomplete cleaning or missed lubrication, usually when cleaning/lubrication was not performed correctly or the leak began immediately after reassembly.",
          likelihood: "medium",
          rulingEvidence: ["ev_cleaning_done"],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_improper_cleaning_lube",
      cause: "Internal leak due to incomplete cleaning or missed lubrication, usually when cleaning/lubrication was not performed correctly or the leak began immediately after reassembly.",
      likelihood: "medium",
      rulingEvidence: ["ev_cleaning_done"],
    },
    new Map([
      [
        "confirm_last_full_clean",
        {
          id: "confirm_last_full_clean",
          title: "Confirm last full clean",
          expectedInput: {
            type: "enum",
            options: ["Within last 72 hours", "More than 72 hours ago", "Unknown"],
          },
        },
      ],
      [
        "lubricate_o_rings_gaskets",
        {
          id: "lubricate_o_rings_gaskets",
          title: "Lubricate seals",
          expectedInput: {
            type: "enum",
            options: ["Completed", "Unable to complete safely", "Skipped"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_cleaning_done?.user, "More than 72 hours ago");
  assert.equal(blueprint?.answers.ev_drive_shaft_gasket?.user, "Skipped");
});

test("structured rules generate neutral answers for competing-only evidence", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "e181c5d8-fac3-4c90-8452-33812fd83cec",
      labelId: "fb_product_leaking_inside_machine",
      title: "Product leaking inside machine / internal drip tray",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Product leaking inside machine / internal drip tray." }],
      evidenceChecklist: [
        {
          id: "ev_cleaning_done",
          type: "observation",
          actionId: "confirm_last_full_clean",
          required: false,
          description: "Routine disassembly/cleaning and correct lubrication performed.",
          valueDefinition: {
            kind: "enum",
            options: ["Within last 72 hours", "More than 72 hours ago", "Unknown"],
            unknownValues: ["Unknown"],
          },
        },
        {
          id: "ev_leak_started_after_cleaning",
          type: "confirmation",
          actionId: "confirm_leak_started_after_cleaning",
          required: false,
          description: "Leak began immediately after cleaning, lubrication, or reassembly.",
          valueDefinition: {
            kind: "enum",
            options: ["Yes", "No", "Unknown"],
            unknownValues: ["Unknown"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_improper_cleaning_lube",
          cause: "Incomplete cleaning or missed lubrication.",
          likelihood: "high",
          rulingEvidence: ["ev_cleaning_done"],
          supportMode: "any",
          supportRules: [
            {
              evidenceId: "ev_cleaning_done",
              operator: "in",
              values: ["More than 72 hours ago", "Unknown"],
            },
          ],
        },
        {
          id: "cause_misassembly",
          cause: "Leak path introduced during reassembly.",
          likelihood: "medium",
          rulingEvidence: ["ev_leak_started_after_cleaning"],
          supportRules: [
            {
              evidenceId: "ev_leak_started_after_cleaning",
              operator: "equals",
              values: ["Yes"],
            },
          ],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_improper_cleaning_lube",
      cause: "Incomplete cleaning or missed lubrication.",
      likelihood: "high",
      rulingEvidence: ["ev_cleaning_done"],
      supportMode: "any",
      supportRules: [
        {
          evidenceId: "ev_cleaning_done",
          operator: "in",
          values: ["More than 72 hours ago", "Unknown"],
        },
      ],
    },
    new Map([
      [
        "confirm_last_full_clean",
        {
          id: "confirm_last_full_clean",
          title: "Confirm last full clean",
          expectedInput: {
            type: "enum",
            options: ["Within last 72 hours", "More than 72 hours ago", "Unknown"],
          },
        },
      ],
      [
        "confirm_leak_started_after_cleaning",
        {
          id: "confirm_leak_started_after_cleaning",
          title: "Confirm leak started after cleaning",
          expectedInput: {
            type: "enum",
            options: ["Yes", "No", "Unknown"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_cleaning_done?.user, "More than 72 hours ago");
  assert.equal(blueprint?.answers.ev_leak_started_after_cleaning?.user, "Unknown");
});

test("competing numeric between rules stay inside allowed range when generating neutral answers", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "3724e28d-b7ce-444c-8aa0-fb73a174fa7b",
      labelId: "fb_product_not_freezing",
      title: "Frozen beverage not freezing (soupy)",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Product remains liquid/soupy; won’t form slush." }],
      evidenceChecklist: [
        {
          id: "ev_brix",
          type: "reading",
          actionId: "check_product_brix",
          required: false,
          description: "Brix reading (refractometer).",
          valueDefinition: { kind: "number", unit: "brix" },
        },
        {
          id: "ev_prechilled",
          type: "confirmation",
          actionId: "confirm_prechilled_mix",
          required: false,
          description: "Product was pre-chilled before addition.",
          valueDefinition: {
            kind: "enum",
            options: ["Yes", "No", "Unsure"],
            unknownValues: ["Unsure"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_brix_too_high",
          cause: "Product brix is too high.",
          likelihood: "high",
          rulingEvidence: ["ev_brix"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_brix", operator: "between", min: 16.1, max: 30 }],
        },
        {
          id: "cause_warm_product_added",
          cause: "Warm product was added without pre-chilling.",
          likelihood: "medium",
          rulingEvidence: ["ev_prechilled"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_prechilled", operator: "equals", values: ["No"] }],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_warm_product_added",
      cause: "Warm product was added without pre-chilling.",
      likelihood: "medium",
      rulingEvidence: ["ev_prechilled"],
      supportMode: "all",
      supportRules: [{ evidenceId: "ev_prechilled", operator: "equals", values: ["No"] }],
    },
    new Map([
      [
        "check_product_brix",
        {
          id: "check_product_brix",
          title: "Check product brix",
          expectedInput: {
            type: "number",
            unit: "brix",
            range: { min: 0, max: 30 },
          },
        },
      ],
      [
        "confirm_prechilled_mix",
        {
          id: "confirm_prechilled_mix",
          title: "Confirm pre-chilled mix",
          expectedInput: {
            type: "enum",
            options: ["Yes", "No", "Unsure"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_prechilled?.user, "No");
  assert.equal(blueprint?.answers.ev_brix?.user, "16.0");
});

test("structured option scoring prefers the target-supported enum over a competing cause", () => {
  const blueprint = buildFallbackResolutionBlueprintForCause(
    {
      id: "pb-refrig-1",
      labelId: "fb_product_not_freezing",
      title: "Frozen beverage not freezing",
      enabled: true,
      schemaVersion: 2,
      symptoms: [{ id: "sym1", description: "Product remains liquid/soupy." }],
      evidenceChecklist: [
        {
          id: "ev_prechilled",
          type: "confirmation",
          actionId: "confirm_prechilled_mix",
          required: false,
          description: "Product was pre-chilled before addition.",
          valueDefinition: {
            kind: "enum",
            options: ["Yes", "No", "Unsure"],
            unknownValues: ["Unsure"],
          },
        },
      ],
      candidateCauses: [
        {
          id: "cause_warm_product_added",
          cause: "Warm product was added without pre-chilling.",
          likelihood: "medium",
          rulingEvidence: ["ev_prechilled"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_prechilled", operator: "equals", values: ["No"] }],
        },
        {
          id: "cause_refrigeration_fault",
          cause: "Refrigeration fault after other checks are normal.",
          likelihood: "medium",
          rulingEvidence: ["ev_prechilled"],
          supportMode: "all",
          supportRules: [{ evidenceId: "ev_prechilled", operator: "equals", values: ["Yes"] }],
        },
      ],
      escalationTriggers: [],
      steps: [],
      updatedAt: new Date(),
    },
    {
      id: "cause_refrigeration_fault",
      cause: "Refrigeration fault after other checks are normal.",
      likelihood: "medium",
      rulingEvidence: ["ev_prechilled"],
      supportMode: "all",
      supportRules: [{ evidenceId: "ev_prechilled", operator: "equals", values: ["Yes"] }],
    },
    new Map([
      [
        "confirm_prechilled_mix",
        {
          id: "confirm_prechilled_mix",
          title: "Confirm pre-chilled mix",
          expectedInput: {
            type: "boolean",
            options: ["Yes", "No"],
          },
        },
      ],
    ])
  );

  assert.ok(blueprint);
  assert.equal(blueprint?.answers.ev_prechilled?.user, "Yes");
});
