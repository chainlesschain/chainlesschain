/**
 * Unit tests: src/lib/packer/pack-update-applier.js
 *
 * The applier is the one place in the OTA chain where we mutate the running
 * exe's file path. We must test both platform branches (POSIX rename, Windows
 * sidecar cmd) without touching the real running `node` binary. Strategy:
 *
 *   - `dryRun: true` for plan-only assertions.
 *   - Injected `platform: "win32" | "posix"` forces both branches on any host.
 *   - Injected `spawnImpl` stub captures the commands we'd have run.
 *   - A throwaway "fake exe" file in os.tmpdir stands in for process.execPath.
 *
 * We deliberately test the sidecar path on non-Windows hosts by mocking
 * os.tmpdir + forcing platform="win32". The generated .cmd is never actually
 * executed — we just assert on its textual shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  scheduleReplace,
  rollbackLastKnownGood,
  writeWindowsSidecar,
  ApplyError,
  _deps,
} from "../../src/lib/packer/pack-update-applier.js";
import {
  NATIVE_UPDATE_LINEAGE_SCHEMA,
  NATIVE_UPDATE_RESULT_SCHEMA,
  reportPendingNativeUpdateResult,
} from "../../src/lib/packer/native-update-state.js";

const FIXTURE_TRANSACTION_ID = "00000000-0000-4000-8000-000000000001";
const FIXTURE_LOCK_TOKEN = `999999:${FIXTURE_TRANSACTION_ID}`;
const CANONICAL_TEMP_ROOT = fs.realpathSync.native(os.tmpdir());

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const FALLBACK_SHA256 = sha256("fixture-bytes");

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function applyFixture(options) {
  const expectedSha256 =
    options.expectedSha256 ||
    (options.newExePath && fs.existsSync(options.newExePath)
      ? fileSha256(options.newExePath)
      : FALLBACK_SHA256);
  return { ...options, expectedSha256 };
}

function writeLineageFixture(targetExePath, options = {}) {
  const {
    currentSha256 = fileSha256(targetExePath),
    previousSha256,
    operation = "update",
    transactionId = FIXTURE_TRANSACTION_ID,
  } = options;
  const lineagePath = `${targetExePath}.update-lineage.json`;
  fs.writeFileSync(
    lineagePath,
    `${JSON.stringify({
      schema: NATIVE_UPDATE_LINEAGE_SCHEMA,
      transactionId,
      operation,
      currentSha256,
      previousSha256,
      updatedAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
  );
  return lineagePath;
}

function sidecarFixture(options = {}) {
  const {
    newExePath = "C:\\fixture\\app.exe.new",
    targetExePath = "C:\\fixture\\app.exe",
    aliasPath = null,
    expectedSha256 = fs.existsSync(newExePath)
      ? fileSha256(newExePath)
      : FALLBACK_SHA256,
    hadTarget = fs.existsSync(targetExePath),
    hadAlias = Boolean(aliasPath && fs.existsSync(aliasPath)),
    targetBeforeSha256 = hadTarget && fs.existsSync(targetExePath)
      ? fileSha256(targetExePath)
      : hadTarget
        ? sha256("old-target")
        : null,
    aliasBeforeSha256 = hadAlias && fs.existsSync(aliasPath)
      ? fileSha256(aliasPath)
      : hadAlias
        ? sha256("old-alias")
        : null,
    transactionId = crypto.randomUUID(),
    lockToken = FIXTURE_LOCK_TOKEN,
    parentPid = 2147483647,
    restart = false,
    ...rest
  } = options;
  return {
    newExePath,
    targetExePath,
    aliasPath,
    expectedSha256,
    targetBeforeSha256,
    aliasBeforeSha256,
    hadTarget,
    hadAlias,
    transactionId,
    lockToken,
    parentPid,
    restart,
    ...rest,
  };
}

describe("scheduleReplace – argument guards", () => {
  it("rejects missing newExePath", async () => {
    await expect(
      scheduleReplace({ targetExePath: "/bin/x" }),
    ).rejects.toMatchObject({ code: "NO_NEW_EXE" });
  });

  it("rejects missing targetExePath", async () => {
    await expect(
      scheduleReplace({ newExePath: "/bin/x.new" }),
    ).rejects.toMatchObject({ code: "NO_TARGET_EXE" });
  });

  it("rejects newExePath that does not exist", async () => {
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: "/definitely/does/not/exist.exe.new",
          targetExePath: "/bin/x",
        }),
      ),
    ).rejects.toMatchObject({ code: "NEW_EXE_MISSING" });
  });

  it("requires the verified staging file to be a target sibling", async () => {
    const firstDir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-stage-a-"),
    );
    const secondDir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-stage-b-"),
    );
    const newExe = path.join(firstDir, "new.exe");
    fs.writeFileSync(newExe, "new");
    try {
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: newExe,
            targetExePath: path.join(secondDir, "current.exe"),
          }),
        ),
      ).rejects.toMatchObject({ code: "STAGING_NOT_SIBLING" });
    } finally {
      fs.rmSync(firstDir, { recursive: true, force: true });
      fs.rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("requires an explicit lowercase downloader-bound SHA-256", async () => {
    const dir = fs.mkdtempSync(path.join(CANONICAL_TEMP_ROOT, "cc-apply-sha-"));
    const newExe = path.join(dir, "new.exe");
    const target = path.join(dir, "current.exe");
    fs.writeFileSync(newExe, "new");
    fs.writeFileSync(target, "old");
    try {
      await expect(
        scheduleReplace({
          newExePath: newExe,
          targetExePath: target,
          expectedSha256: fileSha256(newExe).toUpperCase(),
        }),
      ).rejects.toMatchObject({ code: "BAD_EXPECTED_SHA256" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat an arbitrary standalone cc.exe as a managed alias", async () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-unmanaged-alias-"),
    );
    const newExe = path.join(dir, "new.exe");
    const alias = path.join(dir, "cc.exe");
    fs.writeFileSync(newExe, "new");
    fs.writeFileSync(alias, "unrelated");
    try {
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: newExe,
            targetExePath: alias,
            platform: "win32",
          }),
        ),
      ).rejects.toMatchObject({ code: "UNMANAGED_ALIAS" });
      expect(fs.readFileSync(alias, "utf8")).toBe("unrelated");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("rollbackLastKnownGood", () => {
  it("restores through staging without overwriting the previous backup", async () => {
    const dir = fs.mkdtempSync(path.join(CANONICAL_TEMP_ROOT, "cc-rollback-"));
    const target = path.join(dir, "chainlesschain");
    const backup = `${target}.previous`;
    fs.writeFileSync(target, "bad-new-version");
    fs.writeFileSync(backup, "known-good-version");
    const lineagePath = writeLineageFixture(target, {
      previousSha256: fileSha256(backup),
    });
    try {
      const result = await rollbackLastKnownGood({
        targetExePath: target,
        platform: "posix",
        verify: true,
        verifyImpl: () => ({ status: 0, stdout: "1.0.0" }),
      });
      expect(result.action).toBe("rescue-in-place");
      expect(fs.readFileSync(target, "utf8")).toBe("known-good-version");
      expect(fs.readFileSync(backup, "utf8")).toBe("known-good-version");
      expect(JSON.parse(fs.readFileSync(lineagePath, "utf8"))).toMatchObject({
        schema: NATIVE_UPDATE_LINEAGE_SCHEMA,
        operation: "rescue",
        currentSha256: fileSha256(backup),
        previousSha256: fileSha256(backup),
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores the pre-rescue target when the rescued binary fails verification", async () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-rescue-fail-"),
    );
    const target = path.join(dir, "chainlesschain");
    const backup = `${target}.previous`;
    fs.writeFileSync(target, "current-version");
    fs.writeFileSync(backup, "previous-version");
    const lineagePath = writeLineageFixture(target, {
      previousSha256: fileSha256(backup),
    });
    const originalLineage = fs.readFileSync(lineagePath, "utf8");
    try {
      await expect(
        rollbackLastKnownGood({
          targetExePath: target,
          platform: "posix",
          verify: true,
          verifyImpl: () => ({ status: 1, stderr: "still broken" }),
        }),
      ).rejects.toMatchObject({ code: "UPDATE_VERIFY_FAILED" });
      expect(fs.readFileSync(target, "utf8")).toBe("current-version");
      expect(fs.readFileSync(backup, "utf8")).toBe("previous-version");
      expect(fs.readFileSync(lineagePath, "utf8")).toBe(originalLineage);
      expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a stale lineage that does not describe the active target", async () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-rescue-stale-"),
    );
    const target = path.join(dir, "chainlesschain");
    const backup = `${target}.previous`;
    fs.writeFileSync(target, "lineage-current");
    fs.writeFileSync(backup, "lineage-previous");
    writeLineageFixture(target, { previousSha256: fileSha256(backup) });
    fs.writeFileSync(target, "unrelated-replacement");
    try {
      await expect(
        rollbackLastKnownGood({ targetExePath: target, platform: "posix" }),
      ).rejects.toMatchObject({ code: "LINEAGE_CURRENT_MISMATCH" });
      expect(fs.readFileSync(target, "utf8")).toBe("unrelated-replacement");
      expect(fs.readFileSync(backup, "utf8")).toBe("lineage-previous");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves an independent pre-rescue snapshot if restoration itself fails", async () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-rescue-preserve-"),
    );
    const target = path.join(dir, "chainlesschain");
    const backup = `${target}.previous`;
    fs.writeFileSync(target, "current-version");
    fs.writeFileSync(backup, "previous-version");
    writeLineageFixture(target, { previousSha256: fileSha256(backup) });
    const originalCopyFileSync = fs.copyFileSync.bind(fs);
    const copySpy = vi
      .spyOn(fs, "copyFileSync")
      .mockImplementation((sourcePath, destinationPath, flags) => {
        if (String(sourcePath).includes(".rescue-current-")) {
          const error = new Error("restore denied");
          error.code = "EACCES";
          throw error;
        }
        return originalCopyFileSync(sourcePath, destinationPath, flags);
      });
    try {
      await expect(
        rollbackLastKnownGood({
          targetExePath: target,
          platform: "posix",
          verify: true,
          verifyImpl: () => ({ status: 1 }),
        }),
      ).rejects.toMatchObject({ code: "RESCUE_ROLLBACK_FAILED" });
      expect(fs.readFileSync(target, "utf8")).toBe("previous-version");
      const snapshot = fs
        .readdirSync(dir)
        .find((name) => name.includes(".rescue-current-"));
      expect(snapshot).toBeTruthy();
      expect(fs.readFileSync(path.join(dir, snapshot), "utf8")).toBe(
        "current-version",
      );
      expect(fs.readFileSync(backup, "utf8")).toBe("previous-version");
      expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
      const retry = path.join(dir, "retry.new");
      fs.writeFileSync(retry, "retry-version");
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: retry,
            targetExePath: target,
            platform: "posix",
          }),
        ),
      ).rejects.toMatchObject({ code: "UPDATE_LOCKED" });
    } finally {
      copySpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes the readiness handshake through a Windows rescue transaction", async () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-rescue-win-ready-"),
    );
    const target = path.join(dir, "current.exe");
    const backup = `${target}.previous`;
    let sidecarPath = null;
    fs.writeFileSync(target, "current-version");
    fs.writeFileSync(backup, "previous-version");
    writeLineageFixture(target, { previousSha256: fileSha256(backup) });
    const waitForReadyImpl = vi.fn(() => true);
    try {
      const result = await rollbackLastKnownGood({
        targetExePath: target,
        platform: "win32",
        parentPid: 12345,
        verify: false,
        spawnImpl: (_command, args) => {
          sidecarPath = args.at(-1);
          return { unref: () => {}, kill: () => true };
        },
        waitForReadyImpl,
      });
      expect(result.action).toBe("sidecar-cmd");
      expect(waitForReadyImpl).toHaveBeenCalledOnce();
      expect(fs.readFileSync(sidecarPath, "utf8")).toContain(
        'set "OPERATION=rescue"',
      );
    } finally {
      if (sidecarPath) {
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          /* best effort */
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails clearly when no backup exists", async () => {
    await expect(
      rollbackLastKnownGood({
        targetExePath: "Z:\\missing\\chainlesschain.exe",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_MISSING" });
  });
});

