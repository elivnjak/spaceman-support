import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getLlmConfig } from "@/lib/config";
import { requireAdminUiAuth } from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/rate-limit-server";

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

const RequestSchema = z.object({
  analytics: z.object({
    summary: z.object({
      totalSessions: z.number(),
      matchedSessions: z.number(),
      unmatchedSessions: z.number(),
      avgTriageRound: z.number(),
      multiRoundSessions: z.number(),
      multiRoundTriageRate: z.number(),
    }),
    playbookStats: z.array(
      z.object({
        playbookId: z.string().max(80),
        title: z.string().max(200),
        labelId: z.string().max(80),
        labelName: z.string().max(200),
        total: z.number(),
        resolved: z.number(),
        escalated: z.number(),
        active: z.number(),
        resolutionRate: z.number(),
        escalationRate: z.number(),
        frustrationRate: z.number(),
        avgTurns: z.number().nullable(),
        avgTurnsResolved: z.number().nullable(),
        avgTurnsEscalated: z.number().nullable(),
        verificationRequestedCount: z.number(),
        verificationRespondedCount: z.number(),
        verificationResponseRate: z.number().nullable(),
        notFixedCount: z.number(),
        partiallyFixedCount: z.number(),
        topEscalationReasons: z.array(
          z.object({
            reason: z.string().max(300),
            count: z.number(),
          })
        ).max(10),
      })
    ).max(200),
    coverageGaps: z.object({
      unmatchedSessions: z.number(),
      topUnmatchedMachineModels: z.array(
        z.object({
          label: z.string().max(200),
          count: z.number(),
        })
      ).max(25),
      topUnmatchedProductTypes: z.array(
        z.object({
          label: z.string().max(200),
          count: z.number(),
        })
      ).max(25),
    }),
    playbookMetadata: z.array(
      z.object({
        playbookId: z.string().max(80),
        title: z.string().max(200),
        labelId: z.string().max(80),
        labelName: z.string().max(200),
        stepCount: z.number(),
        symptomCount: z.number(),
        evidenceItemCount: z.number(),
        candidateCauseCount: z.number(),
        questionCount: z.number(),
        triggerCount: z.number(),
        updatedAt: z.string().nullable(),
      })
    ).max(300),
  }),
});

const RecommendationSchema = z.object({
  type: z.enum([
    "improve_playbook",
    "create_playbook",
    "add_trigger",
    "review_coverage",
    "process_change",
  ]),
  priority: z.enum(["high", "medium", "low"]),
  playbookId: z.string().nullable(),
  playbookTitle: z.string().nullable(),
  title: z.string().min(1),
  insight: z.string().min(1),
  action: z.string().min(1),
  impact: z.string().min(1),
});

const ResponseSchema = z.object({
  healthScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  recommendations: z.array(RecommendationSchema).max(12),
});

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

