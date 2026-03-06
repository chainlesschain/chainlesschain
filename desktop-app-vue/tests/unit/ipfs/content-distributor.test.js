import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let ContentDistributor, getContentDistributor;

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
  const mod = await import("../../../src/main/ipfs/content-distributor.js");
  ContentDistributor = mod.ContentDistributor;
  getContentDistributor = mod.getContentDistributor;
});

describe("ContentDistributor", () => {
  let distributor;
  beforeEach(() => {
    distributor = new ContentDistributor({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(distributor._versions).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await distributor.initialize();
      expect(distributor.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      distributor._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS content_versions");
    });
  });

  describe("distributeContent()", () => {
    it("should throw if cid is missing", async () => {
      await expect(distributor.distributeContent({})).rejects.toThrow(
        "CID is required",
      );
    });

    it("should distribute content", async () => {
      const result = await distributor.distributeContent({ cid: "Qm123abc" });
      expect(result.content_cid).toBe("Qm123abc");
      expect(result.version).toBe(1);
      expect(result.cached).toBe(1);
      expect(result.peer_count).toBe(3);
    });

    it("should persist to DB", async () => {
      await distributor.distributeContent({ cid: "Qm123" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should use custom peer count", async () => {
      const result = await distributor.distributeContent({
        cid: "Qm123",
        peerCount: 10,
      });
      expect(result.peer_count).toBe(10);
    });
  });

  describe("getVersionHistory()", () => {
    it("should throw if cid missing", async () => {
      await expect(distributor.getVersionHistory()).rejects.toThrow(
        "CID is required",
      );
    });

    it("should return version history from memory", async () => {
      const d = new ContentDistributor(null);
      d._versions.set("v1", { content_cid: "Qm1" });
      d._versions.set("v2", { content_cid: "Qm2" });
      const history = await d.getVersionHistory("Qm1");
      expect(history).toHaveLength(1);
      expect(history[0].content_cid).toBe("Qm1");
    });
  });

  describe("close()", () => {
    it("should clear versions", async () => {
      distributor._versions.set("v1", {});
      await distributor.close();
      expect(distributor._versions.size).toBe(0);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getContentDistributor();
      expect(instance).toBeInstanceOf(ContentDistributor);
    });
  });
});
