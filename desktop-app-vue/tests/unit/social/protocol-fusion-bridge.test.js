import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let ProtocolFusionBridge, getProtocolFusionBridge, PROTOCOL;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod =
    await import("../../../src/main/social/protocol-fusion-bridge.js");
  ProtocolFusionBridge = mod.ProtocolFusionBridge;
  getProtocolFusionBridge = mod.getProtocolFusionBridge;
  PROTOCOL = mod.PROTOCOL;
});

describe("ProtocolFusionBridge", () => {
  let bridge;
  beforeEach(() => {
    bridge = new ProtocolFusionBridge({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(bridge.initialized).toBe(false);
      expect(bridge._messages).toBeInstanceOf(Map);
      expect(bridge._identityMap).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      bridge._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS unified_messages");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS identity_mappings");
    });
  });

  describe("getUnifiedFeed()", () => {
    it("should return empty feed", async () => {
      const b = new ProtocolFusionBridge(null);
      const feed = await b.getUnifiedFeed();
      expect(feed).toHaveLength(0);
    });

    it("should filter by protocol", async () => {
      const b = new ProtocolFusionBridge(null);
      b._messages.set("m1", { source_protocol: "did" });
      b._messages.set("m2", { source_protocol: "nostr" });
      const feed = await b.getUnifiedFeed({ protocol: "did" });
      expect(feed).toHaveLength(1);
    });
  });

  describe("sendMessage()", () => {
    it("should throw if content is missing", async () => {
      await expect(bridge.sendMessage({})).rejects.toThrow(
        "Message content is required",
      );
    });

    it("should throw if sourceProtocol is missing", async () => {
      await expect(bridge.sendMessage({ content: "hello" })).rejects.toThrow(
        "Source protocol is required",
      );
    });

    it("should send message", async () => {
      const result = await bridge.sendMessage({
        content: "hello",
        sourceProtocol: "did",
      });
      expect(result.content).toBe("hello");
      expect(result.source_protocol).toBe("did");
      expect(result.routed).toBe(1);
    });

    it("should mark as converted for cross-protocol", async () => {
      const result = await bridge.sendMessage({
        content: "hi",
        sourceProtocol: "did",
        targetProtocol: "nostr",
      });
      expect(result.converted).toBe(1);
    });

    it("should persist to DB", async () => {
      await bridge.sendMessage({ content: "test", sourceProtocol: "did" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("mapIdentity()", () => {
    it("should throw if didId is missing", async () => {
      await expect(bridge.mapIdentity({})).rejects.toThrow(
        "DID ID is required",
      );
    });

    it("should map identity", async () => {
      const result = await bridge.mapIdentity({ didId: "did:example:123" });
      expect(result.did_id).toBe("did:example:123");
      expect(result.verified).toBe(0);
    });

    it("should persist to DB", async () => {
      await bridge.mapIdentity({ didId: "did:example:123" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("getIdentityMap()", () => {
    it("should return all mappings when no didId", async () => {
      bridge._identityMap.set("m1", { did_id: "did:1" });
      bridge._identityMap.set("m2", { did_id: "did:2" });
      const result = await bridge.getIdentityMap();
      expect(result).toHaveLength(2);
    });

    it("should return specific mapping by didId", async () => {
      bridge._identityMap.set("m1", { did_id: "did:1" });
      const result = await bridge.getIdentityMap("did:1");
      expect(result.did_id).toBe("did:1");
    });

    it("should return null for unknown didId", async () => {
      const result = await bridge.getIdentityMap("did:unknown");
      expect(result).toBeNull();
    });
  });

  describe("getProtocolStatus()", () => {
    it("should return status for all protocols", async () => {
      const status = await bridge.getProtocolStatus();
      expect(status).toHaveProperty("did");
      expect(status).toHaveProperty("activitypub");
      expect(status).toHaveProperty("nostr");
      expect(status).toHaveProperty("matrix");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      bridge._messages.set("m1", {});
      bridge._identityMap.set("i1", {});
      await bridge.close();
      expect(bridge._messages.size).toBe(0);
      expect(bridge._identityMap.size).toBe(0);
      expect(bridge.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getProtocolFusionBridge();
      expect(instance).toBeInstanceOf(ProtocolFusionBridge);
    });
  });
});
