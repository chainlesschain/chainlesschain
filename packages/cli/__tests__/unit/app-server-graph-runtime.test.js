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
    const projection = await recovered.run({
      definition: definition(),
      runId: "desktop-team-receipt-cutpoint",
      inputs: { implement: "do exact work" },
      waitForCompletion: true,
    });
    expect(replays).toBe(0);
    expect(projection).toMatchObject({
      status: "succeeded",
      authorityGeneration: 2,
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
