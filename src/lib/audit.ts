import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;
let lastCleanupAt = 0;

export type SessionStateSnapshot = {
  phase: string;
  turnCount: number;
  status: string;
  machineModel?: string | null;
  playbookId?: string | null;
  evidenceKeys?: string[];
  hypothesesCount?: number;
};

export type LlmCallEntry = {
  name: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
  imageCount?: number;
  rawResponse?: string;
  parsedResponse?: unknown;
  tokensUsed?: unknown;
  durationMs?: number;
};

export type RagRetrievalEntry = {
  query: string;
  chunksReturned: number;
  chunkIds: string[];
  documentIds?: string[];
  topSimilarity?: number;
};

export type SentimentSignalEntry = {
  frustrationLevel: string;
  escalationIntent: boolean;
  reasoning: string;
};

type AuditPayload = {
  sentimentSignal?: SentimentSignalEntry;
  userInput?: {
    message: string;
    imageCount: number;
    imageSizes: number[];
    imagePaths: string[];
  };
  sessionStateBefore?: SessionStateSnapshot;
  sessionStateAfter?: SessionStateSnapshot;
  phasePath?: string[];
  phaseTransition?: string | null;
  llmCalls?: LlmCallEntry[];
  ragRetrieval?: RagRetrievalEntry[];
  plannerOutput?: unknown;
  sanitizedOutput?: unknown;
  sanitizationErrors?: string[];
  apiResponse?: unknown;
  errors?: string[];
  durationMs?: number;
};

async function maybeCleanupOldAuditLogs(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.delete(auditLogs).where(lt(auditLogs.createdAt, cutoff));
}

export class AuditLogger {
  private readonly sessionId: string;
  private readonly turnNumber: number;
  private readonly startTime: number;
  private readonly payload: AuditPayload;

  constructor(sessionId: string, turnNumber: number) {
    this.sessionId = sessionId;
    this.turnNumber = turnNumber;
    this.startTime = Date.now();
    this.payload = {
      phasePath: [],
      llmCalls: [],
      ragRetrieval: [],
      errors: [],
      sanitizationErrors: [],
    };
  }

  logUserInput(input: {
    message: string;
    imageCount: number;
    imageSizes: number[];
    imagePaths: string[];
  }): void {
    this.payload.userInput = input;
  }

  logSessionState(label: "before" | "after", state: SessionStateSnapshot): void {
    if (label === "before") {
      this.payload.sessionStateBefore = state;
      return;
    }

    this.payload.sessionStateAfter = state;
    const before = this.payload.sessionStateBefore?.phase;
    const after = state.phase;
    if (before && after && before !== after) {
      this.payload.phaseTransition = `${before} -> ${after}`;
    } else {
      this.payload.phaseTransition = null;
    }
  }

  logPhasePath(path: string): void {
    if (!path) return;
    if (!this.payload.phasePath) this.payload.phasePath = [];
    this.payload.phasePath.push(path);
  }

  logLlmCall(entry: LlmCallEntry): void {
    if (!this.payload.llmCalls) this.payload.llmCalls = [];
    this.payload.llmCalls.push(entry);
  }

  logRagRetrieval(entry: RagRetrievalEntry): void {
    if (!this.payload.ragRetrieval) this.payload.ragRetrieval = [];
    this.payload.ragRetrieval.push(entry);
  }

  logSentimentSignal(signal: SentimentSignalEntry): void {
    this.payload.sentimentSignal = signal;
  }

  logPlannerOutput(raw: unknown, sanitized?: unknown, errors?: string[]): void {
    this.payload.plannerOutput = raw;
    if (sanitized !== undefined) this.payload.sanitizedOutput = sanitized;
    if (errors?.length) {
      if (!this.payload.sanitizationErrors) this.payload.sanitizationErrors = [];
      this.payload.sanitizationErrors.push(...errors);
    }
  }

  logApiResponse(response: unknown): void {
    this.payload.apiResponse = response;
  }

  logError(error: string): void {
    if (!error) return;
    if (!this.payload.errors) this.payload.errors = [];
    this.payload.errors.push(error);
  }

  async flush(): Promise<void> {
    this.payload.durationMs = Date.now() - this.startTime;
    await db.insert(auditLogs).values({
      sessionId: this.sessionId,
      turnNumber: this.turnNumber,
      payload: this.payload,
    });
    await maybeCleanupOldAuditLogs();
  }
}
