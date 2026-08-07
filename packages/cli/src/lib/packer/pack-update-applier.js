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
  pathMatchesOpenedFileIdentitySync,
  sameOpenedFileIdentity,
} from "./file-identity.js";
import {
  NATIVE_GENERATION_TRANSACTION_SCHEMA,
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
  tmpdir: () => os.tmpdir(),
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
    "generation transaction journal": statePaths.journalPath,
    "retired generation transaction journal": statePaths.lastJournalPath,
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
  if (lstatOrNull(statePaths.journalPath)) {
    throw new ApplyError(
      `an interrupted native generation requires restart recovery: ${statePaths.journalPath}`,
      "RECOVERY_REQUIRED",
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
      "generation transaction journal": statePaths.journalPath,
      "retired generation transaction journal": statePaths.lastJournalPath,
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
    const hadPriorLineage = Boolean(lstatOrNull(statePaths.lineagePath));
    const priorLineageSha = hadPriorLineage
      ? stableSha256(statePaths.lineagePath, "existing native update lineage")
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
        hadPriorLineage,
        priorBackupSha,
        priorLineageSha,
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
      hadPriorLineage,
      priorBackupSha,
      priorLineageSha,
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
    hadPriorLineage,
    priorBackupSha,
    priorLineageSha,
    restart,
    verify,
    spawnImpl,
    verifyImpl,
    orphaned,
  } = ctx;
  const targetPath = layout.canonicalPath;
  let backupStagingPath = null;
  const snapshotPaths = generationSnapshotPaths(targetPath, transactionId);
  const journal = makeGenerationJournal({
    transactionId,
    operation: "update",
    expectedSha,
    hadTarget,
    targetBeforeSha,
    hadBackup: hadPriorBackup,
    backupBeforeSha: priorBackupSha,
    hadLineage: hadPriorLineage,
    lineageBeforeSha: priorLineageSha,
  });

  try {
    if (hadTarget) {
      atomicCopyFile(targetPath, snapshotPaths.priorTargetPath, {
        preserveModeFrom: targetPath,
        updateLock,
      });
      assertExpectedFileHash(
        snapshotPaths.priorTargetPath,
        targetBeforeSha,
        "target generation snapshot",
      );
    }
    if (hadPriorBackup) {
      atomicCopyFile(statePaths.backupPath, snapshotPaths.priorBackupPath, {
        preserveModeFrom: statePaths.backupPath,
        updateLock,
      });
      assertExpectedFileHash(
        snapshotPaths.priorBackupPath,
        priorBackupSha,
        "backup generation snapshot",
      );
    }
    if (hadPriorLineage) {
      atomicCopyFile(statePaths.lineagePath, snapshotPaths.priorLineagePath, {
        preserveModeFrom: statePaths.lineagePath,
        updateLock,
      });
      assertExpectedFileHash(
        snapshotPaths.priorLineagePath,
        priorLineageSha,
        "lineage generation snapshot",
      );
    }
  } catch (error) {
    cleanupGenerationSnapshots(snapshotPaths);
    throw asApplyError(
      error,
      "GENERATION_SNAPSHOT_FAILED",
      "could not preserve the native generation pre-state",
    );
  }

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
      cleanupGenerationSnapshots(snapshotPaths);
      throw asApplyError(error, "BACKUP_FAILED", "could not create backup");
    }
  }

  try {
    writeGenerationJournalPhase(
      statePaths.journalPath,
      journal,
      "prepared",
      "rollback",
      updateLock,
    );
  } catch (error) {
    removeRegularFileIfPresent(backupStagingPath);
    if (lstatOrNull(statePaths.journalPath)) {
      throw new ApplyError(
        `native generation intent persistence is unknown: ${error.message}`,
        "ROLLBACK_FAILED",
      );
    }
    cleanupGenerationSnapshots(snapshotPaths);
    throw asApplyError(
      error,
      "JOURNAL_WRITE_FAILED",
      "could not persist native generation intent",
    );
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
    writeGenerationJournalPhase(
      statePaths.journalPath,
      journal,
      "target-committed",
      "rollback",
      updateLock,
    );
  } catch (error) {
    removeRegularFileIfPresent(backupStagingPath);
    try {
      rollbackFailedPosixUpdate({
        targetPath,
        statePaths,
        transactionId,
        hadTarget,
        targetBeforeSha,
        hadPriorBackup,
        hadPriorLineage,
        priorBackupSha,
        priorLineageSha,
        snapshotPaths,
        journal,
        updateLock,
      });
    } catch (recoveryError) {
      throw new ApplyError(
        `target commit failed and its generation journal could not be retired: ${recoveryError.message}`,
        "ROLLBACK_FAILED",
      );
    }
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
      writeGenerationJournalPhase(
        statePaths.journalPath,
        journal,
        "verified",
        "rollback",
        updateLock,
      );
    } catch (error) {
      commitFailure = new ApplyError(
        `could not persist native generation verification: ${error.message}`,
        "JOURNAL_WRITE_FAILED",
      );
    }
  }
  if (!commitFailure) {
    try {
      if (hadTarget) {
        assertUpdateLockOwned(updateLock);
        fs.renameSync(backupStagingPath, statePaths.backupPath);
        backupStagingPath = null;
        fsyncDirectory(path.dirname(targetPath));
      }
      writeGenerationJournalPhase(
        statePaths.journalPath,
        journal,
        "backup-committed",
        "rollback",
        updateLock,
      );
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
      writeGenerationJournalPhase(
        statePaths.journalPath,
        journal,
        "lineage-committed",
        "rollback",
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
      hadPriorBackup,
      hadPriorLineage,
      priorBackupSha,
      priorLineageSha,
      snapshotPaths,
      journal,
      updateLock,
    });
    removeRegularFileIfPresent(backupStagingPath);
    throw commitFailure;
  }

  try {
    writeGenerationJournalPhase(
      statePaths.journalPath,
      journal,
      "committed",
      "commit",
      updateLock,
    );
  } catch (error) {
    throw new ApplyError(
      `native generation commit decision is unknown: ${error.message}`,
      "ROLLBACK_FAILED",
    );
  }
  try {
    retireGenerationJournal(statePaths, journal, updateLock);
  } catch (error) {
    throw new ApplyError(
      `native generation committed but journal retirement failed: ${error.message}`,
      "ROLLBACK_FAILED",
    );
  }
  cleanupGenerationSnapshots(snapshotPaths);

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
    hadPriorBackup,
    hadPriorLineage,
    priorBackupSha,
    priorLineageSha,
    snapshotPaths,
    journal,
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
      atomicCopyFile(snapshotPaths.priorTargetPath, targetPath, {
        preserveModeFrom: snapshotPaths.priorTargetPath,
        updateLock,
      });
      assertExpectedFileHash(
        targetPath,
        targetBeforeSha,
        "restored executable",
      );
    } else {
      const currentTarget = lstatOrNull(targetPath);
      if (currentTarget) {
        assertExpectedFileHash(
          targetPath,
          journal.expectedSha256,
          "failed fresh target",
        );
        assertUpdateLockOwned(updateLock);
        fs.renameSync(targetPath, failedPath);
        fsyncDirectory(path.dirname(targetPath));
      }
    }

    if (hadPriorBackup) {
      atomicCopyFile(snapshotPaths.priorBackupPath, statePaths.backupPath, {
        preserveModeFrom: snapshotPaths.priorBackupPath,
        updateLock,
      });
      assertExpectedFileHash(
        statePaths.backupPath,
        priorBackupSha,
        "restored last-known-good backup",
      );
    } else if (lstatOrNull(statePaths.backupPath)) {
      if (!hadTarget) {
        throw new Error("fresh update created an unexpected backup");
      }
      assertExpectedFileHash(
        statePaths.backupPath,
        targetBeforeSha,
        "transaction-created last-known-good backup",
      );
      assertUpdateLockOwned(updateLock);
      removeRegularFileIfPresent(statePaths.backupPath);
      fsyncDirectory(path.dirname(targetPath));
    }

    if (hadPriorLineage) {
      atomicCopyFile(snapshotPaths.priorLineagePath, statePaths.lineagePath, {
        preserveModeFrom: snapshotPaths.priorLineagePath,
        updateLock,
      });
      assertExpectedFileHash(
        statePaths.lineagePath,
        priorLineageSha,
        "restored native update lineage",
      );
    } else if (lstatOrNull(statePaths.lineagePath)) {
      const lineage = readNativeLineage(statePaths.lineagePath);
      if (
        lineage.transactionId !== transactionId ||
        lineage.currentSha256 !== journal.expectedSha256
      ) {
        throw new Error("transaction-created lineage changed before rollback");
      }
      assertUpdateLockOwned(updateLock);
      removeRegularFileIfPresent(statePaths.lineagePath);
      fsyncDirectory(path.dirname(targetPath));
    }
    retireGenerationJournal(statePaths, journal, updateLock);
    cleanupGenerationSnapshots(snapshotPaths);
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
    hadPriorLineage = false,
    priorBackupSha = null,
    priorLineageSha = null,
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
      journalPath: statePaths.journalPath,
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
      hadPriorLineage,
      priorBackupSha256: priorBackupSha,
      priorLineageSha256: priorLineageSha,
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
    if (sidecarPath) removeRegularFileIfPresent(`${sidecarPath}.journal.ps1`);
    if (sidecarPath) removeRegularFileIfPresent(`${sidecarPath}.ready`);
    if (error instanceof ApplyError) throw error;
    throw new ApplyError(
      `could not schedule Windows replacement: ${error.message}`,
      "SIDECAR_FAILED",
    );
  }
}

