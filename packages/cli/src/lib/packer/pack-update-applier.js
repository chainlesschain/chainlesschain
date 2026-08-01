/**
 * Transactional native CLI updater.
 *
 * Security invariants:
 *   - the installer and OTA updater share `<canonical>.update.lock`;
 *   - apply is bound to the SHA-256 returned by the downloader and re-hashes
 *     the sibling staging file immediately before the commit point;
 *   - `.previous` is trusted only through a persisted lineage record;
 *   - Windows transfers lock ownership (token included) to a sidecar that
 *     re-checks hashes, path reparse points and the observed pre-state;
 *   - rescue is a separate transaction and never feeds `.previous` back into
 *     the forward-update backup rotation.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn as nativeSpawn } from "node:child_process";
import executionBroker from "../process-execution-broker/index.js";
import {
  NATIVE_UPDATE_LINEAGE_SCHEMA,
  NATIVE_UPDATE_RESULT_SCHEMA,
  SHA256_HEX,
  assertSafeRegularFile as assertStateSafeRegularFile,
  lstatOrNull,
  nativeUpdatePaths,
  nativeResultRequiresRecovery,
  readNativeUpdateResult,
  readNativeLineage,
  resolveNativeLayout,
} from "./native-update-state.js";

export const _deps = {
  // Replacement/restart children must outlive the CLI process. Platform
  // sandboxes deliberately bind descendants to a parent-owned process tree,
  // so this narrowly scoped host update boundary uses native detached spawn
  // only after path, ownership and digest validation has completed.
  spawn: (...args) => nativeSpawn(...args),
  spawnSync: (...args) => executionBroker.spawnSync(...args),
};

export async function scheduleReplace(ctx = {}) {
  const {
    newExePath,
    targetExePath,
    expectedSha256,
    restart = false,
    dryRun = false,
    platform = process.platform === "win32" ? "win32" : "posix",
    parentPid = process.pid,
    spawnImpl = _deps.spawn,
    verify = false,
    verifyImpl = _deps.spawnSync,
    waitForReadyImpl = waitForWindowsSidecarReady,
  } = ctx;

  validatePlatform(platform);
  if (!newExePath || typeof newExePath !== "string") {
    throw new ApplyError("newExePath is required", "NO_NEW_EXE");
  }
  if (!targetExePath || typeof targetExePath !== "string") {
    throw new ApplyError("targetExePath is required", "NO_TARGET_EXE");
  }
  const resolvedNewPath = path.resolve(newExePath);
  const layout = resolveNativeLayout(targetExePath, platform);
  const resolvedTargetPath = layout.canonicalPath;
  if (
    platform === "win32" &&
    path.basename(layout.requestedPath).toLowerCase() === "cc.exe" &&
    !lstatOrNull(resolvedTargetPath)
  ) {
    throw new ApplyError(
      "cc.exe is not a managed alias because its canonical chainlesschain.exe is missing",
      "UNMANAGED_ALIAS",
    );
  }
  // Prefer a precise missing/unsafe staging error before checking its
  // placement or the externally supplied digest. The digest is still
  // mandatory before dry-run planning or any transaction can proceed.
  assertApplyPath(resolvedNewPath, "new executable", false, platform);
  if (!sameDirectory(resolvedNewPath, resolvedTargetPath, platform)) {
    throw new ApplyError(
      "newExePath must be staged in the canonical executable directory",
      "STAGING_NOT_SIBLING",
    );
  }
  const expectedSha = validateExpectedSha(expectedSha256);

  const statePaths = nativeUpdatePaths(resolvedTargetPath);
  assertApplyPath(resolvedTargetPath, "canonical executable", true, platform);
  if (layout.aliasPath) {
    assertApplyPath(layout.aliasPath, "managed CLI alias", true, platform);
  }
  for (const [label, filePath] of Object.entries({
    "last-known-good backup": statePaths.backupPath,
    "update lock": statePaths.lockPath,
    "update lineage": statePaths.lineagePath,
    "update result": statePaths.resultPath,
    "last consumed update result": statePaths.lastResultPath,
  })) {
    assertApplyPath(filePath, label, true, platform);
  }

  if (dryRun) {
    return buildPlan({
      platform,
      action: "dry-run",
      layout,
      resolvedNewPath,
      statePaths,
      restart,
      expectedSha,
      transactionId: null,
      sidecarPath: null,
    });
  }

  if (lstatOrNull(statePaths.lastResultPath)) {
    let lastResult;
    try {
      lastResult = readNativeUpdateResult(statePaths.lastResultPath, {
        label: "last consumed native update result",
        platform,
      });
    } catch (error) {
      throw asApplyError(error, error.code || "RESULT_INVALID");
    }
    if (nativeResultRequiresRecovery(lastResult)) {
      throw new ApplyError(
        `the previous native update could not roll back safely; recover before updating again: ${statePaths.lastResultPath}`,
        "RECOVERY_REQUIRED",
      );
    }
  }

  if (lstatOrNull(statePaths.resultPath)) {
    throw new ApplyError(
      `an unconsumed native update result exists: ${statePaths.resultPath}`,
      "RESULT_PENDING",
    );
  }

  const updateLock = acquireUpdateLock(statePaths.lockPath, platform);
  const transactionId = crypto.randomUUID();
  try {
    // A path component can be replaced while lock acquisition is in flight.
    // Repeat all trust-boundary checks while holding the shared installer/OTA
    // lock, before reading or mutating any transaction state.
    assertApplyPath(resolvedNewPath, "new executable", false, platform);
    assertApplyPath(resolvedTargetPath, "canonical executable", true, platform);
    if (layout.aliasPath) {
      assertApplyPath(layout.aliasPath, "managed CLI alias", true, platform);
    }
    for (const [label, filePath] of Object.entries({
      "last-known-good backup": statePaths.backupPath,
      "update lineage": statePaths.lineagePath,
      "update result": statePaths.resultPath,
      "last consumed update result": statePaths.lastResultPath,
    })) {
      assertApplyPath(filePath, label, true, platform);
    }
    // Bind apply to the exact bytes accepted by the downloader. Windows does
    // this again in the sidecar after the parent exits.
    assertExpectedFileHash(resolvedNewPath, expectedSha, "new executable");
    const hadTarget = Boolean(lstatOrNull(resolvedTargetPath));
    const hadAlias = Boolean(layout.aliasPath && lstatOrNull(layout.aliasPath));
    const targetBeforeSha = hadTarget
      ? stableSha256(resolvedTargetPath, "canonical executable")
      : null;
    const aliasBeforeSha = hadAlias
      ? stableSha256(layout.aliasPath, "managed CLI alias")
      : null;
    const orphaned = hadTarget
      ? []
      : quarantineFreshState(statePaths, transactionId, platform, updateLock);
    const hadPriorBackup = Boolean(lstatOrNull(statePaths.backupPath));
    const priorBackupSha = hadPriorBackup
      ? stableSha256(statePaths.backupPath, "existing last-known-good backup")
      : null;

    if (platform === "win32") {
      return scheduleWindowsTransaction({
        operation: "update",
        resolvedNewPath,
        layout,
        statePaths,
        updateLock,
        transactionId,
        expectedSha,
        targetBeforeSha,
        aliasBeforeSha,
        hadTarget,
        hadAlias,
        hadPriorBackup,
        priorBackupSha,
        parentPid,
        restart: Boolean(restart),
        verify: Boolean(verify),
        spawnImpl,
        waitForReadyImpl,
        orphaned,
      });
    }

    return applyPosixUpdate({
      resolvedNewPath,
      layout,
      statePaths,
      updateLock,
      transactionId,
      expectedSha,
      targetBeforeSha,
      hadTarget,
      hadPriorBackup,
      restart: Boolean(restart),
      verify: Boolean(verify),
      spawnImpl,
      verifyImpl,
      orphaned,
    });
  } catch (error) {
    if (error?.code === "ROLLBACK_FAILED") {
      retainUpdateLockForRecovery(updateLock);
    }
    throw error;
  } finally {
    if (!updateLock.transferred) releaseUpdateLock(updateLock);
  }
}

function applyPosixUpdate(ctx) {
  const {
    resolvedNewPath,
    layout,
    statePaths,
    updateLock,
    transactionId,
    expectedSha,
    targetBeforeSha,
    hadTarget,
    hadPriorBackup,
    restart,
    verify,
    spawnImpl,
    verifyImpl,
    orphaned,
  } = ctx;
  const targetPath = layout.canonicalPath;
  let backupStagingPath = null;
  let backupCommitted = false;

  if (hadTarget) {
    backupStagingPath = uniqueSibling(statePaths.backupPath, "pending");
    try {
      atomicCopyFile(targetPath, backupStagingPath, {
        preserveModeFrom: targetPath,
        updateLock,
      });
      assertExpectedFileHash(
        backupStagingPath,
        targetBeforeSha,
        "pending last-known-good backup",
      );
    } catch (error) {
      removeRegularFileIfPresent(backupStagingPath);
      throw asApplyError(error, "BACKUP_FAILED", "could not create backup");
    }
  }

  try {
    fs.chmodSync(resolvedNewPath, 0o755);
  } catch {
    /* verification remains authoritative on filesystems without POSIX modes */
  }

  try {
    if (hadTarget) {
      assertExpectedFileHash(
        targetPath,
        targetBeforeSha,
        "canonical executable before update commit",
      );
    }
    // These are intentionally the final candidate and lock reads before the
    // canonical rename. If an operator replaces the token pathname while a
    // long-running transaction is staged, the old owner must stop here.
    assertExpectedFileHash(resolvedNewPath, expectedSha, "new executable");
    assertUpdateLockOwned(updateLock);
    fs.renameSync(resolvedNewPath, targetPath);
    fsyncDirectory(path.dirname(targetPath));
  } catch (error) {
    removeRegularFileIfPresent(backupStagingPath);
    if (error instanceof ApplyError) throw error;
    throw new ApplyError(`rename failed: ${error.message}`, "RENAME_FAILED");
  }

  let commitFailure = null;
  try {
    assertExpectedFileHash(
      targetPath,
      expectedSha,
      "canonical executable after update commit",
    );
  } catch (error) {
    commitFailure = new ApplyError(
      `post-commit SHA-256 verification failed: ${error.message}`,
      "POST_COMMIT_HASH_FAILED",
    );
  }
  if (!commitFailure && verify) {
    commitFailure = verificationFailure(targetPath, verifyImpl);
  }
  if (!commitFailure) {
    try {
      if (hadTarget) {
        assertUpdateLockOwned(updateLock);
        fs.renameSync(backupStagingPath, statePaths.backupPath);
        backupStagingPath = null;
        backupCommitted = true;
        fsyncDirectory(path.dirname(targetPath));
      }
    } catch (error) {
      commitFailure = new ApplyError(
        `could not persist last-known-good backup: ${error.message}`,
        "BACKUP_COMMIT_FAILED",
      );
    }
  }
  if (!commitFailure) {
    try {
      atomicWriteJson(
        statePaths.lineagePath,
        makeLineage({
          transactionId,
          operation: "update",
          currentSha256: expectedSha,
          previousSha256: hadTarget ? targetBeforeSha : null,
        }),
        updateLock,
      );
    } catch (error) {
      commitFailure = new ApplyError(
        `could not persist update lineage: ${error.message}`,
        "LINEAGE_WRITE_FAILED",
      );
    }
  }

  if (commitFailure) {
    rollbackFailedPosixUpdate({
      targetPath,
      statePaths,
      transactionId,
      hadTarget,
      targetBeforeSha,
      rollbackSourcePath: backupStagingPath || statePaths.backupPath,
      backupCommitted,
      hadPriorBackup,
      updateLock,
    });
    removeRegularFileIfPresent(backupStagingPath);
    throw commitFailure;
  }

  restartVerifiedExecutable(targetPath, restart, spawnImpl);
  return buildPlan({
    platform: "posix",
    action: "replace-in-place",
    layout,
    resolvedNewPath,
    statePaths,
    restart,
    expectedSha,
    transactionId,
    sidecarPath: null,
    orphaned,
  });
}