function sanitizeForPrompt(text: string, maxLen = 220): string {
  const normalized = text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function buildPromptAnalytics(input: z.infer<typeof RequestSchema>["analytics"]) {
  return {
    summary: input.summary,
    playbookStats: input.playbookStats.slice(0, 80).map((item) => ({
      playbookId: item.playbookId,
      title: sanitizeForPrompt(item.title, 120),
      labelName: sanitizeForPrompt(item.labelName, 100),
      total: item.total,
      resolved: item.resolved,
      escalated: item.escalated,
      active: item.active,
      resolutionRate: item.resolutionRate,
      escalationRate: item.escalationRate,
      frustrationRate: item.frustrationRate,
      avgTurns: item.avgTurns,
      verificationResponseRate: item.verificationResponseRate,
      notFixedCount: item.notFixedCount,
      partiallyFixedCount: item.partiallyFixedCount,
      topEscalationReasons: item.topEscalationReasons
        .slice(0, 5)
        .map((r) => ({ reason: sanitizeForPrompt(r.reason, 180), count: r.count })),
    })),
    coverageGaps: {
      unmatchedSessions: input.coverageGaps.unmatchedSessions,
      topUnmatchedMachineModels: input.coverageGaps.topUnmatchedMachineModels
        .slice(0, 10)
        .map((m) => ({ label: sanitizeForPrompt(m.label, 120), count: m.count })),
      topUnmatchedProductTypes: input.coverageGaps.topUnmatchedProductTypes
        .slice(0, 10)
        .map((p) => ({ label: sanitizeForPrompt(p.label, 120), count: p.count })),
    },
    playbookMetadata: input.playbookMetadata.slice(0, 120).map((meta) => ({
      playbookId: meta.playbookId,
      title: sanitizeForPrompt(meta.title, 120),
      labelName: sanitizeForPrompt(meta.labelName, 100),
      stepCount: meta.stepCount,
      symptomCount: meta.symptomCount,
      evidenceItemCount: meta.evidenceItemCount,
      candidateCauseCount: meta.candidateCauseCount,
      questionCount: meta.questionCount,
      triggerCount: meta.triggerCount,
    })),
  };
}

async function POSTHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const ip = getClientIp(request);
  const ipRateLimit = await checkRateLimit(
    `admin:ai-analytics:recommend:${ip}`,
    Math.max(10, Math.floor(RATE_LIMITS.adminPerIp.maxRequests / 6)),
    RATE_LIMITS.adminPerIp.windowMs
  );
  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many recommendation requests. Please wait before retrying." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipRateLimit.resetMs / 1000)),
          "X-RateLimit-Remaining": "0",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsedRequest = RequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Invalid analytics payload", details: parsedRequest.error.flatten() },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const llmConfig = await getLlmConfig();
  const input = buildPromptAnalytics(parsedRequest.data.analytics);

  const systemPrompt = `You are an AI support analytics strategist.
Your task: analyze playbook and session analytics and return concise, high-value recommendations.

Requirements:
- Return valid JSON only (no markdown, no prose before/after JSON).
- Use this exact schema:
{
  "healthScore": 0-100,
  "summary": "2-3 sentence executive summary",
  "recommendations": [{
    "type": "improve_playbook"|"create_playbook"|"add_trigger"|"review_coverage"|"process_change",
    "priority": "high"|"medium"|"low",
    "playbookId": "string|null",
    "playbookTitle": "string|null",
    "title": "string",
    "insight": "string",
    "action": "string",
    "impact": "string"
  }]
}

Guidelines:
- Prioritize by expected impact and urgency.
- Prefer specific actions over generic advice.
- Use only evidence from the provided analytics data.
- Avoid mentioning user-level details or PII.
- Include 4 to 8 recommendations.
- At least one recommendation should address playbook coverage gaps if unmatched sessions are material.
- Tie recommendations to playbook IDs/titles when possible.`;

  const userPrompt = `Analytics data:
${JSON.stringify(input, null, 2)}

Return JSON now.`;

  const res = await getOpenAI().chat.completions.create({
    model: llmConfig.diagnosticPlannerModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const text = res.choices[0]?.message?.content?.trim();
  if (!text) {
    return NextResponse.json(
      { error: "Empty recommendation response from model." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const maybeJson = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  })();

  if (!maybeJson) {
    return NextResponse.json({
      healthScore: null,
      summary: "Unable to parse structured recommendations from model output.",
      recommendations: [],
      rawText: text,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const parsedResponse = ResponseSchema.safeParse(maybeJson);
  if (!parsedResponse.success) {
    return NextResponse.json({
      healthScore: null,
      summary: "Model returned an unexpected recommendation format.",
      recommendations: [],
      rawText: text,
      validationErrors: parsedResponse.error.flatten(),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(parsedResponse.data, {
    headers: { "Cache-Control": "no-store" },
  });
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/ai-analytics/recommend",
  POSTHandler
);
