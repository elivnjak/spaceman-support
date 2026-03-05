import { NextResponse } from "next/server";
import {
  sendEscalationEmailFallback,
  type EscalationHandoff,
} from "@/lib/escalation";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function POSTHandler() {
  const now = new Date().toISOString();
  const sample: EscalationHandoff = {
    sessionId: `email-fallback-test-${Date.now()}`,
    userName: "Fallback Test User",
    userPhone: "+10000000000",
    machineModel: "TEST-MODEL",
    serialNumber: "TEST-SERIAL",
    productType: "Ice Cream",
    manufacturingYear: 2024,
    escalationReason: "Manual fallback email test from admin settings",
    playbookTitle: "Telegram fallback test",
    labelId: "fallback_test",
    turnCount: 1,
    ticketUrl: null,
    clearanceImagePaths: [],
    userImagePaths: [],
    evidenceCollected: {
      hopper_temp: { value: "unknown", type: "string", confidence: "uncertain" },
      clearance_ok: { value: true, type: "boolean", confidence: "exact" },
    },
    hypotheses: [],
    recentUserMessages: ["This is a test escalation payload."],
    recentQuestionAnswers: [
      {
        question: "Can you check whether the machine is showing any error code?",
        answer: "Yes, it shows E12 after about 2 minutes.",
      },
    ],
    stepsAttempted: [],
    escalatedAt: now,
  };

  const result = await sendEscalationEmailFallback(
    sample,
    "Manual admin test of fallback email delivery"
  );
  if (!result.sent) {
    return NextResponse.json(
      {
        ok: false,
        sent: false,
        error: result.error ?? "Fallback email failed to send.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    sent: true,
  });
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/telegram-config/test-email-fallback",
  POSTHandler
);