function rollbackFailedPosixUpdate(ctx) {
  const {
    targetPath,
    statePaths,
    transactionId,
    hadTarget,
    targetBeforeSha,
    rollbackSourcePath,
    backupCommitted,
    hadPriorBackup,
    updateLock,
  } = ctx;
  const failedPath = uniqueSibling(targetPath, "failed");
  try {
    if (hadTarget) {
      try {
        atomicCopyFile(targetPath, failedPath, {
          preserveModeFrom: targetPath,
          updateLock,
        });
      } catch {
        /* preserving rejected bytes must never block restoration */
      }
      atomicCopyFile(rollbackSourcePath, targetPath, {
        preserveModeFrom: rollbackSourcePath,
        updateLock,
      });
      assertExpectedFileHash(
        targetPath,
        targetBeforeSha,
        "restored executable",
      );
      // When the pending backup was never committed, the old target,
      // `.previous`, and lineage are once again the exact pre-transaction
      // state. Preserve that lineage instead of fabricating a relationship to
      // a backup that was never installed.
      if (backupCommitted) {
        atomicWriteJson(
          statePaths.lineagePath,
          makeLineage({
            transactionId,
            operation: "rolled-back",
            currentSha256: targetBeforeSha,
            previousSha256: targetBeforeSha,
          }),
          updateLock,
        );
      } else if (!hadPriorBackup) {
        assertUpdateLockOwned(updateLock);
        fs.renameSync(rollbackSourcePath, statePaths.backupPath);
        fsyncDirectory(path.dirname(targetPath));
        atomicWriteJson(
          statePaths.lineagePath,
          makeLineage({
            transactionId,
            operation: "rolled-back",
            currentSha256: targetBeforeSha,
            previousSha256: targetBeforeSha,
          }),
          updateLock,
        );
      }
    } else {
      assertUpdateLockOwned(updateLock);
      fs.renameSync(targetPath, failedPath);
      fsyncDirectory(path.dirname(targetPath));
      assertUpdateLockOwned(updateLock);
      removeRegularFileIfPresent(statePaths.lineagePath);
    }
  } catch (error) {
    throw new ApplyError(
      `new binary failed and rollback failed: ${error.message}`,
      "ROLLBACK_FAILED",
    );
  }
}

