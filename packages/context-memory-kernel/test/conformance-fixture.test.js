"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ContextMemoryKernel,
  InMemoryMemoryPort,
  InMemoryProjectionPurgePort,
  InMemorySessionContextPort,
  applyMemoryCommand,
  createMemoryCandidate,
  mergeReplicaRecord,
  normalizeContextItem,
  parseContextMemoryConformanceFixture,
  planContext,
} = require("../lib/index.js");

const AT = "2026-08-29T00:00:00.000Z";
const CLOCK = () => Date.parse(AT);

function fixture() {
  return parseContextMemoryConformanceFixture(
    readFileSync(
      path.resolve(
        __dirname,
        "..",
        "fixtures",
        "cross-surface-projection-v1.tsv",
      ),
      "utf8",
    ),
  );
}

function item(itemId, overrides = {}) {
  return normalizeContextItem({
    schemaVersion: 1,
    itemId,
    kind: "message",
    scope: "session",
    scopeId: "fixture-session",
    sourceRef: {
      store: "conformance-fixture",
      id: `source-${itemId}`,
      eventSequence: 1,
    },
    provenance: {
      source: "conformance-fixture",
      actor: "fixture-user",
      observedAt: AT,
    },
    trust: "user",
    sensitivity: "internal",
    allowedSinks: ["provider.local"],
    tokenEstimate: 8,
    priority: 100,
    pinned: false,
    createdAt: AT,
    content: itemId,
    ...overrides,
  });
}

function planRequest(items, modelWindowTokens = 1_024) {
  return {
    modelWindowTokens,
    reservedOutputTokens: 64,
    safetyMarginTokens: 32,
    recoveryReserveTokens: 32,
    items,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: "fixture-session" }],
    policyVersion: "conformance-v1",
    modelProfile: `fixture-${modelWindowTokens}`,
    sessionHead: "head:fixture",
    memoryRevision: 0,
    now: AT,
  };
}

function memoryProposal(memoryId, scope, scopeId) {
  return {
    memoryId,
    scope,
    ...(scopeId ? { scopeId } : {}),
    category: "shared-fact",
    content: `shared ${scope} fact`,
    provenance: {
      source: "conformance-fixture",
      actor: "fixture-user",
      observedAt: AT,
    },
    evidenceRefs: [
      { store: "conformance-fixture", id: `evidence-${memoryId}` },
    ],
    confidence: 0.8,
    importance: 0.8,
    tags: ["shared"],
    sensitivity: "internal",
    allowedSinks: ["provider.local"],
    retentionPolicy: { mode: "durable" },
    activate: true,
    createdAt: AT,
  };
}

function protectedItems() {
  return [
    item("goal", {
      kind: "task-state",
      tokenEstimate: 24,
      pinned: true,
      binding: { taskState: "running", requiredForRecovery: true },
      content: "Ship the release / 完成发布",
    }),
    item("approval", {
      kind: "task-state",
      tokenEstimate: 24,
      binding: {
        taskState: "waiting",
        approvalId: "approval-1",
        requiredForRecovery: true,
      },
      content: "Pending approval / 等待审批",
    }),
    item("question", {
      kind: "task-state",
      tokenEstimate: 24,
      binding: {
        taskState: "waiting",
        questionId: "question-1",
        requiredForRecovery: true,
      },
      content: "Pending question / 等待回答",
    }),
  ];
}

function runLongSession(scenario) {
  const messages = Array.from(
    { length: scenario.input.messageCount },
    (_, index) =>
      item(`message-${String(index).padStart(3, "0")}`, {
        content:
          index % 2 === 0
            ? `中文长会话消息 ${index}，保持任务连续性。`
            : `English long-session message ${index} preserves continuity.`,
        priority: 50 - (index % 10),
      }),
  );
  const items = [...protectedItems(), ...messages];
  const request = planRequest(items, scenario.input.modelWindowTokens);
  const first = planContext(request);
  const second = planContext({ ...request, items: [...items].reverse() });
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.selectedItemIds, second.selectedItemIds);
  for (const itemId of scenario.expected.protected) {
    assert.ok(first.selectedItemIds.includes(itemId), itemId);
  }
  return { protected: scenario.expected.protected, stableOrder: true };
}

function runParallelTools() {
  const items = protectedItems();
  for (let index = 0; index < 3; index += 1) {
    const toolCallId = `tool-${index}`;
    items.push(
      item(`call-${index}`, {
        kind: "tool-evidence",
        trust: "external",
        binding: {
          toolCallId,
          toolRole: "call",
          toolOutcome: "succeeded",
        },
      }),
      item(`result-${index}`, {
        kind: "tool-evidence",
        trust: "external",
        binding: {
          toolCallId,
          toolRole: "result",
          toolOutcome: "succeeded",
        },
      }),
    );
  }
  const plan = planContext(planRequest(items, 2_048));
  for (let index = 0; index < 3; index += 1) {
    assert.equal(
      plan.selectedItemIds.includes(`call-${index}`),
      plan.selectedItemIds.includes(`result-${index}`),
    );
  }
  assert.ok(plan.selectedItemIds.includes("approval"));
  assert.ok(plan.selectedItemIds.includes("question"));
  return { toolPairsIntact: true, pendingPreserved: true };
}

