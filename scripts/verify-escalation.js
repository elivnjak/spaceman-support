/**
 * Quick verification: first message "I want to speak to a human" should
 * return phase "escalated" and the escalation intent message.
 * Run with: node scripts/verify-escalation.js
 * Requires: dev server on http://localhost:3001
 */
const API = "http://localhost:3001/api/chat";

async function main() {
  const form = new FormData();
  form.set("message", "I want to speak to a human");
  // No sessionId = new session in collecting_issue

  const res = await fetch(API, {
    method: "POST",
    body: form,
    headers: process.env.COOKIE ? { Cookie: process.env.COOKIE } : {},
  });

  if (!res.ok) {
    console.error("Request failed:", res.status, res.statusText);
    const text = await res.text();
    if (text) console.error(text.slice(0, 500));
    process.exit(1);
  }

  const text = await res.text();
  // Response is SSE: "event: message\ndata: {...}\n\n" (data is single-line JSON)
  const messageMatch = text.match(/event:\s*message\s*\ndata:\s*(\{[^\n]+\})\s*\n\n/);
  if (!messageMatch) {
    console.error("No SSE 'message' event found in response. Sample:\n", text.slice(0, 400));
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(messageMatch[1]);
  } catch (e) {
    console.error("Failed to parse message data:", e.message);
    process.exit(1);
  }

  const phase = data.phase;
  const message = data.message || "";
  const reason = data.escalation_reason || "";

  const expectedPhase = "escalated";
  const expectedReason = "User asked to speak with a human";
  const ok = phase === expectedPhase && (reason === expectedReason || message.includes("connect you with a technician"));

  if (ok) {
    console.log("PASS: First-message 'I want to speak to a human' triggered immediate escalation.");
    console.log("  phase:", phase);
    console.log("  escalation_reason:", reason);
    console.log("  message:", message.slice(0, 80) + (message.length > 80 ? "..." : ""));
  } else {
    console.error("FAIL: Expected phase '%s' and escalation reason. Got phase '%s', reason '%s'", expectedPhase, phase, reason);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
