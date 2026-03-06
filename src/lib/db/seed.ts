import { sql } from "drizzle-orm";
import { db } from "./index";
import { labels, actions, playbooks, users, supportedModels } from "./schema";
import { eq } from "drizzle-orm";
import { loadActionCatalogRows } from "@/lib/actions/catalog";
import { hashPassword } from "@/lib/auth";
import { toCanonicalModel } from "@/lib/ingestion/extract-machine-model";

const DEFAULT_LABELS = [
  // Texture classification labels
  { id: "good_texture", displayName: "Good texture", description: "Normal, desired consistency" },
  { id: "too_runny", displayName: "Too runny", description: "Watery, thin, melts too fast" },
  { id: "too_icy", displayName: "Too icy", description: "Crystalline, icy texture" },
  { id: "too_thick", displayName: "Too thick", description: "Overly dense or stiff" },

  // Frozen Beverage (FB) playbook labels
  { id: "fb_auger_not_turning", displayName: "FB – Auger not turning", description: "Frozen beverage auger/beater motor is not spinning" },
  { id: "fb_auto_fill_not_refilling", displayName: "FB – Auto-fill not refilling", description: "Automatic refill system is not replenishing the bowl" },
  { id: "fb_brix_out_of_range", displayName: "FB – Brix out of range", description: "Product sugar concentration (brix) is outside acceptable range" },
  { id: "fb_chunks_or_particles_in_product", displayName: "FB – Chunks or particles in product", description: "Unwanted chunks, ice crystals, or particles appearing in dispensed product" },
  { id: "fb_compressor_runs_no_frost", displayName: "FB – Compressor runs, no frost", description: "Compressor is running but cylinder is not getting cold" },
  { id: "fb_display_alarm_or_error", displayName: "FB – Display alarm or error", description: "Machine display showing an alarm code or error message" },
  { id: "fb_draw_handle_stuck", displayName: "FB – Draw handle stuck", description: "Dispensing handle is jammed or difficult to operate" },
  { id: "fb_freeze_up_thermal_overload_trip", displayName: "FB – Freeze-up / thermal overload trip", description: "Machine has frozen up or tripped on thermal overload" },
  { id: "fb_inconsistent_texture_between_sides", displayName: "FB – Inconsistent texture between sides", description: "Product texture differs between left and right barrels" },
  { id: "fb_low_mix_light_with_full_hopper", displayName: "FB – Low-mix light with full hopper", description: "Low-mix indicator is on despite hopper being full" },
  { id: "fb_machine_not_cooling", displayName: "FB – Machine not cooling", description: "Frozen beverage machine is not reaching or maintaining target temperature" },
  { id: "fb_product_freeze_up_thick", displayName: "FB – Product freeze-up / too thick", description: "Product is freezing solid or dispensing too thick" },
  { id: "fb_product_leaking_from_door", displayName: "FB – Product leaking from door", description: "Product leaking around the dispensing door area" },
  { id: "fb_product_leaking_inside_machine", displayName: "FB – Product leaking inside machine", description: "Product leaking internally within the machine cabinet" },
  { id: "fb_product_not_freezing", displayName: "FB – Product not freezing", description: "Product remains liquid and is not freezing at all" },

  // Soft Serve (SS) playbook labels
  { id: "ss_beater_not_turning", displayName: "SS – Beater not turning", description: "Soft serve beater/auger motor is not spinning" },
  { id: "ss_excessive_internal_leak_drip_tray", displayName: "SS – Excessive internal leak / drip tray", description: "Excessive leaking into drip tray or internal cabinet" },
  { id: "ss_excessive_overrun_foamy", displayName: "SS – Excessive overrun / foamy", description: "Product has too much air, appears foamy or spits" },
  { id: "ss_first_pull_runny_after_idle", displayName: "SS – First pull runny after idle", description: "First serve after idle period is runny or soft" },
  { id: "ss_hopper_too_warm_or_too_cold", displayName: "SS – Hopper too warm or too cold", description: "Hopper temperature is outside the safe operating range" },
  { id: "ss_insufficient_overrun_flat", displayName: "SS – Insufficient overrun / flat", description: "Product has too little air, appears dense or flat" },
  { id: "ss_leak_from_door_or_spout", displayName: "SS – Leak from door or spout", description: "Product leaking from the dispensing door or spout area" },
  { id: "ss_machine_freeze_up_stop1_stop2", displayName: "SS – Machine freeze-up / STOP1–STOP2", description: "Machine has frozen up or entered STOP1/STOP2 alarm state" },
  { id: "ss_machine_not_cooling", displayName: "SS – Machine not cooling", description: "Soft serve machine is not reaching or maintaining target temperature" },
  { id: "ss_no_power_or_trips_breaker", displayName: "SS – No power or trips breaker", description: "Machine has no power or is tripping the circuit breaker" },
  { id: "ss_off_taste_contamination", displayName: "SS – Off taste / contamination", description: "Product has an unusual taste, odour, or contamination" },
  { id: "ss_product_too_icy", displayName: "SS – Product too icy", description: "Soft serve product has an icy or crystalline texture" },
  { id: "ss_product_too_soft_runny", displayName: "SS – Product too soft / runny", description: "Soft serve is dispensing too soft or runny" },
  { id: "ss_product_too_stiff_freeze_up_risk", displayName: "SS – Product too stiff / freeze-up risk", description: "Product is too stiff with risk of freeze-up" },
  { id: "ss_stop4_temperature_sensor_error", displayName: "SS – STOP4 temperature sensor error", description: "Machine reporting STOP4 alarm due to temperature sensor fault" },
];

