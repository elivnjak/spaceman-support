import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  customType,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";

// pgvector type: stored as string in DB, we pass number[] from JS
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[] | null; driverData: string | null }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[] | null) {
      if (value === null || value === undefined) return null as string | null;
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string | null) {
      if (value === null || value === undefined) return null as number[] | null;
      const trimmed = String(value).replace(/^\[|\]$/g, "");
      return trimmed ? trimmed.split(",").map(Number) : [];
    },
  })(name);

export const labels = pgTable("labels", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const supportedModels = pgTable("supported_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelNumber: text("model_number").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const productTypes = pgTable("product_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isOther: boolean("is_other").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const referenceImages = pgTable("reference_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  labelId: text("label_id")
    .notNull()
    .references(() => labels.id),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  filePath: text("file_path").notNull(),
  status: text("status").notNull().default("UPLOADED"),
  ingestionProgress: integer("ingestion_progress").notNull().default(0),
  ingestionStage: text("ingestion_stage"),
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  ingestionStartedAt: timestamp("ingestion_started_at", { withTimezone: true }),
  ingestionCompletedAt: timestamp("ingestion_completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  rawTextPreview: text("raw_text_preview"),
  pastedContent: text("pasted_content"),
  machineModel: text("machine_model"),
  sourceUrl: text("source_url"),
  cssSelector: text("css_selector"),
  renderJs: boolean("render_js").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const docChunks = pgTable("doc_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  embedding: vector("embedding", 1536),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const actions = pgTable("actions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  expectedInput: jsonb("expected_input"),
  safetyLevel: text("safety_level").notNull().default("safe"),
  appliesToModels: jsonb("applies_to_models"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const playbooks = pgTable("playbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  labelId: text("label_id")
    .notNull()
    .references(() => labels.id),
  title: text("title").notNull(),
  steps: jsonb("steps").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  symptoms: jsonb("symptoms"),
  evidenceChecklist: jsonb("evidence_checklist"),
  candidateCauses: jsonb("candidate_causes"),
  escalationTriggers: jsonb("escalation_triggers"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const playbookProductTypes = pgTable(
  "playbook_product_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    productTypeId: uuid("product_type_id")
      .notNull()
      .references(() => productTypes.id, { onDelete: "cascade" }),
  },
  (self) => [unique("playbook_product_types_unique").on(self.playbookId, self.productTypeId)]
);

export const nameplateConfig = pgTable("nameplate_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  instructionText: text("instruction_text").notNull(),
  guideImageIds: jsonb("guide_image_ids").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const nameplateGuideImages = pgTable("nameplate_guide_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const clearanceConfig = pgTable("clearance_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  instructionText: text("instruction_text").notNull(),
  guideImageIds: jsonb("guide_image_ids").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const clearanceGuideImages = pgTable("clearance_guide_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const maintenanceConfig = pgTable("maintenance_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  enabled: boolean("enabled").notNull().default(false),
  iconPath: text("icon_path"),
  title: text("title").notNull().default("Chat Unavailable"),
  description: text("description")
    .notNull()
    .default("Our support chat is currently undergoing maintenance."),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const diagnosisModeConfig = pgTable("diagnosis_mode_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const telegramConfig = pgTable("telegram_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  enabled: boolean("enabled").notNull().default(false),
  botToken: text("bot_token").notNull().default(""),
  chatId: text("chat_id").notNull().default(""),
  chatIds: jsonb("chat_ids").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const intentManifest = pgTable("intent_manifest", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull().default({}),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const supportSessions = pgTable(
  "support_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userText: text("user_text"),
    imagePaths: jsonb("image_paths"),
    predictedLabelId: text("predicted_label_id").references(() => labels.id),
    confidence: real("confidence"),
    result: jsonb("result"),
    parentSessionId: uuid("parent_session_id"),
    machineModel: text("machine_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (self) => [
    foreignKey({
      columns: [self.parentSessionId],
      foreignColumns: [self.id],
    }),
  ]
);

export const diagnosticSessions = pgTable("diagnostic_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("active"),
  ticketStatus: text("ticket_status").notNull().default("open"),
  userName: text("user_name"),
  userPhone: text("user_phone"),
  machineModel: text("machine_model"),
  serialNumber: text("serial_number"),
  productType: text("product_type"),
  clearanceImagePaths: jsonb("clearance_image_paths").notNull().default([]),
  manufacturingYear: integer("manufacturing_year"),
  playbookId: uuid("playbook_id").references(() => playbooks.id),
  triageHistory: jsonb("triage_history").notNull().default([]),
  triageRound: integer("triage_round").notNull().default(0),
  messages: jsonb("messages").notNull().default([]),
  evidence: jsonb("evidence").notNull().default({}),
  hypotheses: jsonb("hypotheses").notNull().default([]),
  phase: text("phase").notNull().default("gathering_info"),
  turnCount: integer("turn_count").notNull().default(0),
  resolvedCauseId: text("resolved_cause_id"),
  escalationReason: text("escalation_reason"),
  /** "confirmed" | "not_fixed" | "partially_fixed" | null (awaiting feedback) */
  resolutionOutcome: text("resolution_outcome"),
  /** Timestamp when a structured resolution verification prompt was sent */
  verificationRequestedAt: timestamp("verification_requested_at", { withTimezone: true }),
  /** Timestamp when the user replied to the resolution verification prompt */
  verificationRespondedAt: timestamp("verification_responded_at", { withTimezone: true }),
  /** Structured handoff data sent to external ticketing system on escalation */
  escalationHandoff: jsonb("escalation_handoff"),
  /** Consecutive turns with mild+ frustration; reset when none; used for cumulative escalation */
  frustrationTurnCount: integer("frustration_turn_count").notNull().default(0),
  /** Turns we have already sent "try up to N alternate paths" context; when >= N we force escalate */
  escalationContextTurnCount: integer("escalation_context_turn_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => diagnosticSessions.id, { onDelete: "cascade" }),
  turnNumber: integer("turn_number").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const ticketNotes = pgTable("ticket_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => diagnosticSessions.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const machineSpecs = pgTable("machine_specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  machineModel: text("machine_model").notNull().unique(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  specs: jsonb("specs").notNull(),
  rawSource: text("raw_source"),
  verified: boolean("verified").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
export type SupportedModel = typeof supportedModels.$inferSelect;
export type NewSupportedModel = typeof supportedModels.$inferInsert;
export type ProductType = typeof productTypes.$inferSelect;
export type NewProductType = typeof productTypes.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type ReferenceImage = typeof referenceImages.$inferSelect;
export type NewReferenceImage = typeof referenceImages.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocChunk = typeof docChunks.$inferSelect;
export type NewDocChunk = typeof docChunks.$inferInsert;
export type Action = typeof actions.$inferSelect;
export type NewAction = typeof actions.$inferInsert;
export type NameplateConfig = typeof nameplateConfig.$inferSelect;
export type NewNameplateConfig = typeof nameplateConfig.$inferInsert;
export type NameplateGuideImage = typeof nameplateGuideImages.$inferSelect;
export type NewNameplateGuideImage = typeof nameplateGuideImages.$inferInsert;
export type ClearanceConfig = typeof clearanceConfig.$inferSelect;
export type NewClearanceConfig = typeof clearanceConfig.$inferInsert;
export type ClearanceGuideImage = typeof clearanceGuideImages.$inferSelect;
export type NewClearanceGuideImage = typeof clearanceGuideImages.$inferInsert;
export type MaintenanceConfig = typeof maintenanceConfig.$inferSelect;
export type NewMaintenanceConfig = typeof maintenanceConfig.$inferInsert;
export type DiagnosisModeConfig = typeof diagnosisModeConfig.$inferSelect;
export type NewDiagnosisModeConfig = typeof diagnosisModeConfig.$inferInsert;
export type TelegramConfig = typeof telegramConfig.$inferSelect;
export type NewTelegramConfig = typeof telegramConfig.$inferInsert;
export type IntentManifestRow = typeof intentManifest.$inferSelect;
export type NewIntentManifestRow = typeof intentManifest.$inferInsert;
export type Playbook = typeof playbooks.$inferSelect;
export type NewPlaybook = typeof playbooks.$inferInsert;
export type PlaybookProductType = typeof playbookProductTypes.$inferSelect;
export type NewPlaybookProductType = typeof playbookProductTypes.$inferInsert;
export type SupportSession = typeof supportSessions.$inferSelect;
export type NewSupportSession = typeof supportSessions.$inferInsert;
export type DiagnosticSession = typeof diagnosticSessions.$inferSelect;
export type NewDiagnosticSession = typeof diagnosticSessions.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type TicketNote = typeof ticketNotes.$inferSelect;
export type NewTicketNote = typeof ticketNotes.$inferInsert;
export type MachineSpec = typeof machineSpecs.$inferSelect;
export type NewMachineSpec = typeof machineSpecs.$inferInsert;
