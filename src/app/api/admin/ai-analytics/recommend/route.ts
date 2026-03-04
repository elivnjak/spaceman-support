import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getLlmConfig } from "@/lib/config";
import { requireAdminUiAuth } from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

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
        playbookId: z.string(),
        title: z.string(),
        labelId: z.string(),
        labelName: z.string(),
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
            reason: z.string(),
            count: z.number(),
          })
        ),
      })
    ),
    coverageGaps: z.object({
      unmatchedSessions: z.number(),
      topUnmatchedMachineModels: z.array(
        z.object({
          label: z.string(),
          count: z.number(),
        })
      ),
      topUnmatchedProductTypes: z.array(
        z.object({
          label: z.string(),
          count: z.number(),
        })
      ),
    }),
    playbookMetadata: z.array(
      z.object({
        playbookId: z.string(),
        title: z.string(),
        labelId: z.string(),
        labelName: z.string(),
        stepCount: z.number(),
        symptomCount: z.number(),
        evidenceItemCount: z.number(),
        candidateCauseCount: z.number(),
        questionCount: z.number(),
        triggerCount: z.number(),
        updatedAt: z.string().nullable(),
      })
    ),
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

async function POSTHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  const parsedRequest = RequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Invalid analytics payload", details: parsedRequest.error.flatten() },
      { status: 400 }
    );
  }

  const llmConfig = await getLlmConfig();
  const input = parsedRequest.data.analytics;

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
      { status: 502 }
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
    });
  }

  const parsedResponse = ResponseSchema.safeParse(maybeJson);
  if (!parsedResponse.success) {
    return NextResponse.json({
      healthScore: null,
      summary: "Model returned an unexpected recommendation format.",
      recommendations: [],
      rawText: text,
      validationErrors: parsedResponse.error.flatten(),
    });
  }

  return NextResponse.json(parsedResponse.data);
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/ai-analytics/recommend",
  POSTHandler
);