describe("scheduleReplace – dryRun", () => {
  let tmpDir;
  let newExe;
  let target;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(CANONICAL_TEMP_ROOT, "cc-apply-"));
    newExe = path.join(tmpDir, "new.exe");
    target = path.join(tmpDir, "current.exe");
    fs.writeFileSync(newExe, "new-bytes", "utf-8");
    fs.writeFileSync(target, "old-bytes", "utf-8");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("returns a plan and does not touch the filesystem", async () => {
    const r = await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        dryRun: true,
      }),
    );
    expect(r.action).toBe("dry-run");
    expect(r.targetExePath).toBe(target);
    expect(r.newExePath).toBe(newExe);
    expect(r.sidecarPath).toBeNull();
    // Target content must still be the old bytes — the plan hasn't executed.
    expect(fs.readFileSync(target, "utf-8")).toBe("old-bytes");
    expect(fs.readFileSync(newExe, "utf-8")).toBe("new-bytes");
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
  });

  it("dryRun respects the forced platform", async () => {
    const r = await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        dryRun: true,
        platform: "win32",
      }),
    );
    expect(r.platform).toBe("win32");
  });
});

describe("scheduleReplace – POSIX branch", () => {
  let tmpDir;
  let newExe;
  let target;
  let spawnCalls;
  const fakeSpawn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    return { unref: () => {} };
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(CANONICAL_TEMP_ROOT, "cc-apply-posix-"));
    newExe = path.join(tmpDir, "new.exe");
    target = path.join(tmpDir, "current.exe");
    fs.writeFileSync(newExe, "new-payload", "utf-8");
    fs.writeFileSync(target, "old-payload", "utf-8");
    spawnCalls = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("renames new → target atomically", async () => {
    const r = await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        platform: "posix",
        spawnImpl: fakeSpawn,
      }),
    );
    expect(r.action).toBe("replace-in-place");
    expect(r.sidecarPath).toBeNull();
    expect(fs.existsSync(newExe)).toBe(false);
    expect(fs.readFileSync(target, "utf-8")).toBe("new-payload");
    expect(fs.readFileSync(`${target}.previous`, "utf-8")).toBe("old-payload");
    expect(
      JSON.parse(fs.readFileSync(`${target}.update-lineage.json`, "utf8")),
    ).toMatchObject({
      schema: NATIVE_UPDATE_LINEAGE_SCHEMA,
      operation: "update",
      currentSha256: sha256("new-payload"),
      previousSha256: sha256("old-payload"),
    });
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
    // restart not requested → no spawn
    expect(spawnCalls).toEqual([]);
  });

  it("keeps descriptor identity fields as bigint while hashing", async () => {
    const fstatSpy = vi.spyOn(fs, "fstatSync");
    try {
      await scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "posix",
          spawnImpl: fakeSpawn,
        }),
      );
      expect(fstatSpy).toHaveBeenCalled();
      expect(
        fstatSpy.mock.calls.every(([, options]) => options?.bigint === true),
      ).toBe(true);
    } finally {
      fstatSpy.mockRestore();
    }
  });

  it("quarantines stale backup/lineage on a fresh apply generation", async () => {
    fs.unlinkSync(target);
    const backupPath = `${target}.previous`;
    const lineagePath = `${target}.update-lineage.json`;
    fs.writeFileSync(backupPath, "stale-previous");
    fs.writeFileSync(
      lineagePath,
      JSON.stringify({ schema: "stale-lineage", transactionId: "old" }),
    );

    const result = await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        platform: "posix",
      }),
    );

    expect(result.orphaned).toHaveLength(2);
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(
      result.orphaned.some(
        (filePath) =>
          filePath.startsWith(`${backupPath}.orphaned-`) &&
          fs.readFileSync(filePath, "utf8") === "stale-previous",
      ),
    ).toBe(true);
    expect(JSON.parse(fs.readFileSync(lineagePath, "utf8"))).toMatchObject({
      operation: "update",
      currentSha256: sha256("new-payload"),
      previousSha256: null,
    });
  });

  it("binds the commit to the expected staging SHA-256", async () => {
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          expectedSha256: sha256("different-payload"),
          platform: "posix",
        }),
      ),
    ).rejects.toMatchObject({ code: "APPLY_SHA256_MISMATCH" });
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-payload");
    expect(fs.existsSync(`${target}.previous`)).toBe(false);
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
  });

  it("leaves the old target and staging file intact when backup creation fails", async () => {
    const originalCopyFileSync = fs.copyFileSync.bind(fs);
    const copySpy = vi
      .spyOn(fs, "copyFileSync")
      .mockImplementation((sourcePath, destinationPath, flags) => {
        if (String(destinationPath).includes(".previous.pending-")) {
          const error = new Error("disk full while staging backup");
          error.code = "ENOSPC";
          throw error;
        }
        return originalCopyFileSync(sourcePath, destinationPath, flags);
      });
    try {
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: newExe,
            targetExePath: target,
            platform: "posix",
          }),
        ),
      ).rejects.toMatchObject({ code: "BACKUP_FAILED" });
    } finally {
      copySpy.mockRestore();
    }
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-payload");
    expect(fs.existsSync(`${target}.previous`)).toBe(false);
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
  });

  it("preserves the old target and prior rollback generation when the commit rename fails", async () => {
    const backupPath = `${target}.previous`;
    fs.writeFileSync(backupPath, "older-payload");
    const lineagePath = writeLineageFixture(target, {
      previousSha256: fileSha256(backupPath),
    });
    const originalLineage = fs.readFileSync(lineagePath, "utf8");
    const originalRenameSync = fs.renameSync.bind(fs);
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((sourcePath, destinationPath) => {
        if (
          path.resolve(String(sourcePath)) === path.resolve(newExe) &&
          path.resolve(String(destinationPath)) === path.resolve(target)
        ) {
          const error = new Error("rename denied");
          error.code = "EACCES";
          throw error;
        }
        return originalRenameSync(sourcePath, destinationPath);
      });
    try {
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: newExe,
            targetExePath: target,
            platform: "posix",
          }),
        ),
      ).rejects.toMatchObject({ code: "RENAME_FAILED" });
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-payload");
    expect(fs.readFileSync(backupPath, "utf8")).toBe("older-payload");
    expect(fs.readFileSync(lineagePath, "utf8")).toBe(originalLineage);
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
  });

  it("stops before the canonical commit when its lock pathname is replaced", async () => {
    const lockPath = `${target}.update.lock`;
    const originalChmodSync = fs.chmodSync.bind(fs);
    let exchanged = false;
    const chmodSpy = vi
      .spyOn(fs, "chmodSync")
      .mockImplementation((filePath, mode) => {
        const result = originalChmodSync(filePath, mode);
        if (
          !exchanged &&
          path.resolve(String(filePath)) === path.resolve(newExe)
        ) {
          fs.unlinkSync(lockPath);
          fs.writeFileSync(lockPath, "foreign-owner");
          exchanged = true;
        }
        return result;
      });
    try {
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: newExe,
            targetExePath: target,
            platform: "posix",
          }),
        ),
      ).rejects.toMatchObject({ code: "UPDATE_LOCK_LOST" });
    } finally {
      chmodSpy.mockRestore();
    }
    expect(exchanged).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-payload");
    expect(fs.readFileSync(lockPath, "utf8")).toBe("foreign-owner");
    expect(
      fs
        .readdirSync(tmpDir)
        .some((name) => name.includes(".previous.pending-")),
    ).toBe(false);
  });

  it("rolls back when the committed pathname no longer has the accepted hash", async () => {
    const originalRenameSync = fs.renameSync.bind(fs);
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((sourcePath, destinationPath) => {
        const result = originalRenameSync(sourcePath, destinationPath);
        if (
          path.resolve(String(sourcePath)) === path.resolve(newExe) &&
          path.resolve(String(destinationPath)) === path.resolve(target)
        ) {
          fs.writeFileSync(target, "substituted-after-rename");
        }
        return result;
      });
    try {
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: newExe,
            targetExePath: target,
            platform: "posix",
          }),
        ),
      ).rejects.toMatchObject({ code: "POST_COMMIT_HASH_FAILED" });
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(`${target}.previous`, "utf8")).toBe("old-payload");
    expect(
      JSON.parse(fs.readFileSync(`${target}.update-lineage.json`, "utf8")),
    ).toMatchObject({ operation: "rolled-back" });
  });

  it("restart=true spawns the new exe detached after rename", async () => {
    await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        restart: true,
        platform: "posix",
        spawnImpl: fakeSpawn,
      }),
    );
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe(target);
    expect(spawnCalls[0].args).toEqual([]);
    expect(spawnCalls[0].opts.detached).toBe(true);
    expect(spawnCalls[0].opts.stdio).toBe("ignore");
    expect(spawnCalls[0].opts).toMatchObject({
      origin: "packer:update-restart",
      scope: "pack-update",
      policy: "allow",
      shell: false,
    });
  });

  it("consumes asynchronous POSIX restart spawn errors", async () => {
    const child = new EventEmitter();
    child.unref = vi.fn();
    await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        restart: true,
        platform: "posix",
        spawnImpl: () => child,
      }),
    );
    expect(child.listenerCount("error")).toBe(1);
    expect(() =>
      child.emit("error", new Error("async restart failure")),
    ).not.toThrow();
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("chmod +x is applied before rename (exec bit survives)", async () => {
    // Start new.exe as mode 0644 (no exec bit)
    fs.chmodSync(newExe, 0o644);
    await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        platform: "posix",
        spawnImpl: fakeSpawn,
      }),
    );
    if (process.platform !== "win32") {
      // Inspect the real FS only on POSIX where chmod is meaningful.
      const mode = fs.statSync(target).mode & 0o777;
      expect(mode & 0o100).toBe(0o100); // owner exec
    }
  });

  it("restores the last-known-good binary when post-switch verification fails", async () => {
    const verifyImpl = vi.fn(() => ({
      status: 1,
      stderr: "broken executable",
    }));
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "posix",
          verify: true,
          verifyImpl,
        }),
      ),
    ).rejects.toMatchObject({ code: "UPDATE_VERIFY_FAILED" });
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(`${target}.previous`, "utf8")).toBe("old-payload");
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(`${target}.update-lineage.json`, "utf8")),
    ).toMatchObject({
      operation: "rolled-back",
      currentSha256: sha256("old-payload"),
    });
    expect(verifyImpl).toHaveBeenCalledWith(
      target,
      ["--version"],
      expect.objectContaining({ timeout: 30_000, killSignal: "SIGKILL" }),
    );
    expect(
      fs.readdirSync(tmpDir).some((name) => name.includes(".failed-")),
    ).toBe(true);
  });

  it("rolls back when the verification process throws", async () => {
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "posix",
          verify: true,
          verifyImpl: () => {
            throw new Error("bad executable format");
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "UPDATE_VERIFY_FAILED" });
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(`${target}.previous`, "utf8")).toBe("old-payload");
  });

  it("preserves the transaction rescue snapshot when rollback fails", async () => {
    const originalCopyFileSync = fs.copyFileSync.bind(fs);
    const backupPath = `${target}.previous`;
    const copySpy = vi
      .spyOn(fs, "copyFileSync")
      .mockImplementation((sourcePath, destinationPath, flags) => {
        if (String(sourcePath).includes(".previous.pending-")) {
          const error = new Error("rollback copy denied");
          error.code = "EACCES";
          throw error;
        }
        return originalCopyFileSync(sourcePath, destinationPath, flags);
      });
    try {
      await expect(
        scheduleReplace(
          applyFixture({
            newExePath: newExe,
            targetExePath: target,
            platform: "posix",
            verify: true,
            verifyImpl: () => ({ status: 1, stderr: "broken executable" }),
          }),
        ),
      ).rejects.toMatchObject({ code: "ROLLBACK_FAILED" });
    } finally {
      copySpy.mockRestore();
    }
    expect(fs.readFileSync(target, "utf8")).toBe("new-payload");
    expect(fs.existsSync(backupPath)).toBe(false);
    const recoverySnapshot = fs
      .readdirSync(tmpDir)
      .find((name) => name.includes(".previous.pending-"));
    expect(recoverySnapshot).toBeTruthy();
    expect(fs.readFileSync(path.join(tmpDir, recoverySnapshot), "utf8")).toBe(
      "old-payload",
    );
    expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
    const retry = path.join(tmpDir, "retry.exe");
    fs.writeFileSync(retry, "retry-payload");
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: retry,
          targetExePath: target,
          platform: "posix",
        }),
      ),
    ).rejects.toMatchObject({ code: "UPDATE_LOCKED" });
  });

  it("keeps a successfully committed binary when only restart fails", async () => {
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "posix",
          restart: true,
          spawnImpl: () => {
            throw new Error("process creation denied");
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "RESTART_FAILED" });
    expect(fs.readFileSync(target, "utf8")).toBe("new-payload");
    expect(fs.readFileSync(`${target}.previous`, "utf8")).toBe("old-payload");
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
  });

  it("does not enter the transaction while another updater holds the lock", async () => {
    const lockPath = `${target}.update.lock`;
    fs.writeFileSync(lockPath, "other-owner");
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "posix",
        }),
      ),
    ).rejects.toMatchObject({ code: "UPDATE_LOCKED" });
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-payload");
    expect(fs.readFileSync(lockPath, "utf8")).toBe("other-owner");
  });

  it("blocks another update after a consumed rollback-failed result", async () => {
    fs.writeFileSync(
      `${target}.update-result.last.json`,
      JSON.stringify({
        schema: NATIVE_UPDATE_RESULT_SCHEMA,
        transactionId: FIXTURE_TRANSACTION_ID,
        operation: "update",
        status: "verify-failed-rollback-failed",
        exitCode: 1,
      }),
    );
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "posix",
        }),
      ),
    ).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-payload");
  });

  it("fails closed on a symlink staging executable", async () => {
    const realNew = path.join(tmpDir, "real-new.exe");
    const linkedNew = path.join(tmpDir, "linked-new.exe");
    fs.writeFileSync(realNew, "linked-payload");
    try {
      fs.symlinkSync(realNew, linkedNew, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: linkedNew,
          targetExePath: target,
          platform: "posix",
        }),
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    expect(fs.readFileSync(target, "utf8")).toBe("old-payload");
  });

  it("fails closed on a symlink or junction in the transaction ancestor chain", async () => {
    const realDir = path.join(tmpDir, "real-dir");
    const linkedDir = path.join(tmpDir, "linked-dir");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "new.exe"), "linked-new");
    fs.writeFileSync(path.join(realDir, "current.exe"), "linked-old");
    try {
      fs.symlinkSync(
        realDir,
        linkedDir,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }
    const linkedNew = path.join(linkedDir, "new.exe");
    const linkedTarget = path.join(linkedDir, "current.exe");
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: linkedNew,
          targetExePath: linkedTarget,
          platform: "posix",
        }),
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    expect(fs.readFileSync(path.join(realDir, "current.exe"), "utf8")).toBe(
      "linked-old",
    );
  });
});

