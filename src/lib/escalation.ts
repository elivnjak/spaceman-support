import type { ChatMessage, EvidenceRecord, HypothesisState, PlannerOutput } from "./pipeline/diagnostic-planner";

export type EscalationHandoff = {
  sessionId: string;
  machineModel: string | null;
  escalationReason: string;
  playbookTitle: string;
  labelId: string;
  turnCount: number;
  /** Summary of evidence collected during the session */
  evidenceCollected: Record<string, {
    value: unknown;
    type: string;
    confidence: string;
  }>;
  /** Current hypothesis state at time of escalation */
  hypotheses: {
    causeId: string;
    confidence: number;
    status: string;
    reasoning: string;
  }[];
  /** Last N user messages for context */
  recentUserMessages: string[];
  /** Steps already attempted (from prior resolution, if any) */
  stepsAttempted: { stepId: string; instruction: string }[];
  /** Timestamp of escalation */
  escalatedAt: string;
};

export function buildEscalationHandoff(opts: {
  sessionId: string;
  machineModel: string | null;
  escalationReason: string;
  playbookTitle: string;
  labelId: string;
  turnCount: number;
  evidence: Record<string, EvidenceRecord>;
  hypotheses: HypothesisState[];
  messages: ChatMessage[];
  resolution?: PlannerOutput["resolution"];
}): EscalationHandoff {
  const recentUserMessages = opts.messages
    .filter((m) => m.role === "user")
    .slice(-5)
    .map((m) => m.content);

  const evidenceCollected: EscalationHandoff["evidenceCollected"] = {};
  for (const [key, rec] of Object.entries(opts.evidence)) {
    evidenceCollected[key] = {
      value: rec.value,
      type: rec.type,
      confidence: rec.confidence,
    };
  }

  const stepsAttempted = (opts.resolution?.steps ?? []).map((s) => ({
    stepId: s.step_id,
    instruction: s.instruction,
  }));

  return {
    sessionId: opts.sessionId,
    machineModel: opts.machineModel,
    escalationReason: opts.escalationReason,
    playbookTitle: opts.playbookTitle,
    labelId: opts.labelId,
    turnCount: opts.turnCount,
    evidenceCollected,
    hypotheses: opts.hypotheses.map((h) => ({
      causeId: h.causeId,
      confidence: h.confidence,
      status: h.status,
      reasoning: h.reasoning,
    })),
    recentUserMessages,
    stepsAttempted,
    escalatedAt: new Date().toISOString(),
  };
}

/**
 * Send escalation handoff to external webhook if configured.
 * Non-blocking: logs errors but never throws to prevent disrupting the user flow.
 */
export async function sendEscalationWebhook(handoff: EscalationHandoff): Promise<boolean> {
  const webhookUrl = process.env.ESCALATION_WEBHOOK_URL;
  if (!webhookUrl) {
    if (process.env.NODE_ENV !== "test") {
      console.log("[escalation] No ESCALATION_WEBHOOK_URL configured; skipping webhook");
    }
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(handoff),
    });
    if (!res.ok) {
      console.error(`[escalation] Webhook returned ${res.status}: ${await res.text()}`);
      return false;
    }
    if (process.env.NODE_ENV !== "test") {
      console.log(`[escalation] Webhook sent for session ${handoff.sessionId}`);
    }
    return true;
  } catch (err) {
    console.error("[escalation] Webhook failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
