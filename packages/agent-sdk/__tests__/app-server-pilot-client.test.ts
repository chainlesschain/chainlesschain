import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  AppServerPilotClient,
  type AppServerPilotTransport,
} from "../src/app-server-pilot-client.js";

class FakeTransport extends EventEmitter implements AppServerPilotTransport {
  running = false;
  pendingRequestCount = 0;
  start = vi.fn(async () => {
    this.running = true;
    return {
      protocolVersion: 1,
      features: ["thread_turn_item", "bounded_transport"],
    };
  });
  request = vi.fn(async (method: string, params = {}) => ({ method, params }));
  close = vi.fn(async () => {
    this.running = false;
  });
}

describe("AppServerPilotClient", () => {
  it("exposes only fixed Thread/Turn capabilities and lazily initializes once", async () => {
    const transport = new FakeTransport();
    const pilot = new AppServerPilotClient({ transport });

    await expect(pilot.threadList({ limit: 20 })).resolves.toEqual({
      method: "thread/list",
      params: { limit: 20 },
    });
    await expect(
      pilot.turnStart({ threadId: "thread-1", input: "hello" }),
    ).resolves.toEqual({
      method: "turn/start",
      params: { threadId: "thread-1", input: "hello" },
    });
    await expect(
      pilot.graphHistory({ runId: "graph-1", snapshotLimit: 20 }),
    ).resolves.toEqual({
      method: "graph/history",
      params: { runId: "graph-1", snapshotLimit: 20 },
    });
    await expect(
      pilot.memoryReconcile({ operationId: "deletion-1" }),
    ).resolves.toEqual({
      method: "memory/reconcile",
      params: { operationId: "deletion-1" },
    });
    await expect(
      pilot.evolutionWorkbenchList({ status: "pending" }),
    ).resolves.toEqual({
      method: "evolution/workbench/list",
      params: { status: "pending" },
    });

    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(transport.request.mock.calls.map(([method]) => method)).toEqual([
      "thread/list",
      "turn/start",
      "graph/history",
      "memory/reconcile",
      "evolution/workbench/list",
    ]);
    expect("request" in pilot).toBe(false);
    expect(pilot.status).toMatchObject({
      running: true,
      initialized: true,
      pendingRequestCount: 0,
      capabilities: { protocolVersion: 1 },
    });
  });

  it("exposes fixed Context/Memory capabilities without a generic request escape hatch", async () => {
    const transport = new FakeTransport();
    const pilot = new AppServerPilotClient({ transport });
    const calls = [
      pilot.contextPlan({} as never),
      pilot.contextCompact({} as never),
      pilot.memoryRecall({} as never),
      pilot.memoryPropose({} as never),
      pilot.memoryDecide({} as never),
      pilot.memoryDelete({} as never),
      pilot.memoryReconcile({ operationId: "operation-1" }),
      pilot.evolutionWorkbenchCompare({
        leftPacketDigest: "left",
        rightPacketDigest: "right",
      }),
      pilot.evolutionWorkbenchReview({
        packetDigests: ["packet"],
        decision: "approve",
        reason: "reviewed",
      }),
      pilot.evolutionWorkbenchRollback({
        fromPacketDigest: "from",
        toPacketDigest: "to",
        reason: "rollback",
      }),
      pilot.governedKnowledgeConflicts({ cursor: 0, limit: 50 }),
      pilot.governedKnowledgeMerge({
        conflictEnvelopeDigest: "sha256:conflict",
        mergedRecord: {},
        reason: "merged",
      }),
    ];
    await Promise.all(calls);
    expect(transport.request.mock.calls.map(([method]) => method)).toEqual([
      "context/plan",
      "context/compact",
      "memory/recall",
      "memory/propose",
      "memory/decide",
      "memory/delete",
      "memory/reconcile",
      "evolution/workbench/compare",
      "evolution/workbench/review",
      "evolution/workbench/rollback",
      "evolution/knowledge/conflicts",
      "evolution/knowledge/merge",
    ]);
    expect("request" in pilot).toBe(false);
  });

  it("forwards canonical notifications and contains unhandled transport errors", () => {
    const transport = new FakeTransport();
    const pilot = new AppServerPilotClient({ transport });
    const notification = vi.fn();
    const completed = vi.fn();
    pilot.on("notification", notification);
    pilot.on("turn/completed", completed);

    transport.emit("notification", {
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { turn: { id: "turn-1" } },
    });
    expect(notification).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith({ turn: { id: "turn-1" } });

    expect(() =>
      transport.emit("error", new Error("broken pipe")),
    ).not.toThrow();
    expect(pilot.status.lastError).toBe("broken pipe");
  });

  it("resets negotiated capabilities on close", async () => {
    const transport = new FakeTransport();
    const pilot = new AppServerPilotClient({ transport });
    await pilot.start();
    await pilot.close();

    expect(transport.close).toHaveBeenCalledOnce();
    expect(pilot.status).toMatchObject({ running: false, initialized: false });
  });
});