function scheduleWindowsTransaction(ctx) {
  const {
    operation,
    resolvedNewPath,
    layout,
    statePaths,
    updateLock,
    transactionId,
    expectedSha,
    targetBeforeSha,
    aliasBeforeSha,
    hadTarget,
    hadAlias,
    hadPriorBackup = false,
    priorBackupSha = null,
    parentPid,
    restart,
    verify,
    spawnImpl,
    waitForReadyImpl,
    orphaned = [],
  } = ctx;
  let sidecarPath = null;
  try {
    const windowsSystemRoot = resolveTrustedWindowsSystemRoot();
    sidecarPath = writeWindowsSidecar({
      operation,
      newExePath: resolvedNewPath,
      targetExePath: layout.canonicalPath,
      aliasPath: layout.aliasPath,
      backupPath: statePaths.backupPath,
      lineagePath: statePaths.lineagePath,
      lockPath: statePaths.lockPath,
      resultPath: statePaths.resultPath,
      lockToken: updateLock.token,
      transactionId,
      expectedSha256: expectedSha,
      targetBeforeSha256: targetBeforeSha,
      aliasBeforeSha256: aliasBeforeSha,
      hadTarget,
      hadAlias,
      hadPriorBackup,
      priorBackupSha256: priorBackupSha,
      parentPid,
      restart,
      verify,
      windowsSystemRoot,
    });
    const readyPath = `${sidecarPath}.ready`;

    // Keep ownership in the token file, but close the Windows handle so the
    // sidecar can hash/read that file during its readiness preflight. A failed
    // spawn is still cleaned up by the parent because `transferred` remains
    // false until the marker is validated.
    closeUpdateLockHandle(updateLock);
    let child;
    try {
      child = spawnImpl(
        path.win32.join(windowsSystemRoot, "System32", "cmd.exe"),
        ["/d", "/c", sidecarPath],
        {
          origin: "packer:update-sidecar",
          scope: "pack-update",
          policy: "allow",
          shell: false,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );
    } catch (error) {
      throw new ApplyError(
        `could not start update sidecar: ${error.message}`,
        "SIDECAR_SPAWN_FAILED",
      );
    }
    if (!child) {
      throw new ApplyError(
        "update sidecar spawn returned no child process",
        "SIDECAR_SPAWN_FAILED",
      );
    }

    let ready = false;
    let childError = null;
    if (typeof child.once === "function") {
      // Native spawn failures are normally emitted asynchronously. Attach
      // before the synchronous readiness wait so both the no-ready and the
      // post-transfer paths always consume the ChildProcess error event.
      child.once("error", (error) => {
        childError = error;
        if (ready) {
          removeOwnedLockFile(updateLock);
          removeRegularFileIfPresent(sidecarPath);
          removeRegularFileIfPresent(readyPath);
        }
      });
    }
    try {
      ready =
        Boolean(
          waitForReadyImpl({
            readyPath,
            transactionId,
            timeoutMs: 10_000,
            child,
          }),
        ) && !childError;
    } catch {
      ready = false;
    }
    if (!ready) {
      try {
        if (typeof child.kill === "function") child.kill();
      } catch {
        /* the owned lock still prevents a late sidecar commit */
      }
      // Do not unlink through a path whose sidecar safety checks never
      // completed. Close our handle and deliberately leave the token file as
      // a fail-closed recovery marker.
      closeUpdateLockHandle(updateLock);
      updateLock.transferred = true;
      throw new ApplyError(
        "Windows update sidecar did not complete its safety handshake",
        "SIDECAR_NOT_READY",
      );
    }
    removeRegularFileIfPresent(readyPath);

    updateLock.transferred = true;
    if (typeof child.unref === "function") child.unref();

    return buildPlan({
      platform: "win32",
      action: "sidecar-cmd",
      layout,
      resolvedNewPath,
      statePaths,
      restart,
      expectedSha,
      transactionId,
      sidecarPath,
      orphaned,
    });
  } catch (error) {
    if (sidecarPath) removeRegularFileIfPresent(sidecarPath);
    if (sidecarPath) removeRegularFileIfPresent(`${sidecarPath}.ready`);
    if (error instanceof ApplyError) throw error;
    throw new ApplyError(
      `could not schedule Windows replacement: ${error.message}`,
      "SIDECAR_FAILED",
    );
  }
}

/**
 * Windows sidecar for both forward update and independent rescue.
 * Every caller must pass the observed pre-state and lock token.
 */
export function writeWindowsSidecar(ctx) {
  const {
    operation = "update",
    newExePath,
    targetExePath,
    aliasPath = null,
    backupPath = `${targetExePath}.previous`,
    lineagePath = `${targetExePath}.update-lineage.json`,
    lockPath = `${targetExePath}.update.lock`,
    resultPath = `${targetExePath}.update-result.json`,
    lockToken,
    transactionId = crypto.randomUUID(),
    expectedSha256,
    targetBeforeSha256 = null,
    aliasBeforeSha256 = null,
    hadTarget,
    hadAlias = false,
    hadPriorBackup = false,
    priorBackupSha256 = null,
    parentPid,
    restart,
    verify = true,
    windowsSystemRoot = resolveTrustedWindowsSystemRoot(),
  } = ctx;

  if (!["update", "rescue"].includes(operation)) {
    throw new ApplyError("invalid sidecar operation", "BAD_OPERATION");
  }
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
    throw new ApplyError(
      "parentPid must be a positive integer",
      "BAD_PARENT_PID",
    );
  }
  if (typeof hadTarget !== "boolean" || typeof hadAlias !== "boolean") {
    throw new ApplyError(
      "sidecar requires explicit hadTarget/hadAlias state",
      "MISSING_PRESTATE",
    );
  }
  if (typeof hadPriorBackup !== "boolean") {
    throw new ApplyError(
      "sidecar requires explicit prior backup state",
      "MISSING_PRESTATE",
    );
  }
  const expectedSha = validateExpectedSha(expectedSha256);
  if (hadTarget) validateExpectedSha(targetBeforeSha256, "targetBeforeSha256");
  if (hadAlias) validateExpectedSha(aliasBeforeSha256, "aliasBeforeSha256");
  if (hadPriorBackup) {
    validateExpectedSha(priorBackupSha256, "priorBackupSha256");
  }
  if (!lockToken || !/^[0-9]+:[0-9a-f-]{32,36}$/i.test(lockToken)) {
    throw new ApplyError(
      "a valid lock ownership token is required",
      "BAD_LOCK_TOKEN",
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) {
    throw new ApplyError(
      "a valid transactionId is required",
      "BAD_TRANSACTION_ID",
    );
  }

  const suffix = transactionId.replaceAll("-", "");
  const lockTokenSha = crypto
    .createHash("sha256")
    .update(lockToken, "utf8")
    .digest("hex");
  const sidecarPath = path.join(os.tmpdir(), `cc-pack-apply-${suffix}.cmd`);
  const readyPath = `${sidecarPath}.ready`;
  const parentProbePath = `${sidecarPath}.parent`;
  const backupTempPath = `${backupPath}.tmp-${suffix}`;
  const currentTempPath = `${targetExePath}.rescue-current-${suffix}`;
  const rollbackTempPath = `${targetExePath}.rollback-${suffix}`;
  const failedPath = `${targetExePath}.failed-${suffix}`;
  const aliasCandidatePath = aliasPath
    ? `${aliasPath}.candidate-${suffix}`
    : targetExePath;
  const aliasBackupPath = aliasPath
    ? `${aliasPath}.previous-${suffix}`
    : targetExePath;
  const aliasRollbackPath = aliasPath
    ? `${aliasPath}.rollback-${suffix}`
    : targetExePath;
  const lineageTempPath = `${lineagePath}.tmp-${suffix}`;
  const resultTempPath = `${resultPath}.tmp-${suffix}`;

  const allPaths = {
    windowsSystemRoot,
    sidecarPath,
    readyPath,
    parentProbePath,
    newExePath,
    targetExePath,
    backupPath,
    lineagePath,
    lockPath,
    resultPath,
    backupTempPath,
    currentTempPath,
    rollbackTempPath,
    failedPath,
    lineageTempPath,
    resultTempPath,
  };
  if (aliasPath) {
    Object.assign(allPaths, {
      aliasPath,
      aliasCandidatePath,
      aliasBackupPath,
      aliasRollbackPath,
    });
  }
  for (const [label, value] of Object.entries(allPaths)) {
    assertWindowsCmdSafePath(value, label);
  }

  const successLineage = makeLineage({
    transactionId,
    operation,
    currentSha256: expectedSha,
    previousSha256:
      operation === "update"
        ? hadTarget
          ? targetBeforeSha256
          : null
        : expectedSha,
  });
  const rolledBackLineage = hadTarget
    ? makeLineage({
        transactionId,
        operation: "rolled-back",
        currentSha256: targetBeforeSha256,
        previousSha256: targetBeforeSha256,
      })
    : null;
  const rollbackSourcePath =
    operation === "update" ? backupTempPath : currentTempPath;
  const reparseChecks = buildWindowsReparseChecks(Object.values(allPaths));
  const startupCheck = buildWindowsTimedStartupCheckLines();

  const cmd = [
    "@echo off",
    "setlocal EnableExtensions DisableDelayedExpansion",
    `set "CC_SYSTEM_ROOT=${windowsSystemRoot}"`,
    '"%CC_SYSTEM_ROOT%\\System32\\chcp.com" 65001 >NUL',
    `set "PARENT_PID=${parentPid}"`,
    `set "OPERATION=${operation}"`,
    `set "TRANSACTION_ID=${transactionId}"`,
    `set "NEW_EXE=${newExePath}"`,
    `set "TARGET_EXE=${targetExePath}"`,
    `set "ALIAS_EXE=${aliasPath || ""}"`,
    `set "BACKUP_EXE=${backupPath}"`,
    `set "BACKUP_TEMP=${backupTempPath}"`,
    `set "CURRENT_TEMP=${currentTempPath}"`,
    `set "ROLLBACK_SOURCE=${rollbackSourcePath}"`,
    `set "ROLLBACK_TEMP=${rollbackTempPath}"`,
    `set "FAILED_EXE=${failedPath}"`,
    `set "ALIAS_CANDIDATE=${aliasCandidatePath}"`,
    `set "ALIAS_BACKUP=${aliasBackupPath}"`,
    `set "ALIAS_ROLLBACK=${aliasRollbackPath}"`,
    `set "LINEAGE_FILE=${lineagePath}"`,
    `set "LINEAGE_TEMP=${lineageTempPath}"`,
    `set "LOCK_FILE=${lockPath}"`,
    `set "LOCK_TOKEN=${lockToken}"`,
    `set "LOCK_TOKEN_SHA=${lockTokenSha}"`,
    `set "RESULT_FILE=${resultPath}"`,
    `set "RESULT_TEMP=${resultTempPath}"`,
    `set "READY_FILE=${readyPath}"`,
    `set "PARENT_PROBE=${parentProbePath}"`,
    `set "EXPECTED_SHA=${expectedSha}"`,
    `set "TARGET_BEFORE_SHA=${targetBeforeSha256 || ""}"`,
    `set "ALIAS_BEFORE_SHA=${aliasBeforeSha256 || ""}"`,
    `set "HAD_TARGET=${hadTarget ? "1" : "0"}"`,
    `set "HAD_ALIAS=${hadAlias ? "1" : "0"}"`,
    `set "HAD_BACKUP=${hadPriorBackup ? "1" : "0"}"`,
    `set "BACKUP_BEFORE_SHA=${priorBackupSha256 || ""}"`,
    `set "MANAGE_ALIAS=${aliasPath ? "1" : "0"}"`,
    'set "TARGET_COMMITTED=0"',
    'set "ALIAS_COMMITTED=0"',
    'set "BACKUP_COMMITTED=0"',
    'set "ROLLBACK_OK=1"',
    'set "RESULT_STATUS=not-started"',
    'set "FAIL_STATUS=transaction-failed"',
    'set "EXIT_CODE=1"',
    'set "WRITE_RESULT=1"',
    'set "SKIP_PATH_CLEANUP=0"',
    `set "RESTART_REQUESTED=${restart ? "1" : "0"}"`,
    // The parent transfers lock ownership only after this preflight marker is
    // visible. Everything is checked again after the parent exits.
    "call :checklock",
    "if errorlevel 1 goto locklost",
    'if not exist "%CC_SYSTEM_ROOT%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" goto safetycheckfailed',
    ...reparseChecks,
    `> "%READY_FILE%" echo ${transactionId}`,
    "if errorlevel 1 goto readyfailed",
    "set /a ATTEMPTS=0",
    ":waitloop",
    // Do not pipe tasklist directly into findstr. A detached cmd.exe with
    // ignored stdio can retain the anonymous pipe writer and deadlock findstr
    // after tasklist exits. The transaction-scoped regular file also lets us
    // distinguish a failed tasklist probe from a genuinely absent parent.
    '"%CC_SYSTEM_ROOT%\\System32\\tasklist.exe" /FI "PID eq %PARENT_PID%" /FO CSV /NH > "%PARENT_PROBE%" 2>NUL',
    "if errorlevel 1 goto parentcheckfailed",
    '"%CC_SYSTEM_ROOT%\\System32\\findstr.exe" /L /C:"%PARENT_PID%" "%PARENT_PROBE%" >NUL 2>&1',
    "if errorlevel 1 goto doreplace",
    "set /a ATTEMPTS=%ATTEMPTS%+1",
    "if %ATTEMPTS% GEQ 120 goto parenttimeout",
    // timeout.exe rejects redirected stdin and would turn the 120-second wait
    // into a tight loop under stdio:"ignore". Loopback ping provides a trusted
    // one-second delay without reading the detached child's stdin.
    '"%CC_SYSTEM_ROOT%\\System32\\ping.exe" -n 2 -w 1000 127.0.0.1 >NUL',
    "if errorlevel 1 goto parentcheckfailed",
    "goto waitloop",
    ":doreplace",
    "call :checklock",
    "if errorlevel 1 goto locklost",
    'if not exist "%CC_SYSTEM_ROOT%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" goto safetycheckfailed',
    ...reparseChecks,
    "call :checkprestate",
    "if errorlevel 1 goto stateconflict",
    'set "HASH_PATH=%NEW_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto hashfailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto hashmismatch',
    'if "%OPERATION%"=="rescue" goto stagerescue',
    'if "%HAD_TARGET%"=="0" goto stagealias',
    'copy /B /Y "%TARGET_EXE%" "%BACKUP_TEMP%" >NUL',
    "if errorlevel 1 goto backupfailed",
    'set "HASH_PATH=%BACKUP_TEMP%"',
    "call :hashpath",
    "if errorlevel 1 goto backupfailed",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto backupfailed',
    "goto stagealias",
    ":stagerescue",
    'if "%HAD_TARGET%"=="0" goto stagealias',
    'copy /B /Y "%TARGET_EXE%" "%CURRENT_TEMP%" >NUL',
    "if errorlevel 1 goto backupfailed",
    'set "HASH_PATH=%CURRENT_TEMP%"',
    "call :hashpath",
    "if errorlevel 1 goto backupfailed",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto backupfailed',
    ":stagealias",
    'if "%MANAGE_ALIAS%"=="0" goto precommitcheck',
    'if "%HAD_ALIAS%"=="0" goto makealiascandidate',
    'copy /B /Y "%ALIAS_EXE%" "%ALIAS_BACKUP%" >NUL',
    "if errorlevel 1 goto aliasstagefailed",
    ":makealiascandidate",
    'copy /B /Y "%NEW_EXE%" "%ALIAS_CANDIDATE%" >NUL',
    "if errorlevel 1 goto aliasstagefailed",
    'set "HASH_PATH=%ALIAS_CANDIDATE%"',
    "call :hashpath",
    "if errorlevel 1 goto aliasstagefailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto aliasstagefailed',
    ":precommitcheck",
    // Re-hash after all potentially slow backup work, immediately before move.
    'set "HASH_PATH=%NEW_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto hashfailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto hashmismatch',
    // Ownership and path safety are checked again at the actual commit edge,
    // after all slow copies and hash processes have completed.
    "call :checklock",
    "if errorlevel 1 goto locklost",
    ...reparseChecks,
    "call :checkprestate",
    "if errorlevel 1 goto stateconflict",
    'move /Y "%NEW_EXE%" "%TARGET_EXE%" >NUL',
    "if errorlevel 1 goto movefailed",
    'set "TARGET_COMMITTED=1"',
    'if "%MANAGE_ALIAS%"=="0" goto verifytransaction',
    'move /Y "%ALIAS_CANDIDATE%" "%ALIAS_EXE%" >NUL',
    "if errorlevel 1 goto aliascommitfailed",
    'set "ALIAS_COMMITTED=1"',
    ":verifytransaction",
    // Hash committed pathnames before executing either binary or persisting
    // backup/lineage. This catches a candidate pathname exchange in the final
    // precommit safety window as well as alias commit substitution.
    'set "HASH_PATH=%TARGET_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto postcommithashfailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto postcommithashfailed',
    'if "%MANAGE_ALIAS%"=="0" goto startupverify',
    'set "HASH_PATH=%ALIAS_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto postcommithashfailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto postcommithashfailed',
    ":startupverify",
    ...(verify
      ? [
          'set "VERIFY_PATH=%TARGET_EXE%"',
          ...startupCheck,
          'if "%MANAGE_ALIAS%"=="0" goto writelineage',
          'set "VERIFY_PATH=%ALIAS_EXE%"',
          ...startupCheck,
        ]
      : ["REM post-replace verification disabled"]),
    ":writelineage",
    'if not "%OPERATION%"=="update" goto persistlineage',
    'if "%HAD_TARGET%"=="0" goto persistlineage',
    'move /Y "%BACKUP_TEMP%" "%BACKUP_EXE%" >NUL',
    "if errorlevel 1 goto backupcommitfailed",
    'set "BACKUP_COMMITTED=1"',
    'set "ROLLBACK_SOURCE=%BACKUP_EXE%"',
    ":persistlineage",
    `> "%LINEAGE_TEMP%" echo ${JSON.stringify(successLineage)}`,
    'move /Y "%LINEAGE_TEMP%" "%LINEAGE_FILE%" >NUL',
    "if errorlevel 1 goto lineagefailed",
    restart
      ? "REM restart deferred until result persistence"
      : "REM restart not requested",
    'set "RESULT_STATUS=success"',
    'set "EXIT_CODE=0"',
    "goto cleanup",
    ":verifyfailed",
    'set "FAIL_STATUS=verify-failed"',
    "goto rollbacktransaction",
    ":postcommithashfailed",
    'set "FAIL_STATUS=post-commit-hash-failed"',
    "goto rollbacktransaction",
    ":aliascommitfailed",
    'set "FAIL_STATUS=alias-commit-failed"',
    "goto rollbacktransaction",
    ":lineagefailed",
    'set "FAIL_STATUS=lineage-write-failed"',
    "goto rollbacktransaction",
    ":rollbacktransaction",
    'if not "%TARGET_COMMITTED%"=="1" goto rollbackalias',
    'copy /B /Y "%TARGET_EXE%" "%FAILED_EXE%" >NUL 2>&1',
    'if "%HAD_TARGET%"=="0" goto removefreshcanonical',
    'copy /B /Y "%ROLLBACK_SOURCE%" "%ROLLBACK_TEMP%" >NUL',
    "if errorlevel 1 goto targetrollbackfailed",
    'move /Y "%ROLLBACK_TEMP%" "%TARGET_EXE%" >NUL',
    "if errorlevel 1 goto targetrollbackfailed",
    'set "HASH_PATH=%TARGET_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto targetrollbackfailed",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto targetrollbackfailed',
    "goto rollbackalias",
    ":removefreshcanonical",
    'del /F /Q "%TARGET_EXE%" >NUL 2>&1',
    'if exist "%TARGET_EXE%" goto targetrollbackfailed',
    "goto rollbackalias",
    ":targetrollbackfailed",
    'set "ROLLBACK_OK=0"',
    ":rollbackalias",
    'if not "%ALIAS_COMMITTED%"=="1" goto finishrollback',
    'if "%HAD_ALIAS%"=="0" goto removefreshalias',
    'copy /B /Y "%ALIAS_BACKUP%" "%ALIAS_ROLLBACK%" >NUL',
    "if errorlevel 1 goto aliasrollbackfailed",
    'move /Y "%ALIAS_ROLLBACK%" "%ALIAS_EXE%" >NUL',
    "if errorlevel 1 goto aliasrollbackfailed",
    'set "HASH_PATH=%ALIAS_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto aliasrollbackfailed",
    'if /I not "%OBSERVED_SHA%"=="%ALIAS_BEFORE_SHA%" goto aliasrollbackfailed',
    "goto finishrollback",
    ":removefreshalias",
    'del /F /Q "%ALIAS_EXE%" >NUL 2>&1',
    'if exist "%ALIAS_EXE%" goto aliasrollbackfailed',
    "goto finishrollback",
    ":aliasrollbackfailed",
    'set "ROLLBACK_OK=0"',
    ":finishrollback",
    'if "%ROLLBACK_OK%"=="0" goto rollbackfailed',
    ...(operation === "update" && rolledBackLineage
      ? [
          'if "%BACKUP_COMMITTED%"=="1" goto writerolledbacklineage',
          'if "%HAD_BACKUP%"=="1" goto rollbackstatecomplete',
          'move /Y "%BACKUP_TEMP%" "%BACKUP_EXE%" >NUL',
          "if errorlevel 1 goto rollbackstatecomplete",
          'set "BACKUP_COMMITTED=1"',
          ":writerolledbacklineage",
          `> "%LINEAGE_TEMP%" echo ${JSON.stringify(rolledBackLineage)}`,
          'move /Y "%LINEAGE_TEMP%" "%LINEAGE_FILE%" >NUL 2>&1',
          "if errorlevel 1 goto rollbacklineagefailed",
          ":rollbackstatecomplete",
        ]
      : []),
    'set "RESULT_STATUS=%FAIL_STATUS%-rolled-back"',
    "goto cleanup",
    ":rollbackfailed",
    'set "RESULT_STATUS=%FAIL_STATUS%-rollback-failed"',
    "goto cleanup",
    ":rollbacklineagefailed",
    'set "ROLLBACK_OK=0"',
    'set "FAIL_STATUS=rollback-lineage-write-failed"',
    "goto rollbackfailed",
    ":parenttimeout",
    'set "RESULT_STATUS=parent-timeout"',
    "goto cleanup",
    ":parentcheckfailed",
    'set "RESULT_STATUS=parent-check-failed"',
    "goto cleanup",
    ":safetycheckfailed",
    'set "RESULT_STATUS=safety-check-unavailable"',
    'set "WRITE_RESULT=0"',
    'set "SKIP_PATH_CLEANUP=1"',
    "goto cleanup",
    ":unsafepath",
    'set "RESULT_STATUS=unsafe-reparse-path"',
    'set "WRITE_RESULT=0"',
    'set "SKIP_PATH_CLEANUP=1"',
    "goto cleanup",
    ":stateconflict",
    'set "RESULT_STATUS=prestate-conflict"',
    "goto cleanup",
    ":hashfailed",
    'set "RESULT_STATUS=hash-check-failed"',
    "goto cleanup",
    ":hashmismatch",
    'set "RESULT_STATUS=sha256-mismatch"',
    "goto cleanup",
    ":backupfailed",
    'set "RESULT_STATUS=backup-failed"',
    "goto cleanup",
    ":backupcommitfailed",
    'set "FAIL_STATUS=backup-commit-failed"',
    "goto rollbacktransaction",
    ":aliasstagefailed",
    'set "RESULT_STATUS=alias-stage-failed"',
    "goto cleanup",
    ":movefailed",
    'set "RESULT_STATUS=move-failed"',
    "goto cleanup",
    ":locklost",
    'set "RESULT_STATUS=lock-ownership-lost"',
    'set "WRITE_RESULT=0"',
    "goto cleanup",
    ":readyfailed",
    'set "WRITE_RESULT=0"',
    'set "SKIP_PATH_CLEANUP=1"',
    "goto cleanup",
    ":cleanup",
    'if "%SKIP_PATH_CLEANUP%"=="1" goto unsafeexit',
    'if "%ROLLBACK_OK%"=="1" del /F /Q "%BACKUP_TEMP%" >NUL 2>&1',
    'if "%ROLLBACK_OK%"=="1" del /F /Q "%CURRENT_TEMP%" >NUL 2>&1',
    'if "%ROLLBACK_OK%"=="1" del /F /Q "%ROLLBACK_TEMP%" >NUL 2>&1',
    'if "%MANAGE_ALIAS%"=="1" del /F /Q "%ALIAS_CANDIDATE%" >NUL 2>&1',
    'if "%ROLLBACK_OK%"=="1" if "%MANAGE_ALIAS%"=="1" del /F /Q "%ALIAS_BACKUP%" >NUL 2>&1',
    'if "%ROLLBACK_OK%"=="1" if "%MANAGE_ALIAS%"=="1" del /F /Q "%ALIAS_ROLLBACK%" >NUL 2>&1',
    'del /F /Q "%LINEAGE_TEMP%" >NUL 2>&1',
    'del /F /Q "%READY_FILE%" >NUL 2>&1',
    'del /F /Q "%PARENT_PROBE%" >NUL 2>&1',
    'if "%WRITE_RESULT%"=="0" goto releaselock',
    `> "%RESULT_TEMP%" echo {"schema":"${NATIVE_UPDATE_RESULT_SCHEMA}","transactionId":"${transactionId}","operation":"${operation}","status":"%RESULT_STATUS%","exitCode":%EXIT_CODE%,"hadTarget":${hadTarget ? "true" : "false"},"targetBeforeSha256":${targetBeforeSha256 ? `"${targetBeforeSha256}"` : "null"},"expectedSha256":"${expectedSha}","aliasManaged":${aliasPath ? "true" : "false"},"hadAlias":${hadAlias ? "true" : "false"},"aliasBeforeSha256":${aliasBeforeSha256 ? `"${aliasBeforeSha256}"` : "null"}}`,
    "if errorlevel 1 goto resultpersistfailed",
    'move /Y "%RESULT_TEMP%" "%RESULT_FILE%" >NUL 2>&1',
    "if errorlevel 1 goto resultpersistfailed",
    "goto releaselock",
    ":resultpersistfailed",
    // Keep the owned lock and result temp fail-closed: otherwise a detached
    // transaction could disappear without any durable observable outcome.
    'set "EXIT_CODE=1"',
    ":unsafeexit",
    '(goto) 2>NUL & del /F /Q "%~f0" & exit /b %EXIT_CODE%',
    ":releaselock",
    "call :checklock",
    'if not errorlevel 1 del /F /Q "%LOCK_FILE%" >NUL 2>&1',
    'if "%EXIT_CODE%"=="0" if "%RESTART_REQUESTED%"=="1" start "" "%TARGET_EXE%"',
    '(goto) 2>NUL & del /F /Q "%~f0" & exit /b %EXIT_CODE%',
    ":hashpath",
    'set "OBSERVED_SHA="',
    'for /f "usebackq delims=" %%H in (`%CC_SYSTEM_ROOT%\\System32\\certutil.exe -hashfile "%HASH_PATH%" SHA256 ^| %CC_SYSTEM_ROOT%\\System32\\findstr.exe /R /X /I "[0-9A-F][0-9A-F]*"`) do if not defined OBSERVED_SHA set "OBSERVED_SHA=%%H"',
    "if not defined OBSERVED_SHA exit /b 1",
    "exit /b 0",
    ":checklock",
    'set "HASH_PATH=%LOCK_FILE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%LOCK_TOKEN_SHA%" exit /b 1',
    "exit /b 0",
    ":checkprestate",
    'if "%HAD_TARGET%"=="1" goto prestate_target_present',
    'if exist "%TARGET_EXE%" exit /b 1',
    "goto prestate_alias",
    ":prestate_target_present",
    'if not exist "%TARGET_EXE%" exit /b 1',
    'set "HASH_PATH=%TARGET_EXE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" exit /b 1',
    ":prestate_alias",
    'if "%MANAGE_ALIAS%"=="0" goto prestate_backup',
    'if "%HAD_ALIAS%"=="1" goto prestate_alias_present',
    'if exist "%ALIAS_EXE%" exit /b 1',
    "goto prestate_backup",
    ":prestate_alias_present",
    'if not exist "%ALIAS_EXE%" exit /b 1',
    'set "HASH_PATH=%ALIAS_EXE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%ALIAS_BEFORE_SHA%" exit /b 1',
    ":prestate_backup",
    'if "%HAD_BACKUP%"=="1" goto prestate_backup_present',
    'if exist "%BACKUP_EXE%" exit /b 1',
    "exit /b 0",
    ":prestate_backup_present",
    'if not exist "%BACKUP_EXE%" exit /b 1',
    'set "HASH_PATH=%BACKUP_EXE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%BACKUP_BEFORE_SHA%" exit /b 1',
    "exit /b 0",
  ].join("\r\n");

  fs.writeFileSync(sidecarPath, `\uFEFF${cmd}`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return sidecarPath;
}

/**
 * Independent rescue path. It validates `.previous` against lineage, stages a
 * separate rescue candidate, and never rotates or consumes `.previous`.
 */
export async function rollbackLastKnownGood(ctx = {}) {
  const {
    targetExePath,
    backupPath: requestedBackupPath,
    restart = false,
    verify = true,
    platform = process.platform === "win32" ? "win32" : "posix",
    parentPid = process.pid,
    spawnImpl = _deps.spawn,
    verifyImpl = _deps.spawnSync,
    waitForReadyImpl = waitForWindowsSidecarReady,
    allowMissingTarget = false,
  } = ctx;
  validatePlatform(platform);
  if (!targetExePath || typeof targetExePath !== "string") {
    throw new ApplyError("targetExePath is required", "NO_TARGET_EXE");
  }

  const layout = resolveNativeLayout(targetExePath, platform);
  if (
    platform === "win32" &&
    path.basename(layout.requestedPath).toLowerCase() === "cc.exe" &&
    !lstatOrNull(layout.canonicalPath)
  ) {
    throw new ApplyError(
      "cc.exe is not a managed alias because its canonical chainlesschain.exe is missing",
      "UNMANAGED_ALIAS",
    );
  }
  const statePaths = nativeUpdatePaths(layout.canonicalPath);
  const backupPath = path.resolve(requestedBackupPath || statePaths.backupPath);
  if (!sameDirectory(backupPath, layout.canonicalPath, platform)) {
    throw new ApplyError(
      "backupPath must be in the canonical executable directory",
      "BACKUP_NOT_SIBLING",
    );
  }
  assertApplyPath(backupPath, "last-known-good backup", false, platform);
  assertApplyPath(statePaths.lineagePath, "update lineage", false, platform);
  assertApplyPath(layout.canonicalPath, "canonical executable", true, platform);
  if (layout.aliasPath) {
    assertApplyPath(layout.aliasPath, "managed CLI alias", true, platform);
  }

  const updateLock = acquireUpdateLock(statePaths.lockPath, platform);
  const transactionId = crypto.randomUUID();
  let rescueStagingPath = null;
  try {
    let lineage;
    try {
      lineage = readNativeLineage(statePaths.lineagePath);
    } catch (error) {
      throw asApplyError(error, error.code || "LINEAGE_INVALID");
    }
    if (!lineage.previousSha256) {
      throw new ApplyError(
        "lineage does not identify a previous executable",
        "NO_PREVIOUS_LINEAGE",
      );
    }
    const hadTarget = Boolean(lstatOrNull(layout.canonicalPath));
    if (!hadTarget && !allowMissingTarget) {
      throw new ApplyError(
        "canonical executable is missing; explicit allowMissingTarget is required for disaster rescue",
        "TARGET_MISSING_FOR_RESCUE",
      );
    }
    const targetBeforeSha = hadTarget
      ? stableSha256(layout.canonicalPath, "canonical executable")
      : null;
    if (hadTarget && targetBeforeSha !== lineage.currentSha256) {
      throw new ApplyError(
        "canonical executable does not match the current lineage generation",
        "LINEAGE_CURRENT_MISMATCH",
      );
    }
    assertExpectedFileHash(
      backupPath,
      lineage.previousSha256,
      "last-known-good backup",
    );

    rescueStagingPath = uniqueSibling(layout.canonicalPath, "rescue");
    atomicCopyFile(backupPath, rescueStagingPath, {
      preserveModeFrom: backupPath,
      updateLock,
    });
    assertExpectedFileHash(
      rescueStagingPath,
      lineage.previousSha256,
      "rescue staging executable",
    );

    const hadAlias = Boolean(layout.aliasPath && lstatOrNull(layout.aliasPath));
    const aliasBeforeSha = hadAlias
      ? stableSha256(layout.aliasPath, "managed CLI alias")
      : null;

    if (platform === "win32") {
      const result = scheduleWindowsTransaction({
        operation: "rescue",
        resolvedNewPath: rescueStagingPath,
        layout,
        statePaths: { ...statePaths, backupPath },
        updateLock,
        transactionId,
        expectedSha: lineage.previousSha256,
        targetBeforeSha,
        aliasBeforeSha,
        hadTarget,
        hadAlias,
        hadPriorBackup: true,
        priorBackupSha: lineage.previousSha256,
        parentPid,
        restart: Boolean(restart),
        verify: Boolean(verify),
        spawnImpl,
        waitForReadyImpl,
      });
      rescueStagingPath = null;
      return result;
    }

    const result = applyPosixRescue({
      rescueStagingPath,
      layout,
      statePaths,
      updateLock,
      transactionId,
      rescueSha: lineage.previousSha256,
      hadTarget,
      targetBeforeSha,
      restart: Boolean(restart),
      verify: Boolean(verify),
      spawnImpl,
      verifyImpl,
    });
    rescueStagingPath = null;
    return result;
  } catch (error) {
    if (error?.code === "RESCUE_ROLLBACK_FAILED") {
      retainUpdateLockForRecovery(updateLock);
    }
    throw error;
  } finally {
    if (rescueStagingPath) removeRegularFileIfPresent(rescueStagingPath);
    if (!updateLock.transferred) releaseUpdateLock(updateLock);
  }
}

function applyPosixRescue(ctx) {
  const {
    rescueStagingPath,
    layout,
    statePaths,
    updateLock,
    transactionId,
    rescueSha,
    hadTarget,
    targetBeforeSha,
    restart,
    verify,
    spawnImpl,
    verifyImpl,
  } = ctx;
  const targetPath = layout.canonicalPath;
  const currentSnapshotPath = uniqueSibling(targetPath, "rescue-current");
  if (hadTarget) {
    atomicCopyFile(targetPath, currentSnapshotPath, {
      preserveModeFrom: targetPath,
      updateLock,
    });
    assertExpectedFileHash(
      currentSnapshotPath,
      targetBeforeSha,
      "pre-rescue executable",
    );
  }

  assertExpectedFileHash(
    rescueStagingPath,
    rescueSha,
    "rescue staging executable",
  );
  if (hadTarget) {
    assertExpectedFileHash(
      targetPath,
      targetBeforeSha,
      "canonical executable before rescue commit",
    );
  }
  try {
    assertUpdateLockOwned(updateLock);
    fs.renameSync(rescueStagingPath, targetPath);
    fsyncDirectory(path.dirname(targetPath));
  } catch (error) {
    removeRegularFileIfPresent(currentSnapshotPath);
    throw new ApplyError(
      `rescue rename failed: ${error.message}`,
      "RESCUE_RENAME_FAILED",
    );
  }

  let failure = null;
  try {
    assertExpectedFileHash(
      targetPath,
      rescueSha,
      "canonical executable after rescue commit",
    );
  } catch (error) {
    failure = new ApplyError(
      `post-rescue SHA-256 verification failed: ${error.message}`,
      "POST_COMMIT_HASH_FAILED",
    );
  }
  if (!failure && verify) {
    failure = verificationFailure(targetPath, verifyImpl);
  }
  if (!failure) {
    try {
      atomicWriteJson(
        statePaths.lineagePath,
        makeLineage({
          transactionId,
          operation: "rescue",
          currentSha256: rescueSha,
          previousSha256: rescueSha,
        }),
        updateLock,
      );
    } catch (error) {
      failure = new ApplyError(
        `could not persist rescue lineage: ${error.message}`,
        "LINEAGE_WRITE_FAILED",
      );
    }
  }

  if (failure) {
    let restored = false;
    try {
      if (hadTarget) {
        atomicCopyFile(currentSnapshotPath, targetPath, {
          preserveModeFrom: currentSnapshotPath,
          updateLock,
        });
        assertExpectedFileHash(
          targetPath,
          targetBeforeSha,
          "restored pre-rescue executable",
        );
      } else {
        assertUpdateLockOwned(updateLock);
        fs.renameSync(targetPath, uniqueSibling(targetPath, "failed-rescue"));
      }
      restored = true;
    } catch (error) {
      throw new ApplyError(
        `rescue verification failed and pre-rescue restore failed; recovery snapshot preserved at ${currentSnapshotPath}: ${error.message}`,
        "RESCUE_ROLLBACK_FAILED",
      );
    } finally {
      if (restored) {
        assertUpdateLockOwned(updateLock);
        removeRegularFileIfPresent(currentSnapshotPath);
      }
    }
    throw failure;
  }

  assertUpdateLockOwned(updateLock);
  removeRegularFileIfPresent(currentSnapshotPath);
  restartVerifiedExecutable(targetPath, restart, spawnImpl);
  return buildPlan({
    platform: "posix",
    action: "rescue-in-place",
    layout,
    resolvedNewPath: rescueStagingPath,
    statePaths,
    restart,
    expectedSha: rescueSha,
    transactionId,
    sidecarPath: null,
  });
}

function makeLineage({
  transactionId,
  operation,
  currentSha256,
  previousSha256,
}) {
  return {
    schema: NATIVE_UPDATE_LINEAGE_SCHEMA,
    transactionId,
    operation,
    currentSha256,
    previousSha256,
    updatedAt: new Date().toISOString(),
  };
}

function buildPlan({
  platform,
  action,
  layout,
  resolvedNewPath,
  statePaths,
  restart,
  expectedSha,
  transactionId,
  sidecarPath,
  orphaned = [],
}) {
  return {
    platform,
    action,
    requestedTargetExePath: layout.requestedPath,
    targetExePath: layout.canonicalPath,
    aliasPath: layout.aliasPath,
    newExePath: resolvedNewPath,
    sidecarPath,
    backupPath: statePaths.backupPath,
    lockPath: statePaths.lockPath,
    lineagePath: statePaths.lineagePath,
    resultPath: platform === "win32" ? statePaths.resultPath : null,
    expectedSha256: expectedSha,
    transactionId,
    orphaned,
    restartRequested: Boolean(restart),
  };
}

function validatePlatform(platform) {
  if (!["win32", "posix"].includes(platform)) {
    throw new ApplyError(
      `unsupported apply platform: ${platform}`,
      "BAD_PLATFORM",
    );
  }
}

function resolveTrustedWindowsSystemRoot() {
  // Tests can force the Windows branch on another host, where the sidecar is
  // inspected but never executed. A real Windows apply resolves the kernel's
  // SystemRoot alias instead of trusting the caller-controlled environment.
  if (process.platform !== "win32") return String.raw`C:\Windows`;

  let systemRoot;
  try {
    systemRoot = path.win32.resolve(
      fs.realpathSync.native(String.raw`\\?\GLOBALROOT\SystemRoot`),
    );
  } catch (error) {
    throw new ApplyError(
      `could not resolve the trusted Windows system root: ${error.message}`,
      "WINDOWS_SYSTEM_ROOT_UNAVAILABLE",
    );
  }
  if (!/^[A-Za-z]:\\/.test(systemRoot) || systemRoot.includes("\0")) {
    throw new ApplyError(
      "the trusted Windows system root resolved to an invalid path",
      "WINDOWS_SYSTEM_ROOT_UNAVAILABLE",
    );
  }

  for (const relativePath of [
    ["System32", "cmd.exe"],
    ["System32", "tasklist.exe"],
    ["System32", "findstr.exe"],
    ["System32", "certutil.exe"],
    ["System32", "chcp.com"],
    ["System32", "ping.exe"],
    ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"],
  ]) {
    const toolPath = path.win32.join(systemRoot, ...relativePath);
    try {
      assertStateSafeRegularFile(toolPath, {
        label: "trusted Windows update helper",
        allowMissingLeaf: false,
        platform: "win32",
      });
    } catch (error) {
      throw new ApplyError(
        `trusted Windows update helper is unavailable: ${toolPath}: ${error.message}`,
        "WINDOWS_SYSTEM_TOOL_UNAVAILABLE",
      );
    }
  }
  return systemRoot;
}

function validateExpectedSha(value, label = "expectedSha256") {
  if (!SHA256_HEX.test(value || "")) {
    throw new ApplyError(
      `${label} must be a lowercase 64-character SHA-256`,
      "BAD_EXPECTED_SHA256",
    );
  }
  return value;
}

function sameDirectory(firstPath, secondPath, platform = process.platform) {
  let first = path.dirname(path.resolve(firstPath));
  let second = path.dirname(path.resolve(secondPath));
  if (platform === "win32") {
    first = first.toLowerCase();
    second = second.toLowerCase();
  }
  return first === second;
}

function assertApplyPath(filePath, label, allowMissingLeaf, platform) {
  try {
    assertStateSafeRegularFile(filePath, {
      label,
      allowMissingLeaf,
      platform,
    });
  } catch (error) {
    const missingCodes = new Set(["PATH_MISSING", "ENOENT"]);
    const code = missingCodes.has(error?.code)
      ? label === "last-known-good backup"
        ? "BACKUP_MISSING"
        : label === "new executable"
          ? "NEW_EXE_MISSING"
          : "PATH_MISSING"
      : "UNSAFE_PATH";
    throw new ApplyError(error.message, code);
  }
}

function stableSha256(filePath, label) {
  assertApplyPath(filePath, label, false, process.platform);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    throw new ApplyError(
      `could not open ${label} without following links: ${error.message}`,
      "UNSAFE_PATH",
    );
  }
  try {
    // Windows file IDs routinely exceed Number.MAX_SAFE_INTEGER. Keep every
    // identity field as bigint so a pathname exchange cannot hide behind a
    // rounded inode/device value.
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) {
      throw new ApplyError(`${label} is not a regular file`, "UNSAFE_PATH");
    }
    const hasher = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hasher.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    const after = fs.fstatSync(fd, { bigint: true });
    const pathStat = fs.lstatSync(filePath, { bigint: true });
    const identityChanged =
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      (before.ino === 0n && before.dev === 0n) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      after.dev !== pathStat.dev ||
      after.ino !== pathStat.ino ||
      after.size !== pathStat.size ||
      after.mtimeNs !== pathStat.mtimeNs ||
      after.ctimeNs !== pathStat.ctimeNs;
    if (identityChanged) {
      throw new ApplyError(
        `${label} changed while it was being verified`,
        "FILE_CHANGED_DURING_VERIFY",
      );
    }
    return hasher.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function assertExpectedFileHash(filePath, expectedSha, label) {
  const actual = stableSha256(filePath, label);
  if (actual !== expectedSha) {
    throw new ApplyError(
      `${label} SHA-256 mismatch: expected ${expectedSha}, got ${actual}`,
      "APPLY_SHA256_MISMATCH",
    );
  }
  return actual;
}

function uniqueSibling(filePath, purpose) {
  return `${filePath}.${purpose}-${process.pid}-${crypto.randomUUID()}`;
}

function atomicCopyFile(sourcePath, destinationPath, options = {}) {
  assertApplyPath(sourcePath, "copy source", false, process.platform);
  assertApplyPath(destinationPath, "copy destination", true, process.platform);
  const stagingPath = uniqueSibling(destinationPath, "tmp");
  try {
    fs.copyFileSync(sourcePath, stagingPath, fs.constants.COPYFILE_EXCL);
    if (options.preserveModeFrom) {
      try {
        fs.chmodSync(stagingPath, fs.statSync(options.preserveModeFrom).mode);
      } catch {
        /* mode preservation is best effort on non-POSIX filesystems */
      }
    }
    fsyncFile(stagingPath);
    if (options.updateLock) assertUpdateLockOwned(options.updateLock);
    fs.renameSync(stagingPath, destinationPath);
    fsyncDirectory(path.dirname(destinationPath));
  } finally {
    removeRegularFileIfPresent(stagingPath);
  }
}

function atomicWriteJson(destinationPath, value, updateLock = null) {
  assertApplyPath(
    destinationPath,
    "native update state",
    true,
    process.platform,
  );
  const stagingPath = uniqueSibling(destinationPath, "tmp");
  try {
    fs.writeFileSync(stagingPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fsyncFile(stagingPath);
    if (updateLock) assertUpdateLockOwned(updateLock);
    fs.renameSync(stagingPath, destinationPath);
    fsyncDirectory(path.dirname(destinationPath));
  } finally {
    removeRegularFileIfPresent(stagingPath);
  }
}

function quarantineFreshState(statePaths, transactionId, platform, updateLock) {
  const orphaned = [];
  for (const filePath of [statePaths.backupPath, statePaths.lineagePath]) {
    const stat = lstatOrNull(filePath);
    if (!stat) continue;
    assertApplyPath(filePath, "stale native update state", false, platform);
    const quarantinePath = `${filePath}.orphaned-${transactionId}`;
    assertApplyPath(
      quarantinePath,
      "quarantined native update state",
      true,
      platform,
    );
    assertUpdateLockOwned(updateLock);
    fs.renameSync(filePath, quarantinePath);
    fsyncDirectory(path.dirname(filePath));
    orphaned.push(quarantinePath);
  }
  return orphaned;
}

function verificationFailure(targetPath, verifyImpl) {
  let result;
  try {
    result = verifyImpl(targetPath, ["--version"], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
      origin: "packer:update-verify",
      scope: "pack-update",
      policy: "allow",
      shell: false,
    });
  } catch (error) {
    result = { status: 1, error };
  }
  return result?.error || result?.status !== 0
    ? new ApplyError("new binary verification failed", "UPDATE_VERIFY_FAILED")
    : null;
}

function buildWindowsTimedStartupCheckLines() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$startInfo = [Diagnostics.ProcessStartInfo]::new()",
    "$startInfo.FileName = $env:VERIFY_PATH",
    "$startInfo.Arguments = '--version'",
    "$startInfo.UseShellExecute = $false",
    "$startInfo.CreateNoWindow = $true",
    "$process = [Diagnostics.Process]::new()",
    "$process.StartInfo = $startInfo",
    "try {",
    "  if (-not $process.Start()) { exit 1 }",
    "  if (-not $process.WaitForExit(30000)) {",
    "    $killed = $false",
    "    try { $process.Kill(); $killed = $true } catch {}",
    "    if ($killed) { try { [void]$process.WaitForExit(5000) } catch {} }",
    "    exit 124",
    "  }",
    "  exit $process.ExitCode",
    "} finally { $process.Dispose() }",
  ].join("\r\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return [
    `"%CC_SYSTEM_ROOT%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -EncodedCommand ${encoded} >NUL 2>&1`,
    "if errorlevel 1 goto verifyfailed",
  ];
}