describe("scheduleReplace – Windows branch (sidecar cmd)", () => {
  let tmpDir;
  let newExe;
  let target;
  let spawnCalls;
  const fakeSpawn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    if (path.win32.basename(cmd).toLowerCase() === "cmd.exe") {
      const sidecarPath = args.at(-1);
      const body = fs.readFileSync(sidecarPath, "utf8");
      const transactionId = body.match(
        /set "TRANSACTION_ID=([0-9a-f-]{36})"/i,
      )?.[1];
      fs.writeFileSync(`${sidecarPath}.ready`, transactionId || "invalid");
    }
    return { unref: () => {}, kill: () => true };
  };
  // These are synthetic Windows-sidecar tests. On macOS, os.tmpdir() can
  // traverse an APFS firmlink that the production Windows reparse guard must
  // reject, so this fixture verifies the transaction handshake independently.
  const fakeWaitForReady = ({ readyPath, transactionId }) =>
    fs.readFileSync(readyPath, "utf8").trim() === transactionId;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(CANONICAL_TEMP_ROOT, "cc-apply-win-"));
    newExe = path.join(tmpDir, "new.exe");
    target = path.join(tmpDir, "current.exe");
    fs.writeFileSync(newExe, "new-bytes", "utf-8");
    fs.writeFileSync(target, "old-bytes", "utf-8");
    spawnCalls = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("writes a .cmd sidecar and spawns cmd.exe detached", async () => {
    const originalSpawn = _deps.spawn;
    _deps.spawn = fakeSpawn;
    let r;
    try {
      r = await scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "win32",
          parentPid: 12345,
          waitForReadyImpl: fakeWaitForReady,
        }),
      );
    } finally {
      _deps.spawn = originalSpawn;
    }
    expect(r.action).toBe("sidecar-cmd");
    expect(r.sidecarPath).toBeTruthy();
    expect(fs.existsSync(r.sidecarPath)).toBe(true);
    expect(fs.existsSync(r.lockPath)).toBe(true);
    expect(r.resultPath).toBe(`${target}.update-result.json`);
    // The real FS is untouched — sidecar hasn't run.
    expect(fs.readFileSync(target, "utf-8")).toBe("old-bytes");
    expect(fs.readFileSync(newExe, "utf-8")).toBe("new-bytes");
    // Sidecar spawned with cmd.exe /c <path>, detached, windowsHide.
    expect(spawnCalls).toHaveLength(1);
    expect(path.win32.basename(spawnCalls[0].cmd).toLowerCase()).toBe(
      "cmd.exe",
    );
    if (process.platform === "win32") {
      expect(path.win32.isAbsolute(spawnCalls[0].cmd)).toBe(true);
    }
    expect(spawnCalls[0].args).toEqual(["/d", "/c", r.sidecarPath]);
    expect(spawnCalls[0].opts.detached).toBe(true);
    expect(spawnCalls[0].opts.windowsHide).toBe(true);
    expect(spawnCalls[0].opts).toMatchObject({
      origin: "packer:update-sidecar",
      scope: "pack-update",
      policy: "allow",
      shell: false,
    });
    // Cleanup
    try {
      fs.unlinkSync(r.sidecarPath);
    } catch {
      /* best effort */
    }
  });

  it("keeps the transferred lock so a second Windows apply fails closed", async () => {
    const r = await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        platform: "win32",
        parentPid: 12345,
        spawnImpl: fakeSpawn,
        waitForReadyImpl: fakeWaitForReady,
      }),
    );
    const secondNew = path.join(tmpDir, "second.exe");
    fs.writeFileSync(secondNew, "second");
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: secondNew,
          targetExePath: target,
          platform: "win32",
          spawnImpl: fakeSpawn,
        }),
      ),
    ).rejects.toMatchObject({ code: "UPDATE_LOCKED" });
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-bytes");
    try {
      fs.unlinkSync(r.sidecarPath);
    } catch {
      /* best effort */
    }
  });

  it("isolates stale backup/lineage before scheduling a fresh Windows apply", async () => {
    fs.unlinkSync(target);
    const backupPath = `${target}.previous`;
    const lineagePath = `${target}.update-lineage.json`;
    fs.writeFileSync(backupPath, "stale-backup");
    fs.writeFileSync(lineagePath, '{"schema":"stale"}');
    const result = await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: target,
        platform: "win32",
        parentPid: 12345,
        spawnImpl: fakeSpawn,
        waitForReadyImpl: fakeWaitForReady,
      }),
    );
    try {
      expect(result.orphaned).toHaveLength(2);
      expect(fs.existsSync(backupPath)).toBe(false);
      expect(fs.existsSync(lineagePath)).toBe(false);
      const body = fs.readFileSync(result.sidecarPath, "utf8");
      expect(body).toContain('set "HAD_TARGET=0"');
      expect(body).toContain('set "HAD_BACKUP=0"');
    } finally {
      fs.unlinkSync(result.sidecarPath);
    }
  });

  it("canonicalizes cc.exe and carries alias pre-state into the sidecar", async () => {
    const canonicalPath = path.join(tmpDir, "chainlesschain.exe");
    const aliasPath = path.join(tmpDir, "cc.exe");
    fs.writeFileSync(canonicalPath, "old-canonical");
    fs.writeFileSync(aliasPath, "old-alias");

    const result = await scheduleReplace(
      applyFixture({
        newExePath: newExe,
        targetExePath: aliasPath,
        platform: "win32",
        parentPid: 12345,
        spawnImpl: fakeSpawn,
        waitForReadyImpl: fakeWaitForReady,
      }),
    );

    expect(result.requestedTargetExePath).toBe(aliasPath);
    expect(result.targetExePath).toBe(canonicalPath);
    expect(result.aliasPath).toBe(aliasPath);
    const body = fs.readFileSync(result.sidecarPath, "utf8");
    expect(body).toContain(`set "TARGET_EXE=${canonicalPath}"`);
    expect(body).toContain(`set "ALIAS_EXE=${aliasPath}"`);
    expect(body).toContain(`set "ALIAS_BEFORE_SHA=${sha256("old-alias")}"`);

    fs.unlinkSync(result.sidecarPath);
  });

  it("releases the lock and removes the sidecar when spawn throws", async () => {
    const before = new Set(
      fs
        .readdirSync(CANONICAL_TEMP_ROOT)
        .filter((name) => name.startsWith("cc-pack-apply-")),
    );
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "win32",
          spawnImpl: () => {
            throw new Error("spawn denied");
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "SIDECAR_SPAWN_FAILED" });
    expect(fs.existsSync(`${target}.update.lock`)).toBe(false);
    const after = fs
      .readdirSync(CANONICAL_TEMP_ROOT)
      .filter((name) => name.startsWith("cc-pack-apply-"));
    expect(after.filter((name) => !before.has(name))).toEqual([]);
  });

  it("keeps a fail-closed lock when the sidecar safety handshake never arrives", async () => {
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "win32",
          spawnImpl: () => ({ kill: () => true, unref: () => {} }),
          waitForReadyImpl: () => false,
        }),
      ),
    ).rejects.toMatchObject({ code: "SIDECAR_NOT_READY" });
    expect(fs.readFileSync(target, "utf8")).toBe("old-bytes");
    expect(fs.readFileSync(newExe, "utf8")).toBe("new-bytes");
    expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
  });

  it("attaches the sidecar error listener before the readiness wait", async () => {
    const child = new EventEmitter();
    child.kill = vi.fn(() => true);
    child.unref = vi.fn();
    await expect(
      scheduleReplace(
        applyFixture({
          newExePath: newExe,
          targetExePath: target,
          platform: "win32",
          spawnImpl: () => child,
          waitForReadyImpl: () => {
            expect(child.listenerCount("error")).toBe(1);
            child.emit("error", new Error("async spawn failure"));
            return true;
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "SIDECAR_NOT_READY" });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
  });

  it.runIf(process.platform === "win32")(
    "transfers the real lock only after a sidecar readiness handshake",
    () => {
      const dir = fs.mkdtempSync(
        path.join(CANONICAL_TEMP_ROOT, "cc-ready-e2e-"),
      );
      const stagedPath = path.join(dir, "current.exe.new");
      const targetPath = path.join(dir, "current.exe");
      const planPath = path.join(dir, "plan.json");
      const helperPath = path.join(dir, "schedule.mjs");
      fs.writeFileSync(stagedPath, "ready-new");
      fs.writeFileSync(targetPath, "ready-old");
      const moduleUrl = pathToFileURL(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../src/lib/packer/pack-update-applier.js",
        ),
      ).href;
      fs.writeFileSync(
        helperPath,
        `import fs from "node:fs";\n` +
          `import crypto from "node:crypto";\n` +
          `import { scheduleReplace } from ${JSON.stringify(moduleUrl)};\n` +
          `const stagedPath = ${JSON.stringify(stagedPath)};\n` +
          `const targetPath = ${JSON.stringify(targetPath)};\n` +
          `const expectedSha256 = crypto.createHash("sha256").update(fs.readFileSync(stagedPath)).digest("hex");\n` +
          `const plan = await scheduleReplace({ newExePath: stagedPath, targetExePath: targetPath, expectedSha256, platform: "win32", verify: false });\n` +
          `fs.writeFileSync(${JSON.stringify(planPath)}, JSON.stringify(plan));\n`,
      );
      try {
        const scheduled = nodeSpawnSync(process.execPath, [helperPath], {
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(scheduled.status, scheduled.stderr || scheduled.stdout).toBe(0);
        const resultPath = `${targetPath}.update-result.json`;
        const lockPath = `${targetPath}.update.lock`;
        const waitCell = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 60_000;
        while (
          (!fs.existsSync(resultPath) || fs.existsSync(lockPath)) &&
          Date.now() < deadline
        ) {
          Atomics.wait(waitCell, 0, 0, 50);
        }
        expect(fs.existsSync(resultPath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
          status: "success",
          exitCode: 0,
        });
        expect(fs.readFileSync(targetPath, "utf8")).toBe("ready-new");
        expect(fs.existsSync(lockPath)).toBe(false);
        expect(JSON.parse(fs.readFileSync(planPath, "utf8"))).toMatchObject({
          action: "sidecar-cmd",
          targetExePath: targetPath,
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    90_000,
  );
});

describe("writeWindowsSidecar (cmd body)", () => {
  let tmpFiles = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* best effort */
      }
    }
    tmpFiles = [];
  });

  it("emits a cmd that waits on PARENT_PID, moves, and self-deletes", () => {
    const p = writeWindowsSidecar(
      sidecarFixture({
        newExePath: "C:\\Users\\u\\app.exe.new",
        targetExePath: "C:\\Users\\u\\app.exe",
        parentPid: 7777,
        restart: false,
      }),
    );
    tmpFiles.push(p);
    const body = fs.readFileSync(p, "utf-8");
    expect(body).toContain("@echo off");
    expect(body).toContain('set "PARENT_PID=7777"');
    expect(body).toContain('set "CC_SYSTEM_ROOT=');
    expect(body).not.toContain("%SystemRoot%");
    expect(body).toContain('"%CC_SYSTEM_ROOT%\\System32\\chcp.com" 65001 >NUL');
    expect(body).toContain(
      '"%CC_SYSTEM_ROOT%\\System32\\ping.exe" -n 2 -w 1000 127.0.0.1 >NUL',
    );
    expect(body).not.toMatch(/\r\n(?:chcp|timeout|ping)\s/i);
    expect(body).toContain('set "NEW_EXE=C:\\Users\\u\\app.exe.new"');
    expect(body).toContain('set "TARGET_EXE=C:\\Users\\u\\app.exe"');
    expect(body).toContain("tasklist");
    expect(body).toContain('/FO CSV /NH > "%PARENT_PROBE%"');
    expect(body).not.toContain(
      'tasklist.exe" /FI "PID eq %PARENT_PID%" 2>NUL |',
    );
    expect(body).toContain('move /Y "%NEW_EXE%" "%TARGET_EXE%"');
    expect(body).toContain('set "BACKUP_EXE=');
    expect(body).toContain('copy /B /Y "%TARGET_EXE%" "%BACKUP_TEMP%"');
    expect(body).toContain('move /Y "%BACKUP_TEMP%" "%BACKUP_EXE%"');
    expect(body).toContain('move /Y "%ROLLBACK_TEMP%" "%TARGET_EXE%"');
    const targetCommitted = body.indexOf('set "TARGET_COMMITTED=1"');
    const postCommitHash = body.indexOf(
      'set "HASH_PATH=%TARGET_EXE%"',
      targetCommitted,
    );
    const startupCheck = body.indexOf('set "VERIFY_PATH=%TARGET_EXE%"');
    expect(postCommitHash).toBeGreaterThan(targetCommitted);
    expect(postCommitHash).toBeLessThan(startupCheck);
    expect(body).toContain('set "VERIFY_PATH=%ALIAS_EXE%"');
    const decodedPowerShell = [
      ...body.matchAll(/-EncodedCommand ([A-Za-z0-9+/=]+)/g),
    ].map(([, encoded]) => Buffer.from(encoded, "base64").toString("utf16le"));
    expect(
      decodedPowerShell.some((script) => script.includes("WaitForExit(30000)")),
    ).toBe(true);
    expect(
      decodedPowerShell.some((script) => script.includes("WaitForExit(5000)")),
    ).toBe(true);
    expect(body).toContain('move /Y "%RESULT_TEMP%" "%RESULT_FILE%"');
    expect(body).toContain('del /F /Q "%LOCK_FILE%"');
    expect(body).toContain('if "%HAD_TARGET%"=="0" goto removefreshcanonical');
    expect(body).toContain(':removefreshcanonical\r\ndel /F /Q "%TARGET_EXE%"');
    expect(body).toContain("REM restart not requested");
    expect(body).toContain('del /F /Q "%~f0"');
  });

  it("emits a `start` line when restart=true", () => {
    const p = writeWindowsSidecar(
      sidecarFixture({
        newExePath: "C:\\x.new",
        targetExePath: "C:\\x",
        parentPid: 1,
        restart: true,
      }),
    );
    tmpFiles.push(p);
    const body = fs.readFileSync(p, "utf-8");
    expect(body).toContain('start "" "%TARGET_EXE%"');
    expect(body).not.toContain("REM restart not requested");
  });

  it("each invocation produces a unique sidecar path", () => {
    const a = writeWindowsSidecar(
      sidecarFixture({
        newExePath: "C:\\n",
        targetExePath: "C:\\t",
        parentPid: 1,
        restart: false,
      }),
    );
    const b = writeWindowsSidecar(
      sidecarFixture({
        newExePath: "C:\\n",
        targetExePath: "C:\\t",
        parentPid: 1,
        restart: false,
      }),
    );
    tmpFiles.push(a, b);
    expect(a).not.toBe(b);
  });

  it("rejects cmd metacharacters that could expand into commands", () => {
    expect(() =>
      writeWindowsSidecar(
        sidecarFixture({
          newExePath: "C:\\unsafe%TEMP%\\n.exe",
          targetExePath: "C:\\x.exe",
          parentPid: 1,
          restart: false,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "UNSAFE_WINDOWS_PATH" }));
  });

  it.runIf(process.platform === "win32")(
    "commits the canonical binary and alias with lineage/result persistence",
    () => {
      const root = fs.mkdtempSync(
        path.join(CANONICAL_TEMP_ROOT, "cc-sidecar-e2e-"),
      );
      const dir = path.join(root, "\u539f\u751f\u66f4\u65b0");
      fs.mkdirSync(dir);
      const newExePath = path.join(dir, "chainlesschain.exe.new");
      const targetExePath = path.join(dir, "chainlesschain.exe");
      const aliasPath = path.join(dir, "cc.exe");
      const lockPath = `${targetExePath}.update.lock`;
      const resultPath = `${targetExePath}.update-result.json`;
      fs.writeFileSync(newExePath, "new-version");
      fs.writeFileSync(targetExePath, "old-version");
      fs.writeFileSync(aliasPath, "old-alias");
      const context = sidecarFixture({
        newExePath,
        targetExePath,
        aliasPath,
        lockPath,
        resultPath,
        verify: false,
      });
      fs.writeFileSync(lockPath, context.lockToken);
      const sidecarPath = writeWindowsSidecar(context);
      try {
        const run = nodeSpawnSync("cmd.exe", ["/c", sidecarPath], {
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(run.status, run.stderr || run.stdout).toBe(0);
        expect(fs.readFileSync(targetExePath, "utf8")).toBe("new-version");
        expect(fs.readFileSync(aliasPath, "utf8")).toBe("new-version");
        expect(fs.readFileSync(`${targetExePath}.previous`, "utf8")).toBe(
          "old-version",
        );
        expect(
          JSON.parse(
            fs.readFileSync(`${targetExePath}.update-lineage.json`, "utf8"),
          ),
        ).toMatchObject({
          schema: NATIVE_UPDATE_LINEAGE_SCHEMA,
          transactionId: context.transactionId,
          operation: "update",
          currentSha256: sha256("new-version"),
          previousSha256: sha256("old-version"),
        });
        expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
          schema: NATIVE_UPDATE_RESULT_SCHEMA,
          transactionId: context.transactionId,
          operation: "update",
          status: "success",
          exitCode: 0,
          hadTarget: true,
          expectedSha256: sha256("new-version"),
          aliasManaged: true,
        });
        expect(fs.existsSync(lockPath)).toBe(false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          /* self-delete normally removed it */
        }
      }
    },
    30_000,
  );

  it.runIf(process.platform === "win32")(
    "rolls the canonical binary and alias back after verification fails",
    () => {
      const dir = fs.mkdtempSync(
        path.join(CANONICAL_TEMP_ROOT, "cc-sidecar-fail-"),
      );
      const newExePath = path.join(dir, "chainlesschain.exe.new");
      const targetExePath = path.join(dir, "chainlesschain.exe");
      const aliasPath = path.join(dir, "cc.exe");
      const lockPath = `${targetExePath}.update.lock`;
      const resultPath = `${targetExePath}.update-result.json`;
      fs.writeFileSync(newExePath, "not-a-valid-executable");
      fs.writeFileSync(targetExePath, "old-version");
      fs.writeFileSync(aliasPath, "old-alias");
      const context = sidecarFixture({
        newExePath,
        targetExePath,
        aliasPath,
        lockPath,
        resultPath,
        verify: true,
      });
      fs.writeFileSync(lockPath, context.lockToken);
      const sidecarPath = writeWindowsSidecar(context);
      try {
        const run = nodeSpawnSync("cmd.exe", ["/c", sidecarPath], {
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(run.status, run.stderr || run.stdout).toBe(1);
        expect(fs.readFileSync(targetExePath, "utf8")).toBe("old-version");
        expect(fs.readFileSync(aliasPath, "utf8")).toBe("old-alias");
        expect(fs.readFileSync(`${targetExePath}.previous`, "utf8")).toBe(
          "old-version",
        );
        expect(
          JSON.parse(
            fs.readFileSync(`${targetExePath}.update-lineage.json`, "utf8"),
          ),
        ).toMatchObject({
          operation: "rolled-back",
          currentSha256: sha256("old-version"),
        });
        expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
          schema: NATIVE_UPDATE_RESULT_SCHEMA,
          transactionId: context.transactionId,
          status: "verify-failed-rolled-back",
          exitCode: 1,
          aliasManaged: true,
        });
        expect(fs.existsSync(lockPath)).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          /* self-delete normally removed it */
        }
      }
    },
    30_000,
  );

  it.runIf(process.platform === "win32")(
    "does not mutate or release a lock after sidecar ownership is replaced",
    () => {
      const dir = fs.mkdtempSync(
        path.join(CANONICAL_TEMP_ROOT, "cc-sidecar-lock-"),
      );
      const newExePath = path.join(dir, "chainlesschain.exe.new");
      const targetExePath = path.join(dir, "chainlesschain.exe");
      const lockPath = `${targetExePath}.update.lock`;
      const resultPath = `${targetExePath}.update-result.json`;
      fs.writeFileSync(newExePath, "new-version");
      fs.writeFileSync(targetExePath, "old-version");
      const context = sidecarFixture({
        newExePath,
        targetExePath,
        lockPath,
        resultPath,
        verify: false,
      });
      const foreignToken = `888888:${crypto.randomUUID()}`;
      fs.writeFileSync(lockPath, foreignToken);
      const sidecarPath = writeWindowsSidecar(context);
      try {
        const run = nodeSpawnSync("cmd.exe", ["/c", sidecarPath], {
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(run.status, run.stderr || run.stdout).toBe(1);
        expect(fs.readFileSync(targetExePath, "utf8")).toBe("old-version");
        expect(fs.readFileSync(newExePath, "utf8")).toBe("new-version");
        expect(fs.readFileSync(lockPath, "utf8")).toBe(foreignToken);
        expect(fs.existsSync(resultPath)).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          /* self-delete normally removed it */
        }
      }
    },
    30_000,
  );

  it.runIf(process.platform === "win32")(
    "rejects a candidate mutated after scheduling and before sidecar commit",
    () => {
      const dir = fs.mkdtempSync(
        path.join(CANONICAL_TEMP_ROOT, "cc-sidecar-sha-"),
      );
      const newExePath = path.join(dir, "chainlesschain.exe.new");
      const targetExePath = path.join(dir, "chainlesschain.exe");
      const lockPath = `${targetExePath}.update.lock`;
      const resultPath = `${targetExePath}.update-result.json`;
      fs.writeFileSync(newExePath, "accepted-version");
      fs.writeFileSync(targetExePath, "old-version");
      const context = sidecarFixture({
        newExePath,
        targetExePath,
        lockPath,
        resultPath,
        verify: false,
      });
      fs.writeFileSync(lockPath, context.lockToken);
      fs.writeFileSync(newExePath, "mutated-version");
      const sidecarPath = writeWindowsSidecar(context);
      try {
        const run = nodeSpawnSync("cmd.exe", ["/c", sidecarPath], {
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(run.status, run.stderr || run.stdout).toBe(1);
        expect(fs.readFileSync(targetExePath, "utf8")).toBe("old-version");
        expect(fs.readFileSync(newExePath, "utf8")).toBe("mutated-version");
        expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
          status: "sha256-mismatch",
          expectedSha256: sha256("accepted-version"),
        });
        expect(fs.existsSync(`${targetExePath}.previous`)).toBe(false);
        expect(fs.existsSync(lockPath)).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          /* self-delete normally removed it */
        }
      }
    },
    30_000,
  );

  it.runIf(process.platform === "win32")(
    "fails closed when a sidecar path ancestor is a junction",
    () => {
      const root = fs.mkdtempSync(
        path.join(CANONICAL_TEMP_ROOT, "cc-sidecar-link-"),
      );
      const realDir = path.join(root, "real");
      const linkedDir = path.join(root, "linked");
      fs.mkdirSync(realDir);
      try {
        fs.symlinkSync(realDir, linkedDir, "junction");
      } catch (error) {
        fs.rmSync(root, { recursive: true, force: true });
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return;
        throw error;
      }
      const newExePath = path.join(linkedDir, "chainlesschain.exe.new");
      const targetExePath = path.join(linkedDir, "chainlesschain.exe");
      const lockPath = `${targetExePath}.update.lock`;
      fs.writeFileSync(newExePath, "new-version");
      fs.writeFileSync(targetExePath, "old-version");
      const context = sidecarFixture({
        newExePath,
        targetExePath,
        lockPath,
        verify: false,
      });
      fs.writeFileSync(lockPath, context.lockToken);
      const sidecarPath = writeWindowsSidecar(context);
      try {
        const run = nodeSpawnSync("cmd.exe", ["/c", sidecarPath], {
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(run.status, run.stderr || run.stdout).toBe(1);
        expect(
          fs.readFileSync(path.join(realDir, "chainlesschain.exe"), "utf8"),
        ).toBe("old-version");
        expect(
          fs.readFileSync(path.join(realDir, "chainlesschain.exe.new"), "utf8"),
        ).toBe("new-version");
        expect(fs.existsSync(lockPath)).toBe(true);
        expect(fs.existsSync(`${targetExePath}.update-result.json`)).toBe(
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          /* self-delete normally removed it */
        }
      }
    },
    30_000,
  );

  it("ApplyError is a typed Error with a code", () => {
    const e = new ApplyError("test", "XYZ");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ApplyError");
    expect(e.code).toBe("XYZ");
  });
});

describe("native sidecar result reporting", () => {
  it("atomically consumes a valid pending result and retains diagnostics", () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-update-result-"),
    );
    const targetExePath = path.join(dir, "chainlesschain.exe");
    const resultPath = `${targetExePath}.update-result.json`;
    const lastResultPath = `${targetExePath}.update-result.last.json`;
    const stderr = { write: vi.fn() };
    const value = {
      schema: NATIVE_UPDATE_RESULT_SCHEMA,
      transactionId: FIXTURE_TRANSACTION_ID,
      operation: "update",
      status: "success",
      exitCode: 0,
    };
    fs.writeFileSync(resultPath, JSON.stringify(value));
    try {
      expect(
        reportPendingNativeUpdateResult({
          targetExePath,
          platform: "win32",
          force: true,
          stderr,
        }),
      ).toMatchObject({ ...value, consumedPath: lastResultPath });
      expect(fs.existsSync(resultPath)).toBe(false);
      expect(JSON.parse(fs.readFileSync(lastResultPath, "utf8"))).toEqual(
        value,
      );
      expect(stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("Native update completed"),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports and archives a detached sidecar failure", () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-update-failed-"),
    );
    const targetExePath = path.join(dir, "chainlesschain.exe");
    const resultPath = `${targetExePath}.update-result.json`;
    const lastResultPath = `${targetExePath}.update-result.last.json`;
    const stderr = { write: vi.fn() };
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema: NATIVE_UPDATE_RESULT_SCHEMA,
        transactionId: FIXTURE_TRANSACTION_ID,
        operation: "update",
        status: "sha256-mismatch",
        exitCode: 1,
      }),
    );
    try {
      expect(
        reportPendingNativeUpdateResult({
          targetExePath,
          platform: "win32",
          force: true,
          stderr,
        }),
      ).toMatchObject({ status: "sha256-mismatch", exitCode: 1 });
      expect(fs.existsSync(resultPath)).toBe(false);
      expect(fs.existsSync(lastResultPath)).toBe(true);
      expect(stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("Native update failed"),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves an invalid result pending and reports that it could not be consumed", () => {
    const dir = fs.mkdtempSync(
      path.join(CANONICAL_TEMP_ROOT, "cc-update-invalid-"),
    );
    const targetExePath = path.join(dir, "chainlesschain.exe");
    const resultPath = `${targetExePath}.update-result.json`;
    const stderr = { write: vi.fn() };
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema: NATIVE_UPDATE_RESULT_SCHEMA,
        transactionId: FIXTURE_TRANSACTION_ID,
        operation: "update",
        status: "success",
        exitCode: 1,
      }),
    );
    try {
      expect(
        reportPendingNativeUpdateResult({
          targetExePath,
          platform: "win32",
          force: true,
          stderr,
        }),
      ).toMatchObject({ status: "result-invalid", resultPath });
      expect(fs.existsSync(resultPath)).toBe(true);
      expect(stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("could not be consumed"),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
