import { sql } from "drizzle-orm";
import { db } from "./index";
import { labels, actions, playbooks } from "./schema";
import { eq } from "drizzle-orm";

const DEFAULT_LABELS = [
  { id: "good_texture", displayName: "Good texture", description: "Normal, desired consistency" },
  { id: "too_runny", displayName: "Too runny", description: "Watery, thin, melts too fast" },
  { id: "too_icy", displayName: "Too icy", description: "Crystalline, icy texture" },
  { id: "too_thick", displayName: "Too thick", description: "Overly dense or stiff" },
];

export async function ensureVectorExtension(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
}

export async function ensureVectorIndexes(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS reference_images_embedding_idx
    ON reference_images USING hnsw (embedding vector_cosine_ops)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
    ON doc_chunks USING hnsw (embedding vector_cosine_ops)
  `);
}

const DEFAULT_ACTIONS = [
  {
    id: "photo_dispense_front",
    title: "Photo: product dispense",
    instructions:
      "Dispense a small amount of product and take a clear photo from the front showing the texture and flow.",
    expectedInput: { type: "photo" as const },
    safetyLevel: "safe" as const,
  },
  {
    id: "photo_settings_screen",
    title: "Photo: settings display",
    instructions: "Take a clear photo of the machine's settings/temperature display screen.",
    expectedInput: { type: "photo" as const },
    safetyLevel: "safe" as const,
  },
  {
    id: "read_hopper_temp",
    title: "Read hopper temperature",
    instructions: "Check the temperature displayed on the hopper and report the reading.",
    expectedInput: { type: "number" as const, unit: "C", range: { min: -10, max: 20 } },
    safetyLevel: "safe" as const,
  },
  {
    id: "check_clearance",
    title: "Check machine clearance",
    instructions:
      "Measure the gap between the machine and surrounding walls/equipment on all sides. Is there at least 6 inches (15cm) of clearance on all sides?",
    expectedInput: { type: "boolean" as const },
    safetyLevel: "safe" as const,
  },
  {
    id: "check_mix_ratio",
    title: "Check mix-to-water ratio",
    instructions:
      "What mix-to-water ratio are you currently using? Check the mix bag instructions for the recommended ratio.",
    expectedInput: { type: "text" as const },
    safetyLevel: "safe" as const,
  },
  {
    id: "report_last_clean",
    title: "Report last cleaning date",
    instructions: "When was the machine last fully cleaned (including air tubes)?",
    expectedInput: { type: "text" as const },
    safetyLevel: "safe" as const,
  },
  {
    id: "count_pulls_hour",
    title: "Count pulls per hour",
    instructions: "Approximately how many servings have you pulled in the last hour?",
    expectedInput: { type: "number" as const, unit: "servings", range: { min: 0, max: 200 } },
    safetyLevel: "safe" as const,
  },
  {
    id: "run_rinse_cycle",
    title: "Run basic rinse cycle",
    instructions: "Run a basic rinse cycle following the machine's standard procedure. Report when complete.",
    expectedInput: { type: "boolean" as const },
    safetyLevel: "caution" as const,
  },
  {
    id: "inspect_scraper_blades",
    title: "Inspect scraper blades",
    instructions:
      "Open the machine and visually inspect the scraper blades. Look for wear, damage, or product buildup.",
    expectedInput: {
      type: "enum" as const,
      options: ["Good condition", "Some wear visible", "Clearly damaged/worn"],
    },
    safetyLevel: "caution" as const,
  },
];

export async function seedLabels(): Promise<void> {
  await ensureVectorExtension();
  await ensureVectorIndexes();
  for (const label of DEFAULT_LABELS) {
    await db
      .insert(labels)
      .values({
        id: label.id,
        displayName: label.displayName,
        description: label.description ?? null,
      })
      .onConflictDoUpdate({
        target: labels.id,
        set: {
          displayName: label.displayName,
          description: label.description ?? null,
        },
      });
  }
}

export async function seedActions(): Promise<void> {
  for (const a of DEFAULT_ACTIONS) {
    await db
      .insert(actions)
      .values({
        id: a.id,
        title: a.title,
        instructions: a.instructions,
        expectedInput: a.expectedInput as unknown as Record<string, unknown>,
        safetyLevel: a.safetyLevel,
        appliesToModels: null,
      })
      .onConflictDoUpdate({
        target: actions.id,
        set: {
          title: a.title,
          instructions: a.instructions,
          expectedInput: a.expectedInput as unknown as Record<string, unknown>,
          safetyLevel: a.safetyLevel,
          updatedAt: new Date(),
        },
      });
  }
}

const TOO_RUNNY_SYMPTOMS = [
  { id: "watery", description: "Watery texture" },
  { id: "melts_fast", description: "Product melts too fast" },
  { id: "wont_hold_shape", description: "Won't hold shape" },
  { id: "too_soft", description: "Soft serve is too soft" },
  { id: "running", description: "Running/dripping" },
];

const TOO_RUNNY_EVIDENCE = [
  { id: "machine_model", description: "Machine model", type: "observation" as const, required: true },
  { id: "dispense_photo", description: "Photo of product dispense", actionId: "photo_dispense_front", type: "photo" as const, required: true },
  { id: "hopper_temp", description: "Hopper temperature reading (normal operating range typically -8°C to -4°C; above this can cause runny product)", actionId: "read_hopper_temp", type: "reading" as const, required: true },
  { id: "clearance_ok", description: "Machine has adequate clearance", actionId: "check_clearance", type: "confirmation" as const, required: true },
  { id: "last_clean", description: "Last cleaning date", actionId: "report_last_clean", type: "observation" as const, required: false },
  { id: "mix_ratio", description: "Current mix-to-water ratio", actionId: "check_mix_ratio", type: "observation" as const, required: false },
  { id: "pulls_per_hour", description: "Servings pulled per hour", actionId: "count_pulls_hour", type: "reading" as const, required: false },
  { id: "scraper_condition", description: "Scraper blade condition", actionId: "inspect_scraper_blades", type: "action" as const, required: false },
];

const TOO_RUNNY_CAUSES = [
  { id: "hopper_too_warm", cause: "Hopper temperature too high (product not cold enough to set properly)", likelihood: "high" as const, rulingEvidence: ["hopper_temp"] },
  { id: "poor_airflow", cause: "Insufficient air circulation around machine", likelihood: "high" as const, rulingEvidence: ["clearance_ok"] },
  { id: "worn_scrapers", cause: "Worn or damaged scraper blades", likelihood: "medium" as const, rulingEvidence: ["scraper_condition"] },
  { id: "over_beaten", cause: "Product over-beaten from sitting too long", likelihood: "medium" as const, rulingEvidence: ["pulls_per_hour"] },
  { id: "blocked_air_tubes", cause: "Blocked air tubes or pump", likelihood: "medium" as const, rulingEvidence: ["last_clean"] },
  { id: "over_pulling", cause: "Over-pulling beyond machine capacity", likelihood: "medium" as const, rulingEvidence: ["pulls_per_hour"] },
  { id: "wrong_mix_ratio", cause: "Incorrect mix-to-water ratio", likelihood: "low" as const, rulingEvidence: ["mix_ratio"] },
];

const TOO_RUNNY_TRIGGERS = [
  { trigger: "electrical smell", reason: "Potential electrical hazard" },
  { trigger: "refrigerant leak", reason: "Refrigerant handling requires certified technician" },
  { trigger: "error code", reason: "Machine error codes require technician diagnosis" },
  { trigger: "sparking", reason: "Electrical hazard" },
];

const TOO_RUNNY_STEPS = [
  { step_id: "cool-hopper", title: "Cool hopper to operating range", instruction: "Allow the machine time to cool. Hopper should be in the -8°C to -4°C range for proper texture. Check that the machine has adequate clearance for airflow and that ambient temperature is not too high.", check: "Hopper display shows temperature within -8°C to -4°C.", if_failed: "If temperature does not drop after 30+ minutes, escalate to technician (possible refrigeration issue)." },
  { step_id: "clear-space", title: "Clear space", instruction: "Ensure minimum 6\" clearance on all sides of the machine for air flow.", check: "Verify clearance with a ruler.", if_failed: "Check for obstructions or relocated equipment." },
  { step_id: "check-scraper", title: "Check scraper", instruction: "Inspect scraper blades for wear; replace if they don't scrape the cylinder properly.", check: "Blades contact cylinder evenly; no visible wear.", if_failed: "Order replacement blades; reduce pull rate until replaced." },
  { step_id: "flush-old", title: "Flush old product", instruction: "Pull product out several times so fresh mix from the hopper enters the cylinder.", check: "Dispensed product is from fresh batch.", if_failed: "Extend wait time between pulls." },
  { step_id: "clean-air", title: "Clean air system", instruction: "Clean air tube and air tube inlet holes thoroughly as per cleaning procedure.", check: "No blockages; air flows.", if_failed: "Repeat cleaning; check pump if still blocked." },
  { step_id: "pace-pulls", title: "Pace pulls", instruction: "Time your pulls and leave a delay between each so the machine can freeze new product.", check: "Servings per hour within model limit.", if_failed: "Reduce serving rate or upgrade model." },
];

export async function seedTooRunnyPlaybook(): Promise<void> {
  const existing = await db.select().from(playbooks).where(eq(playbooks.labelId, "too_runny"));
  const payload = {
    title: "Fix runny texture — Spaceman",
    steps: TOO_RUNNY_STEPS,
    schemaVersion: 1,
    symptoms: TOO_RUNNY_SYMPTOMS,
    evidenceChecklist: TOO_RUNNY_EVIDENCE,
    candidateCauses: TOO_RUNNY_CAUSES,
    escalationTriggers: TOO_RUNNY_TRIGGERS,
    updatedAt: new Date(),
  };
  if (existing.length > 0) {
    await db.update(playbooks).set(payload).where(eq(playbooks.id, existing[0].id));
  } else {
    await db.insert(playbooks).values({
      labelId: "too_runny",
      title: payload.title,
      steps: payload.steps,
      schemaVersion: payload.schemaVersion,
      symptoms: payload.symptoms,
      evidenceChecklist: payload.evidenceChecklist,
      candidateCauses: payload.candidateCauses,
      escalationTriggers: payload.escalationTriggers,
    });
  }
}