/** Spaceman Soft Serve Ice Cream Machines — https://spaceman.com.au/products/soft-serve-ice-cream-machines/ */
const SPACEMAN_SOFT_SERVE_MODELS = [
  "6220",
  "6220E",
  "6250-C",
  "6250A-C",
  "6235-C",
  "6235A-C",
  "6210-C",
  "6210A-C",
  "6218",
  "6236-C",
  "6236A-C",
  "6228-C",
  "6228A-C",
  "6234-C",
  "6234A-C",
  "6378-C",
  "6378A-C",
  "6368-C",
  "6368A-C",
  "6210B-C",
  "6210AB-C",
  "6228B-C",
  "6228AB-C",
  "6234B-C",
  "6234AB-C",
  "6236B-C",
  "6236AB-C",
  "6235B-C",
  "6235AB-C",
  "6368B-C",
  "6368AB-C",
  "6338-C",
  "6338A-C",
  "6240",
  "6240A",
  "6268",
  "6225",
  "6225A",
  "6378B-C",
  "6378AB-C",
  "6338B-C",
  "6338AB-C",
];

/** Spaceman Frozen Beverage Machines — https://spaceman.com.au/products/frozen-beverage-machines/ */
const SPACEMAN_FROZEN_BEVERAGE_MODELS = [
  "6450-C",
  "6450-CL",
  "6690-C",
  "6690-CL",
  "6695-C",
  "6695-CL",
  "6455-C",
  "6795-C",
  "6795-CL",
];

export async function ensureVectorExtension(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
}

export async function ensureVectorIndexes(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
    ON doc_chunks USING hnsw (embedding vector_cosine_ops)
  `);
}

/** Ensures users and sessions tables exist (idempotent). Run before seedAdminUser if migrations may not have been applied. */
export async function ensureAuthTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "email" text NOT NULL,
      "password_hash" text NOT NULL,
      "role" text DEFAULT 'admin' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      "updated_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "users_email_unique" UNIQUE("email")
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sessions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
      "token" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "sessions_token_unique" UNIQUE("token")
    )
  `);
}

export async function seedAdminUser(): Promise<void> {
  await ensureAuthTables();
  const rawEmail = process.env.ADMIN_EMAIL?.trim();
  const rawPassword = process.env.ADMIN_PASSWORD?.trim();
  if (!rawEmail) {
    throw new Error("ADMIN_EMAIL must be set when seeding admin user");
  }
  if (!rawPassword) {
    throw new Error("ADMIN_PASSWORD must be set when seeding admin user");
  }

  const email = rawEmail.toLowerCase();
  const password = rawPassword;

  if (!password) {
    throw new Error("ADMIN_PASSWORD cannot be empty when seeding admin user");
  }

  const passwordHash = await hashPassword(password);
  await db
    .insert(users)
    .values({
      email,
      passwordHash,
      role: "admin",
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash,
        role: "admin",
        updatedAt: new Date(),
      },
    });
}

