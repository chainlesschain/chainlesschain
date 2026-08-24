import { describe, expect, it } from "vitest";
import { compileGraphDefinition } from "../../src/lib/graph-kernel/compiler.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const NOW = 1_700_000_000_000;
const POLICY = {
  origin: "host:fault-injection",
  trust: "trusted_host",
  sensitivity: "internal",
  allowedSinks: ["agent:*"],
};

class AfterAppendFaultStore {
  constructor(inner) {
    this.inner = inner;
    this.faultType = null;
  }

  arm(type) {
    this.faultType = type;
  }

  start(...args) {
    return this.inner.start(...args);
  }

  append(...args) {
    const event = this.inner.append(...args);
    if (args[1] === this.faultType) {
      this.faultType = null;
      const error = new Error(`injected crash after durable ${args[1]}`);
      error.code = "TEST_CRASH_AFTER_DURABLE_APPEND";
      throw error;
    }
    return event;
  }

  read(...args) {
    return this.inner.read(...args);
  }
}

function task(id, overrides = {}) {
  return {
    id,
    kind: "task",
    dependsOn: [],
    inputs: [],
    outputs: [],
    effectClass: "none",
    ...overrides,
  };
}

function compiled(nodes, overrides = {}) {
  return compileGraphDefinition({
    schemaVersion: 1,
    id: overrides.id || "fault-injection-graph",
    revision: 1,
    nodes,
    edges: [],
    loops: overrides.loops || [],
    subgraphCalls: overrides.subgraphCalls || [],
    budget: { turns: 100, tokens: 100_000 },
    allowedCapabilities: [],
    metadata: {},
  });
}

function context(nodes, runId, overrides = {}) {
  const durable = new GraphEventStore({
    rolloutStore: new MemoryRolloutStore({ now: () => NOW }),
  });
  const eventStore = new AfterAppendFaultStore(durable);
  const kernel = new GraphKernel({
    eventStore,
    now: () => NOW,
    createId: () => "generated-id",
  });
  kernel.startRun(compiled(nodes, overrides), { runId });
  kernel.sealRun(runId);
  return { durable, eventStore, kernel };
}

function assign(kernel, runId, nodeId) {
  return kernel.assignNode(runId, nodeId, "agent-1", {
    attemptId: `attempt-${nodeId}`,
    leaseId: `lease-${nodeId}`,
  });
}

function recover(durable, runId) {
  const kernel = new GraphKernel({ eventStore: durable, now: () => NOW });
  kernel.recoverRun(runId);
  return kernel;
}

function send(kernel, runId, attempt, messageId = "message-1") {
  return kernel.sendMessage(runId, {
    messageId,
    fromAttemptId: attempt.id,
    leaseId: attempt.leaseId,
    fence: attempt.fence,
    toAgentId: "recipient",
    payload: { text: "durable message" },
    dataPolicy: POLICY,
  });
}

