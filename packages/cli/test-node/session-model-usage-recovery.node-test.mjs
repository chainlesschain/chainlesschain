import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionModelUsageRecoveryProjection,
  formatSessionModelUsageRecoveryNotice,
} from "../src/lib/session-model-usage-recovery.js";

const event = (type, callId, usage) => ({ type, data: { callId, usage } });
test("a new request settlement cannot erase an interrupted request", () => {
  const p = createSessionModelUsageRecoveryProjection();
  p.accept(event("model_usage_started", "old"));
  p.accept(event("model_usage_started", "new"));
  p.accept(event("token_usage", "new", { input_tokens: 10, output_tokens: 5 }));
  assert.deepEqual(p.finish().unsettledCallIds, ["old"]);
  assert.equal(p.finish().telemetryComplete, false);
  assert.deepEqual(p.finish().unknownEvidence.byCode, [
    { code: "model-usage-unsettled", count: 1 },
  ]);
});
test("malformed settlement leaves usage unknown; genuine zero-token settlement is known", () => {
  const p = createSessionModelUsageRecoveryProjection();
  p.accept(event("model_usage_started", "call"));
  p.accept(event("token_usage", "call", { input_tokens: 10 }));
  assert.equal(p.finish().telemetryComplete, false);
  p.accept(event("token_usage", "call", { input_tokens: 0, output_tokens: 0 }));
  assert.equal(p.finish().telemetryComplete, true);
});
test("explicit unknown cost and a reused historical call id remain conservative", () => {
  const p = createSessionModelUsageRecoveryProjection();
  p.accept(event("model_usage_started", "unknown"));
  p.accept(event("model_usage_unknown", "unknown"));
  p.accept(event("model_usage_started", "known"));
  p.accept(
    event("token_usage", "known", { input_tokens: 1, output_tokens: 2 }),
  );
  p.accept(event("model_usage_started", "known"));
  assert.deepEqual(p.finish().unknownCallIds, ["unknown"]);
  assert.deepEqual(p.finish().unsettledCallIds, ["known"]);
});
test("recovery notice is actionable, content-free and escapes terminal control characters", () => {
  const text = formatSessionModelUsageRecoveryNotice("session\nforged", {
    unsettledCallIds: ["call\u001b[2J"],
  });
  assert.equal(text.includes("\n"), false);
  assert.equal(text.includes("\u001b"), false);
  assert.match(text, /usage and cost remain unknown/);
  assert.match(text, /Original prompt may not have been saved/);
  assert.match(text, /reconcile provider usage/);
  assert.match(text, /not retried automatically/);
  assert.equal(
    formatSessionModelUsageRecoveryNotice("session", { unsettledCallIds: [] }),
    null,
  );
});

test("provider/model/source/operation identity mismatch never settles the original call", () => {
  for (const key of ["provider", "model", "source", "operationId"]) {
    const p = createSessionModelUsageRecoveryProjection();
    const data = {
      callId: "same",
      provider: "ollama",
      model: "model-a",
      source: "model",
      operationId: "operation-a",
    };
    p.accept({ type: "model_usage_started", data });
    p.accept({
      type: "token_usage",
      data: {
        ...data,
        [key]: key === "source" ? "semantic-compaction" : "different",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    assert.deepEqual(p.finish().unsettledCallIds, ["same"], key);
    p.accept({
      type: "token_usage",
      data: { ...data, usage: { input_tokens: 1, output_tokens: 1 } },
    });
    assert.equal(p.finish().retainedCallCount, 0);
  }
});
test("settled historical calls are not retained by streaming recovery", () => {
  const p = createSessionModelUsageRecoveryProjection();
  p.accept(event("model_usage_started", "interrupted"));
  for (let index = 0; index < 20000; index++) {
    p.accept(event("model_usage_started", "call-" + index));
    p.accept(
      event("token_usage", "call-" + index, {
        input_tokens: 1,
        output_tokens: 1,
      }),
    );
  }
  assert.equal(p.finish().retainedCallCount, 1);
  assert.deepEqual(p.finish().unsettledCallIds, ["interrupted"]);
  assert.equal(p.finish().billingComplete, false);
});

test("shared runtime token contract rejects fractional, alias, total and reasoning conflicts", () => {
  for (const usage of [
    { input_tokens: 1.5, output_tokens: 1 },
    { input_tokens: 1, prompt_tokens: 2, output_tokens: 1 },
    { input_tokens: 1, output_tokens: 1, total_tokens: 3 },
    { input_tokens: 1, output_tokens: 1, reasoning_tokens: 2 },
  ]) {
    const p = createSessionModelUsageRecoveryProjection();
    p.accept(event("model_usage_started", "call"));
    p.accept(event("token_usage", "call", usage));
    assert.deepEqual(p.finish().unsettledCallIds, ["call"]);
  }
});