export async function seedSupportedModels(): Promise<void> {
  const rawModels = [...SPACEMAN_SOFT_SERVE_MODELS, ...SPACEMAN_FROZEN_BEVERAGE_MODELS];
  const canonicalModels = Array.from(
    new Set(
      rawModels
        .map((value) => toCanonicalModel(value))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (canonicalModels.length === 0) return;
  await db
    .insert(supportedModels)
    .values(canonicalModels.map((modelNumber) => ({ modelNumber })))
    .onConflictDoNothing({ target: supportedModels.modelNumber });
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
  const catalogActions = loadActionCatalogRows().map((a) => ({
    id: a.actionId,
    title: a.name,
    instructions: a.description,
    expectedInput: a.expectedInput,
    safetyLevel: a.safetyLevel,
  }));
  const actionsById = new Map<string, (typeof catalogActions)[number]>();
  [...catalogActions, ...DEFAULT_ACTIONS].forEach((a) => actionsById.set(a.id, a));
  for (const a of actionsById.values()) {
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
  {
    id: "hopper_too_warm",
    cause: "Hopper temperature too high (product not cold enough to set properly)",
    likelihood: "high" as const,
    rulingEvidence: ["hopper_temp"],
  },
  {
    id: "poor_airflow",
    cause: "Insufficient air circulation around machine",
    likelihood: "high" as const,
    rulingEvidence: ["clearance_ok"],
  },
  {
    id: "worn_scrapers",
    cause: "Worn or damaged scraper blades",
    likelihood: "medium" as const,
    rulingEvidence: ["scraper_condition"],
  },
  {
    id: "over_beaten",
    cause: "Product over-beaten from sitting too long",
    likelihood: "medium" as const,
    rulingEvidence: ["pulls_per_hour"],
  },
  {
    id: "blocked_air_tubes",
    cause: "Blocked air tubes or pump",
    likelihood: "medium" as const,
    rulingEvidence: ["last_clean"],
  },
  {
    id: "over_pulling",
    cause: "Over-pulling beyond machine capacity",
    likelihood: "medium" as const,
    rulingEvidence: ["pulls_per_hour"],
  },
  {
    id: "wrong_mix_ratio",
    cause: "Incorrect mix-to-water ratio",
    likelihood: "low" as const,
    rulingEvidence: ["mix_ratio"],
  },
];

const TOO_RUNNY_TRIGGERS = [
  { trigger: "electrical smell", reason: "Potential electrical hazard" },
  { trigger: "refrigerant leak", reason: "Refrigerant handling requires certified technician" },
  { trigger: "error code", reason: "Machine error codes require technician diagnosis" },
  { trigger: "sparking", reason: "Electrical hazard" },
];

const TOO_RUNNY_STEPS = [
  { step_id: "cool-hopper", title: "Cool hopper to operating range", instruction: "Allow the machine time to cool. Hopper should be in the -8°C to -4°C range for proper texture. Check that the machine has adequate clearance for airflow and that ambient temperature is not too high.", check: "Hopper display shows temperature within -8°C to -4°C." },
  { step_id: "clear-space", title: "Clear space", instruction: "Ensure minimum 6\" clearance on all sides of the machine for air flow.", check: "Verify clearance with a ruler." },
  { step_id: "check-scraper", title: "Check scraper", instruction: "Inspect scraper blades for wear; replace if they don't scrape the cylinder properly.", check: "Blades contact cylinder evenly; no visible wear." },
  { step_id: "flush-old", title: "Flush old product", instruction: "Pull product out several times so fresh mix from the hopper enters the cylinder.", check: "Dispensed product is from fresh batch." },
  { step_id: "clean-air", title: "Clean air system", instruction: "Clean air tube and air tube inlet holes thoroughly as per cleaning procedure.", check: "No blockages; air flows." },
  { step_id: "pace-pulls", title: "Pace pulls", instruction: "Time your pulls and leave a delay between each so the machine can freeze new product.", check: "Servings per hour within model limit." },
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
