/**
 * CloudBackupManager unit tests
 *
 * Instance-property injection is used for _storage (BackupStorageAdapter) because
 * server.deps.inline bundles all src/main modules, preventing vi.mock() from
 * intercepting top-level CJS require() calls at runtime.
 *
 * encryptBackup (scrypt N=32768, ~32 MB per call) and shamir-split run for real.
 * A shared beforeAll creates ONE backup to minimise scrypt invocations (6 total);
 * only tests that require independent managers run their own createBackup.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

const { CloudBackupManager } = require("../cloud-backup-manager");

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

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture — ONE scrypt call reused for createBackup and verifyBackup tests
// Call counts are captured in plain variables because clearMocks/resetMocks wipe
// mock.calls before each it() block executes.
// ─────────────────────────────────────────────────────────────────────────────
let sharedManager;
let sharedStorage;
let sharedBackupId;
let sharedResult;
let sharedStoredShares;
let sharedStoreCallCount;

beforeAll(async () => {
  sharedStorage = makeStorageMock();
  sharedManager = new CloudBackupManager();
  sharedManager._storage = sharedStorage;

  sharedResult = await sharedManager.createBackup(
    Buffer.from("shared-key"),
    "shared-pass",
  );
  sharedBackupId = sharedResult.backupId;

  // Capture before clearMocks clears mock.calls between tests
  sharedStoredShares = sharedStorage.store.mock.calls.map((c) => c[2]);
  sharedStoreCallCount = sharedStorage.store.mock.calls.length;
});

// ── createBackup ──────────────────────────────────────────────────────────────

describe("CloudBackupManager.createBackup", () => {
  it("returns { backupId, shardsStored, strategy }", () => {
    expect(typeof sharedResult.backupId).toBe("string");
    expect(sharedResult.shardsStored).toBe(3);
    expect(sharedResult.strategy).toBe("standard");
  });

  it('"backup-created" event metadata is correct (verified via _metadata)', () => {
    const meta = sharedManager._metadata.find((m) => m.id === sharedBackupId);
    expect(meta).toBeDefined();
    expect(meta.strategy).toBe("standard");
    expect(meta.threshold).toBe(2);
  });

  it("calls storage.store 3 times (one per shard, standard strategy)", () => {
    expect(sharedStoreCallCount).toBe(3);
  });

  it('strategy "standard" produces shardsTotal=3, threshold=2 in metadata', () => {
    const meta = sharedManager._metadata.find((m) => m.id === sharedBackupId);
    expect(meta.shardsTotal).toBe(3);
    expect(meta.threshold).toBe(2);
  });

  it("backup appears in listBackups() after creation", async () => {
    const list = await sharedManager.listBackups();
    expect(list.some((b) => b.id === sharedBackupId)).toBe(true);
  });
});

// ── listBackups ───────────────────────────────────────────────────────────────

describe("CloudBackupManager.listBackups", () => {
  it("returns empty array for a fresh manager", async () => {
    const mgr = new CloudBackupManager();
    mgr._storage = makeStorageMock();
    expect(await mgr.listBackups()).toEqual([]);
  });

  it("returns all created backups", async () => {
    // Two scrypt calls — unavoidable for a 2-backup test
    const storage = makeStorageMock();
    const mgr = new CloudBackupManager();
    mgr._storage = storage;
    await mgr.createBackup(Buffer.from("k1"), "p1");
    await mgr.createBackup(Buffer.from("k2"), "p2");
    expect(await mgr.listBackups()).toHaveLength(2);
  });
});

// ── verifyBackup ──────────────────────────────────────────────────────────────

describe("CloudBackupManager.verifyBackup", () => {
  it("returns { ok: true } when shards ≥ threshold", async () => {
    sharedStorage.list.mockResolvedValue([
      { shardIndex: 0, backend: "local", location: "/tmp/0" },
      { shardIndex: 1, backend: "local", location: "/tmp/1" },
      { shardIndex: 2, backend: "local", location: "/tmp/2" },
    ]);
    const result = await sharedManager.verifyBackup(sharedBackupId);
    expect(result.ok).toBe(true);
    expect(result.shardsFound).toBe(3);
  });

  it("returns { ok: false } when shards < threshold", async () => {
    sharedStorage.list.mockResolvedValue([
      { shardIndex: 0, backend: "local", location: "/tmp/0" },
    ]);
    const result = await sharedManager.verifyBackup(sharedBackupId);
    expect(result.ok).toBe(false);
  });
});

// ── deleteBackup ──────────────────────────────────────────────────────────────
// All three delete tests share ONE extra scrypt call (beforeAll creates one backup).
// deleteBackup always calls storage.delete and emits the event, even for an
// already-deleted id, so tests 2 and 3 re-use the same deleted id safely.

describe("CloudBackupManager.deleteBackup", () => {
  let delManager;
  let delStorage;
  let delBackupId;

  beforeAll(async () => {
    delStorage = makeStorageMock();
    delManager = new CloudBackupManager();
    delManager._storage = delStorage;
    const r = await delManager.createBackup(Buffer.from("del-key"), "del-pass");
    delBackupId = r.backupId;
  });

  it("removes backup from listBackups()", async () => {
    expect(
      (await delManager.listBackups()).some((b) => b.id === delBackupId),
    ).toBe(true);
    await delManager.deleteBackup(delBackupId);
    expect(
      (await delManager.listBackups()).some((b) => b.id === delBackupId),
    ).toBe(false);
  });

  it("calls storage.delete with backupId", async () => {
    // backup already deleted in prior test; deleteBackup still calls storage.delete
    await delManager.deleteBackup(delBackupId);
    expect(delStorage.delete).toHaveBeenCalledWith(delBackupId);
  });

  it('emits "backup-deleted" event', async () => {
    const events = [];
    delManager.on("backup-deleted", (e) => events.push(e));
    await delManager.deleteBackup(delBackupId);
    expect(events[0].backupId).toBe(delBackupId);
  });
});

// ── restoreBackup ─────────────────────────────────────────────────────────────

describe("CloudBackupManager.restoreBackup", () => {
  it("returns reconstructed data on success", async () => {
    const rawData = Buffer.from("restore-test-data");
    const pass = "restore-pass";
    const storage = makeStorageMock();
    const mgr = new CloudBackupManager();
    mgr._storage = storage;

    // Run a real createBackup — captures actual encrypted shares via store mock
    const { backupId } = await mgr.createBackup(rawData, pass);
    const storedShares = storage.store.mock.calls.map((call) => call[2]);

    // Set up list/retrieve to replay the captured shares
    storage.list.mockResolvedValue(
      storedShares.map((_, i) => ({
        shardIndex: i,
        backend: "local",
        location: `/tmp/${i}`,
      })),
    );
    storage.retrieve.mockImplementation((_id, shardIndex) =>
      Promise.resolve(storedShares[shardIndex]),
    );

    const result = await mgr.restoreBackup(backupId, pass);
    expect(result.equals(rawData)).toBe(true);
  });

  it("throws when no shards found", async () => {
    const storage = makeStorageMock();
    const mgr = new CloudBackupManager();
    mgr._storage = storage;
    storage.list.mockResolvedValue([]);
    await expect(mgr.restoreBackup("nonexistent-id", "pass")).rejects.toThrow(
      "No shards found",
    );
  });
});