function windowsGenerationJournalHelperSource() {
  return String.raw`param()
$ErrorActionPreference = 'Stop'
$Action = [string]$env:JOURNAL_ACTION
$JournalPath = [string]$env:JOURNAL_FILE
$RetiredPath = [string]$env:JOURNAL_RETIRED
$TransactionId = [string]$env:TRANSACTION_ID
$Phase = [string]$env:JOURNAL_PHASE
$Decision = [string]$env:JOURNAL_DECISION
$HashPattern = '^[a-f0-9]{64}$'
$AllowedPhases = @('prepared','target-committed','alias-committed','verified','backup-committed','lineage-committed','committed')
$AllowedActions = @('write','retire')
$ParsedId = [guid]::Empty
if ($AllowedActions -notcontains $Action) { throw 'Invalid journal action' }
if (-not [guid]::TryParse($TransactionId, [ref]$ParsedId)) { throw 'Invalid transaction identifier' }
if ($AllowedPhases -notcontains $Phase) { throw 'Invalid transaction phase' }
if (@('rollback','commit') -notcontains $Decision) { throw 'Invalid transaction decision' }
if (($Phase -eq 'committed') -ne ($Decision -eq 'commit')) { throw 'Invalid phase decision' }

if ($Action -eq 'write' -and $Phase -eq 'prepared') {
  if ([IO.File]::Exists($JournalPath)) { throw 'A generation journal already exists' }
  $Bytes = [Convert]::FromBase64String([string]$env:JOURNAL_INITIAL_BASE64)
  $Journal = [Text.Encoding]::UTF8.GetString($Bytes) | ConvertFrom-Json
  $ParentSource = @'
using System;
using System.Runtime.InteropServices;
public static class CcParentProcess {
  [StructLayout(LayoutKind.Sequential)]
  private struct PBI {
    public IntPtr Reserved1;
    public IntPtr PebBaseAddress;
    public IntPtr Reserved2_0;
    public IntPtr Reserved2_1;
    public IntPtr UniqueProcessId;
    public IntPtr InheritedFromUniqueProcessId;
  }
  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref PBI info, int size, out int returned);
  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();
  public static int Get() {
    PBI info = new PBI();
    int returned;
    int status = NtQueryInformationProcess(GetCurrentProcess(), 0, ref info, Marshal.SizeOf(info), out returned);
    if (status != 0) { throw new InvalidOperationException("Parent process query failed"); }
    return info.InheritedFromUniqueProcessId.ToInt32();
  }
}
'@
  Add-Type -TypeDefinition $ParentSource -Language CSharp
  $Journal | Add-Member -NotePropertyName ownerPid -NotePropertyValue ([CcParentProcess]::Get())
} else {
  if (-not [IO.File]::Exists($JournalPath)) { throw 'Generation journal is missing' }
  $Journal = Get-Content -Raw -LiteralPath $JournalPath | ConvertFrom-Json
}

$ValidBefore = {
  param($Present, $Digest)
  return (($Present -is [bool]) -and ((-not $Present -and $null -eq $Digest) -or ($Present -and [string]$Digest -match $HashPattern)))
}
$Valid = (
  [string]$Journal.schema -eq 'chainlesschain.native-install-transaction.v1' -and
  [string]$Journal.transactionId -eq $TransactionId -and
  @('update','rescue') -contains [string]$Journal.operation -and
  ($Journal.ownerPid -is [int] -or $Journal.ownerPid -is [long]) -and
  [int64]$Journal.ownerPid -gt 0 -and
  $AllowedPhases -contains [string]$Journal.phase -and
  @('rollback','commit') -contains [string]$Journal.decision -and
  [string]$Journal.expectedSha256 -match $HashPattern -and
  (& $ValidBefore $Journal.hadTarget $Journal.targetBeforeSha256) -and
  (& $ValidBefore $Journal.hadAlias $Journal.aliasBeforeSha256) -and
  (& $ValidBefore $Journal.hadBackup $Journal.backupBeforeSha256) -and
  (& $ValidBefore $Journal.hadLineage $Journal.lineageBeforeSha256)
)
if (-not $Valid) { throw 'Generation journal failed schema validation' }
if ([string]$Journal.transactionId -ne $TransactionId) { throw 'Generation journal ownership changed' }

if ($Action -eq 'retire') {
  if ([string]$Journal.phase -ne $Phase -or [string]$Journal.decision -ne $Decision) {
    throw 'Generation journal decision changed before retirement'
  }
  $ReplacedPath = Join-Path (Split-Path -Parent $JournalPath) ('.chainlesschain.journal-retired-previous-' + [guid]::NewGuid().ToString('N'))
  try {
    if ([IO.File]::Exists($RetiredPath)) {
      [IO.File]::Replace($JournalPath, $RetiredPath, $ReplacedPath, $true)
    } else {
      [IO.File]::Move($JournalPath, $RetiredPath)
    }
    $Final = [IO.File]::Open($RetiredPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    try { $Final.Flush($true) } finally { $Final.Dispose() }
  } finally {
    if ([IO.File]::Exists($ReplacedPath)) {
      try { [IO.File]::Delete($ReplacedPath) } catch { }
    }
  }
  exit 0
}

if ($Phase -eq 'prepared') {
  $Snapshots = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  if ($Journal.hadTarget) { $Snapshots.Add([string]$env:TARGET_SNAPSHOT, [string]$Journal.targetBeforeSha256) }
  if ($Journal.hadAlias) { $Snapshots.Add([string]$env:ALIAS_BACKUP, [string]$Journal.aliasBeforeSha256) }
  if ($Journal.hadBackup) { $Snapshots.Add([string]$env:BACKUP_SNAPSHOT, [string]$Journal.backupBeforeSha256) }
  if ($Journal.hadLineage) { $Snapshots.Add([string]$env:LINEAGE_SNAPSHOT, [string]$Journal.lineageBeforeSha256) }
  foreach ($Snapshot in $Snapshots.GetEnumerator()) {
    if (-not [IO.File]::Exists($Snapshot.Key)) { throw 'A recovery snapshot is missing' }
    $SnapshotStream = [IO.File]::Open($Snapshot.Key, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    try {
      $Hasher = [Security.Cryptography.SHA256]::Create()
      try {
        $Observed = ([BitConverter]::ToString($Hasher.ComputeHash($SnapshotStream))).Replace('-', '').ToLowerInvariant()
      } finally { $Hasher.Dispose() }
      if ($Observed -ne $Snapshot.Value) { throw 'A recovery snapshot changed while staging' }
      $SnapshotStream.Flush($true)
    } finally { $SnapshotStream.Dispose() }
  }
}

if ($Phase -ne 'prepared') {
  $Transitions = @{
    'prepared' = @('target-committed')
    'target-committed' = @('alias-committed','verified')
    'alias-committed' = @('verified')
    'verified' = @('backup-committed','lineage-committed')
    'backup-committed' = @('lineage-committed')
    'lineage-committed' = @('committed')
  }
  if ($Transitions[[string]$Journal.phase] -notcontains $Phase) {
    throw 'Generation journal phase transition is invalid'
  }
}

$Journal.phase = $Phase
$Journal.decision = $Decision
$Journal.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
$Directory = Split-Path -Parent $JournalPath
$StagingPath = Join-Path $Directory ('.chainlesschain.journal-' + [guid]::NewGuid().ToString('N'))
$ReplacedPath = Join-Path $Directory ('.chainlesschain.journal-previous-' + [guid]::NewGuid().ToString('N'))
try {
  $Payload = $Journal | ConvertTo-Json -Compress -Depth 8
  $PayloadBytes = [Text.UTF8Encoding]::new($false).GetBytes($Payload + [Environment]::NewLine)
  $Stream = [IO.File]::Open($StagingPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $Stream.Write($PayloadBytes, 0, $PayloadBytes.Length)
    $Stream.Flush($true)
  } finally { $Stream.Dispose() }
  if ([IO.File]::Exists($JournalPath)) {
    [IO.File]::Replace($StagingPath, $JournalPath, $ReplacedPath, $true)
    [IO.File]::Delete($ReplacedPath)
  } else {
    [IO.File]::Move($StagingPath, $JournalPath)
  }
  $Final = [IO.File]::Open($JournalPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
  try { $Final.Flush($true) } finally { $Final.Dispose() }
} finally {
  if ([IO.File]::Exists($StagingPath)) { [IO.File]::Delete($StagingPath) }
  if ([IO.File]::Exists($ReplacedPath)) { [IO.File]::Delete($ReplacedPath) }
}
`;
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
    journalPath = `${targetExePath}.update-transaction.json`,
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
    hadPriorLineage = false,
    priorBackupSha256 = null,
    priorLineageSha256 = null,
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
  if (typeof hadPriorLineage !== "boolean") {
    throw new ApplyError(
      "sidecar requires explicit prior lineage state",
      "MISSING_PRESTATE",
    );
  }
  const expectedSha = validateExpectedSha(expectedSha256);
  if (hadTarget) validateExpectedSha(targetBeforeSha256, "targetBeforeSha256");
  if (hadAlias) validateExpectedSha(aliasBeforeSha256, "aliasBeforeSha256");
  if (hadPriorBackup) {
    validateExpectedSha(priorBackupSha256, "priorBackupSha256");
  }
  if (hadPriorLineage) {
    validateExpectedSha(priorLineageSha256, "priorLineageSha256");
  }
  if (
    !lockToken ||
    !/^[1-9][0-9]*:(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(
      lockToken,
    )
  ) {
    throw new ApplyError(
      "a valid lock ownership token is required",
      "BAD_LOCK_TOKEN",
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      transactionId,
    )
  ) {
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
  // GitHub's Windows runners expose TEMP through an 8.3 alias such as
  // C:\Users\RUNNER~1\..., while realpath/ancestor validation returns the
  // corresponding long pathname. Publish and validate the marker through the
  // canonical root so that a harmless DOS alias is not mistaken for a reparse
  // redirect. Keep the original root in the sidecar's reparse preflight below:
  // canonicalization must never erase evidence of a junction in TEMP.
  const rawTempRoot = path.resolve(_deps.tmpdir());
  let sidecarTempRoot;
  try {
    const rawTempStat = fs.lstatSync(rawTempRoot);
    if (rawTempStat.isSymbolicLink() || !rawTempStat.isDirectory()) {
      throw new Error("temporary root must be a real directory");
    }
    sidecarTempRoot = fs.realpathSync.native(rawTempRoot);
  } catch (error) {
    throw new ApplyError(
      `could not bind the Windows sidecar temporary root: ${error.message}`,
      "UNSAFE_WINDOWS_PATH",
    );
  }
  const sidecarPath = path.join(sidecarTempRoot, `cc-pack-apply-${suffix}.cmd`);
  try {
    assertStateSafeRegularFile(sidecarPath, {
      label: "Windows update sidecar",
      allowMissingLeaf: true,
      platform: process.platform,
    });
  } catch (error) {
    throw new ApplyError(error.message, "UNSAFE_WINDOWS_PATH");
  }
  const readyPath = `${sidecarPath}.ready`;
  const readyTempPath = `${readyPath}.tmp-${suffix}`;
  const journalHelperPath = `${sidecarPath}.journal.ps1`;
  const parentProbePath = `${sidecarPath}.parent`;
  const targetSnapshotPath = path.join(
    path.dirname(targetExePath),
    `.chainlesschain.target-prior-${transactionId}.exe`,
  );
  const backupSnapshotPath = path.join(
    path.dirname(targetExePath),
    `.chainlesschain.backup-prior-${transactionId}.exe`,
  );
  const lineageSnapshotPath = path.join(
    path.dirname(targetExePath),
    `.chainlesschain.lineage-prior-${transactionId}.json`,
  );
  const journalRetiredPath = `${journalPath}.last`;
  const backupTempPath = `${backupPath}.tmp-${suffix}`;
  const currentTempPath = targetSnapshotPath;
  const rollbackTempPath = `${targetExePath}.rollback-${suffix}`;
  const backupRollbackPath = `${backupPath}.rollback-${suffix}`;
  const failedPath = `${targetExePath}.failed-${suffix}`;
  const aliasCandidatePath = aliasPath
    ? `${aliasPath}.candidate-${suffix}`
    : targetExePath;
  const aliasBackupPath = aliasPath
    ? path.join(path.dirname(aliasPath), `.cc.previous-${transactionId}.exe`)
    : targetExePath;
  const aliasRollbackPath = aliasPath
    ? `${aliasPath}.rollback-${suffix}`
    : targetExePath;
  const lineageTempPath = `${lineagePath}.tmp-${suffix}`;
  const resultTempPath = `${resultPath}.tmp-${suffix}`;

  const allPaths = {
    windowsSystemRoot,
    // This is intentionally distinct from sidecarPath's canonical parent.
    // buildWindowsReparseChecks expands every ancestor, so the trusted
    // PowerShell preflight rejects a junction/redirector in the original TEMP
    // spelling before READY_FILE is published and lock ownership transfers.
    rawTempRoot,
    sidecarPath,
    journalHelperPath,
    readyPath,
    readyTempPath,
    parentProbePath,
    newExePath,
    targetExePath,
    backupPath,
    lineagePath,
    journalPath,
    journalRetiredPath,
    lockPath,
    resultPath,
    backupTempPath,
    currentTempPath,
    targetSnapshotPath,
    backupSnapshotPath,
    lineageSnapshotPath,
    rollbackTempPath,
    backupRollbackPath,
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
  const rollbackSourcePath = targetSnapshotPath;
  const initialJournal = {
    schema: NATIVE_GENERATION_TRANSACTION_SCHEMA,
    transactionId,
    operation,
    phase: "prepared",
    decision: "rollback",
    expectedSha256: expectedSha,
    hadTarget,
    targetBeforeSha256: hadTarget ? targetBeforeSha256 : null,
    hadAlias,
    aliasBeforeSha256: hadAlias ? aliasBeforeSha256 : null,
    hadBackup: hadPriorBackup,
    backupBeforeSha256: hadPriorBackup ? priorBackupSha256 : null,
    hadLineage: hadPriorLineage,
    lineageBeforeSha256: hadPriorLineage ? priorLineageSha256 : null,
    updatedAt: null,
  };
  const initialJournalBase64 = Buffer.from(
    JSON.stringify(initialJournal),
    "utf8",
  ).toString("base64");
  const successLineageSha = crypto
    .createHash("sha256")
    .update(`${JSON.stringify(successLineage)}\r\n`, "utf8")
    .digest("hex");
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
    `set "BACKUP_ROLLBACK=${backupRollbackPath}"`,
    `set "FAILED_EXE=${failedPath}"`,
    `set "ALIAS_CANDIDATE=${aliasCandidatePath}"`,
    `set "ALIAS_BACKUP=${aliasBackupPath}"`,
    `set "ALIAS_ROLLBACK=${aliasRollbackPath}"`,
    `set "LINEAGE_FILE=${lineagePath}"`,
    `set "LINEAGE_TEMP=${lineageTempPath}"`,
    `set "LINEAGE_SNAPSHOT=${lineageSnapshotPath}"`,
    `set "TARGET_SNAPSHOT=${targetSnapshotPath}"`,
    `set "BACKUP_SNAPSHOT=${backupSnapshotPath}"`,
    `set "JOURNAL_FILE=${journalPath}"`,
    `set "JOURNAL_RETIRED=${journalRetiredPath}"`,
    `set "JOURNAL_HELPER=${journalHelperPath}"`,
    `set "JOURNAL_INITIAL_BASE64=${initialJournalBase64}"`,
    'set "JOURNAL_ACTION=write"',
    'set "JOURNAL_PHASE=prepared"',
    'set "JOURNAL_DECISION=rollback"',
    `set "LOCK_FILE=${lockPath}"`,
    `set "LOCK_TOKEN=${lockToken}"`,
    `set "LOCK_TOKEN_SHA=${lockTokenSha}"`,
    `set "RESULT_FILE=${resultPath}"`,
    `set "RESULT_TEMP=${resultTempPath}"`,
    `set "READY_FILE=${readyPath}"`,
    `set "READY_TEMP=${readyTempPath}"`,
    `set "PARENT_PROBE=${parentProbePath}"`,
    `set "EXPECTED_SHA=${expectedSha}"`,
    `set "TARGET_BEFORE_SHA=${targetBeforeSha256 || ""}"`,
    `set "ALIAS_BEFORE_SHA=${aliasBeforeSha256 || ""}"`,
    `set "HAD_TARGET=${hadTarget ? "1" : "0"}"`,
    `set "HAD_ALIAS=${hadAlias ? "1" : "0"}"`,
    `set "HAD_BACKUP=${hadPriorBackup ? "1" : "0"}"`,
    `set "BACKUP_BEFORE_SHA=${priorBackupSha256 || ""}"`,
    `set "HAD_LINEAGE=${hadPriorLineage ? "1" : "0"}"`,
    `set "LINEAGE_BEFORE_SHA=${priorLineageSha256 || ""}"`,
    `set "LINEAGE_TRANSACTION_SHA=${successLineageSha}"`,
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
    // Redirection creates/truncates its target before echo writes the token.
    // Publish through a same-directory rename so the parent can never observe
    // a zero-length or partially written readiness marker.
    `> "%READY_TEMP%" echo ${transactionId}`,
    "if errorlevel 1 goto readyfailed",
    'move /Y "%READY_TEMP%" "%READY_FILE%" >NUL 2>&1',
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
    'if "%HAD_TARGET%"=="0" goto stagepriorstate',
    'copy /B /Y "%TARGET_EXE%" "%TARGET_SNAPSHOT%" >NUL',
    "if errorlevel 1 goto backupfailed",
    'set "HASH_PATH=%TARGET_SNAPSHOT%"',
    "call :hashpath",
    "if errorlevel 1 goto backupfailed",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto backupfailed',
    'copy /B /Y "%TARGET_SNAPSHOT%" "%BACKUP_TEMP%" >NUL',
    "if errorlevel 1 goto backupfailed",
    'set "HASH_PATH=%BACKUP_TEMP%"',
    "call :hashpath",
    "if errorlevel 1 goto backupfailed",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto backupfailed',
    "goto stagepriorstate",
    ":stagerescue",
    'if "%HAD_TARGET%"=="0" goto stagepriorstate',
    'copy /B /Y "%TARGET_EXE%" "%CURRENT_TEMP%" >NUL',
    "if errorlevel 1 goto backupfailed",
    'set "HASH_PATH=%CURRENT_TEMP%"',
    "call :hashpath",
    "if errorlevel 1 goto backupfailed",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto backupfailed',
    ":stagepriorstate",
    'if "%HAD_BACKUP%"=="0" goto stagepriorlineage',
    'copy /B /Y "%BACKUP_EXE%" "%BACKUP_SNAPSHOT%" >NUL',
    "if errorlevel 1 goto backupfailed",
    'set "HASH_PATH=%BACKUP_SNAPSHOT%"',
    "call :hashpath",
    "if errorlevel 1 goto backupfailed",
    'if /I not "%OBSERVED_SHA%"=="%BACKUP_BEFORE_SHA%" goto backupfailed',
    ":stagepriorlineage",
    'if "%HAD_LINEAGE%"=="0" goto stagealias',
    'copy /B /Y "%LINEAGE_FILE%" "%LINEAGE_SNAPSHOT%" >NUL',
    "if errorlevel 1 goto backupfailed",
    'set "HASH_PATH=%LINEAGE_SNAPSHOT%"',
    "call :hashpath",
    "if errorlevel 1 goto backupfailed",
    'if /I not "%OBSERVED_SHA%"=="%LINEAGE_BEFORE_SHA%" goto backupfailed',
    ":stagealias",
    'if "%MANAGE_ALIAS%"=="0" goto persistprepared',
    'if "%HAD_ALIAS%"=="0" goto makealiascandidate',
    'copy /B /Y "%ALIAS_EXE%" "%ALIAS_BACKUP%" >NUL',
    "if errorlevel 1 goto aliasstagefailed",
    'set "HASH_PATH=%ALIAS_BACKUP%"',
    "call :hashpath",
    "if errorlevel 1 goto aliasstagefailed",
    'if /I not "%OBSERVED_SHA%"=="%ALIAS_BEFORE_SHA%" goto aliasstagefailed',
    ":makealiascandidate",
    'copy /B /Y "%NEW_EXE%" "%ALIAS_CANDIDATE%" >NUL',
    "if errorlevel 1 goto aliasstagefailed",
    'set "HASH_PATH=%ALIAS_CANDIDATE%"',
    "call :hashpath",
    "if errorlevel 1 goto aliasstagefailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto aliasstagefailed',
    ":persistprepared",
    'set "JOURNAL_PHASE=prepared"',
    'set "JOURNAL_DECISION=rollback"',
    "call :writejournal",
    "if errorlevel 1 goto journalpreparefailed",
    'set "JOURNAL_INITIAL_BASE64="',
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
    'set "JOURNAL_PHASE=target-committed"',
    "call :writejournal",
    "if errorlevel 1 goto journalphasefailed",
    'if "%MANAGE_ALIAS%"=="0" goto verifytransaction',
    'move /Y "%ALIAS_CANDIDATE%" "%ALIAS_EXE%" >NUL',
    "if errorlevel 1 goto aliascommitfailed",
    'set "ALIAS_COMMITTED=1"',
    'set "JOURNAL_PHASE=alias-committed"',
    "call :writejournal",
    "if errorlevel 1 goto journalphasefailed",
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
          'if "%MANAGE_ALIAS%"=="0" goto persistverified',
          'set "VERIFY_PATH=%ALIAS_EXE%"',
          ...startupCheck,
        ]
      : ["REM post-replace verification disabled"]),
    ":persistverified",
    'set "JOURNAL_PHASE=verified"',
    "call :writejournal",
    "if errorlevel 1 goto journalphasefailed",
    ":writelineage",
    'if not "%OPERATION%"=="update" goto persistlineage',
    'if "%HAD_TARGET%"=="0" goto persistlineage',
    'move /Y "%BACKUP_TEMP%" "%BACKUP_EXE%" >NUL',
    "if errorlevel 1 goto backupcommitfailed",
    'set "BACKUP_COMMITTED=1"',
    'set "HASH_PATH=%BACKUP_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto backupcommitfailed",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto backupcommitfailed',
    'set "JOURNAL_PHASE=backup-committed"',
    "call :writejournal",
    "if errorlevel 1 goto journalphasefailed",
    ":persistlineage",
    `> "%LINEAGE_TEMP%" echo ${JSON.stringify(successLineage)}`,
    'move /Y "%LINEAGE_TEMP%" "%LINEAGE_FILE%" >NUL',
    "if errorlevel 1 goto lineagefailed",
    'set "HASH_PATH=%LINEAGE_FILE%"',
    "call :hashpath",
    "if errorlevel 1 goto lineagefailed",
    'if /I not "%OBSERVED_SHA%"=="%LINEAGE_TRANSACTION_SHA%" goto lineagefailed',
    'set "JOURNAL_PHASE=lineage-committed"',
    "call :writejournal",
    "if errorlevel 1 goto journalphasefailed",
    'set "JOURNAL_PHASE=committed"',
    'set "JOURNAL_DECISION=commit"',
    "call :writejournal",
    "if errorlevel 1 goto journalcommitfailed",
    'set "JOURNAL_ACTION=retire"',
    "call :writejournal",
    "if errorlevel 1 goto journalretirefailed",
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
    ":journalphasefailed",
    'set "FAIL_STATUS=journal-phase-write-failed"',
    "goto rollbacktransaction",
    ":journalpreparefailed",
    'if exist "%JOURNAL_FILE%" goto journalrecoveryrequired',
    'set "RESULT_STATUS=journal-prepare-failed"',
    "goto cleanup",
    ":journalcommitfailed",
    'set "RESULT_STATUS=journal-commit-write-failed"',
    "goto journalrecoveryrequired",
    ":journalretirefailed",
    'set "RESULT_STATUS=journal-retirement-failed"',
    "goto journalrecoveryrequired",
    ":rollbacktransaction",
    'if "%TARGET_COMMITTED%"=="1" goto rollbackcommittedtarget',
    'if exist "%TARGET_EXE%" goto inspectrollbacktarget',
    'if "%HAD_TARGET%"=="1" goto targetrollbackfailed',
    "goto rollbackalias",
    ":inspectrollbacktarget",
    'set "HASH_PATH=%TARGET_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto targetrollbackfailed",
    'if /I "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" goto rollbackalias',
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto targetrollbackfailed',
    'set "TARGET_COMMITTED=1"',
    ":rollbackcommittedtarget",
    'set "HASH_PATH=%TARGET_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto targetrollbackfailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto targetrollbackfailed',
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
    'if "%MANAGE_ALIAS%"=="0" goto finishrollback',
    'if "%ALIAS_COMMITTED%"=="1" goto rollbackcommittedalias',
    'if exist "%ALIAS_EXE%" goto inspectrollbackalias',
    'if "%HAD_ALIAS%"=="1" goto aliasrollbackfailed',
    "goto finishrollback",
    ":inspectrollbackalias",
    'set "HASH_PATH=%ALIAS_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto aliasrollbackfailed",
    'if /I "%OBSERVED_SHA%"=="%ALIAS_BEFORE_SHA%" goto finishrollback',
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto aliasrollbackfailed',
    'set "ALIAS_COMMITTED=1"',
    ":rollbackcommittedalias",
    'set "HASH_PATH=%ALIAS_EXE%"',
    "call :hashpath",
    "if errorlevel 1 goto aliasrollbackfailed",
    'if /I not "%OBSERVED_SHA%"=="%EXPECTED_SHA%" goto aliasrollbackfailed',
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
    "call :restorebackupstate",
    "if errorlevel 1 goto rollbackstatefailed",
    "call :restorelineagestate",
    "if errorlevel 1 goto rollbacklineagefailed",
    'set "JOURNAL_ACTION=retire"',
    "call :writejournal",
    "if errorlevel 1 goto rollbackjournalretirefailed",
    'set "RESULT_STATUS=%FAIL_STATUS%-rolled-back"',
    "goto cleanup",
    ":rollbackfailed",
    'set "RESULT_STATUS=%FAIL_STATUS%-rollback-failed"',
    "goto journalrecoveryrequired",
    ":rollbacklineagefailed",
    'set "ROLLBACK_OK=0"',
    'set "FAIL_STATUS=rollback-lineage-write-failed"',
    "goto rollbackfailed",
    ":rollbackstatefailed",
    'set "ROLLBACK_OK=0"',
    'set "FAIL_STATUS=rollback-state-restore-failed"',
    "goto rollbackfailed",
    ":rollbackjournalretirefailed",
    'set "FAIL_STATUS=rollback-journal-retirement-failed"',
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
    'if exist "%JOURNAL_FILE%" goto journalrecoveryrequired',
    "goto cleanup",
    ":hashfailed",
    'set "RESULT_STATUS=hash-check-failed"',
    'if exist "%JOURNAL_FILE%" goto hashfailedafterjournal',
    "goto cleanup",
    ":hashfailedafterjournal",
    'set "FAIL_STATUS=hash-check-failed"',
    "goto rollbacktransaction",
    ":hashmismatch",
    'set "RESULT_STATUS=sha256-mismatch"',
    'if exist "%JOURNAL_FILE%" goto hashmismatchafterjournal',
    "goto cleanup",
    ":hashmismatchafterjournal",
    'set "FAIL_STATUS=sha256-mismatch"',
    "goto rollbacktransaction",
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
    'set "FAIL_STATUS=move-failed"',
    "goto rollbacktransaction",
    ":locklost",
    'set "RESULT_STATUS=lock-ownership-lost"',
    "goto journalrecoveryrequired",
    ":readyfailed",
    'set "WRITE_RESULT=0"',
    'set "SKIP_PATH_CLEANUP=1"',
    "goto cleanup",
    ":journalrecoveryrequired",
    'set "EXIT_CODE=1"',
    'set "WRITE_RESULT=0"',
    'set "SKIP_PATH_CLEANUP=1"',
    'set "ROLLBACK_OK=0"',
    "goto cleanup",
    ":cleanup",
    'if "%SKIP_PATH_CLEANUP%"=="1" goto unsafeexit',
    'if exist "%JOURNAL_FILE%" goto cleanupvolatile',
    'del /F /Q "%BACKUP_TEMP%" >NUL 2>&1',
    'del /F /Q "%CURRENT_TEMP%" >NUL 2>&1',
    'del /F /Q "%TARGET_SNAPSHOT%" >NUL 2>&1',
    'del /F /Q "%BACKUP_SNAPSHOT%" >NUL 2>&1',
    'del /F /Q "%LINEAGE_SNAPSHOT%" >NUL 2>&1',
    'if "%MANAGE_ALIAS%"=="1" del /F /Q "%ALIAS_BACKUP%" >NUL 2>&1',
    'del /F /Q "%JOURNAL_HELPER%" >NUL 2>&1',
    ":cleanupvolatile",
    'if "%ROLLBACK_OK%"=="1" del /F /Q "%ROLLBACK_TEMP%" >NUL 2>&1',
    'if "%ROLLBACK_OK%"=="1" del /F /Q "%BACKUP_ROLLBACK%" >NUL 2>&1',
    'if "%MANAGE_ALIAS%"=="1" del /F /Q "%ALIAS_CANDIDATE%" >NUL 2>&1',
    'if "%ROLLBACK_OK%"=="1" if "%MANAGE_ALIAS%"=="1" del /F /Q "%ALIAS_ROLLBACK%" >NUL 2>&1',
    'del /F /Q "%LINEAGE_TEMP%" >NUL 2>&1',
    'del /F /Q "%READY_TEMP%" >NUL 2>&1',
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
    ":writejournal",
    '"%CC_SYSTEM_ROOT%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%JOURNAL_HELPER%" >NUL 2>&1',
    "exit /b %ERRORLEVEL%",
    ":restorebackupstate",
    'if "%HAD_BACKUP%"=="0" goto restorebackupabsent',
    'if not exist "%BACKUP_EXE%" goto restorebackupfromsnapshot',
    'set "HASH_PATH=%BACKUP_EXE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I "%OBSERVED_SHA%"=="%BACKUP_BEFORE_SHA%" exit /b 0',
    'if "%OPERATION%"=="rescue" exit /b 1',
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" exit /b 1',
    ":restorebackupfromsnapshot",
    'if not exist "%BACKUP_SNAPSHOT%" exit /b 1',
    'set "HASH_PATH=%BACKUP_SNAPSHOT%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%BACKUP_BEFORE_SHA%" exit /b 1',
    'copy /B /Y "%BACKUP_SNAPSHOT%" "%BACKUP_ROLLBACK%" >NUL',
    "if errorlevel 1 exit /b 1",
    'move /Y "%BACKUP_ROLLBACK%" "%BACKUP_EXE%" >NUL',
    "if errorlevel 1 exit /b 1",
    'set "HASH_PATH=%BACKUP_EXE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%BACKUP_BEFORE_SHA%" exit /b 1',
    "exit /b 0",
    ":restorebackupabsent",
    'if not exist "%BACKUP_EXE%" exit /b 0',
    'if "%OPERATION%"=="rescue" exit /b 1',
    'if "%HAD_TARGET%"=="0" exit /b 1',
    'set "HASH_PATH=%BACKUP_EXE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%TARGET_BEFORE_SHA%" exit /b 1',
    'del /F /Q "%BACKUP_EXE%" >NUL 2>&1',
    'if exist "%BACKUP_EXE%" exit /b 1',
    "exit /b 0",
    ":restorelineagestate",
    'if "%HAD_LINEAGE%"=="0" goto restorelineageabsent',
    'if not exist "%LINEAGE_FILE%" goto restorelineagefromsnapshot',
    'set "HASH_PATH=%LINEAGE_FILE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I "%OBSERVED_SHA%"=="%LINEAGE_BEFORE_SHA%" exit /b 0',
    'if /I not "%OBSERVED_SHA%"=="%LINEAGE_TRANSACTION_SHA%" exit /b 1',
    ":restorelineagefromsnapshot",
    'if not exist "%LINEAGE_SNAPSHOT%" exit /b 1',
    'set "HASH_PATH=%LINEAGE_SNAPSHOT%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%LINEAGE_BEFORE_SHA%" exit /b 1',
    'copy /B /Y "%LINEAGE_SNAPSHOT%" "%LINEAGE_TEMP%" >NUL',
    "if errorlevel 1 exit /b 1",
    'move /Y "%LINEAGE_TEMP%" "%LINEAGE_FILE%" >NUL',
    "if errorlevel 1 exit /b 1",
    'set "HASH_PATH=%LINEAGE_FILE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%LINEAGE_BEFORE_SHA%" exit /b 1',
    "exit /b 0",
    ":restorelineageabsent",
    'if not exist "%LINEAGE_FILE%" exit /b 0',
    'set "HASH_PATH=%LINEAGE_FILE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%LINEAGE_TRANSACTION_SHA%" exit /b 1',
    'del /F /Q "%LINEAGE_FILE%" >NUL 2>&1',
    'if exist "%LINEAGE_FILE%" exit /b 1',
    "exit /b 0",
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
    "goto prestate_lineage",
    ":prestate_backup_present",
    'if not exist "%BACKUP_EXE%" exit /b 1',
    'set "HASH_PATH=%BACKUP_EXE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%BACKUP_BEFORE_SHA%" exit /b 1',
    ":prestate_lineage",
    'if "%HAD_LINEAGE%"=="1" goto prestate_lineage_present',
    'if exist "%LINEAGE_FILE%" exit /b 1',
    "exit /b 0",
    ":prestate_lineage_present",
    'if not exist "%LINEAGE_FILE%" exit /b 1',
    'set "HASH_PATH=%LINEAGE_FILE%"',
    "call :hashpath",
    "if errorlevel 1 exit /b 1",
    'if /I not "%OBSERVED_SHA%"=="%LINEAGE_BEFORE_SHA%" exit /b 1',
    "exit /b 0",
  ].join("\r\n");

  try {
    fs.writeFileSync(
      journalHelperPath,
      windowsGenerationJournalHelperSource(),
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    fs.writeFileSync(sidecarPath, `\uFEFF${cmd}`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    removeRegularFileIfPresent(sidecarPath);
    removeRegularFileIfPresent(journalHelperPath);
    throw error;
  }
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
  if (
    platform === "win32" &&
    !samePath(backupPath, statePaths.backupPath, platform)
  ) {
    throw new ApplyError(
      "Windows restart recovery requires the canonical .previous backup",
      "BACKUP_NOT_CANONICAL",
    );
  }
  assertApplyPath(backupPath, "last-known-good backup", false, platform);
  assertApplyPath(statePaths.lineagePath, "update lineage", false, platform);
  assertApplyPath(layout.canonicalPath, "canonical executable", true, platform);
  if (layout.aliasPath) {
    assertApplyPath(layout.aliasPath, "managed CLI alias", true, platform);
  }
  if (lstatOrNull(statePaths.journalPath)) {
    throw new ApplyError(
      `an interrupted native generation requires restart recovery: ${statePaths.journalPath}`,
      "RECOVERY_REQUIRED",
    );
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
    const hadPriorBackup = Boolean(lstatOrNull(statePaths.backupPath));
    const priorBackupSha = hadPriorBackup
      ? stableSha256(statePaths.backupPath, "existing native backup")
      : null;
    const priorLineageSha = stableSha256(
      statePaths.lineagePath,
      "native update lineage before rescue",
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
        hadPriorBackup,
        hadPriorLineage: true,
        priorBackupSha,
        priorLineageSha,
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
      hadPriorBackup,
      priorBackupSha,
      priorLineageSha,
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
    hadPriorBackup,
    priorBackupSha,
    priorLineageSha,
    restart,
    verify,
    spawnImpl,
    verifyImpl,
  } = ctx;
  const targetPath = layout.canonicalPath;
  const snapshotPaths = generationSnapshotPaths(targetPath, transactionId);
  const journal = makeGenerationJournal({
    transactionId,
    operation: "rescue",
    expectedSha: rescueSha,
    hadTarget,
    targetBeforeSha,
    hadBackup: hadPriorBackup,
    backupBeforeSha: priorBackupSha,
    hadLineage: true,
    lineageBeforeSha: priorLineageSha,
  });

  try {
    if (hadTarget) {
      atomicCopyFile(targetPath, snapshotPaths.priorTargetPath, {
        preserveModeFrom: targetPath,
        updateLock,
      });
      assertExpectedFileHash(
        snapshotPaths.priorTargetPath,
        targetBeforeSha,
        "pre-rescue target generation snapshot",
      );
    }
    if (hadPriorBackup) {
      atomicCopyFile(statePaths.backupPath, snapshotPaths.priorBackupPath, {
        preserveModeFrom: statePaths.backupPath,
        updateLock,
      });
      assertExpectedFileHash(
        snapshotPaths.priorBackupPath,
        priorBackupSha,
        "pre-rescue backup generation snapshot",
      );
    }
    atomicCopyFile(statePaths.lineagePath, snapshotPaths.priorLineagePath, {
      preserveModeFrom: statePaths.lineagePath,
      updateLock,
    });
    assertExpectedFileHash(
      snapshotPaths.priorLineagePath,
      priorLineageSha,
      "pre-rescue lineage generation snapshot",
    );
  } catch (error) {
    cleanupGenerationSnapshots(snapshotPaths);
    throw asApplyError(
      error,
      "GENERATION_SNAPSHOT_FAILED",
      "could not preserve the native rescue pre-state",
    );
  }

  try {
    writeGenerationJournalPhase(
      statePaths.journalPath,
      journal,
      "prepared",
      "rollback",
      updateLock,
    );
  } catch (error) {
    if (lstatOrNull(statePaths.journalPath)) {
      throw new ApplyError(
        `native rescue intent persistence is unknown: ${error.message}`,
        "RESCUE_ROLLBACK_FAILED",
      );
    }
    cleanupGenerationSnapshots(snapshotPaths);
    throw asApplyError(
      error,
      "JOURNAL_WRITE_FAILED",
      "could not persist native rescue intent",
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
    writeGenerationJournalPhase(
      statePaths.journalPath,
      journal,
      "target-committed",
      "rollback",
      updateLock,
    );
  } catch (error) {
    try {
      rollbackFailedPosixUpdate({
        targetPath,
        statePaths,
        transactionId,
        hadTarget,
        targetBeforeSha,
        hadPriorBackup,
        hadPriorLineage: true,
        priorBackupSha,
        priorLineageSha,
        snapshotPaths,
        journal,
        updateLock,
      });
    } catch (recoveryError) {
      throw new ApplyError(
        `rescue target commit failed and its generation journal could not be retired: ${recoveryError.message}`,
        "RESCUE_ROLLBACK_FAILED",
      );
    }
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
      writeGenerationJournalPhase(
        statePaths.journalPath,
        journal,
        "verified",
        "rollback",
        updateLock,
      );
    } catch (error) {
      failure = new ApplyError(
        `could not persist native rescue verification: ${error.message}`,
        "JOURNAL_WRITE_FAILED",
      );
    }
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
      writeGenerationJournalPhase(
        statePaths.journalPath,
        journal,
        "lineage-committed",
        "rollback",
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
    try {
      rollbackFailedPosixUpdate({
        targetPath,
        statePaths,
        transactionId,
        hadTarget,
        targetBeforeSha,
        hadPriorBackup,
        hadPriorLineage: true,
        priorBackupSha,
        priorLineageSha,
        snapshotPaths,
        journal,
        updateLock,
      });
    } catch (error) {
      throw new ApplyError(
        `rescue verification failed and pre-rescue restoration failed: ${error.message}`,
        "RESCUE_ROLLBACK_FAILED",
      );
    }
    throw failure;
  }

  try {
    writeGenerationJournalPhase(
      statePaths.journalPath,
      journal,
      "committed",
      "commit",
      updateLock,
    );
  } catch (error) {
    throw new ApplyError(
      `native rescue commit decision is unknown: ${error.message}`,
      "RESCUE_ROLLBACK_FAILED",
    );
  }
  try {
    retireGenerationJournal(statePaths, journal, updateLock);
  } catch (error) {
    throw new ApplyError(
      `native rescue committed but journal retirement failed: ${error.message}`,
      "RESCUE_ROLLBACK_FAILED",
    );
  }
  cleanupGenerationSnapshots(snapshotPaths);
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

function generationSnapshotPaths(targetPath, transactionId) {
  const directory = path.dirname(targetPath);
  return {
    priorTargetPath: path.join(
      directory,
      `.chainlesschain.target-prior-${transactionId}`,
    ),
    priorBackupPath: path.join(
      directory,
      `.chainlesschain.backup-prior-${transactionId}`,
    ),
    priorLineagePath: path.join(
      directory,
      `.chainlesschain.lineage-prior-${transactionId}`,
    ),
  };
}

function makeGenerationJournal({
  transactionId,
  operation,
  expectedSha,
  hadTarget,
  targetBeforeSha,
  hadBackup,
  backupBeforeSha,
  hadLineage,
  lineageBeforeSha,
}) {
  return {
    schema: NATIVE_GENERATION_TRANSACTION_SCHEMA,
    transactionId,
    operation,
    phase: "prepared",
    decision: "rollback",
    expectedSha256: expectedSha,
    hadTarget,
    targetBeforeSha256: hadTarget ? targetBeforeSha : null,
    hadBackup,
    backupBeforeSha256: hadBackup ? backupBeforeSha : null,
    hadAlias: false,
    aliasBeforeSha256: null,
    hadLineage,
    lineageBeforeSha256: hadLineage ? lineageBeforeSha : null,
    updatedAt: new Date().toISOString(),
  };
}

function writeGenerationJournalPhase(
  journalPath,
  journal,
  phase,
  decision,
  updateLock,
) {
  journal.phase = phase;
  journal.decision = decision;
  journal.updatedAt = new Date().toISOString();
  atomicWriteJson(journalPath, journal, updateLock);
}

function retireGenerationJournal(statePaths, journal, updateLock) {
  assertUpdateLockOwned(updateLock);
  const current = JSON.parse(fs.readFileSync(statePaths.journalPath, "utf8"));
  if (
    current.schema !== NATIVE_GENERATION_TRANSACTION_SCHEMA ||
    current.transactionId !== journal.transactionId ||
    current.decision !== journal.decision ||
    (current.phase === "committed") !== (current.decision === "commit")
  ) {
    throw new ApplyError(
      "native generation journal changed before retirement",
      "JOURNAL_CHANGED",
    );
  }
  fs.renameSync(statePaths.journalPath, statePaths.lastJournalPath);
  fsyncDirectory(path.dirname(statePaths.journalPath));
}

function cleanupGenerationSnapshots(snapshotPaths) {
  for (const snapshotPath of Object.values(snapshotPaths)) {
    removeRegularFileIfPresent(snapshotPath);
  }
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

function samePath(firstPath, secondPath, platform = process.platform) {
  let first = path.resolve(firstPath);
  let second = path.resolve(secondPath);
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
    const identityChanged =
      !sameOpenedFileIdentity(before, after, ["size", "mtimeNs", "ctimeNs"]) ||
      !pathMatchesOpenedFileIdentitySync(filePath, after, {
        stateFields: ["size", "mtimeNs", "ctimeNs"],
      });
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
    const pathOwnedBefore = pathMatchesOpenedFileIdentitySync(
      lock.lockPath,
      before,
      { stateFields: ["size", "mtimeNs", "ctimeNs"] },
    );
    const expected = Buffer.from(lock.token, "utf8");
    const actual = Buffer.alloc(expected.length + 1);
    const bytesRead = fs.readSync(lock.fd, actual, 0, actual.length, 0);
    const after = fs.fstatSync(lock.fd, { bigint: true });
    const pathOwnedAfter = pathMatchesOpenedFileIdentitySync(
      lock.lockPath,
      after,
      { stateFields: ["size", "mtimeNs", "ctimeNs"] },
    );
    const descriptorStable =
      before.isFile() &&
      after.isFile() &&
      before.nlink > 0n &&
      after.nlink > 0n &&
      sameOpenedFileIdentity(before, after, ["size", "mtimeNs", "ctimeNs"]);
    const pathStillOwned = pathOwnedBefore && pathOwnedAfter;
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
