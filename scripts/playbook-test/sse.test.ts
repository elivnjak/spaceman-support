import test from "node:test";
import assert from "node:assert/strict";
import { getLastEventData, parseSsePayload } from "./sse";

test("parseSsePayload extracts message and error events", () => {
  const payload = [
    "event: stage",
    'data: {"message":"Thinking"}',
    "",
    "event: message",
    'data: {"sessionId":"abc","phase":"triaging","message":"Next question"}',
    "",
    "event: error",
    'data: {"error":"boom"}',
    "",
  ].join("\n");

  const events = parseSsePayload(payload);
  assert.equal(events.length, 3);
  assert.deepEqual(getLastEventData(events, "message"), {
    sessionId: "abc",
    phase: "triaging",
    message: "Next question",
  });
  assert.deepEqual(getLastEventData(events, "error"), { error: "boom" });
});