function restartVerifiedExecutable(targetPath, restart, spawnImpl) {
  if (!restart) return;
  try {
    // An updater restart starts the newly installed CLI, not the command that
    // performed the update. Replaying `pack auto-update --current ...` can
    // otherwise form an update/restart loop, and Windows already restarts
    // without inherited arguments.
    const child = spawnImpl(targetPath, [], {
      origin: "packer:update-restart",
      scope: "pack-update",
      policy: "allow",
      shell: false,
      detached: true,
      stdio: "ignore",
    });
    if (child && typeof child.once === "function") {
      // Detached spawn errors arrive asynchronously and cannot be converted
      // into the already returned transaction result. Consume the event so a
      // restart failure does not crash an otherwise committed update.
      child.once("error", () => {});
    }
    if (child && typeof child.unref === "function") child.unref();
  } catch (error) {
    throw new ApplyError(
      `updated binary was verified but restart failed: ${error.message}`,
      "RESTART_FAILED",
    );
  }
}

function waitForWindowsSidecarReady({ readyPath, transactionId, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  const waitCell = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    const stat = lstatOrNull(readyPath);
    if (stat) {
      try {
        assertStateSafeRegularFile(readyPath, {
          label: "Windows update sidecar ready marker",
          allowMissingLeaf: false,
          platform: "win32",
        });
        return fs.readFileSync(readyPath, "utf8").trim() === transactionId;
      } catch {
        return false;
      }
    }
    Atomics.wait(waitCell, 0, 0, 25);
  }
  return false;
}

