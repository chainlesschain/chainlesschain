/**
 * CloudBackupManager unit tests
 *
 * Instance-property injection is used for _storage (BackupStorageAdapter) because
 * server.deps.inline bundles all src/main modules, preventing vi.mock() from
 * intercepting top-level CJS require() calls at runtime.
 *
 * encryptBackup (scrypt N=32768) and splitSecret/reconstructSecret run for real.
 * Each createBackup call ≈ 500 ms (one scrypt). Tests are written to accept this.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { CloudBackupManager } = require("../cloud-backup-manager");

// ── shared storage mock factory ───────────────────────────────────────────────

function makeStorageMock() {
  return {
    store: vi
      .fn()
      .mockResolvedValue({ backend: "local", location: "/tmp/test_shard" }),
    list: vi.fn().mockResolvedValue([]),
    retrieve: vi.fn(),
    delete: vi.fn().mockResolvedValue(1),
  };
}

let manager;
let mockStorage;

beforeEach(() => {
  mockStorage = makeStorageMock();
  manager = new CloudBackupManager();
  // Inject mock storage to avoid real filesystem I/O
  manager._storage = mockStorage;
});

// ── createBackup ──────────────────────────────────────────────────────────────

describe("CloudBackupManager.createBackup", () => {
  it("returns { backupId, shardsStored, strategy }", async () => {
    const result = await manager.createBackup(Buffer.from("key"), "pass");
    expect(typeof result.backupId).toBe("string");
    expect(result.shardsStored).toBe(3);
    expect(result.strategy).toBe("standard");
  });

  it('emits "backup-created" event with metadata', async () => {
    const events = [];
    manager.on("backup-created", (e) => events.push(e));
    await manager.createBackup(Buffer.from("key"), "pass");
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveProperty("id");
    expect(events[0].strategy).toBe("standard");
    expect(events[0].threshold).toBe(2);
  });

  it("calls storage.store 3 times (one per shard, standard strategy)", async () => {
    await manager.createBackup(Buffer.from("key"), "pass");
    expect(mockStorage.store).toHaveBeenCalledTimes(3);
  });

  it('strategy "standard" produces threshold=2 in backup metadata', async () => {
    const events = [];
    manager.on("backup-created", (e) => events.push(e));
    await manager.createBackup(Buffer.from("key"), "pass", {
      strategy: "standard",
    });
    expect(events[0].shardsTotal).toBe(3);
    expect(events[0].threshold).toBe(2);
  });

  it("backup appears in listBackups() after creation", async () => {
    const { backupId } = await manager.createBackup(Buffer.from("key"), "pass");
    const list = await manager.listBackups();
    expect(list.some((b) => b.id === backupId)).toBe(true);
  });
});

// ── listBackups ───────────────────────────────────────────────────────────────

describe("CloudBackupManager.listBackups", () => {
  it("returns empty array initially", async () => {
    expect(await manager.listBackups()).toEqual([]);
  });

  it("returns all created backups", async () => {
    await manager.createBackup(Buffer.from("k1"), "p1");
    await manager.createBackup(Buffer.from("k2"), "p2");
    expect(await manager.listBackups()).toHaveLength(2);
  });
});

// ── verifyBackup ──────────────────────────────────────────────────────────────

describe("CloudBackupManager.verifyBackup", () => {
  it("returns { ok: true } when shards ≥ threshold", async () => {
    mockStorage.list.mockResolvedValue([
      { shardIndex: 0, backend: "local", location: "/tmp/0" },
      { shardIndex: 1, backend: "local", location: "/tmp/1" },
      { shardIndex: 2, backend: "local", location: "/tmp/2" },
    ]);
    const { backupId } = await manager.createBackup(Buffer.from("key"), "pass");
    const result = await manager.verifyBackup(backupId);
    expect(result.ok).toBe(true);
    expect(result.shardsFound).toBe(3);
  });

  it("returns { ok: false } when shards < threshold", async () => {
    mockStorage.list.mockResolvedValue([
      { shardIndex: 0, backend: "local", location: "/tmp/0" },
    ]);
    const { backupId } = await manager.createBackup(Buffer.from("key"), "pass");
    const result = await manager.verifyBackup(backupId);
    expect(result.ok).toBe(false);
  });
});

// ── deleteBackup ──────────────────────────────────────────────────────────────

describe("CloudBackupManager.deleteBackup", () => {
  it("removes backup from listBackups()", async () => {
    const { backupId } = await manager.createBackup(Buffer.from("key"), "pass");
    await manager.deleteBackup(backupId);
    expect((await manager.listBackups()).some((b) => b.id === backupId)).toBe(
      false,
    );
  });

  it("calls storage.delete with backupId", async () => {
    const { backupId } = await manager.createBackup(Buffer.from("key"), "pass");
    await manager.deleteBackup(backupId);
    expect(mockStorage.delete).toHaveBeenCalledWith(backupId);
  });

  it('emits "backup-deleted" event', async () => {
    const { backupId } = await manager.createBackup(Buffer.from("key"), "pass");
    const events = [];
    manager.on("backup-deleted", (e) => events.push(e));
    await manager.deleteBackup(backupId);
    expect(events[0].backupId).toBe(backupId);
  });
});

// ── restoreBackup ─────────────────────────────────────────────────────────────

describe("CloudBackupManager.restoreBackup", () => {
  it("returns reconstructed data on success", async () => {
    const rawData = Buffer.from("restore-test-data");
    const pass = "restore-pass";

    // Run a real createBackup — captures actual encrypted shares in store mock
    const { backupId } = await manager.createBackup(rawData, pass);

    // Extract shares from store mock calls: store(backupId, shardIndex, shareString, backend)
    const storedShares = mockStorage.store.mock.calls.map((call) => call[2]);

    // Set up list to return shard descriptors matching the stored shards
    mockStorage.list.mockResolvedValue(
      storedShares.map((_, i) => ({
        shardIndex: i,
        backend: "local",
        location: `/tmp/${i}`,
      })),
    );

    // Set up retrieve to return the corresponding share by shard index
    mockStorage.retrieve.mockImplementation((_id, shardIndex) =>
      Promise.resolve(storedShares[shardIndex]),
    );

    const result = await manager.restoreBackup(backupId, pass);
    expect(result.equals(rawData)).toBe(true);
  });

  it("throws when no shards found", async () => {
    mockStorage.list.mockResolvedValue([]);
    await expect(
      manager.restoreBackup("nonexistent-id", "pass"),
    ).rejects.toThrow("No shards found");
  });
});
