import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { createAtomicFileCommitter } = require("../secure-config-atomic-file");
const { SecureConfigStorage } = require("../secure-config-storage");

function storageOptions(root, options = {}) {
  return {
    storagePath: path.join(root, "secure-config.enc"),
    app: { getPath: () => root },
    safeStorage: { isEncryptionAvailable: () => false },
    ...options,
  };
}

describe("secure config backup retention", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "chainless-backup-"));
  });

  afterEach(() => {
    const resolvedRoot = path.resolve(root);
    const resolvedTemp = path.resolve(os.tmpdir());
    if (!resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`)) {
      throw new Error("Refusing to remove a non-temporary test directory");
    }
    fs.rmSync(resolvedRoot, { force: true, recursive: true });
  });

  it("keeps the newly created backup within the configured bounded inventory", () => {
    const storage = new SecureConfigStorage(
      storageOptions(root, { maxBackups: 2 }),
    );
    expect(storage.save({ version: 1 })).toBe(true);
    const first = storage.createBackup();
    const firstResolved = fs.realpathSync(first);
    expect(storage.save({ version: 2 })).toBe(true);
    const second = storage.createBackup();
    expect(storage.save({ version: 3 })).toBe(true);
    const third = storage.createBackup();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(third).toBeTruthy();
    const inventory = storage.listBackups();
    expect(inventory).toHaveLength(2);
    expect(inventory.map((backup) => backup.path)).toContain(
      fs.realpathSync(third),
    );
    expect(inventory.some((backup) => backup.path === firstResolved)).toBe(
      false,
    );
  });

  it("ignores files outside the strict backup naming contract", () => {
    const storage = new SecureConfigStorage(storageOptions(root));
    expect(storage.save({ current: true })).toBe(true);
    const backup = storage.createBackup();
    const backupDir = path.dirname(backup);
    fs.writeFileSync(path.join(backupDir, "untrusted.enc.bak"), "private");
    fs.writeFileSync(
      path.join(backupDir, "secure-config-not-a-timestamp.enc.bak"),
      "private",
    );

    expect(storage.listBackups()).toHaveLength(1);
    expect(storage.listBackups()[0].path).toBe(fs.realpathSync(backup));
  });

  it("refuses restoration from a path outside the server-side inventory", () => {
    const storage = new SecureConfigStorage(storageOptions(root));
    expect(storage.save({ version: "current" })).toBe(true);
    const outside = path.join(root, "outside.enc.bak");
    fs.writeFileSync(outside, storage.encrypt({ version: "outside" }));

    expect(storage.restoreFromBackup(outside)).toBe(false);
    expect(storage.load(false)).toEqual({ version: "current" });
  });

  it("rejects oversized files before they can enter the backup inventory", () => {
    const storage = new SecureConfigStorage(storageOptions(root));
    expect(storage.save({ version: "current" })).toBe(true);
    const backup = storage.createBackup();
    fs.truncateSync(backup, 16 * 1024 * 1024 + 1);

    expect(storage.listBackups()).toEqual([]);
    expect(storage.restoreFromBackup(backup)).toBe(false);
    expect(storage.load(false)).toEqual({ version: "current" });
  });

  it("refuses to write through a linked backup directory", () => {
    const storage = new SecureConfigStorage(storageOptions(root));
    expect(storage.save({ version: "current" })).toBe(true);
    const external = path.join(root, "external");
    const backupDir = path.join(root, "secure-backups");
    fs.mkdirSync(external);
    fs.symlinkSync(
      external,
      backupDir,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(storage.createBackup()).toBeNull();
    expect(fs.readdirSync(external)).toEqual([]);
  });

  it("restores a validated backup selected from the bounded inventory", () => {
    const storage = new SecureConfigStorage(storageOptions(root));
    expect(storage.save({ version: "original" })).toBe(true);
    const backup = storage.createBackup();
    expect(backup).toBe(storage.listBackups()[0].path);
    expect(storage.save({ version: "changed" })).toBe(true);

    expect(storage.restoreFromBackup(backup)).toBe(true);
    expect(storage.load(false)).toEqual({ version: "original" });
  });

  it("fails backup creation closed when retention cannot remove an old backup", () => {
    const delegate = createAtomicFileCommitter();
    let protectedBackup = null;
    const atomicFile = {
      ...delegate,
      removeSync(filePath) {
        if (protectedBackup && path.resolve(filePath) === protectedBackup) {
          return false;
        }
        return delegate.removeSync(filePath);
      },
    };
    const storage = new SecureConfigStorage(
      storageOptions(root, { atomicFile, maxBackups: 1 }),
    );
    expect(storage.save({ version: 1 })).toBe(true);
    const first = storage.createBackup();
    protectedBackup = fs.realpathSync(first);
    expect(storage.save({ version: 2 })).toBe(true);

    expect(storage.createBackup()).toBeNull();
    expect(storage.listBackups().map((backup) => backup.path)).toEqual([
      protectedBackup,
    ]);
  });

  it("rejects invalid backup limits", () => {
    for (const maxBackups of [0, 101, 1.5, "10"]) {
      expect(
        () => new SecureConfigStorage(storageOptions(root, { maxBackups })),
      ).toThrow("Secure config backup limit is invalid");
    }
  });
});
