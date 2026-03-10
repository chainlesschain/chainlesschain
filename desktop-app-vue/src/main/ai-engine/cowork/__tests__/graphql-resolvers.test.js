import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { createResolvers } = require("../graphql-resolvers");

describe("GraphQL Resolvers", () => {
  let resolvers;
  let mockWebauthn;
  let mockZkpEngine;
  let mockZkpVC;
  let mockFlManager;
  let mockIpfsCluster;
  let mockGraphqlManager;

  beforeEach(() => {
    mockWebauthn = {
      initialized: true,
      listPasskeys: vi
        .fn()
        .mockReturnValue([{ id: "p1", credentialId: "cred-1" }]),
      beginRegistration: vi
        .fn()
        .mockResolvedValue({ ceremonyId: "c1", challenge: "ch1" }),
      completeRegistration: vi.fn().mockResolvedValue({ id: "p2" }),
      deletePasskey: vi.fn(),
      bindDID: vi.fn().mockReturnValue({ id: "p1", didBinding: "did:test:1" }),
      getStats: vi.fn().mockReturnValue({ totalPasskeys: 5 }),
    };

    mockZkpEngine = {
      initialized: true,
      getProof: vi.fn().mockReturnValue({ id: "proof1", status: "valid" }),
      listProofs: vi.fn().mockReturnValue([{ id: "proof1" }]),
      generateIdentityProof: vi.fn().mockResolvedValue({ id: "ip1" }),
      generateRangeProof: vi.fn().mockResolvedValue({ id: "rp1" }),
      getStats: vi.fn().mockReturnValue({ totalProofs: 10 }),
    };

    mockZkpVC = {
      initialized: true,
      listCredentials: vi.fn().mockReturnValue([{ id: "vc1" }]),
      issueCredential: vi.fn().mockReturnValue({ id: "vc2" }),
      revokeCredential: vi.fn(),
      getStats: vi.fn().mockReturnValue({ totalCredentials: 3 }),
    };

    mockFlManager = {
      initialized: true,
      listTasks: vi.fn().mockReturnValue([{ id: "fl1", status: "training" }]),
      getTaskStatus: vi
        .fn()
        .mockReturnValue({ id: "fl1", participants: [{ id: "p1" }] }),
      createTask: vi.fn().mockReturnValue({ id: "fl2" }),
      joinTask: vi.fn().mockReturnValue({ id: "par1" }),
      startTraining: vi.fn().mockResolvedValue({ taskId: "fl1", round: 1 }),
      getStats: vi.fn().mockReturnValue({ totalTasks: 2 }),
    };

    mockIpfsCluster = {
      initialized: true,
      listNodes: vi.fn().mockReturnValue([{ id: "node1" }]),
      getNodeStatus: vi.fn().mockReturnValue({ id: "node1", status: "online" }),
      checkHealth: vi.fn().mockReturnValue({
        healthy: 2,
        degraded: 0,
        offline: 0,
        totalNodes: 2,
        underReplicatedPins: 0,
      }),
      addNode: vi.fn().mockReturnValue({ id: "node2" }),
      removeNode: vi.fn(),
      listPins: vi.fn().mockReturnValue([{ id: "pin1" }]),
      getPinStatus: vi
        .fn()
        .mockReturnValue({ id: "pin1", pinStatus: "pinned" }),
      pinContent: vi.fn().mockReturnValue({ id: "pin2", cid: "Qm123" }),
      unpinContent: vi.fn(),
      rebalance: vi.fn().mockReturnValue({ moved: 3, duration: 100 }),
      getStats: vi.fn().mockReturnValue({ totalNodes: 2, totalPins: 5 }),
    };

    mockGraphqlManager = {
      initialized: true,
      listAPIKeys: vi.fn().mockReturnValue([{ id: "ak1", name: "test" }]),
      createAPIKey: vi.fn().mockReturnValue({ id: "ak2", key: "secret" }),
      revokeAPIKey: vi.fn(),
      getQueryLog: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({ totalApiKeys: 1, totalQueries: 50 }),
    };

    resolvers = createResolvers({
      webauthnManager: mockWebauthn,
      zkpEngine: mockZkpEngine,
      zkpVC: mockZkpVC,
      flManager: mockFlManager,
      ipfsClusterManager: mockIpfsCluster,
      graphqlManager: mockGraphqlManager,
    });
  });

  // ── Query resolvers ──

  describe("Query resolvers", () => {
    it("passkeys: returns empty array if not initialized", () => {
      const r = createResolvers({ webauthnManager: { initialized: false } });
      expect(r.passkeys({})).toEqual([]);
    });

    it("passkeys: delegates to webauthnManager.listPasskeys", () => {
      const result = resolvers.passkeys({});
      expect(mockWebauthn.listPasskeys).toHaveBeenCalled();
      expect(result).toEqual([{ id: "p1", credentialId: "cred-1" }]);
    });

    it("proof: returns null if not initialized", () => {
      const r = createResolvers({ zkpEngine: { initialized: false } });
      expect(r.proof({ id: "x" })).toBeNull();
    });

    it("proof: delegates to zkpEngine.getProof", () => {
      const result = resolvers.proof({ id: "proof1" });
      expect(mockZkpEngine.getProof).toHaveBeenCalledWith("proof1");
      expect(result).toEqual({ id: "proof1", status: "valid" });
    });

    it("credentials: returns empty if not initialized", () => {
      const r = createResolvers({ zkpVC: { initialized: false } });
      expect(r.credentials({ filter: {} })).toEqual([]);
    });

    it("flTasks: returns empty if not initialized", () => {
      const r = createResolvers({ flManager: { initialized: false } });
      expect(r.flTasks({ filter: {} })).toEqual([]);
    });

    it("flTasks: delegates to flManager.listTasks", () => {
      const result = resolvers.flTasks({ filter: {} });
      expect(mockFlManager.listTasks).toHaveBeenCalled();
      expect(result).toEqual([{ id: "fl1", status: "training" }]);
    });

    it("clusterNodes: returns empty if not initialized", () => {
      const r = createResolvers({ ipfsClusterManager: { initialized: false } });
      expect(r.clusterNodes({ filter: {} })).toEqual([]);
    });

    it("clusterNodes: delegates to ipfsClusterManager.listNodes", () => {
      const result = resolvers.clusterNodes({ filter: {} });
      expect(mockIpfsCluster.listNodes).toHaveBeenCalled();
      expect(result).toEqual([{ id: "node1" }]);
    });

    it("clusterHealth: returns zeroes if not initialized", () => {
      const r = createResolvers({ ipfsClusterManager: { initialized: false } });
      const result = r.clusterHealth();
      expect(result.healthy).toBe(0);
      expect(result.totalNodes).toBe(0);
    });

    it("stats: aggregates from all managers", () => {
      const result = resolvers.stats();
      expect(result.totalPasskeys).toBe(5);
      expect(result.totalProofs).toBe(10);
      expect(result.totalCredentials).toBe(3);
      expect(result.totalFLTasks).toBe(2);
      expect(result.totalClusterNodes).toBe(2);
      expect(result.totalApiKeys).toBe(1);
      expect(result.totalQueries).toBe(50);
    });

    it("apiKeys: delegates to graphqlManager", () => {
      const result = resolvers.apiKeys();
      expect(mockGraphqlManager.listAPIKeys).toHaveBeenCalled();
      expect(result).toEqual([{ id: "ak1", name: "test" }]);
    });
  });

  // ── Mutation resolvers ──

  describe("Mutation resolvers", () => {
    it("beginRegistration: delegates to webauthnManager", async () => {
      const result = await resolvers.beginRegistration({
        rpId: "rp.test",
        rpName: "Test RP",
        userId: "u1",
        userName: "alice",
      });
      expect(mockWebauthn.beginRegistration).toHaveBeenCalledWith(
        "rp.test",
        "Test RP",
        "u1",
        "alice",
      );
      expect(result).toEqual({ ceremonyId: "c1", challenge: "ch1" });
    });

    it("deletePasskey: returns true on success", () => {
      const result = resolvers.deletePasskey({ credentialId: "cred-1" });
      expect(mockWebauthn.deletePasskey).toHaveBeenCalledWith("cred-1");
      expect(result).toBe(true);
    });

    it("generateIdentityProof: parses claims JSON and delegates", async () => {
      const claims = JSON.stringify({ age: 18 });
      const result = await resolvers.generateIdentityProof({
        proverDid: "did:example:1",
        claims,
      });
      expect(mockZkpEngine.generateIdentityProof).toHaveBeenCalledWith(
        "did:example:1",
        { age: 18 },
      );
      expect(result).toEqual({ id: "ip1" });
    });

    it("issueCredential: delegates to zkpVC", () => {
      const claims = JSON.stringify({ role: "admin" });
      const result = resolvers.issueCredential({
        type: "Identity",
        issuerDid: "did:issuer:1",
        subjectDid: "did:sub:1",
        claims,
      });
      expect(mockZkpVC.issueCredential).toHaveBeenCalledWith({
        type: "Identity",
        issuerDid: "did:issuer:1",
        subjectDid: "did:sub:1",
        claims: { role: "admin" },
      });
      expect(result).toEqual({ id: "vc2" });
    });

    it("createFLTask: delegates to flManager", () => {
      const result = resolvers.createFLTask({
        name: "task1",
        modelType: "nn",
        strategy: "fedavg",
      });
      expect(mockFlManager.createTask).toHaveBeenCalledWith({
        name: "task1",
        modelType: "nn",
        aggregationStrategy: "fedavg",
      });
      expect(result).toEqual({ id: "fl2" });
    });

    it("addClusterNode: delegates to ipfsClusterManager", () => {
      const result = resolvers.addClusterNode({
        peerId: "peer-1",
        endpoint: "http://node:5001",
        region: "us",
      });
      expect(mockIpfsCluster.addNode).toHaveBeenCalledWith({
        peerId: "peer-1",
        endpoint: "http://node:5001",
        region: "us",
      });
      expect(result).toEqual({ id: "node2" });
    });

    it("pinContent: delegates to ipfsClusterManager", () => {
      const result = resolvers.pinContent({
        cid: "Qm123",
        name: "test",
        replicationFactor: 3,
      });
      expect(mockIpfsCluster.pinContent).toHaveBeenCalledWith({
        cid: "Qm123",
        name: "test",
        replicationFactor: 3,
      });
      expect(result).toEqual({ id: "pin2", cid: "Qm123" });
    });

    it("createAPIKey: delegates to graphqlManager", () => {
      const result = resolvers.createAPIKey({
        name: "new-key",
        permissions: ["query"],
      });
      expect(mockGraphqlManager.createAPIKey).toHaveBeenCalledWith("new-key", {
        permissions: ["query"],
      });
      expect(result).toEqual({ id: "ak2", key: "secret" });
    });
  });

  // ── Error handling ──

  describe("Error handling", () => {
    it("throws if webauthnManager not initialized (mutation)", async () => {
      const r = createResolvers({ webauthnManager: { initialized: false } });
      await expect(
        r.beginRegistration({
          rpId: "rp",
          rpName: "RP",
          userId: "u1",
          userName: "a",
        }),
      ).rejects.toThrow("not initialized");
    });

    it("throws if zkpEngine not initialized (mutation)", async () => {
      const r = createResolvers({ zkpEngine: { initialized: false } });
      await expect(
        r.generateIdentityProof({ proverDid: "d", claims: "{}" }),
      ).rejects.toThrow("not initialized");
    });

    it("returns empty array if flManager not initialized (query)", () => {
      const r = createResolvers({ flManager: { initialized: false } });
      const result = r.flTasks({ filter: {} });
      expect(result).toEqual([]);
    });

    it("returns empty array if ipfsClusterManager not initialized (query)", () => {
      const r = createResolvers({ ipfsClusterManager: { initialized: false } });
      const result = r.clusterNodes({ filter: {} });
      expect(result).toEqual([]);
    });
  });

  // ── Structure ──

  describe("Structure", () => {
    it("createResolvers returns an object", () => {
      expect(typeof resolvers).toBe("object");
      expect(resolvers).not.toBeNull();
    });

    it("resolvers have all expected query keys", () => {
      const expectedQueries = [
        "passkeys",
        "proof",
        "credentials",
        "flTasks",
        "clusterNodes",
        "clusterHealth",
        "stats",
        "apiKeys",
      ];
      for (const key of expectedQueries) {
        expect(typeof resolvers[key]).toBe("function");
      }
    });

    it("resolvers have all expected mutation keys", () => {
      const expectedMutations = [
        "beginRegistration",
        "deletePasskey",
        "generateIdentityProof",
        "issueCredential",
        "createFLTask",
        "addClusterNode",
        "pinContent",
        "createAPIKey",
      ];
      for (const key of expectedMutations) {
        expect(typeof resolvers[key]).toBe("function");
      }
    });
  });
});
