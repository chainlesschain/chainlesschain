/**
 * useAgentNetworkStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: onlineAgents / agentsBySkill (parametric) / myReputation
 *    (no DID → 0, matched score) / tasksByStatus (parametric)
 *  - IPC actions (window.electronAPI.invoke mocked): createDID (set myDID /
 *    error), getAllDIDs (populate), revokeDID (chains getAllDIDs), discoverAgents
 *    (populate / error)
 *
 * NB: store calls (window as any).electronAPI.invoke directly, so we stub
 * window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useAgentNetworkStore } from "../agentNetwork";
import type { AgentDID, DiscoveredAgent, RemoteTask } from "../agentNetwork";

const mockInvoke = vi.fn();

function did(d: string): AgentDID {
  return {
    did: d,
    publicKey: "pk",
    skills: [],
    status: "active",
    createdAt: "2026-01-01",
  };
}

function agent(
  d: string,
  overrides: Partial<DiscoveredAgent> = {},
): DiscoveredAgent {
  return {
    did: d,
    name: `A ${d}`,
    skills: [],
    reputation: 0,
    online: true,
    lastSeen: "2026-01-01",
    ...overrides,
  };
}

function task(id: string, status: RemoteTask["status"]): RemoteTask {
  return {
    id,
    type: "exec",
    targetAgent: "did:t",
    status,
    input: {},
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

describe("useAgentNetworkStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useAgentNetworkStore();
      expect(store.myDID).toBeNull();
      expect(store.allDIDs).toEqual([]);
      expect(store.discoveredAgents).toEqual([]);
      expect(store.remoteTasks).toEqual([]);
      expect(store.networkStats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("onlineAgents filters online === true", () => {
      const store = useAgentNetworkStore();
      store.discoveredAgents = [
        agent("a", { online: true }),
        agent("b", { online: false }),
        agent("c", { online: true }),
      ];
      expect(store.onlineAgents.map((a) => a.did)).toEqual(["a", "c"]);
    });

    it("agentsBySkill filters by skill membership", () => {
      const store = useAgentNetworkStore();
      store.discoveredAgents = [
        agent("a", { skills: ["nlp", "vision"] }),
        agent("b", { skills: ["vision"] }),
        agent("c", { skills: ["nlp"] }),
      ];
      expect(store.agentsBySkill("nlp").map((a) => a.did)).toEqual(["a", "c"]);
      expect(store.agentsBySkill("audio")).toEqual([]);
    });

    it("myReputation is 0 without a DID and the matched score otherwise", () => {
      const store = useAgentNetworkStore();
      expect(store.myReputation).toBe(0);
      store.myDID = did("did:me");
      store.reputationScores = [
        { did: "did:other", score: 10, taskCount: 1, successRate: 1 },
        { did: "did:me", score: 87, taskCount: 5, successRate: 0.9 },
      ];
      expect(store.myReputation).toBe(87);
    });

    it("tasksByStatus filters remoteTasks by status", () => {
      const store = useAgentNetworkStore();
      store.remoteTasks = [
        task("t1", "running"),
        task("t2", "completed"),
        task("t3", "running"),
      ];
      expect(store.tasksByStatus("running").map((t) => t.id)).toEqual([
        "t1",
        "t3",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("createDID stores myDID on success", async () => {
      const store = useAgentNetworkStore();
      mockInvoke.mockResolvedValue({ success: true, data: did("did:new") });
      const result = await store.createDID({ algo: "ed25519" });
      expect(mockInvoke).toHaveBeenCalledWith("agent-did:create", {
        algo: "ed25519",
      });
      expect(store.myDID?.did).toBe("did:new");
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it("createDID records the error on failure", async () => {
      const store = useAgentNetworkStore();
      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      await store.createDID();
      expect(store.error).toBe("denied");
      expect(store.myDID).toBeNull();
    });

    it("getAllDIDs populates allDIDs", async () => {
      const store = useAgentNetworkStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [did("did:a"), did("did:b")],
      });
      await store.getAllDIDs();
      expect(mockInvoke).toHaveBeenCalledWith("agent-did:get-all");
      expect(store.allDIDs.map((d) => d.did)).toEqual(["did:a", "did:b"]);
    });

    it("revokeDID chains getAllDIDs on success", async () => {
      const store = useAgentNetworkStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // revoke
        .mockResolvedValueOnce({ success: true, data: [did("did:a")] }); // get-all
      await store.revokeDID("did:b");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "agent-did:revoke",
        "did:b",
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "agent-did:get-all");
      expect(store.allDIDs.map((d) => d.did)).toEqual(["did:a"]);
    });

    it("discoverAgents populates on success and records errors", async () => {
      const store = useAgentNetworkStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [agent("a"), agent("b")],
      });
      await store.discoverAgents({ skill: "nlp" });
      expect(mockInvoke).toHaveBeenCalledWith("fed-registry:discover", {
        skill: "nlp",
      });
      expect(store.discoveredAgents.map((a) => a.did)).toEqual(["a", "b"]);

      mockInvoke.mockResolvedValue({ success: false, error: "offline" });
      await store.discoverAgents();
      expect(store.error).toBe("offline");
    });
  });

  // -------------------------------------------------------------------------
  // initEventListeners — bind-once guard (listener-leak regression)
  // -------------------------------------------------------------------------

  describe("initEventListeners", () => {
    it("binds each IPC listener only once across repeated calls", async () => {
      // Regression: every page using this store calls initEventListeners() in
      // onMounted with no onUnmounted teardown, and the generic electronAPI.on
      // returns no unsubscribe — so repeated mounts accumulated duplicate
      // 'agent-network:*' listeners. A module-level guard must bind once only.
      // Fresh module import resets that module-level flag deterministically.
      vi.resetModules();
      const on = vi.fn();
      (window as any).electronAPI = { invoke: mockInvoke, on };
      const mod = await import("../agentNetwork");
      setActivePinia(createPinia());
      const store = mod.useAgentNetworkStore();

      store.initEventListeners();
      store.initEventListeners();
      store.initEventListeners();

      // two distinct events, each bound exactly once — not 6 registrations
      expect(on).toHaveBeenCalledTimes(2);
      expect(on).toHaveBeenCalledWith(
        "agent-network:agent-discovered",
        expect.any(Function),
      );
      expect(on).toHaveBeenCalledWith(
        "agent-network:task-updated",
        expect.any(Function),
      );
    });
  });
});
