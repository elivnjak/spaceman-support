import type { ChatMessage, PlannerOutput } from "./pipeline/diagnostic-planner";

type MessageWithRequests = ChatMessage & {
  requests?: Array<{
    id?: string;
    prompt?: string;
  }>;
};

const NON_DIAGNOSTIC_REQUEST_IDS = new Set([
  "nameplate_photo",
  "nameplate_manual_known",
  "nameplate_manual_model",
  "nameplate_manual_serial",
  "product_type",
  "product_type_other_detail",
  "clearance_photos",
  "_verification",
  "_escalation_offer",
]);

export function buildAttemptedSteps(
  messages: ChatMessage[],
  resolution?: PlannerOutput["resolution"]
): { stepId: string; instruction: string }[] {
  const resolutionSteps = (resolution?.steps ?? [])
    .map((step) => ({
      stepId: step.step_id,
      instruction: step.instruction,
    }))
    .filter((step) => step.stepId && step.instruction);
  if (resolutionSteps.length > 0) {
    return resolutionSteps;
  }

  const attempted: { stepId: string; instruction: string }[] = [];
  const seenStepIds = new Set<string>();
  const typedMessages = messages as MessageWithRequests[];

  for (let index = 0; index < typedMessages.length; index += 1) {
    const current = typedMessages[index];
    if (current.role !== "assistant" || !Array.isArray(current.requests) || current.requests.length === 0) {
      continue;
    }

    let hasUserReply = false;
    for (let nextIndex = index + 1; nextIndex < typedMessages.length; nextIndex += 1) {
      const next = typedMessages[nextIndex];
      if (next.role === "assistant") break;
      if (next.role === "user" && next.content?.trim()) {
        hasUserReply = true;
        break;
      }
    }
    if (!hasUserReply) continue;

    for (const request of current.requests) {
      const stepId = request.id?.trim();
      const instruction = request.prompt?.trim();
      if (!stepId || !instruction) continue;
      if (NON_DIAGNOSTIC_REQUEST_IDS.has(stepId)) continue;
      if (seenStepIds.has(stepId)) continue;
      seenStepIds.add(stepId);
      attempted.push({ stepId, instruction });
    }
  }

  return attempted.slice(-5);
}
