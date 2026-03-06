import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let SatelliteComm, getSatelliteComm;

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
  const mod = await import("../../../src/main/security/satellite-comm.js");
  SatelliteComm = mod.SatelliteComm;
  getSatelliteComm = mod.getSatelliteComm;
});

describe("SatelliteComm", () => {
  let comm;
  beforeEach(() => {
    comm = new SatelliteComm({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(comm.initialized).toBe(false);
      expect(comm._messages).toBeInstanceOf(Map);
      expect(comm._signatureQueue).toHaveLength(0);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await comm.initialize();
      expect(comm.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      comm._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS satellite_messages");
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS offline_signature_queue",
      );
    });
  });

  describe("sendMessage()", () => {
    it("should throw if content is missing", async () => {
      await expect(comm.sendMessage({})).rejects.toThrow(
        "Message content is required",
      );
    });

    it("should send message", async () => {
      const result = await comm.sendMessage({ content: "hello satellite" });
      expect(result.status).toBe("sent");
      expect(result.satellite_provider).toBe("iridium");
      expect(result.content_encrypted).toContain("enc_");
    });

    it("should persist to DB", async () => {
      await comm.sendMessage({ content: "test" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("getMessages()", () => {
    it("should return empty messages", async () => {
      const c = new SatelliteComm(null);
      const msgs = await c.getMessages();
      expect(msgs).toHaveLength(0);
    });
  });

  describe("syncSignatures()", () => {
    it("should sync pending signatures", async () => {
      comm._signatureQueue.push({ status: "pending" }, { status: "pending" });
      const result = await comm.syncSignatures();
      expect(result.synced).toBe(2);
      expect(result.remaining).toBe(0);
    });

    it("should return zero when no pending", async () => {
      const result = await comm.syncSignatures();
      expect(result.synced).toBe(0);
    });
  });

  describe("emergencyRevoke()", () => {
    it("should throw if keyId missing", async () => {
      await expect(comm.emergencyRevoke()).rejects.toThrow(
        "Key ID is required",
      );
    });

    it("should revoke key", async () => {
      const result = await comm.emergencyRevoke("key-123");
      expect(result.keyId).toBe("key-123");
      expect(result.revoked).toBe(true);
      expect(result.provider).toBe("iridium");
    });
  });

  describe("getRecoveryStatus()", () => {
    it("should return recovery status", async () => {
      const status = await comm.getRecoveryStatus();
      expect(status.offlineSignatures).toBe(0);
      expect(status.pendingSync).toBe(0);
      expect(status).toHaveProperty("lastSyncAt");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      comm._messages.set("m1", {});
      comm._signatureQueue.push({});
      await comm.close();
      expect(comm._messages.size).toBe(0);
      expect(comm._signatureQueue).toHaveLength(0);
      expect(comm.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getSatelliteComm();
      expect(instance).toBeInstanceOf(SatelliteComm);
    });
  });
});
