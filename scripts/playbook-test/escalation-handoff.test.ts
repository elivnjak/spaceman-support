import test from "node:test";
import assert from "node:assert/strict";
import { buildAttemptedSteps } from "@/lib/escalation-handoff";
import type {
  ChatMessage,
  PlannerOutput,
} from "@/lib/pipeline/diagnostic-planner";

test("buildAttemptedSteps falls back to completed troubleshooting requests when no resolution exists", () => {
  const messages: Array<
    ChatMessage & {
      requests?: PlannerOutput["requests"];
      resolution?: PlannerOutput["resolution"];
    }
  > = [
    {
      role: "assistant",
      content: "What type of product are you using?",
      timestamp: "2026-03-08T00:00:00.000Z",
      requests: [
        {
          id: "product_type",
          type: "question",
          prompt: "What type of product are you using?",
        },
      ],
    },
    {
      role: "user",
      content: "Ice Cream",
      timestamp: "2026-03-08T00:00:01.000Z",
    },
    {
      role: "assistant",
      content: "Please inspect the condenser for dust or grease build-up.",
      timestamp: "2026-03-08T00:00:02.000Z",
      requests: [
        {
          id: "inspect_condenser_for_dust",
          type: "question",
          prompt: "Please inspect the condenser for dust or grease build-up.",
        },
      ],
    },
    {
      role: "user",
      content: "No visible build-up",
      timestamp: "2026-03-08T00:00:03.000Z",
    },
    {
      role: "assistant",
      content: "Was the refill mix pre-chilled before being added to the machine?",
      timestamp: "2026-03-08T00:00:04.000Z",
      requests: [
        {
          id: "confirm_prechilled_mix",
          type: "question",
          prompt: "Was the refill mix pre-chilled before being added to the machine?",
        },
      ],
    },
    {
      role: "user",
      content: "Yes",
      timestamp: "2026-03-08T00:00:05.000Z",
    },
  ];

  assert.deepEqual(buildAttemptedSteps(messages), [
    {
      stepId: "inspect_condenser_for_dust",
      instruction: "Please inspect the condenser for dust or grease build-up.",
    },
    {
      stepId: "confirm_prechilled_mix",
      instruction: "Was the refill mix pre-chilled before being added to the machine?",
    },
  ]);
});