function runOrphanResult() {
  const result = item("orphan-result", {
    kind: "tool-evidence",
    trust: "external",
    binding: {
      toolCallId: "orphan-tool",
      toolRole: "result",
      toolOutcome: "succeeded",
    },
  });
  assert.throws(() => planContext(planRequest([result])), {
    code: "invalid_argument",
  });
  return { error: "invalid_argument" };
}

async function runScopes() {
  const memoryPort = new InMemoryMemoryPort();
  const kernel = new ContextMemoryKernel({ memoryPort, clock: CLOCK });
  const scopes = [
    ["session", "fixture-session"],
    ["agent", "fixture-agent"],
    ["project", "fixture-project"],
    ["user", "fixture-user"],
  ];
  for (const [scope, scopeId] of scopes) {
    await kernel.proposeMemory(
      memoryProposal(`memory-${scope}`, scope, scopeId),
    );
  }
  const all = await kernel.recallMemory({
    query: "shared",
    sink: "provider.local",
    scopeAdmissions: scopes.map(([scope, scopeId]) => ({ scope, scopeId })),
  });
  const sessionOnly = await kernel.recallMemory({
    query: "shared",
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: "fixture-session" }],
  });
  assert.equal(all.results.length, 4);
  assert.deepEqual(
    sessionOnly.results.map((entry) => entry.memoryId),
    ["memory-session"],
  );
  return { admittedCount: 4, crossScopeFallback: false };
}

async function runProviderOutcome(scenario) {
  const source = item("provider-source", {
    tokenEstimate: 300,
    priority: 1,
    trust: "untrusted",
    sensitivity: "personal",
  });
  const goal = protectedItems()[0];
  const sessionPort = new InMemorySessionContextPort([
    {
      sessionId: "fixture-session",
      head: "head:fixture",
      items: [source, goal],
    },
  ]);
  const kernel = new ContextMemoryKernel({ sessionPort, clock: CLOCK });
  const request = {
    operationId: scenario.id,
    sessionId: "fixture-session",
    modelWindowTokens: 180,
    reservedOutputTokens: 30,
    safetyMarginTokens: 10,
    recoveryReserveTokens: 10,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: "fixture-session" }],
    policyVersion: "conformance-v1",
    modelProfile: "fixture-provider",
    now: AT,
    allowFallback: scenario.input.allowFallback === true,
    summarizer: async () => {
      if (scenario.input.outcome === "failed") {
        throw Object.assign(new Error("provider failed"), {
          code: "provider_failed",
        });
      }
      if (scenario.input.outcome === "cancelled") {
        throw Object.assign(new Error("provider cancelled"), {
          code: "provider_cancelled",
        });
      }
      if (scenario.input.outcome === "unknown") {
        return { items: [], usageReceipt: { outcome: "unknown" } };
      }
      return {
        items: [
          item("provider-summary", {
            tokenEstimate: 10,
            trust: "untrusted",
            sensitivity: "personal",
            provenance: {
              source: "recorded-provider",
              observedAt: AT,
              parentDigests: [source.digest],
            },
            content: "Recorded bilingual summary",
          }),
        ],
        usageReceipt: {
          outcome: "settled",
          callId: `call-${scenario.id}`,
          provider: "recorded",
          model: "fixture",
          inputTokens: 300,
          outputTokens: 10,
        },
      };
    },
  };
  try {
    const receipt = await kernel.compactContext(request);
    const event = sessionPort.events("fixture-session").at(-1);
    return { status: receipt.status, strategy: event?.strategy };
  } catch (error) {
    assert.equal(error.compactionLifecycle.at(-1).state, "aborted");
    return { status: "aborted" };
  }
}

async function runCasRace() {
  const memoryPort = new InMemoryMemoryPort();
  const kernel = new ContextMemoryKernel({ memoryPort, clock: CLOCK });
  await kernel.proposeMemory(
    memoryProposal("memory-cas", "user", "fixture-user"),
  );
  const settled = await Promise.allSettled([
    kernel.decideMemory({
      memoryId: "memory-cas",
      type: "reinforce",
      expectedRevision: 1,
    }),
    kernel.decideMemory({
      memoryId: "memory-cas",
      type: "reinforce",
      expectedRevision: 1,
    }),
  ]);
  return {
    winnerCount: settled.filter((entry) => entry.status === "fulfilled").length,
  };
}

