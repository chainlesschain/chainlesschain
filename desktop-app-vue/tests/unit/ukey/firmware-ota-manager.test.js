import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-firmware-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let FirmwareOTAManager, getFirmwareOTAManager, UPDATE_CHANNELS, UPDATE_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod = await import("../../../src/main/ukey/firmware-ota-manager.js");
  FirmwareOTAManager = mod.FirmwareOTAManager;
  getFirmwareOTAManager = mod.getFirmwareOTAManager;
  UPDATE_CHANNELS = mod.UPDATE_CHANNELS;
  UPDATE_STATUS = mod.UPDATE_STATUS;
});

describe("UPDATE_CHANNELS constants", () => {
  it("should have stable, beta, nightly", () => {
    expect(UPDATE_CHANNELS.STABLE).toBe("stable");
    expect(UPDATE_CHANNELS.BETA).toBe("beta");
    expect(UPDATE_CHANNELS.NIGHTLY).toBe("nightly");
  });
});

describe("UPDATE_STATUS constants", () => {
  it("should define all statuses", () => {
    expect(UPDATE_STATUS.AVAILABLE).toBe("available");
    expect(UPDATE_STATUS.DOWNLOADING).toBe("downloading");
    expect(UPDATE_STATUS.COMPLETED).toBe("completed");
    expect(UPDATE_STATUS.FAILED).toBe("failed");
    expect(UPDATE_STATUS.ROLLED_BACK).toBe("rolled_back");
  });
});

describe("FirmwareOTAManager", () => {
  let manager;

  beforeEach(() => {
    manager = new FirmwareOTAManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._versions).toBeInstanceOf(Map);
      expect(manager._currentUpdate).toBeNull();
      expect(manager._channel).toBe("stable");
      expect(manager._chunkSize).toBe(65536);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should call _ensureTables", async () => {
      const spy = vi.spyOn(manager, "_ensureTables");
      await manager.initialize();
      expect(spy).toHaveBeenCalled();
    });

    it("should load versions from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        { id: "v1", version: "1.0.0", channel: "stable" },
      ]);
      await manager.initialize();
      expect(manager._versions.size).toBe(1);
    });
  });

  describe("_ensureTables()", () => {
    it("should create firmware tables", () => {
      manager._ensureTables();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS firmware_versions");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS firmware_update_log");
    });

    it("should not throw if database is null", () => {
      const m = new FirmwareOTAManager(null);
      expect(() => m._ensureTables()).not.toThrow();
    });
  });

  describe("checkUpdates()", () => {
    it("should return update info", async () => {
      const result = await manager.checkUpdates();
      expect(result.hasUpdate).toBe(true);
      expect(result.currentVersion).toBe("1.0.0");
      expect(result.availableUpdate).toBeDefined();
      expect(result.availableUpdate.version).toBe("2.0.0");
    });

    it("should use specified channel", async () => {
      const result = await manager.checkUpdates({ channel: "beta" });
      expect(result.availableUpdate.channel).toBe("beta");
    });

    it("should store version in DB", async () => {
      await manager.checkUpdates();
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should add version to internal Map", async () => {
      await manager.checkUpdates();
      expect(manager._versions.size).toBe(1);
    });
  });

  describe("listVersions()", () => {
    it("should return versions from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        { id: "v1", version: "1.0.0", channel: "stable" },
        { id: "v2", version: "2.0.0", channel: "stable" },
      ]);
      const versions = await manager.listVersions();
      expect(versions).toHaveLength(2);
    });

    it("should filter by channel from in-memory", async () => {
      manager._versions.set("v1", { id: "v1", channel: "stable" });
      manager._versions.set("v2", { id: "v2", channel: "beta" });
      // Force fallback to in-memory by using null DB
      const m = new FirmwareOTAManager(null);
      m._versions = manager._versions;
      const versions = await m.listVersions({ channel: "stable" });
      expect(versions).toHaveLength(1);
    });
  });

  describe("startUpdate()", () => {
    it("should throw if versionId is missing", async () => {
      await expect(manager.startUpdate({})).rejects.toThrow(
        "Version ID is required",
      );
    });

    it("should throw if version not found", async () => {
      await expect(
        manager.startUpdate({ versionId: "nonexistent" }),
      ).rejects.toThrow("Version not found");
    });

    it("should throw if another update is in progress", async () => {
      manager._versions.set("v1", { id: "v1", version: "2.0.0" });
      manager._currentUpdate = { id: "existing" };
      await expect(manager.startUpdate({ versionId: "v1" })).rejects.toThrow(
        "Another update is already in progress",
      );
    });

    it("should complete update successfully", async () => {
      manager._versions.set("v1", { id: "v1", version: "2.0.0" });
      const result = await manager.startUpdate({ versionId: "v1" });
      expect(result.status).toBe("completed");
      expect(result.progress).toBe(100);
      expect(manager._currentUpdate).toBeNull();
    });
  });

  describe("getHistory()", () => {
    it("should return history from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        { id: "u1", version: "2.0.0", status: "completed" },
      ]);
      const history = await manager.getHistory();
      expect(history).toHaveLength(1);
    });

    it("should return empty array when no DB", async () => {
      const m = new FirmwareOTAManager(null);
      const history = await m.getHistory();
      expect(history).toEqual([]);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._versions.set("v1", { id: "v1" });
      await manager.close();
      expect(manager._versions.size).toBe(0);
      expect(manager._currentUpdate).toBeNull();
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getFirmwareOTAManager singleton", () => {
    it("should return an instance", () => {
      const instance = getFirmwareOTAManager();
      expect(instance).toBeInstanceOf(FirmwareOTAManager);
    });
  });
});
