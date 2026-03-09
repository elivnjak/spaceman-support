import test from "node:test";
import assert from "node:assert/strict";
import { preventRepeatedChecklistRequests } from "@/lib/pipeline/request-dedup";
import type {
  ActionRecord,
  DiagnosticPlaybook,
  EvidenceRecord,
  PlannerOutput,
} from "@/lib/pipeline/diagnostic-planner";

function buildEvidenceRecord(value: unknown): EvidenceRecord {
  return {
    value,
    type: typeof value,
    confidence: "exact",
    collectedAt: new Date().toISOString(),
    turn: 1,
  };
}

test("does not inject fallback request when only optional checklist evidence is missing", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-1",
    labelId: "ss_excessive_overrun_foamy",
    title: "Soft serve too airy/foamy (excess overrun)",
    steps: [],
    evidenceChecklist: [
      {
        id: "ev_air_tube_orientation",
        actionId: "inspect_air_tube_orientation",
        description: "Air tube installed correctly and not cracked/damaged.",
        type: "observation",
        required: true,
      },
      {
        id: "ev_star_cap_installed",
        description: "Correct star cap installed and seated.",
        type: "observation",
        required: false,
      },
    ],
    candidateCauses: [],
    escalationTriggers: [],
    symptoms: [],
  };

  const result = preventRepeatedChecklistRequests({
    requests: [
      {
        id: "inspect_air_tube_orientation",
        type: "question",
        prompt: "Please inspect the air tube orientation.",
      },
    ] satisfies PlannerOutput["requests"],
    playbook,
    evidence: {
      ev_air_tube_orientation: buildEvidenceRecord(
        "The air tube was dirty and not seated correctly."
      ),
    },
    evidenceExtracted: [],
    actionsById: new Map<string, ActionRecord>(),
  });

  assert.deepEqual(result.requests, []);
  assert.deepEqual(result.removedRequestIds, ["inspect_air_tube_orientation"]);
  assert.equal(result.fallbackEvidenceId, undefined);
});

test("injects fallback request when required checklist evidence is still missing", () => {
  const actionsById = new Map<string, ActionRecord>([
    [
      "check_mix_level",
      {
        id: "check_mix_level",
        title: "Check mix level",
        instructions: "",
        expectedInput: {
          type: "enum",
          options: ["Above minimum line", "Near minimum line", "Below minimum line"],
        },
        safetyLevel: "safe",
      },
    ],
  ]);

  const playbook: DiagnosticPlaybook = {
    id: "pb-2",
    labelId: "ss_excessive_overrun_foamy",
    title: "Soft serve too airy/foamy (excess overrun)",
    steps: [],
    evidenceChecklist: [
      {
        id: "ev_air_tube_orientation",
        actionId: "inspect_air_tube_orientation",
        description: "Air tube installed correctly and not cracked/damaged.",
        type: "observation",
        required: true,
      },
      {
        id: "ev_mix_level_ok",
        actionId: "check_mix_level",
        description: "Mix level adequate (not drawing air from low mix).",
        type: "observation",
        required: true,
      },
    ],
    candidateCauses: [],
    escalationTriggers: [],
    symptoms: [],
  };

  const result = preventRepeatedChecklistRequests({
    requests: [
      {
        id: "inspect_air_tube_orientation",
        type: "question",
        prompt: "Please inspect the air tube orientation.",
      },
    ] satisfies PlannerOutput["requests"],
    playbook,
    evidence: {
      ev_air_tube_orientation: buildEvidenceRecord(
        "The air tube was dirty and not seated correctly."
      ),
    },
    evidenceExtracted: [],
    actionsById,
  });

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.id, "check_mix_level");
  assert.equal(result.fallbackEvidenceId, "ev_mix_level_ok");
});

test("does not treat uncertain evidence as conclusive for dedupe", () => {
  const playbook: DiagnosticPlaybook = {
    id: "pb-3",
    labelId: "ss_product_too_icy",
    title: "Soft serve icy / too hard",
    steps: [],
    evidenceChecklist: [
      {
        id: "ev_scraper_blades_age",
        description: "Scraper blades age/last replacement known.",
        type: "confirmation",
        required: false,
      },
    ],
    candidateCauses: [],
    escalationTriggers: [],
    symptoms: [],
  };

  const result = preventRepeatedChecklistRequests({
    requests: [
      {
        id: "ev_scraper_blades_age",
        type: "question",
        prompt: "When were the scraper blades last replaced?",
      },
    ] satisfies PlannerOutput["requests"],
    playbook,
    evidence: {
      ev_scraper_blades_age: {
        value: "Yes",
        type: "string",
        confidence: "uncertain",
        collectedAt: new Date().toISOString(),
        turn: 3,
      },
    },
    evidenceExtracted: [],
    actionsById: new Map<string, ActionRecord>(),
  });

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.id, "ev_scraper_blades_age");
  assert.deepEqual(result.removedRequestIds, []);
});

test("injects structured fallback evidence when dedupe removes the only request", () => {
  const actionsById = new Map<string, ActionRecord>([
    [
      "confirm_last_full_clean",
      {
        id: "confirm_last_full_clean",
        title: "Confirm last full clean",
        instructions: "",
        expectedInput: {
          type: "enum",
          options: ["Within last 72 hours", "More than 72 hours ago", "Unknown"],
        },
        safetyLevel: "safe",
      },
    ],
  ]);

  const playbook: DiagnosticPlaybook = {
    id: "pb-4",
    labelId: "ss_stop4_temperature_sensor_error",
    title: "STOP 4 temperature sensor error",
    steps: [],
    evidenceChecklist: [
      {
        id: "ev_power_cycle",
        actionId: "power_cycle_off_on",
        description: "Power cycle attempted.",
        type: "observation",
        required: false,
      },
      {
        id: "ev_recent_clean",
        actionId: "confirm_last_full_clean",
        description: "Last cleaning/assembly time.",
        type: "observation",
        required: false,
      },
    ],
    candidateCauses: [
      {
        id: "cause_temp_sensor_fault",
        cause: "Temperature sensor fault.",
        likelihood: "high",
        rulingEvidence: ["ev_power_cycle", "ev_recent_clean"],
        supportMode: "all",
        supportRules: [
          {
            evidenceId: "ev_power_cycle",
            operator: "equals",
            values: ["Attempted but issue persists"],
          },
          {
            evidenceId: "ev_recent_clean",
            operator: "in",
            values: ["More than 72 hours ago", "Unknown"],
          },
        ],
      },
    ],
    escalationTriggers: [],
    symptoms: [],
  };

  const result = preventRepeatedChecklistRequests({
    requests: [
      {
        id: "power_cycle_off_on",
        type: "question",
        prompt: "Please power cycle the machine once.",
      },
    ] satisfies PlannerOutput["requests"],
    playbook,
    evidence: {
      ev_power_cycle: buildEvidenceRecord("Attempted but issue persists"),
    },
    evidenceExtracted: [
      {
        evidenceId: "ev_power_cycle",
        value: "Attempted but issue persists",
        confidence: "exact",
      },
    ],
    actionsById,
  });

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.id, "confirm_last_full_clean");
  assert.equal(result.fallbackEvidenceId, "ev_recent_clean");
});