describe("Graph Kernel durable cutpoint fault injection", () => {
  it("recovers a dispatch lease committed before the worker observed it", () => {
    const runId = "fault-dispatch-lease";
    const { durable, eventStore, kernel } = context([task("only")], runId);
    eventStore.arm("assignment.started");

    expect(() => assign(kernel, runId, "only")).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );

    const recovered = recover(durable, runId);
    expect(recovered.getRun(runId)).toMatchObject({
      status: "running",
      nodes: [
        expect.objectContaining({
          nodeId: "only",
          status: "running",
          attemptIds: ["attempt-only"],
        }),
      ],
    });
    expect(recovered.readyNodes(runId)).toEqual([]);
    recovered.settleAttempt(runId, {
      attemptId: "attempt-only",
      leaseId: "lease-only",
      fence: 1,
      outcome: "succeeded",
      evidence: { outputDigest: DIGEST_A },
    });
    expect(recovered.getRun(runId).status).toBe("succeeded");
  });

  it("recovers a state transition committed before the caller observed it", () => {
    const runId = "fault-state-transition";
    const { durable, eventStore, kernel } = context([task("only")], runId);
    const attempt = assign(kernel, runId, "only");
    eventStore.arm("assignment.settled");

    expect(() =>
      kernel.settleAttempt(runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "succeeded",
        evidence: { outputDigest: DIGEST_A },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );

    expect(recover(durable, runId).getRun(runId)).toMatchObject({
      status: "succeeded",
      nodes: [expect.objectContaining({ nodeId: "only", status: "succeeded" })],
    });
  });

  it("deduplicates a message whose admission committed before the crash", () => {
    const runId = "fault-message-admission";
    const { durable, eventStore, kernel } = context([task("talk")], runId);
    const attempt = assign(kernel, runId, "talk");
    eventStore.arm("message.admitted");

    expect(() => send(kernel, runId, attempt)).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );

    const recovered = recover(durable, runId);
    expect(send(recovered, runId, attempt)).toMatchObject({
      id: "message-1",
      status: "admitted",
    });
    recovered.deliverMessage(runId, "message-1");
    expect(recovered.receiveMessages(runId, "recipient")).toEqual([
      expect.objectContaining({ id: "message-1", deliveryCount: 1 }),
    ]);
    expect(
      recovered
        .events(runId)
        .filter((event) => event.type === "message.admitted"),
    ).toHaveLength(1);
  });

  it("recovers a committed effect receipt without classifying it as unknown", () => {
    const runId = "fault-effect-receipt";
    const { durable, eventStore, kernel } = context(
      [
        task("effect", {
          effectClass: "external",
          idempotencyKey: "effect-key",
        }),
      ],
      runId,
    );
    const attempt = assign(kernel, runId, "effect");
    const effect = kernel.beginEffect(runId, {
      effectId: "effect-1",
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      idempotencyKey: "effect-key",
      operationDigest: DIGEST_B,
    });
    eventStore.arm("effect.settled");

    expect(() =>
      kernel.settleEffect(runId, {
        effectId: effect.id,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "committed",
        receipt: { receiptDigest: DIGEST_A, externalId: "remote-1" },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );

    const recovered = recover(durable, runId);
    expect(
      recovered.beginEffect(runId, {
        effectId: "effect-retry",
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        idempotencyKey: "effect-key",
        operationDigest: DIGEST_B,
      }),
    ).toMatchObject({ id: "effect-1", status: "committed" });
    recovered.settleAttempt(runId, {
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "succeeded",
      evidence: { outputDigest: DIGEST_A },
    });
    expect(recovered.getRun(runId)).toMatchObject({
      status: "succeeded",
      reconciliationEffectIds: [],
    });
  });

  it("replays the same processed receipt after an ACK cutpoint crash", () => {
    const runId = "fault-message-processed";
    const { durable, eventStore, kernel } = context([task("talk")], runId);
    const attempt = assign(kernel, runId, "talk");
    send(kernel, runId, attempt);
    kernel.deliverMessage(runId, "message-1");
    kernel.receiveMessages(runId, "recipient");
    eventStore.arm("message.processed");

    expect(() =>
      kernel.processMessage(runId, "message-1", "recipient", "consumer-1"),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );

    const recovered = recover(durable, runId);
    const receipt = recovered.processMessage(
      runId,
      "message-1",
      "recipient",
      "consumer-1",
    );
    expect(receipt).toMatchObject({
      messageId: "message-1",
      agentId: "recipient",
      consumerKey: "consumer-1",
    });
    expect(recovered.receiveMessages(runId, "recipient")).toEqual([]);
    expect(
      recovered
        .events(runId)
        .filter((event) => event.type === "message.processed"),
    ).toHaveLength(1);
  });

  it("recovers the next deterministic loop frontier after a decision cutpoint", () => {
    const runId = "fault-loop-decision";
    const { durable, eventStore, kernel } = context([task("repeat")], runId, {
      loops: [
        {
          id: "bounded-loop",
          entryNodeId: "repeat",
          exitNodeId: "repeat",
          nodeIds: ["repeat"],
          maxIterations: 2,
          condition: "done",
        },
      ],
    });
    const attempt = assign(kernel, runId, "repeat");
    kernel.settleAttempt(runId, {
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "succeeded",
      evidence: { outputDigest: DIGEST_A },
    });
    eventStore.arm("loop.continued");

    expect(() =>
      kernel.advanceLoop(runId, {
        regionId: "bounded-loop",
        continueLoop: true,
        conditionEvidenceDigest: DIGEST_B,
        requestId: "loop-cutpoint-0",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );

    const recovered = recover(durable, runId);
    expect(recovered.getRun(runId)).toMatchObject({
      status: "running",
      loops: [
        expect.objectContaining({
          status: "active",
          iterationPath: [1],
        }),
      ],
      nodes: [
        expect.objectContaining({ status: "pending", iterationPath: [1] }),
      ],
    });
    expect(
      recovered
        .events(runId)
        .filter((event) => event.type === "loop.continued"),
    ).toHaveLength(1);
  });

  it("resumes child creation after the parent subgraph binding was committed", () => {
    const child = compiled([task("child-task")], { id: "fault-child" });
    const runId = "fault-subgraph-start";
    const { durable, eventStore, kernel } = context(
      [task("call-child", { kind: "subgraph" })],
      runId,
      {
        id: "fault-parent",
        subgraphCalls: [
          {
            nodeId: "call-child",
            definitionId: child.definitionId,
            revisionDigest: child.revisionDigest,
            maxDepth: 2,
          },
        ],
      },
    );
    eventStore.arm("subgraph.starting");

    expect(() => kernel.startSubgraph(runId, "call-child", child)).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );

    const recovered = recover(durable, runId);
    expect(recovered.getRun(runId)).toMatchObject({
      status: "waiting_external",
      subgraphRuns: [expect.objectContaining({ status: "starting" })],
    });
    const resumed = recovered.startSubgraph(runId, "call-child", child);
    expect(resumed).toMatchObject({
      relation: { status: "running" },
      childRun: {
        definitionId: "fault-child",
        phase: "sealed",
        status: "running",
      },
    });
    expect(
      recovered
        .events(runId)
        .filter((event) => event.type === "subgraph.starting"),
    ).toHaveLength(1);
  });
});
