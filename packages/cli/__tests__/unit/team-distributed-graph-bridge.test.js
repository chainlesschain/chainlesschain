import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { TeamDistributedGraphBridge } from "../../src/lib/agent-team/team-distributed-graph-bridge.js";

function bridge() {
  return new TeamDistributedGraphBridge({
    directory: "unused-memory-directory",
    queueId: "queue-1",
    runId: "distributed-run-1",
    store: new MemoryRolloutStore({ now: () => 1_800_000_000_000 }),
  });
}

function request(value, overrides = {}) {
  return value.request({
    requestId: "dispatch-task-1",
    type: "dispatch",
    taskKey: "task-1",
    workerId: "worker-1",
    lease: {
      holder: "worker-1:teammate-1",
      leaseId: "queue-lease-1",
      fencingToken: 1,
    },
    payload: {},
    ...overrides,
  });
}

describe("distributed Team Graph bridge", () => {
  it("durably deduplicates a request and binds its response", async () => {
    const value = bridge();
    const first = request(value);
    expect(request(value)).toEqual(first);
    expect(value.pending()).toEqual([
      expect.objectContaining({
        requestId: "dispatch-task-1",
        requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    ]);
    value.respond(first, {
      status: "applied",
      graphAuthority: {
        authorityGeneration: 1,
        eventHead: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(value.pending()).toEqual([]);
    await expect(
      value.waitForResponse("dispatch-task-1", { timeoutMs: 10 }),
    ).resolves.toMatchObject({
      requestId: "dispatch-task-1",
      requestDigest: first.requestDigest,
      status: "applied",
    });
  });

  it("rejects request-id reuse with another lease binding", () => {
    const value = bridge();
    request(value);
    expect(() =>
      request(value, {
        lease: {
          holder: "worker-2:teammate-1",
          leaseId: "queue-lease-2",
          fencingToken: 2,
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_ROLLOUT_IDEMPOTENCY_CONFLICT" }),
    );
  });

  it("fails closed when a response digest does not match the request", () => {
    const value = bridge();
    const admitted = request(value);
    value.store.append({
      threadId: value.threadId,
      eventType: "team.graph.response",
      idempotencyKey: "response:dispatch-task-1",
      payload: {
        requestId: admitted.requestId,
        requestDigest: `sha256:${"b".repeat(64)}`,
        status: "applied",
      },
    });
    expect(() => value.snapshot()).toThrowError(
      expect.objectContaining({
        code: "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_CORRUPT",
      }),
    );
  });

  it("fails closed when an existing journal belongs to another run", () => {
    const store = new MemoryRolloutStore({ now: () => 1_800_000_000_000 });
    new TeamDistributedGraphBridge({
      directory: "unused-memory-directory",
      queueId: "queue-identity",
      runId: "run-first",
      store,
    });
    expect(
      () =>
        new TeamDistributedGraphBridge({
          directory: "unused-memory-directory",
          queueId: "queue-identity",
          runId: "run-second",
          store,
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_TEAM_DISTRIBUTED_GRAPH_BRIDGE_CORRUPT",
      }),
    );
  });
});
