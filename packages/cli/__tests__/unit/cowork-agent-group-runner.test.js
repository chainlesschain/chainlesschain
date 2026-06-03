import { describe, it, expect } from "vitest";
import { runPeerGroup } from "../../src/lib/cowork/agent-group-runner.js";
import { TASK_STATUS, RELATIONSHIPS } from "@chainlesschain/session-core";

describe("runPeerGroup", () => {
  it("requires peers[] and runPeer function", async () => {
    await expect(
      runPeerGroup({ peers: [], runPeer: () => {} }),
    ).rejects.toThrow(/peers/);
    await expect(runPeerGroup({ peers: [{ agentId: "a" }] })).rejects.toThrow(
      /runPeer/,
    );
  });

  it("creates a PEER AgentGroup with one task per peer and completes them on success", async () => {
    const res = await runPeerGroup({
      peers: [
        { agentId: "a", taskTitle: "A", payload: { n: 1 } },
        { agentId: "b", taskTitle: "B", payload: { n: 2 } },
      ],
      coordinator: { agentId: "mod" },
      runPeer: async (peer) => peer.payload.n * 10,
    });

    expect(res.groupId).toMatch(/^grp_/);
    expect(res.parentAgentId).toBe("mod");
    expect(res.members).toHaveLength(2);
    expect(
      res.members.every((m) => m.relationship === RELATIONSHIPS.PEER),
    ).toBe(true);
    expect(res.tasks).toHaveLength(2);
    expect(res.tasks.every((t) => t.status === TASK_STATUS.COMPLETED)).toBe(
      true,
    );
    expect(res.results.map((r) => r.value)).toEqual([10, 20]);
  });

  it("marks a peer's task BLOCKED when runPeer throws, without aborting siblings", async () => {
    const res = await runPeerGroup({
      peers: [
        { agentId: "ok", taskTitle: "OK" },
        { agentId: "bad", taskTitle: "BAD" },
      ],
      runPeer: async (peer) => {
        if (peer.agentId === "bad") throw new Error("boom");
        return "fine";
      },
    });

    const byAgent = Object.fromEntries(res.tasks.map((t) => [t.assignee, t]));
    expect(byAgent.ok.status).toBe(TASK_STATUS.COMPLETED);
    expect(byAgent.bad.status).toBe(TASK_STATUS.BLOCKED);
    expect(res.results.find((r) => r.peer.agentId === "bad").ok).toBe(false);
    expect(res.results.find((r) => r.peer.agentId === "ok").ok).toBe(true);
  });

  it("runs serially when mode='serial' (order preserved)", async () => {
    const started = [];
    const res = await runPeerGroup({
      peers: [
        { agentId: "p1", taskTitle: "T1" },
        { agentId: "p2", taskTitle: "T2" },
        { agentId: "p3", taskTitle: "T3" },
      ],
      mode: "serial",
      runPeer: async (peer) => {
        started.push(peer.agentId);
        await new Promise((r) => setTimeout(r, 1));
        return peer.agentId;
      },
    });
    expect(started).toEqual(["p1", "p2", "p3"]);
    expect(res.results.map((r) => r.value)).toEqual(["p1", "p2", "p3"]);
  });

  it("exposes taskList and group for audit/inspection", async () => {
    const res = await runPeerGroup({
      peers: [{ agentId: "only", taskTitle: "Only" }],
      runPeer: async () => "done",
    });
    expect(res.taskList.size()).toBe(1);
    expect(res.group.listPeers()).toHaveLength(1);
    expect(res.group.parentAgentId).toBe(null);
  });
});
