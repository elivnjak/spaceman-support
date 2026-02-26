/**
 * One-off script to inspect audit logs for a session.
 * Usage: npx tsx scripts/inspect-audit.ts <sessionId>
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, diagnosticSessions } from "@/lib/db/schema";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("Usage: npx tsx scripts/inspect-audit.ts <sessionId>");
    process.exit(1);
  }

  const [session] = await db
    .select()
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId))
    .limit(1);

  if (!session) {
    console.error("Session not found:", sessionId);
    process.exit(1);
  }

  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.sessionId, sessionId))
    .orderBy(asc(auditLogs.turnNumber), asc(auditLogs.createdAt));

  console.log("=== SESSION ===");
  console.log("id:", session.id);
  console.log("status:", session.status);
  console.log("phase:", session.phase);
  console.log("turnCount:", session.turnCount);
  console.log("frustrationTurnCount:", (session as { frustrationTurnCount?: number }).frustrationTurnCount ?? "n/a");
  console.log("");

  const messages = (session.messages as { role: string; content?: string }[]) ?? [];
  console.log("=== MESSAGES (last 10) ===");
  messages.slice(-10).forEach((m, i) => {
    const content = (m.content ?? "").slice(0, 120);
    console.log(`${messages.length - 10 + i + 1}. [${m.role}] ${content}${content.length >= 120 ? "..." : ""}`);
  });
  console.log("");

  console.log("=== AUDIT ENTRIES (per turn) ===");
  logs.forEach((entry) => {
    const p = entry.payload as Record<string, unknown>;
    console.log(`\n--- Turn ${entry.turnNumber} ---`);
    const userInput = p.userInput as { message?: string } | undefined;
    if (userInput?.message) console.log("User message:", (userInput.message as string).slice(0, 200));
    const sentiment = p.sentimentSignal as { frustrationLevel?: string; escalationIntent?: boolean; reasoning?: string } | undefined;
    if (sentiment) {
      console.log("Sentiment:", sentiment.frustrationLevel, "| escalationIntent:", sentiment.escalationIntent, "|", sentiment.reasoning?.slice(0, 80));
    } else {
      console.log("Sentiment: (not logged)");
    }
    console.log("Phase path:", p.phasePath);
    console.log("Phase transition:", p.phaseTransition);
    const after = p.sessionStateAfter as { phase?: string; status?: string } | undefined;
    if (after) console.log("After: phase=" + after.phase + ", status=" + after.status);
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
