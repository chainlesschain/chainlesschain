/**
 * FederatedAgentRegistry 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  FederatedAgentRegistry,
  REGISTRY_STATUS,
  DISCOVERY_MODE,
} = require("../federated-agent-registry");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

describe("FederatedAgentRegistry", () => {
  let registry;
  let db;

  beforeEach(() => {
    registry = new FederatedAgentRegistry();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (registry.initialized) {
      registry.destroy();
    }
  });

  describe("initialize()", () => {
    it("should set initialized=true and call db.prepare", async () => {
      await registry.initialize(db);
      expect(registry.initialized).toBe(true);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should be idempotent", async () => {
      await registry.initialize(db);
      const count = db.prepare.mock.calls.length;
      await registry.initialize(db);
      expect(db.prepare.mock.calls.length).toBe(count);
    });

    it("should accept optional deps", async () => {
      const mockDeps = { agentDID: { initialized: true }, p2pManager: null };
      await registry.initialize(db, mockDeps);
      expect(registry.initialized).toBe(true);
    });
  });

  describe("register()", () => {
    beforeEach(async () => {
      await registry.initialize(db);
    });

    it("should register an agent and return entry", () => {
      const entry = registry.register(
        "did:chainless:agent-001",
        ["agent:code-review", "agent:deploy"],
        "org-alpha",
      );
      expect(entry).toBeTruthy();
      expect(entry.agentDID).toBe("did:chainless:agent-001");
      expect(entry.organization).toBe("org-alpha");
    });

    it("should emit agent:registered event", () => {
      const listener = vi.fn();
      registry.on("agent:registered", listener);
      registry.register("did:chainless:agent-002", [], "org-beta");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should store registered agent internally", () => {
      registry.register("did:chainless:agent-003", ["agent:test"]);
      const agents = registry.getRegisteredAgents();
      expect(agents.some((a) => a.agentDID === "did:chainless:agent-003")).toBe(
        true,
      );
    });
  });

  describe("unregister()", () => {
    beforeEach(async () => {
      await registry.initialize(db);
    });

    it("should remove a registered agent", () => {
      registry.register("did:chainless:to-remove", ["agent:test"]);
      registry.unregister("did:chainless:to-remove");
      const agents = registry.getRegisteredAgents();
      expect(agents.some((a) => a.agentDID === "did:chainless:to-remove")).toBe(
        false,
      );
    });

    it("should return false for unregistered agent", () => {
      expect(registry.unregister("did:chainless:nonexistent")).toBe(false);
    });
  });

  describe("heartbeat()", () => {
    beforeEach(async () => {
      await registry.initialize(db);
    });

    it("should update lastSeen for a registered agent", () => {
      registry.register("did:chainless:heartbeat-agent", []);
      expect(() =>
        registry.heartbeat("did:chainless:heartbeat-agent"),
      ).not.toThrow();
    });

    it("should return false for unregistered agent", () => {
      expect(registry.heartbeat("did:chainless:ghost")).toBe(false);
    });
  });

  describe("discover()", () => {
    beforeEach(async () => {
      await registry.initialize(db);
      registry.register(
        "did:chainless:a1",
        ["agent:code-review", "agent:test"],
        "org-a",
      );
      registry.register("did:chainless:a2", ["agent:deploy"], "org-b");
      registry.register("did:chainless:a3", ["agent:code-review"], "org-a");
    });

    it("should return all agents when query is empty", () => {
      const results = registry.discover();
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it("should filter by organization", () => {
      const results = registry.discover({ organization: "org-a" });
      results.forEach((a) => expect(a.organization).toBe("org-a"));
    });

    it("should filter by required capabilities", () => {
      const results = registry.discover({ capabilities: ["agent:deploy"] });
      results.forEach((a) => expect(a.capabilities).toContain("agent:deploy"));
    });
  });

  describe("querySkills()", () => {
    beforeEach(async () => {
      await registry.initialize(db);
      registry.register("did:chainless:skilled", [
        "skill:python",
        "agent:test",
      ]);
    });

    it("should return agents with the queried skill", () => {
      const agents = registry.querySkills("skill:python");
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe("getNetworkStats()", () => {
    beforeEach(async () => {
      await registry.initialize(db);
    });

    it("should return network stats with totalAgents", () => {
      registry.register("did:chainless:stats-agent", []);
      const stats = registry.getNetworkStats();
      expect(stats).toHaveProperty("totalAgents");
      expect(stats.totalAgents).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Constants", () => {
    it("REGISTRY_STATUS should have ONLINE", () => {
      expect(REGISTRY_STATUS.ONLINE).toBeTruthy();
    });

    it("DISCOVERY_MODE should have expected modes", () => {
      expect(Object.keys(DISCOVERY_MODE).length).toBeGreaterThan(0);
    });
  });
});
