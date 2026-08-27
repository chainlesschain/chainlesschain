import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamDistributedGraphBridge } from "../../src/lib/agent-team/team-distributed-graph-bridge.js";
import {
  distributedTeamGraphRequestId,
  distributedTeamGraphRunId,
  distributedTeamGraphSettlementPayload,
  TeamDistributedGraphWriter,
  verifyDistributedTeamGraphResponse,
} from "../../src/lib/agent-team/team-distributed-graph-writer.js";
import { TeamGraphRuntimeAdapter } from "../../src/lib/agent-team/team-graph-runtime-adapter.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";

const NOW = 1_800_000_000_000;
const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;

function fixture({ retrySafe = true } = {}) {
  const now = () => NOW;
  const registry = new TaskLeaseRegistry({
    now,
    maxAttempts: 2,
    leaseEpoch: "distributed-writer-test",
  });
  registry.addTask({
    key: "build",
    title: "Build",
    metadata: { retrySafe, scopePaths: ["src"] },
  });
  const acquiredLease = registry.acquire("build", {
    holder: "worker-1:teammate-1",
    ttlMs: 60_000,
  }).lease;
  const lease = { ...acquiredLease, fencingToken: 1 };
  const project = (task) =>
    task?.status === "in_progress"
      ? {
          ...task,
          lease,
          metadata: { ...task.metadata, lease },
        }
      : task;
  const queue = {
    get maxAttempts() {
      return registry.maxAttempts;
    },
    getTask(key) {
      return project(registry.getTask(key));
    },
    list() {
      return registry.list().map(project);
    },
    applyCanonicalTaskProjection(...args) {
      return registry.applyCanonicalTaskProjection(...args);
    },
  };
  const graphRollouts = new MemoryRolloutStore({ now });
  const eventStore = new GraphEventStore({ rolloutStore: graphRollouts });
  const bridge = new TeamDistributedGraphBridge({
    directory: "unused-memory-directory",
    queueId: "queue-1",
    runId: "run-1",
    now,
    store: new MemoryRolloutStore({ now }),
  });
  const graphRunId = distributedTeamGraphRunId({
    queueId: "queue-1",
    runId: "run-1",
  });
  let adapterId = 0;
  const adapter = () =>
    new TeamGraphRuntimeAdapter({
      eventStore,
      now,
      createId: () => `writer-adapter-${++adapterId}`,
    });
  const writer = (runtime = adapter()) =>
    new TeamDistributedGraphWriter({
      queue,
      bridge,
      adapter: runtime,
      runId: graphRunId,
      executionMode: "shell-worktree",
      budget: { maxTasks: 2 },
    });
  const request = (type, payload = {}) => {
    const binding = {
      queueId: "queue-1",
      taskKey: "build",
      lease,
    };
    return bridge.request({
      requestId: distributedTeamGraphRequestId(type, binding),
      type,
      taskKey: "build",
      workerId: "worker-1",
      lease,
      payload,
    });
  };
  return { queue, lease, bridge, eventStore, adapter, writer, request };
}