function acquireUpdateLock(lockPath, platform) {
  assertApplyPath(lockPath, "native update lock", true, platform);
  const token = `${process.pid}:${crypto.randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx+", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new ApplyError(
        `another native install/update is in progress: ${lockPath}`,
        "UPDATE_LOCKED",
      );
    }
    throw new ApplyError(
      `could not acquire native update lock: ${error.message}`,
      "LOCK_FAILED",
    );
  }
  try {
    fs.writeFileSync(fd, token, { encoding: "utf8" });
    fs.fsyncSync(fd);
  } catch (error) {
    releaseUpdateLock({ fd, lockPath, token, transferred: false });
    throw new ApplyError(
      `could not initialize native update lock: ${error.message}`,
      "LOCK_FAILED",
    );
  }
  return { fd, lockPath, token, transferred: false };
}

function assertUpdateLockOwned(lock) {
  if (!lock || lock.fd === null || lock.fd === undefined) {
    throw new ApplyError(
      "native update lock handle is no longer held by this transaction",
      "UPDATE_LOCK_LOST",
    );
  }
  try {
    const before = fs.fstatSync(lock.fd, { bigint: true });
    const pathBefore = fs.lstatSync(lock.lockPath, { bigint: true });
    const expected = Buffer.from(lock.token, "utf8");
    const actual = Buffer.alloc(expected.length + 1);
    const bytesRead = fs.readSync(lock.fd, actual, 0, actual.length, 0);
    const after = fs.fstatSync(lock.fd, { bigint: true });
    const pathAfter = fs.lstatSync(lock.lockPath, { bigint: true });
    const descriptorStable =
      before.isFile() &&
      after.isFile() &&
      before.nlink > 0n &&
      after.nlink > 0n &&
      !(before.dev === 0n && before.ino === 0n) &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeNs === after.mtimeNs &&
      before.ctimeNs === after.ctimeNs;
    const pathStillOwned =
      !pathBefore.isSymbolicLink() &&
      pathBefore.isFile() &&
      !pathAfter.isSymbolicLink() &&
      pathAfter.isFile() &&
      before.dev === pathBefore.dev &&
      before.ino === pathBefore.ino &&
      after.dev === pathAfter.dev &&
      after.ino === pathAfter.ino &&
      after.size === pathAfter.size &&
      after.mtimeNs === pathAfter.mtimeNs &&
      after.ctimeNs === pathAfter.ctimeNs;
    const tokenMatches =
      bytesRead === expected.length &&
      actual.subarray(0, bytesRead).equals(expected);
    if (!descriptorStable || !pathStillOwned || !tokenMatches) {
      throw new Error("lock pathname, descriptor, or token changed");
    }
  } catch (error) {
    throw new ApplyError(
      `native update lock ownership was lost: ${error.message}`,
      "UPDATE_LOCK_LOST",
    );
  }
}

function closeUpdateLockHandle(lock) {
  if (!lock || lock.fd === null) return;
  try {
    fs.closeSync(lock.fd);
  } finally {
    lock.fd = null;
  }
}

function retainUpdateLockForRecovery(lock) {
  closeUpdateLockHandle(lock);
  lock.transferred = true;
}

function removeOwnedLockFile(lock) {
  if (!lock) return;
  try {
    const stat = fs.lstatSync(lock.lockPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    if (fs.readFileSync(lock.lockPath, "utf8") === lock.token) {
      fs.unlinkSync(lock.lockPath);
    }
  } catch {
    /* stale or replaced locks fail closed */
  }
}

function releaseUpdateLock(lock) {
  closeUpdateLockHandle(lock);
  removeOwnedLockFile(lock);
}

function removeRegularFileIfPresent(filePath) {
  if (!filePath) return;
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(filePath);
  } catch {
    /* missing or unsafe paths are intentionally left alone */
  }
}

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    try {
      fs.fsyncSync(fd);
    } catch (error) {
      if (!["EBADF", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
        throw error;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirectory(directoryPath) {
  let fd;
  try {
    fd = fs.openSync(directoryPath, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    if (
      !["EACCES", "EBADF", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
    ) {
      throw error;
    }
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best effort */
      }
    }
  }
}

function asApplyError(error, code, prefix = "") {
  if (error instanceof ApplyError) return error;
  return new ApplyError(`${prefix ? `${prefix}: ` : ""}${error.message}`, code);
}

function assertWindowsCmdSafePath(value, label) {
  if (typeof value !== "string" || !value) {
    throw new ApplyError(`${label} is required`, "UNSAFE_WINDOWS_PATH");
  }
  if (/[\r\n%!"^&|<>()]/.test(value)) {
    throw new ApplyError(
      `${label} contains characters unsafe for a cmd sidecar`,
      "UNSAFE_WINDOWS_PATH",
    );
  }
}

function buildWindowsReparseChecks(paths) {
  const seen = new Set();
  const ordered = [];
  for (const rawPath of paths) {
    let current = path.resolve(rawPath);
    while (current) {
      const key = current.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(current);
      }
      const parent = path.dirname(current);
      if (!parent || parent === current) break;
      current = parent;
    }
  }
  // One encoded PowerShell invocation is both substantially faster than
  // starting fsutil once per component and immune to cmd interpolation of the
  // inspected paths. Missing leaves are allowed; every other inspection error
  // fails closed.
  const literals = ordered
    .map((candidate) => `'${candidate.replaceAll("'", "''")}'`)
    .join(",");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `foreach ($candidate in @(${literals})) {`,
    "  try { $attributes = [IO.File]::GetAttributes($candidate) }",
    "  catch [IO.FileNotFoundException] { continue }",
    "  catch [IO.DirectoryNotFoundException] { continue }",
    "  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 7 }",
    "}",
    "exit 0",
  ].join("\r\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return [
    `"%CC_SYSTEM_ROOT%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -EncodedCommand ${encoded} >NUL 2>&1`,
    "if errorlevel 1 goto unsafepath",
  ];
}

export class ApplyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ApplyError";
    this.code = code;
  }
}
