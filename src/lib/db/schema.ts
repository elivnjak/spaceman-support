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

export const referenceImages = pgTable("reference_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  labelId: text("label_id")
    .notNull()
    .references(() => labels.id),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash"),
  notes: text("notes"),
  embedding: vector("embedding", 512),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  filePath: text("file_path").notNull(),
  status: text("status").notNull().default("UPLOADED"),
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
  diagnosticQuestions: jsonb("diagnostic_questions"),
  escalationTriggers: jsonb("escalation_triggers"),
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
  machineModel: text("machine_model"),
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
  /** Structured handoff data sent to external ticketing system on escalation */
  escalationHandoff: jsonb("escalation_handoff"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
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
export type ReferenceImage = typeof referenceImages.$inferSelect;
export type NewReferenceImage = typeof referenceImages.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocChunk = typeof docChunks.$inferSelect;
export type NewDocChunk = typeof docChunks.$inferInsert;
export type Action = typeof actions.$inferSelect;
export type NewAction = typeof actions.$inferInsert;
export type Playbook = typeof playbooks.$inferSelect;
export type NewPlaybook = typeof playbooks.$inferInsert;
export type SupportSession = typeof supportSessions.$inferSelect;
export type NewSupportSession = typeof supportSessions.$inferInsert;
export type DiagnosticSession = typeof diagnosticSessions.$inferSelect;
export type NewDiagnosticSession = typeof diagnosticSessions.$inferInsert;
export type MachineSpec = typeof machineSpecs.$inferSelect;
export type NewMachineSpec = typeof machineSpecs.$inferInsert;
