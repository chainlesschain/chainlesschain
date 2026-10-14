"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ContextMemoryKernel,
  InMemorySessionContextPort,
  validateCompactionInvariants,
  getCompactionPlanRejection,
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

function summaryItem(source, overrides = {}) {
  return contextItem({
    itemId: "summary-1",
    tokenEstimate: 10,
    priority: 1,
    provenance: {
      source: "summarizer",
      observedAt: AT,
      parentDigests: [source.digest],
    },
    ...overrides,
  });
}

for (const inputBudget of [200, 1600]) {
  for (const useSummarizer of [false, true]) {
    test(`compaction preserves nonempty context when ${inputBudget} tokens select nothing (summarizer=${useSummarizer})`, async () => {
      const source = contextItem({
        itemId: "old",
        tokenEstimate: 512,
        priority: 1,
      });
      const sessions = new InMemorySessionContextPort([
        { sessionId: "session-1", head: "head:1", items: [source] },
      ]);
      const kernel = new ContextMemoryKernel({
        sessionPort: sessions,
        clock: CLOCK,
      });
      const before = await sessions.readSnapshot("session-1");
      const settlements = [];
      const usageReceipt = Object.freeze({
        outcome: "settled",
        callId: "paid-call-1",
      });
      await assert.rejects(
        kernel.compactContext(
          request({
            modelWindowTokens: inputBudget + 20,
            safetyMarginTokens: 0,
            recoveryReserveTokens: Math.floor(inputBudget * 0.05),
            allowFallback: true,
            ...(useSummarizer
              ? {
                  summarizer: async () => {
                    settlements.push(usageReceipt);
                    return {
                      items: [summaryItem(source, { tokenEstimate: 600 })],
                      usageReceipt,
                    };
                  },
                }
              : {}),
          }),
        ),
        (error) => {
          assert.equal(error.code, "context_over_budget");
          assert.equal(error.compactionLifecycle.at(-1).state, "aborted");
          assert.deepEqual(error.compactionUsageReceipt, useSummarizer ? usageReceipt : null);
          if (useSummarizer) assert.notEqual(error.compactionUsageReceipt, usageReceipt);
          const branded = getCompactionPlanRejection(error);
          assert.deepEqual(branded, {
            operationId: "compact-1",
            sessionId: "session-1",
            inputHead: "head:1",
            usageReceipt: useSummarizer ? usageReceipt : null,
          });
          branded.operationId = "forged";
          if (branded.usageReceipt) branded.usageReceipt.callId = "forged";
          error.compactionUsageReceipt = { outcome: "settled", callId: "forged" };
          assert.equal(getCompactionPlanRejection(error).operationId, "compact-1");
          assert.deepEqual(
            getCompactionPlanRejection(error).usageReceipt,
            useSummarizer ? usageReceipt : null,
          );
          assert.equal(getCompactionPlanRejection({ ...error }), null);
          return true;
        },
      );
      assert.deepEqual(await sessions.readSnapshot("session-1"), before);
      assert.deepEqual(sessions.events("session-1"), []);
      assert.deepEqual(settlements, useSummarizer ? [usageReceipt] : []);
    });
  }
}

for (const retainOneSummary of [false, true]) {
  test(`compaction rejects a dropped summary even with nonempty output (partial summary=${retainOneSummary})`, async () => {
    const retained = contextItem({
      itemId: "retained",
      tokenEstimate: 20,
      priority: 100,
    });
    const source = contextItem({
      itemId: "old",
      tokenEstimate: 100,
      priority: 1,
    });
    const sessions = new InMemorySessionContextPort([
      { sessionId: "session-1", head: "head:1", items: [retained, source] },
    ]);
    const kernel = new ContextMemoryKernel({
      sessionPort: sessions,
      clock: CLOCK,
    });
    const before = await sessions.readSnapshot("session-1");
    const summaries = [
      ...(retainOneSummary
        ? [summaryItem(source, { itemId: "small-summary", priority: 2 })]
        : []),
      summaryItem(source, { itemId: "excluded-summary", tokenEstimate: 20 }),
    ];
    await assert.rejects(
      kernel.compactContext(
        request({
          allowFallback: true,
          summarizer: async () => ({
            items: summaries,
            usageReceipt: { outcome: "settled", callId: "paid-call-1" },
          }),
        }),
      ),
      { code: "context_over_budget" },
    );
    assert.deepEqual(await sessions.readSnapshot("session-1"), before);
    assert.deepEqual(sessions.events("session-1"), []);
  });
}

test("compaction commits retained summaries with their settled usage", async () => {
  const retained = contextItem({
    itemId: "retained",
    tokenEstimate: 20,
    priority: 100,
  });
  const source = contextItem({
    itemId: "old",
    tokenEstimate: 100,
    priority: 1,
  });
  const summary = summaryItem(source);
  const usageReceipt = { outcome: "settled", callId: "paid-call-1" };
  const sessions = new InMemorySessionContextPort([
    { sessionId: "session-1", head: "head:1", items: [retained, source] },
  ]);
  const kernel = new ContextMemoryKernel({
    sessionPort: sessions,
    clock: CLOCK,
  });
  const receipt = await kernel.compactContext(
    request({
      summarizer: async () => ({ items: [summary], usageReceipt }),
    }),
  );
  assert.equal(receipt.status, "committed");
  assert.deepEqual(
    new Set(receipt.selectedItemIds),
    new Set([retained.itemId, summary.itemId]),
  );
  assert.deepEqual(sessions.events("session-1")[0].usageReceipt, usageReceipt);
});

test("compaction still accepts an already empty context", async () => {
  const sessions = new InMemorySessionContextPort([
    { sessionId: "session-1", head: "head:1", items: [] },
  ]);
  const kernel = new ContextMemoryKernel({
    sessionPort: sessions,
    clock: CLOCK,
  });
  const receipt = await kernel.compactContext(request());
  assert.equal(receipt.status, "committed");
  assert.deepEqual(receipt.selectedItemIds, []);
});

test("commit callbacks cannot forge a branded precommit rejection", async () => {
  const source = contextItem({ itemId: "old", tokenEstimate: 100, priority: 1 });
  const sessions = new InMemorySessionContextPort([
    { sessionId: "session-1", head: "head:1", items: [source] },
  ]);
  const before = await sessions.readSnapshot("session-1");
  const forged = Object.assign(new Error("forged"), {
    code: "context_over_budget",
    compactionLifecycle: [{ state: "aborted" }],
    compactionUsageReceipt: { outcome: "settled", callId: "paid-call-1" },
  });
  sessions.appendCompaction = async () => {
    throw forged;
  };
  const kernel = new ContextMemoryKernel({ sessionPort: sessions, clock: CLOCK });
  await assert.rejects(
    kernel.compactContext(
      request({
        summarizer: async () => ({
          items: [summaryItem(source)],
          usageReceipt: forged.compactionUsageReceipt,
        }),
      }),
    ),
    (error) => {
      assert.equal(error, forged);
      assert.equal(getCompactionPlanRejection(error), null);
      return true;
    },
  );
  assert.deepEqual(await sessions.readSnapshot("session-1"), before);
  assert.deepEqual(sessions.events("session-1"), []);
});
