import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import {
  AppServerGraphRuntime,
  graphExecutorReceipt,
} from "../../src/lib/app-server/graph-runtime.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";

const OUTPUT = `sha256:${"d".repeat(64)}`;
const EVENT = `sha256:${"e".repeat(64)}`;

function definition(effectClass = "workspace_write") {
  return {
    schemaVersion: 1,
    id: "app-server-graph",
    revision: 1,
    nodes: [
      {
        id: "implement",
        kind: "task",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass,
        ...(effectClass === "workspace_write"
          ? {
              idempotencyKey: "app-server-implement-v1",
              workspaceIsolation: "declared_scope",
              writeSet: ["src/**"],
            }
          : {}),
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: 2 },
    allowedCapabilities: [],
  };
}

function legacyDefinition() {
  return {
    schemaVersion: 0,
    id: "app-server-legacy-graph",
    revision: 1,
    nodes: [{ id: "implement", dependsOn: [] }],
    edges: [],
    metadata: { source: "n-minus-one-production-request" },
  };
}

function humanDefinition({ quorum = 2 } = {}) {
  return {
    schemaVersion: 1,
    id: "app-server-human-graph",
    revision: 1,
    nodes: [
      {
        id: "review",
        kind: "human",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass: "none",
        join: quorum > 1 ? "quorum" : "all",
        ...(quorum > 1 ? { quorum } : {}),
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: 2 },
    allowedCapabilities: [],
  };
}

function humanDecision(task, actorId, decision = { kind: "acceptOnce" }) {
  return {
    humanTaskId: task.id,
    runId: task.runId,
    revisionDigest: task.revisionDigest,
    operationDigest: task.operationDigest,
    nonce: task.nonce,
    actorId,
    decision,
  };
}

class CrashAfterGraphAppendStore extends GraphEventStore {
  arm(type) {
    this.crashType = type;
  }

  append(...args) {
    const event = super.append(...args);
    if (args[1] === this.crashType) {
      this.crashType = null;
      throw new Error(`crash after ${args[1]}`);
    }
    return event;
  }
}

describe("App Server canonical Graph runtime", () => {
  it("drives a quorum HumanTask through distinct authenticated actors", async () => {
    const actors = ["did:chainless:reviewer-1", "did:chainless:reviewer-2"];
    let executorCalls = 0;
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode: async () => {
        executorCalls += 1;
        throw new Error("human nodes must not enter the Agent executor");
      },
      requestHumanTask: async ({ task }) => humanDecision(task, actors.shift()),
    });

    const projection = await runtime.run({
      definition: humanDefinition(),
      runId: "desktop-human-quorum",
      inputs: { review: { prompt: "Approve the exact release candidate" } },
      waitForCompletion: true,
    });

    expect(executorCalls).toBe(0);
    expect(projection.status).toBe("succeeded");
    expect(projection.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "review",
          status: "expired",
          participationStatus: "human_decided",
        }),
        expect.objectContaining({
          nodeId: "review",
          status: "accepted",
          terminalEvidence: { outputDigest: expect.stringMatching(/^sha256:/) },
        }),
      ]),
    );
    expect(runtime.humanTasks("desktop-human-quorum")).toMatchObject([
      {
        status: "decided",
        quorum: 2,
        separationOfDuties: true,
        decisions: [
          { actorId: "did:chainless:reviewer-1" },
          { actorId: "did:chainless:reviewer-2" },
        ],
      },
    ]);
  });

  it("keeps a stale HumanTask durable and resumes it with a new actor", async () => {
    const rolloutStore = new MemoryRolloutStore();
    let currentTime = 1_700_000_000_000;
    const now = () => currentTime;
    const first = new AppServerGraphRuntime({
      rolloutStore,
      now,
      executeNode: async () => ({ status: "failed" }),
      requestHumanTask: async ({ task }) =>
        humanDecision(task, "did:chainless:reviewer-1"),
    });
    await expect(
      first.run({
        definition: humanDefinition(),
        runId: "desktop-human-resume",
        inputs: { review: "Approve after restart" },
        waitForCompletion: true,
      }),
    ).rejects.toMatchObject({ code: "CC_GRAPH_HUMAN_SEPARATION_OF_DUTIES" });
    expect(first.humanTasks("desktop-human-resume")).toMatchObject([
      {
        status: "open",
        decisions: [{ actorId: "did:chainless:reviewer-1" }],
      },
    ]);
    expect(first.status("desktop-human-resume").status).toBe("waiting_human");
    const recovered = new AppServerGraphRuntime({
      rolloutStore,
      now,
      executeNode: async () => ({ status: "failed" }),
      requestHumanTask: async ({ task }) =>
        humanDecision(task, "did:chainless:reviewer-2"),
    });
    const projection = await recovered.resume("desktop-human-resume", {
      waitForCompletion: true,
    });
    expect(projection.status).toBe("succeeded");
    expect(
      recovered.humanTasks("desktop-human-resume")[0].decisions,
    ).toHaveLength(2);
  });

  it("rejects a stale client binding without claiming the HumanTask", async () => {
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode: async () => ({ status: "failed" }),
      requestHumanTask: async ({ task }) => ({
        ...humanDecision(task, "did:chainless:reviewer-1"),
        operationDigest: OUTPUT,
      }),
    });
    await expect(
      runtime.run({
        definition: humanDefinition({ quorum: 1 }),
        runId: "desktop-human-stale-binding",
        inputs: { review: "Do not approve a changed operation" },
        waitForCompletion: true,
      }),
    ).rejects.toMatchObject({ code: "CC_GRAPH_HUMAN_TASK_BINDING_MISMATCH" });
    expect(runtime.status("desktop-human-stale-binding").status).toBe(
      "waiting_human",
    );
    expect(runtime.humanTasks("desktop-human-stale-binding")).toMatchObject([
      { status: "open", decisions: [] },
    ]);
  });

  it("fails closed in waiting_human when no product handler is configured", async () => {
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode: async () => {
        throw new Error("human nodes must not enter the Agent executor");
      },
    });
    const projection = await runtime.run({
      definition: humanDefinition({ quorum: 1 }),
      runId: "desktop-human-no-handler",
      inputs: { review: "Wait for an authenticated reviewer" },
      waitForCompletion: true,
    });
    expect(projection.status).toBe("waiting_human");
    expect(runtime.humanTasks(projection.id)).toMatchObject([
      { status: "open", decisions: [] },
    ]);
  });

  it("returns bounded metadata-only durable history and validates ranges", async () => {
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode: async () => ({
        status: "succeeded",
        terminalEvidence: { eventDigest: EVENT, outputDigest: OUTPUT },
        receipt: {
          receiptDigest: EVENT,
          secretBody: "must-not-reach-debug-history",
        },
      }),
    });
    await runtime.run({
      definition: definition(),
      runId: "desktop-debug-history",
      inputs: { implement: { prompt: "private task body" } },
      waitForCompletion: true,
    });

    const history = runtime.history("desktop-debug-history", {
      limit: 2_000,
      snapshotLimit: 200,
    });
    expect(history).toMatchObject({
      schema: "chainlesschain.graph-debug-history/v1",
      runId: "desktop-debug-history",
      hasMore: false,
      current: { status: "succeeded" },
    });
    expect(
      history.events.every((event) => !Object.hasOwn(event, "payload")),
    ).toBe(true);
    expect(JSON.stringify(history)).not.toContain("private task body");
    expect(JSON.stringify(history)).not.toContain(
      "must-not-reach-debug-history",
    );
    expect(history.current.effects[0]).toEqual(
      expect.objectContaining({
        receiptDigest: EVENT,
        status: "committed",
      }),
    );
    expect(history.diffs).toHaveLength(history.snapshots.length - 1);
    const tail = runtime.history("desktop-debug-history", {
      limit: 2,
      snapshotLimit: 2,
    });
    expect(tail).toMatchObject({
      requestedAfterSeq: 0,
      truncatedBefore: true,
      hasMore: false,
      current: { status: "succeeded" },
    });
    expect(tail.events).toHaveLength(2);
    expect(() =>
      runtime.history("desktop-debug-history", { limit: 2_001 }),
    ).toThrow(
      expect.objectContaining({ code: "CC_GRAPH_HISTORY_RANGE_INVALID" }),
    );
  });

  it("drives a real executor through attempt, effect receipt, and terminal state", async () => {
    const store = new MemoryRolloutStore();
    const calls = [];
    const runtime = new AppServerGraphRuntime({
      rolloutStore: store,
      createId: () => `id-${calls.length + 1}`,
      executeNode: async (context) => {
        calls.push(context);
        return {
          status: "succeeded",
          terminalEvidence: { eventDigest: EVENT, outputDigest: OUTPUT },
          usage: { turns: 1, tokens: 12 },
        };
      },
    });
    const projection = await runtime.run({
      definition: definition(),
      runId: "desktop-team-success",
      inputs: { implement: { prompt: "Implement the approved task" } },
      waitForCompletion: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].input.prompt).toBe("Implement the approved task");
    expect(projection).toMatchObject({
      status: "succeeded",
      originSurface: "desktop",
      authoritySource: "graph_kernel",
      authorityGeneration: 1,
      projectionVersion: 1,
      reconciliationEffectIds: [],
    });
  });

  it("routes an unproven effect outcome to reconciliation and never replays it", async () => {
    let calls = 0;
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode: async () => {
        calls += 1;
        throw new Error("connection lost after tool dispatch");
      },
    });
    const projection = await runtime.run({
      definition: definition(),
      runId: "desktop-team-unknown",
      inputs: { implement: "Do work" },
      waitForCompletion: true,
    });
    expect(calls).toBe(1);
    expect(projection).toMatchObject({
      status: "reconciliation_required",
      reconciliationEffectIds: [expect.any(String)],
    });
    expect(runtime.status("desktop-team-unknown").status).toBe(
      "reconciliation_required",
    );
    expect(calls).toBe(1);
  });

  it("settles an audited committed reconciliation from evidence without executor replay", async () => {
    let calls = 0;
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode: async () => {
        calls += 1;
        throw new Error("connection lost after tool dispatch");
      },
    });
    const unknown = await runtime.run({
      definition: definition(),
      runId: "desktop-audited-reconciliation",
      inputs: { implement: "perform one exact write" },
      waitForCompletion: true,
    });

    await expect(
      runtime.reconcile("desktop-audited-reconciliation", {
        effectId: unknown.reconciliationEffectIds[0],
        decision: "committed",
        receipt: { receiptDigest: EVENT },
        auditDecisionId: "desktop-human-audit-missing-evidence",
      }),
    ).rejects.toMatchObject({
      code: "CC_GRAPH_TERMINAL_EVIDENCE_REQUIRED",
    });
    expect(runtime.status("desktop-audited-reconciliation")).toMatchObject({
      status: "reconciliation_required",
      reconciliationEffectIds: [unknown.reconciliationEffectIds[0]],
    });

    const projection = await runtime.reconcile(
      "desktop-audited-reconciliation",
      {
        effectId: unknown.reconciliationEffectIds[0],
        decision: "committed",
        receipt: { receiptDigest: EVENT },
        terminalEvidence: { outputDigest: OUTPUT },
        auditDecisionId: "desktop-human-audit-1",
      },
    );

    expect(calls).toBe(1);
    expect(projection).toMatchObject({
      status: "succeeded",
      reconciliationEffectIds: [],
      attempts: [
        expect.objectContaining({ status: "expired" }),
        expect.objectContaining({
          status: "accepted",
          terminalEvidence: { outputDigest: OUTPUT },
        }),
      ],
    });
  });

  it("resumes a pre-dispatch run from its durable request without Desktop inputs", async () => {
    const rolloutStore = new MemoryRolloutStore();
    const first = new AppServerGraphRuntime({
      rolloutStore,
      executeNode: async () => {
        throw new Error("the crashed runtime must not execute");
      },
    });
    first.start({
      definition: definition("none"),
      runId: "desktop-resume-from-request",
      inputs: { implement: "resume exact durable input" },
    });

    const inputs = [];
    const recovered = new AppServerGraphRuntime({
      rolloutStore,
      executeNode: async ({ input }) => {
        inputs.push(input.prompt);
        return {
          status: "succeeded",
          terminalEvidence: { outputDigest: OUTPUT },
        };
      },
    });
    const projection = await recovered.resume("desktop-resume-from-request", {
      waitForCompletion: true,
    });

    expect(inputs).toEqual(["resume exact durable input"]);
    expect(projection).toMatchObject({
      status: "succeeded",
      authorityGeneration: 2,
      authoritySource: "graph_kernel",
    });
  });

  it("persists and revalidates an N-1 definition backup across App Server recovery", async () => {
    const rolloutStore = new MemoryRolloutStore();
    const first = new AppServerGraphRuntime({
      rolloutStore,
      executeNode: async () => {
        throw new Error("the pre-crash runtime must not execute");
      },
    });
    const started = first.start({
      definition: legacyDefinition(),
      runId: "desktop-definition-migration",
      inputs: { implement: "resume the migrated definition" },
    });
    expect(started.definitionMigration).toMatchObject({
      schema: "chainlesschain.graph-definition-migration/v1",
      fromVersion: 0,
      toVersion: 1,
      revisionDigest: started.revisionDigest,
      backupAvailable: true,
    });
    expect(
      first._readRequest("desktop-definition-migration").definition,
    ).toEqual(legacyDefinition());
    const durableSnapshot = first.eventStore
      .read("desktop-definition-migration")
      .at(-1).payload.state;
    expect(durableSnapshot.definition.schemaVersion).toBe(1);
    expect(durableSnapshot.definitionMigration).toMatchObject({
      backupDefinition: legacyDefinition(),
      revisionDigest: started.revisionDigest,
    });

    const prompts = [];
    const recovered = new AppServerGraphRuntime({
      rolloutStore,
      executeNode: async ({ input }) => {
        prompts.push(input.prompt);
        return {
          status: "succeeded",
          terminalEvidence: { outputDigest: OUTPUT },
        };
      },
    });
    const completed = await recovered.resume("desktop-definition-migration", {
      waitForCompletion: true,
    });
    expect(prompts).toEqual(["resume the migrated definition"]);
    expect(completed).toMatchObject({
      status: "succeeded",
      authorityGeneration: 2,
      definitionMigration: {
        fromVersion: 0,
        toVersion: 1,
        revisionDigest: started.revisionDigest,
        rollbackDigest: started.definitionMigration.rollbackDigest,
        backupAvailable: true,
      },
    });
  });

  it("rejects forged success without immutable evidence", () => {
    expect(() =>
      graphExecutorReceipt({ status: "succeeded", terminalEvidence: {} }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_TERMINAL_EVIDENCE_REQUIRED" }),
    );
  });

  it("recovers a receipted Agent result without replaying the executor", async () => {
    const rolloutStore = new MemoryRolloutStore();
    const eventStore = new CrashAfterGraphAppendStore({ rolloutStore });
    const first = new AppServerGraphRuntime({
      eventStore,
      createId: (() => {
        let value = 0;
        return () => `first-${++value}`;
      })(),
      executeNode: async ({ runId, nodeId, attempt }) => {
        const threadId = `graph-executor:${runId}`;
        rolloutStore.start({ threadId });
        rolloutStore.append({
          threadId,
          eventType: "executor.succeeded",
          idempotencyKey: `graph-executor:${attempt.id}`,
          payload: {
            runId,
            nodeId,
            attemptId: attempt.id,
            status: "succeeded",
            outputDigest: OUTPUT,
            error: null,
          },
        });
        return {
          status: "succeeded",
          terminalEvidence: { outputDigest: OUTPUT },
        };
      },
    });
    eventStore.arm("effect.settled");
    await expect(
      first.run({
        definition: definition(),
        runId: "desktop-team-receipt-cutpoint",
        inputs: { implement: "do exact work" },
        waitForCompletion: true,
      }),
    ).rejects.toThrow();

    let replays = 0;
    const recovered = new AppServerGraphRuntime({
      eventStore,
      executeNode: async () => {
        replays += 1;
        throw new Error("must not replay");
      },
    });
    const recoveryRequest = {
      definition: definition(),
      runId: "desktop-team-receipt-cutpoint",
      inputs: { implement: "do exact work" },
      waitForCompletion: true,
    };
    eventStore.arm("assignment.resumed");
    expect(() => recovered.run(recoveryRequest)).toThrow(
      "crash after assignment.resumed",
    );
    expect(replays).toBe(0);

    const recoveredAgain = new AppServerGraphRuntime({
      eventStore,
      executeNode: async () => {
        replays += 1;
        throw new Error("must not replay");
      },
    });
    const projection = await recoveredAgain.run(recoveryRequest);
    expect(replays).toBe(0);
    expect(projection).toMatchObject({
      status: "succeeded",
      authorityGeneration: 3,
      authoritySource: "graph_kernel",
    });
  });

  it("binds a run id to one durable definition and input request", async () => {
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode: async () => ({
        status: "succeeded",
        terminalEvidence: { outputDigest: OUTPUT },
      }),
    });
    await runtime.run({
      definition: definition("none"),
      runId: "desktop-team-request-binding",
      inputs: { implement: "first input" },
      authorityMode: "shadow",
    });
    expect(() =>
      runtime.run({
        definition: definition("none"),
        runId: "desktop-team-request-binding",
        inputs: { implement: "different input" },
        authorityMode: "shadow",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_ROLLOUT_IDEMPOTENCY_CONFLICT" }),
    );
  });
});
