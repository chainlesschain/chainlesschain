"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalDigest,
  canonicalJson,
  normalizeContextItem,
  normalizeMemoryRecord,
  planContext,
} = require("../lib/index.js");
const { contextItem, planRequest, proposal } = require("./helpers.js");
const { createMemoryCandidate } = require("../lib/memory-reducer.js");

test("canonical JSON and digests ignore object insertion order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(canonicalDigest({ b: 2, a: 1 }), canonicalDigest({ a: 1, b: 2 }));
});

test("ContextItem validates exact content representation, booleans, and digests", () => {
  const item = contextItem();
  assert.equal(normalizeContextItem(item).digest, item.digest);
  assert.throws(() => normalizeContextItem({ ...item, pinned: 1 }), /pinned must be a boolean/u);
  assert.throws(
    () => normalizeContextItem({ ...item, contentRef: { store: "x" } }),
    /exactly one/u,
  );
  assert.throws(() => normalizeContextItem({ ...item, digest: `sha256:${"0".repeat(64)}` }), {
    code: "digest_mismatch",
  });
  assert.throws(
    () =>
      normalizeContextItem({
        ...item,
        binding: { toolOutcome: "succeeded" },
        digest: undefined,
      }),
    /requires toolCallId/u,
  );
});

test("MemoryRecord rejects credential-like plaintext", () => {
  assert.throws(
    () => createMemoryCandidate(proposal({ content: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" })),
    /secret material/u,
  );
  const record = createMemoryCandidate(proposal());
  assert.equal(normalizeMemoryRecord(record).digest, record.digest);
});

test("planning is deterministic across input order and protects recovery state", () => {
  const items = [
    contextItem({ itemId: "recent", priority: 200, sourceRef: { store: "fixture", id: "recent", eventSequence: 3 } }),
    contextItem({
      itemId: "pending",
      priority: 10,
      binding: { questionId: "question-1", requiredForRecovery: true },
      sourceRef: { store: "fixture", id: "pending", eventSequence: 2 },
    }),
    contextItem({ itemId: "old", priority: 20, sourceRef: { store: "fixture", id: "old", eventSequence: 1 } }),
  ];
  const left = planContext(planRequest(items));
  const right = planContext(planRequest([...items].reverse()));
  assert.equal(left.digest, right.digest);
  assert.deepEqual(left.selectedItemIds, right.selectedItemIds);
  assert.ok(left.selectedItemIds.includes("pending"));
});

test("tool call and result are atomic and settled orphans fail closed", () => {
  const call = contextItem({
    itemId: "tool-call",
    kind: "tool-evidence",
    trust: "external",
    binding: { toolCallId: "call-1", toolRole: "call", toolOutcome: "succeeded" },
  });
  const result = contextItem({
    itemId: "tool-result",
    kind: "tool-evidence",
    trust: "external",
    binding: { toolCallId: "call-1", toolRole: "result", toolOutcome: "succeeded" },
  });
  const plan = planContext(
    planRequest([call, result], {
      modelWindowTokens: 80,
      reservedOutputTokens: 10,
      safetyMarginTokens: 10,
      recoveryReserveTokens: 10,
    }),
  );
  assert.ok(
    plan.selectedItemIds.length === 0 ||
      plan.selectedItemIds.includes("tool-call") === plan.selectedItemIds.includes("tool-result"),
  );
  assert.throws(() => planContext(planRequest([result])), /both call and result/u);
});

test("protected content fails explicitly when the budget cannot fit", () => {
  const protectedItem = contextItem({
    itemId: "goal",
    tokenEstimate: 100,
    binding: { requiredForRecovery: true },
  });
  assert.throws(
    () =>
      planContext(
        planRequest([protectedItem], {
          modelWindowTokens: 100,
          reservedOutputTokens: 20,
          safetyMarginTokens: 10,
          recoveryReserveTokens: 10,
        }),
      ),
    { code: "context_over_budget" },
  );
});