describe("distributed Team canonical Graph writer", () => {
  it("orders dispatch and terminal settlement through one Graph writer", () => {
    const value = fixture();
    const writer = value.writer();
    writer.open();
    const dispatch = value.request("dispatch");
    const dispatched = writer.process(dispatch);
    expect(dispatched).toMatchObject({
      status: "applied",
      graphAuthority: {
        authoritySource: "graph_kernel",
        nodeStatus: "running",
        attemptId: expect.any(String),
        effectId: expect.any(String),
      },
    });
    expect(
      verifyDistributedTeamGraphResponse({
        response: dispatched,
        request: dispatch,
        eventStore: value.eventStore,
        runId: writer.runId,
      }),
    ).toMatchObject({ effect: { status: "started" } });

    const settlement = value.request(
      "settle",
      distributedTeamGraphSettlementPayload({
        task: value.queue.getTask("build"),
        status: "completed",
        result: {
          terminalEvidence: { outputDigest: OUTPUT_DIGEST },
        },
      }),
    );
    const settled = writer.process(settlement);
    expect(settled).toMatchObject({
      status: "applied",
      graphAuthority: { nodeStatus: "succeeded" },
    });
    expect(
      verifyDistributedTeamGraphResponse({
        response: settled,
        request: settlement,
        eventStore: value.eventStore,
        runId: writer.runId,
      }),
    ).toMatchObject({ effect: { status: "committed" } });
    expect(writer.status().graph).toMatchObject({ status: "succeeded" });
  });

  it("rejects an applied response that is absent from the Graph event chain", () => {
    const value = fixture();
    const writer = value.writer();
    writer.open();
    const request = value.request("dispatch");
    const response = writer.process(request);
    expect(() =>
      verifyDistributedTeamGraphResponse({
        response: {
          ...response,
          graphAuthority: {
            ...response.graphAuthority,
            eventHead: `sha256:${"f".repeat(64)}`,
          },
        },
        request,
        eventStore: value.eventStore,
        runId: writer.runId,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_FORGED",
      }),
    );
  });

  it("rejects a stale exact queue lease before mutating Graph", () => {
    const value = fixture();
    const writer = value.writer();
    writer.open();
    const request = value.bridge.request({
      requestId: "stale-dispatch",
      type: "dispatch",
      taskKey: "build",
      workerId: "worker-2",
      lease: {
        holder: "worker-2:teammate-1",
        leaseId: "stale-lease",
        fencingToken: value.lease.fencingToken + 1,
      },
    });
    expect(writer.process(request)).toMatchObject({
      status: "rejected",
      error: { code: "CC_TEAM_DISTRIBUTED_GRAPH_STALE_LEASE" },
    });
    expect(writer.adapter.kernel.effectState(writer.runId)).toEqual([]);
  });

  it("retries safely after crashing before the dispatch response", () => {
    const value = fixture();
    const first = value.writer();
    first.open();
    value.request("dispatch");
    first.adapter.beforeTask({
      key: "build",
      holder: value.lease.holder,
      lease: value.lease,
      task: value.queue.getTask("build"),
    });

    const recovered = value.writer();
    recovered.open();
    expect(recovered.processPending()).toEqual([
      expect.objectContaining({
        status: "applied",
        result: { recovered: false },
      }),
    ]);
    expect(
      recovered.adapter.kernel
        .effectState(recovered.runId)
        .map((effect) => effect.status),
    ).toEqual(["failed", "started"]);
  });

  it("requires adjudication after an applied dispatch loses its worker outcome", () => {
    const value = fixture();
    const first = value.writer();
    first.open();
    first.process(value.request("dispatch"));
    expect(() => value.writer().open()).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_RECONCILIATION_REQUIRED" }),
    );
  });

  it("repairs the queue after Graph settled before its bridge response", () => {
    const value = fixture();
    const first = value.writer();
    first.open();
    first.process(value.request("dispatch"));
    const settlement = value.request(
      "settle",
      distributedTeamGraphSettlementPayload({
        task: value.queue.getTask("build"),
        status: "completed",
        result: { commitOid: "a".repeat(40) },
      }),
    );
    first.adapter.settleTask({
      key: "build",
      task: value.queue.getTask("build"),
      status: "completed",
      result: { terminalEvidence: { commit: "a".repeat(40) } },
    });

    const recovered = value.writer();
    recovered.open();
    expect(value.queue.getTask("build").status).toBe("completed");
    const response = recovered.process(settlement);
    expect(response).toMatchObject({
      status: "applied",
      result: { recovered: true },
    });
    expect(
      verifyDistributedTeamGraphResponse({
        response,
        request: settlement,
        eventStore: value.eventStore,
        runId: recovered.runId,
      }),
    ).toMatchObject({ effect: { status: "committed" } });
  });
});
