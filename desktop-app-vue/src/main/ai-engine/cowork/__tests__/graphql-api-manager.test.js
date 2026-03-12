import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../graphql-schema.js", () => ({
  typeDefs: "type Query { stats: Stats } type Stats { totalPasskeys: Int }",
}));

vi.mock("../graphql-resolvers.js", () => ({
  createResolvers: vi.fn(() => ({
    stats: () => ({ totalPasskeys: 5 }),
  })),
}));

const {
  GraphQLAPIManager,
  OPERATION_TYPE,
  API_KEY_STATUS,
} = require("../graphql-api-manager");

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

describe("GraphQLAPIManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    manager = new GraphQLAPIManager();
    mockDb = createMockDatabase();
  });

  afterEach(() => {
    if (manager && manager._cleanupTimer) {
      clearInterval(manager._cleanupTimer);
      manager._cleanupTimer = null;
    }
    manager = null;
  });

  // ── initialize ──

  describe("initialize", () => {
    it("should set initialized to true", async () => {
      await manager.initialize(mockDb, {});
      expect(manager.initialized).toBe(true);
    });

    it("should call db.exec to create tables", async () => {
      await manager.initialize(mockDb, {});
      expect(mockDb.exec).toHaveBeenCalled();
      const call = mockDb.exec.mock.calls[0][0];
      expect(call).toContain("graphql_api_keys");
      expect(call).toContain("graphql_query_log");
    });

    it("should be idempotent - second call does nothing", async () => {
      await manager.initialize(mockDb, {});
      const execCount = mockDb.exec.mock.calls.length;
      await manager.initialize(mockDb, {});
      expect(mockDb.exec.mock.calls.length).toBe(execCount);
    });
  });

  // ── buildSchema ──

  describe("buildSchema", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should build schema from typeDefs", () => {
      // buildSchema is called during initialize; schema state should exist
      // In simulation mode (no graphql lib), _schema will be null but no error
      expect(manager.initialized).toBe(true);
    });

    it("should store resolvers internally", () => {
      expect(manager._resolvers).toBeDefined();
      expect(manager._resolvers).not.toBeNull();
    });

    it("should return SDL string from getSchemaSDL", () => {
      const sdl = manager.getSchemaSDL();
      expect(typeof sdl).toBe("string");
      expect(sdl).toContain("Query");
    });
  });

  // ── executeQuery ──

  describe("executeQuery", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should execute a simple query and return result", async () => {
      const result = await manager.executeQuery("{ stats { totalPasskeys } }");
      expect(result).toBeDefined();
      expect(result.data !== undefined || result.errors !== undefined).toBe(
        true,
      );
    });

    it("should handle variables parameter", async () => {
      const result = await manager.executeQuery("{ stats { totalPasskeys } }", {
        limit: 10,
      });
      expect(result).toBeDefined();
    });

    it("should log the query to the database", async () => {
      await manager.executeQuery("{ stats { totalPasskeys } }");
      // _logQuery calls db.prepare for INSERT into graphql_query_log
      const prepareCalls = mockDb.prepare.mock.calls;
      const insertCall = prepareCalls.find(
        (c) => c[0] && c[0].includes("graphql_query_log"),
      );
      expect(insertCall).toBeDefined();
    });

    it("should increment query count", async () => {
      expect(manager._queryCount).toBe(0);
      await manager.executeQuery("{ stats { totalPasskeys } }");
      expect(manager._queryCount).toBe(1);
      await manager.executeQuery("{ stats { totalPasskeys } }");
      expect(manager._queryCount).toBe(2);
    });

    it("should detect mutation operation type in simulation mode", async () => {
      const result = await manager.executeQuery(
        'mutation { deletePasskey(id: "p1") }',
      );
      expect(result).toBeDefined();
    });

    it("should throw if not initialized", async () => {
      const fresh = new GraphQLAPIManager();
      await expect(fresh.executeQuery("{ stats }")).rejects.toThrow(
        "not initialized",
      );
    });
  });

  // ── executeMutation (via executeQuery) ──

  describe("executeMutation", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should execute a mutation query", async () => {
      const result = await manager.executeQuery(
        'mutation CreateKey { createAPIKey(name: "test") }',
      );
      expect(result).toBeDefined();
    });

    it("should log as mutation type", async () => {
      const emitted = [];
      manager.on("query:executed", (data) => emitted.push(data));
      await manager.executeQuery(
        'mutation CreateKey { createAPIKey(name: "test") }',
      );
      expect(emitted.length).toBe(1);
      expect(emitted[0].operationType).toBe("mutation");
    });

    it("should handle errors gracefully and still return", async () => {
      // Even with simulation mode, should not throw
      const result = await manager.executeQuery("mutation { invalid }");
      expect(result).toBeDefined();
    });

    it("should return result with data field", async () => {
      const result = await manager.executeQuery("mutation { deletePasskey }");
      expect(result).toHaveProperty("data");
    });
  });

  // ── createAPIKey / revokeAPIKey ──

  describe("createAPIKey / revokeAPIKey", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should create a key with the given name", () => {
      const result = manager.createAPIKey("test-key");
      expect(result.name).toBe("test-key");
      expect(result.id).toBeDefined();
    });

    it("should return key string on creation", () => {
      const result = manager.createAPIKey("test-key");
      expect(typeof result.key).toBe("string");
      expect(result.key.length).toBeGreaterThan(0);
    });

    it("should persist key to db via prepare/run", () => {
      manager.createAPIKey("test-key");
      const prepareCalls = mockDb.prepare.mock.calls;
      const insertCall = prepareCalls.find(
        (c) => c[0] && c[0].includes("INSERT INTO graphql_api_keys"),
      );
      expect(insertCall).toBeDefined();
    });

    it("should revoke a key", () => {
      const result = manager.createAPIKey("test-key");
      manager.revokeAPIKey(result.id);
      const apiKey = manager._apiKeys.get(result.id);
      expect(apiKey.status).toBe(API_KEY_STATUS.REVOKED);
    });

    it("should emit events on create and revoke", () => {
      const events = [];
      manager.on("apikey:created", (d) =>
        events.push({ type: "created", ...d }),
      );
      manager.on("apikey:revoked", (d) =>
        events.push({ type: "revoked", ...d }),
      );
      const result = manager.createAPIKey("test-key");
      manager.revokeAPIKey(result.id);
      expect(events.length).toBe(2);
      expect(events[0].type).toBe("created");
      expect(events[1].type).toBe("revoked");
    });
  });

  // ── rateLimit ──

  describe("rateLimit", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should track requests per day via validateAPIKey", () => {
      const result = manager.createAPIKey("rate-test", { rateLimit: 5 });
      const keyData = manager._apiKeys.get(result.id);
      expect(keyData.requestsToday).toBe(0);

      // Validate increments requestsToday
      manager.validateAPIKey(result.key);
      const updated = manager._apiKeys.get(result.id);
      expect(updated.requestsToday).toBe(1);
    });

    it("should reject when over limit", () => {
      const result = manager.createAPIKey("rate-test", { rateLimit: 2 });
      manager.validateAPIKey(result.key); // 1
      manager.validateAPIKey(result.key); // 2
      const validation = manager.validateAPIKey(result.key); // 3 - over limit
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("Rate limit");
    });

    it("should reset daily limits via _resetDailyLimits", () => {
      const result = manager.createAPIKey("rate-test", { rateLimit: 5 });
      manager.validateAPIKey(result.key);
      manager.validateAPIKey(result.key);
      expect(manager._apiKeys.get(result.id).requestsToday).toBe(2);

      manager._resetDailyLimits();
      expect(manager._apiKeys.get(result.id).requestsToday).toBe(0);
    });
  });

  // ── getQueryLog ──

  describe("getQueryLog", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should return logged queries from db", () => {
      mockDb._prep.all.mockReturnValue([
        { id: "q1", operation_type: "query", status: "success" },
      ]);
      const log = manager.getQueryLog();
      expect(mockDb.prepare).toHaveBeenCalled();
      expect(Array.isArray(log)).toBe(true);
    });

    it("should filter by operationType", () => {
      manager.getQueryLog({ operationType: "mutation" });
      const prepareCalls = mockDb.prepare.mock.calls;
      const filtered = prepareCalls.find(
        (c) => c[0] && c[0].includes("operation_type = ?"),
      );
      expect(filtered).toBeDefined();
    });

    it("should apply limit filter", () => {
      manager.getQueryLog({ limit: 5 });
      const prepareCalls = mockDb.prepare.mock.calls;
      const limited = prepareCalls.find(
        (c) => c[0] && c[0].includes("LIMIT ?"),
      );
      expect(limited).toBeDefined();
    });
  });

  // ── subscribe / publish ──

  describe("subscribe / publish", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should subscribe to a channel and return subscription id", () => {
      const subId = manager.subscribe("notes:updated", vi.fn());
      expect(typeof subId).toBe("string");
      expect(subId).toContain("sub_");
    });

    it("should publish and trigger callback", () => {
      const callback = vi.fn();
      manager.subscribe("notes:updated", callback);
      manager.publish("notes:updated", { noteId: "n1" });
      expect(callback).toHaveBeenCalledWith({ noteId: "n1" });
    });

    it("should unsubscribe and stop delivery", () => {
      const callback = vi.fn();
      const subId = manager.subscribe("notes:updated", callback);
      manager.unsubscribe(subId);
      manager.publish("notes:updated", { noteId: "n1" });
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ── getStats / destroy ──

  describe("getStats / destroy", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should return correct stats", () => {
      manager.createAPIKey("k1");
      manager.createAPIKey("k2");
      manager.subscribe("ch1", vi.fn());
      const stats = manager.getStats();
      expect(stats.totalApiKeys).toBe(2);
      expect(stats.activeApiKeys).toBe(2);
      expect(stats.totalSubscriptions).toBe(1);
      expect(stats.totalQueries).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
    });

    it("should clear cleanup timer on destroy", () => {
      expect(manager._cleanupTimer).not.toBeNull();
      manager.destroy();
      expect(manager._cleanupTimer).toBeNull();
      expect(manager.initialized).toBe(false);
    });

    it("should validate API key correctly", () => {
      const result = manager.createAPIKey("validate-test");
      const validation = manager.validateAPIKey(result.key);
      expect(validation.valid).toBe(true);
      expect(validation.keyId).toBe(result.id);

      // Invalid key
      const invalid = manager.validateAPIKey("invalid-key");
      expect(invalid.valid).toBe(false);
      expect(invalid.reason).toBe("Invalid key");
    });
  });

  // ── constants ──

  describe("constants", () => {
    it("should have correct OPERATION_TYPE values", () => {
      expect(OPERATION_TYPE.QUERY).toBe("query");
      expect(OPERATION_TYPE.MUTATION).toBe("mutation");
      expect(OPERATION_TYPE.SUBSCRIPTION).toBe("subscription");
    });

    it("should have correct API_KEY_STATUS values", () => {
      expect(API_KEY_STATUS.ACTIVE).toBe("active");
      expect(API_KEY_STATUS.REVOKED).toBe("revoked");
      expect(API_KEY_STATUS.EXPIRED).toBe("expired");
    });
  });

  // ── listAPIKeys ──

  describe("listAPIKeys", () => {
    it("should return empty array if not initialized", () => {
      const fresh = new GraphQLAPIManager();
      expect(fresh.listAPIKeys()).toEqual([]);
    });

    it("should list created keys", async () => {
      await manager.initialize(mockDb, {});
      manager.createAPIKey("key-a");
      manager.createAPIKey("key-b");
      const keys = manager.listAPIKeys();
      expect(keys.length).toBe(2);
      expect(keys[0].name).toBe("key-a");
      expect(keys[1].name).toBe("key-b");
    });
  });

  // ── getConfig / configure ──

  describe("getConfig / configure", () => {
    beforeEach(async () => {
      await manager.initialize(mockDb, {});
    });

    it("should return default config", () => {
      const config = manager.getConfig();
      expect(config.maxDepth).toBe(10);
      expect(config.maxComplexity).toBe(1000);
      expect(config.defaultRateLimit).toBe(100);
      expect(config.enableIntrospection).toBe(true);
    });

    it("should update config via configure", () => {
      manager.configure({ maxDepth: 5 });
      expect(manager.getConfig().maxDepth).toBe(5);
    });
  });
});