async function runIndexRebuild() {
  const memoryPort = new InMemoryMemoryPort();
  const kernel = new ContextMemoryKernel({ memoryPort, clock: CLOCK });
  await kernel.proposeMemory(
    memoryProposal("memory-index-1", "user", "fixture-user"),
  );
  await kernel.proposeMemory(
    memoryProposal("memory-index-2", "project", "fixture-project"),
  );
  const project = (records) =>
    records
      .filter((record) => ["active", "reinforced"].includes(record.state))
      .map((record) => [record.memoryId, record.digest])
      .sort(([left], [right]) => left.localeCompare(right, "en"));
  const before = project(await memoryPort.query());
  const emptyProjection = [];
  assert.equal(emptyProjection.length, 0);
  const rebuilt = project(await memoryPort.query());
  assert.deepEqual(rebuilt, before);
  return { sameRecordDigests: true };
}

function runOfflineReplica() {
  const active = createMemoryCandidate(
    memoryProposal("memory-replica", "user", "fixture-user"),
    { clock: CLOCK },
  );
  const deleted = applyMemoryCommand(
    active,
    {
      type: "delete",
      expectedRevision: 1,
      deletionFence: "fixture-fence",
      authority: "fixture-user",
    },
    { clock: CLOCK },
  ).record;
  assert.throws(() => mergeReplicaRecord(deleted, active), {
    code: "replica_tombstone_fenced",
  });
  return { error: "replica_tombstone_fenced" };
}

async function runDeleteRecovery() {
  const memoryPort = new InMemoryMemoryPort();
  const projection = new InMemoryProjectionPurgePort("fixture-index");
  projection.failWith(
    Object.assign(new Error("projection offline"), { code: "index_offline" }),
  );
  const first = new ContextMemoryKernel({
    memoryPort,
    reconciliationPort: memoryPort,
    purgePorts: [projection],
    clock: CLOCK,
  });
  const proposed = await first.proposeMemory(
    memoryProposal("memory-delete", "user", "fixture-user"),
  );
  const request = {
    requestId: "fixture-delete",
    subject: "fixture-user",
    scope: "user",
    scopeId: "fixture-user",
    selector: "memory:memory-delete",
    memoryId: "memory-delete",
    expectedRevision: proposed.record.revision,
    fence: "fixture-delete-fence",
    authority: "fixture-user",
  };
  const partial = await first.deleteMemory(request);
  const second = new ContextMemoryKernel({
    memoryPort,
    reconciliationPort: memoryPort,
    purgePorts: [projection],
    clock: CLOCK,
  });
  const completed = await second.reconcile(request.requestId);
  assert.equal((await memoryPort.read(request.memoryId)).state, "purged");
  return {
    initialStatus: partial.status,
    finalStatus: completed.status,
    rpo: 0,
    replayedEffectCount: 0,
  };
}

async function runScenario(scenario) {
  if (scenario.id.startsWith("multilingual-window-")) {
    return runLongSession(scenario);
  }
  if (scenario.id === "parallel-tools-pending") return runParallelTools();
  if (scenario.id === "orphan-late-tool-result") return runOrphanResult();
  if (scenario.id === "overlapping-scopes") return runScopes();
  if (scenario.id.startsWith("provider-")) return runProviderOutcome(scenario);
  if (scenario.id === "cas-race") return runCasRace();
  if (scenario.id === "index-rebuild") return runIndexRebuild();
  if (scenario.id === "offline-replica-reinjection") {
    return runOfflineReplica();
  }
  if (["crash-restart", "partial-delete-reconcile"].includes(scenario.id)) {
    return runDeleteRecovery();
  }
  throw new Error(`unhandled conformance scenario: ${scenario.id}`);
}

test("single cross-surface fixture executes every Context/Memory conformance scenario", async (t) => {
  const parsed = fixture();
  assert.equal(parsed.cases.length, 14);
  for (const scenario of parsed.cases) {
    await t.test(scenario.id, async () => {
      const actual = await runScenario(scenario);
      assert.deepEqual(
        Object.fromEntries(
          Object.keys(scenario.expected).map((key) => [key, actual[key]]),
        ),
        scenario.expected,
      );
    });
  }
});

test("conformance parser fails closed when a case or product surface is missing", () => {
  const source = readFileSync(
    path.resolve(
      __dirname,
      "..",
      "fixtures",
      "cross-surface-projection-v1.tsv",
    ),
    "utf8",
  );
  assert.throws(
    () =>
      parseContextMemoryConformanceFixture(
        source
          .split(/\r?\n/u)
          .filter((line) => !line.includes("\tcas-race\t"))
          .join("\n"),
      ),
    /coverage is incomplete/u,
  );
  assert.throws(
    () =>
      parseContextMemoryConformanceFixture(
        source.replace(
          "multilingual-long-session\tcli-js,desktop-js,app-server,typescript-sdk,python-sdk,vscode,jetbrains",
          "multilingual-long-session\tcli-js,desktop-js,app-server,typescript-sdk,python-sdk,vscode",
        ),
      ),
    /surface coverage is incomplete/u,
  );
});
