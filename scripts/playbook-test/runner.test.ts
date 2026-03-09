import test from "node:test";
import assert from "node:assert/strict";
import { coerceAutoAnswerForRequest } from "./runner";

test("coerceAutoAnswerForRequest normalizes enum punctuation to the live option", () => {
  const normalized = coerceAutoAnswerForRequest("Yes.", {
    id: "confirm_idle_time",
    type: "question",
    expectedInput: {
      type: "boolean",
      options: ["Yes", "No"],
    },
  });

  assert.equal(normalized, "Yes");
});

test("coerceAutoAnswerForRequest rejects enum answers outside the allowed options", () => {
  assert.throws(
    () =>
      coerceAutoAnswerForRequest("Yes", {
        id: "ev_scraper_blades_age",
        type: "question",
        expectedInput: {
          type: "enum",
          options: ["Less than 3 months", "3-6 months", "More than 6 months", "Unknown"],
        },
      }),
    /does not match allowed options/
  );
});

test("coerceAutoAnswerForRequest extracts numeric values for number requests", () => {
  const normalized = coerceAutoAnswerForRequest("About 18 months old", {
    id: "ev_parts_age",
    type: "question",
    expectedInput: {
      type: "number",
      unit: "months",
    },
  });

  assert.equal(normalized, "18");
});

test("coerceAutoAnswerForRequest maps numeric month answers onto enum age buckets", () => {
  const normalized = coerceAutoAnswerForRequest("4", {
    id: "ev_parts_age",
    type: "question",
    expectedInput: {
      type: "enum",
      options: ["Less than 6 months", "6 to 12 months", "Over 12 months", "Unknown"],
    },
  });

  assert.equal(normalized, "Less than 6 months");
});

test("coerceAutoAnswerForRequest maps numeric month answers onto enum age buckets with ago suffix", () => {
  const normalized = coerceAutoAnswerForRequest("4", {
    id: "ev_parts_age",
    type: "question",
    expectedInput: {
      type: "enum",
      options: [
        "Less than 6 months ago",
        "6-12 months ago",
        "More than 12 months ago",
        "Unknown",
      ],
    },
  });

  assert.equal(normalized, "Less than 6 months ago");
});
