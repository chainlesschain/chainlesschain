"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ContextMemoryKernel,
  InMemorySessionContextPort,
  validateCompactionInvariants,
} = require("../lib/index.js");
const { AT, CLOCK, contextItem } = require("./helpers.js");

function request(overrides = {}) {
  return {
    operationId: "compact-1",
    sessionId: "session-1",
    modelWindowTokens: 160,
    reservedOutputTokens: 20,
    safetyMarginTokens: 10,
    recoveryReserveTokens: 10,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: "session-1" }],
    policyVersion: "policy-1",
    modelProfile: "model-1",
    now: AT,
    ...overrides,
  };
}

test("compaction commits with CAS and is idempotent by operation ID", async () => {
  const protectedItem = contextItem({
    itemId: "goal",
    tokenEstimate: 20,
    binding: { requiredForRecovery: true },
  });
  const old = contextItem({ itemId: "old", tokenEstimate: 100, priority: 1 });
  const sessions = new InMemorySessionContextPort([
    { sessionId: "session-1", head: "head:1", items: [old, protectedItem] },
  ]);
  let uuid = 0;
  const kernel = new ContextMemoryKernel({
    sessionPort: sessions,
    clock: CLOCK,
    randomUUID: () => `id-${++uuid}`,
  });
  const first = await kernel.compactContext(request());
  assert.equal(first.status, "committed");
  assert.match(first.contextPlanDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.memoryRevision, 0);
  assert.ok(first.selectedItemIds.includes("goal"));
  assert.equal(sessions.events("session-1").length, 1);
  const replay = await kernel.compactContext(request());
  assert.deepEqual(replay, first);
  assert.equal(sessions.events("session-1").length, 1);
});

test("summary derivation cannot raise trust, lower sensitivity, expand sinks, or invent control", async () => {
  const source = contextItem({
    itemId: "external",
    trust: "untrusted",
    sensitivity: "personal",
    allowedSinks: ["provider.local"],
    tokenEstimate: 100,
    priority: 1,
  });
  const sessions = new InMemorySessionContextPort([
    { sessionId: "session-1", head: "head:1", items: [source] },
  ]);
  const kernel = new ContextMemoryKernel({ sessionPort: sessions, clock: CLOCK });
  const summary = contextItem({
    itemId: "summary-1",
    trust: "host",
    sensitivity: "public",
    provenance: {
      source: "summarizer",
      observedAt: AT,
      parentDigests: [source.digest],
    },
    tokenEstimate: 10,
  });
  await assert.rejects(
    kernel.compactContext(
      request({
        summarizer: async () => ({
          items: [summary],
          usageReceipt: { outcome: "settled", callId: "call-1" },
        }),
      }),
    ),
    { code: "derivation_policy_violation" },
  );
});

test("provider usage unknown is durably recorded for reconciliation", async () => {
  const source = contextItem({ itemId: "old", tokenEstimate: 100, priority: 1 });
  const sessions = new InMemorySessionContextPort([
    { sessionId: "session-1", head: "head:1", items: [source] },
  ]);
  const kernel = new ContextMemoryKernel({ sessionPort: sessions, clock: CLOCK });
  const receipt = await kernel.compactContext(
    request({
      summarizer: async () => ({ items: [], usageReceipt: { outcome: "unknown" } }),
    }),
  );
  assert.equal(receipt.status, "reconciliation_required");
  assert.deepEqual(await kernel.reconcile("compact-1"), receipt);
});

test("compaction invariant rejects split tool pairs", () => {
  const call = contextItem({
    itemId: "call",
    kind: "tool-evidence",
    trust: "external",
    binding: { toolCallId: "tool-1", toolRole: "call", toolOutcome: "succeeded" },
  });
  const result = contextItem({
    itemId: "result",
    kind: "tool-evidence",
    trust: "external",
    binding: { toolCallId: "tool-1", toolRole: "result", toolOutcome: "succeeded" },
  });
  const check = validateCompactionInvariants([call, result], [call]);
  assert.equal(check.ok, false);
  assert.equal(check.violations[0].code, "tool_pair_split");
});
