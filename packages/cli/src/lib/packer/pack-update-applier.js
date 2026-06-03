/**
 * Phase 5c: replace the currently-running packed exe with a downloaded new
 * artifact. This is the third step of the OTA chain:
 *   Phase 5a (check) → Phase 5b (download+verify) → Phase 5c (apply)
 *
 * The two platform flavors behave very differently:
 *
 *   POSIX (Linux / macOS): the kernel keeps the running exe's inode open
 *   independently of its directory entry. We can `rename(new, target)`
 *   while the old process is still executing — the new bytes are on disk
 *   under the target path, the old process continues running the old
 *   inode until it exits, and a fresh spawn of `target` picks up the new
 *   code. Clean, atomic, no sidecar.
 *
 *   Windows: the OS refuses to overwrite a running `.exe`. The only
 *   reliable pattern is a sidecar script that (1) waits for the parent
 *   PID to exit, (2) moves `<new>` → `<target>`, (3) optionally restarts.
 *   We write a tiny `.cmd` to `%TEMP%` and spawn it detached; the parent
 *   then exits on its own.
 *
 * All file-system mutations can be gated by `dryRun: true`, which just
 * returns the plan (commands / paths the applier would have executed).
 * Tests use `platform: 'win32' | 'posix'` to exercise both branches on any
 * host without touching the running exe.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * @param {object} ctx
 * @param {string} ctx.newExePath              the verified artifact from Phase 5b
 * @param {string} ctx.targetExePath           the exe to replace (usually process.execPath)
 * @param {boolean} [ctx.restart=false]        spawn the new exe after replacement
 * @param {boolean} [ctx.dryRun=false]         return the plan, do not mutate disk
 * @param {"win32"|"posix"} [ctx.platform]     override host detection for tests
 * @param {number} [ctx.parentPid]             PID to wait on (Windows sidecar); defaults to process.pid
 * @param {(cmd:string,args:string[])=>object} [ctx.spawnImpl]  injected for tests
 * @returns {Promise<{
 *   platform: "win32"|"posix",
 *   action: "replace-in-place"|"sidecar-cmd"|"dry-run",
 *   targetExePath: string,
 *   newExePath: string,
 *   sidecarPath: string|null,
 *   restartRequested: boolean,
 * }>}
 */
export async function scheduleReplace(ctx) {
  const {
    newExePath,
    targetExePath,
    restart = false,
    dryRun = false,
    platform = process.platform === "win32" ? "win32" : "posix",
    parentPid = process.pid,
    spawnImpl = spawn,
  } = ctx;

  if (!newExePath || typeof newExePath !== "string") {
    throw new ApplyError("newExePath is required", "NO_NEW_EXE");
  }
  if (!targetExePath || typeof targetExePath !== "string") {
    throw new ApplyError("targetExePath is required", "NO_TARGET_EXE");
  }
  if (!fs.existsSync(newExePath)) {
    throw new ApplyError(
      `new exe does not exist: ${newExePath}`,
      "NEW_EXE_MISSING",
    );
  }

  if (dryRun) {
    return {
      platform,
      action: "dry-run",
      targetExePath,
      newExePath,
      sidecarPath: null,
      restartRequested: Boolean(restart),
    };
  }

  if (platform === "win32") {
    const sidecarPath = writeWindowsSidecar({
      newExePath,
      targetExePath,
      parentPid,
      restart: Boolean(restart),
    });
    // Detach so the sidecar survives our process exit. `windowsHide: true`
    // keeps the cmd window from flashing — the replace itself is silent.
    const child = spawnImpl("cmd.exe", ["/c", sidecarPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    if (child && typeof child.unref === "function") child.unref();

    return {
      platform,
      action: "sidecar-cmd",
      targetExePath,
      newExePath,
      sidecarPath,
      restartRequested: Boolean(restart),
    };
  }

  // POSIX: atomic rename works even if targetExePath is the running exe.
  // Preserve executable bit — a downloaded file from fetch defaults to 644.
  try {
    fs.chmodSync(newExePath, 0o755);
  } catch {
    /* best effort — non-fatal if chmod fails (e.g. on FAT32 volumes) */
  }
  try {
    fs.renameSync(newExePath, targetExePath);
  } catch (err) {
    throw new ApplyError(`rename failed: ${err.message}`, "RENAME_FAILED");
  }

  if (restart) {
    const child = spawnImpl(targetExePath, process.argv.slice(2), {
      detached: true,
      stdio: "ignore",
    });
    if (child && typeof child.unref === "function") child.unref();
  }

  return {
    platform,
    action: "replace-in-place",
    targetExePath,
    newExePath,
    sidecarPath: null,
    restartRequested: Boolean(restart),
  };
}

/**
 * Build the Windows sidecar `.cmd` that waits for the parent, moves the new
 * exe over the target, and optionally restarts. Exposed (rather than inlined)
 * so tests can read it back and assert on the shape without actually spawning.
 *
 * @param {object} ctx
 * @param {string} ctx.newExePath
 * @param {string} ctx.targetExePath
 * @param {number} ctx.parentPid
 * @param {boolean} ctx.restart
 * @returns {string} absolute path to the generated .cmd (lives in os.tmpdir())
 */
export function writeWindowsSidecar(ctx) {
  const { newExePath, targetExePath, parentPid, restart } = ctx;

  // `%TEMP%` is writable, survives across Explorer double-click launches, and
  // gets auto-cleaned by Windows eventually. The unique name prevents two
  // concurrent applies from clobbering each other.
  const sidecarName = `cc-pack-apply-${Date.now()}-${Math.floor(Math.random() * 1e6)}.cmd`;
  const sidecarPath = path.join(os.tmpdir(), sidecarName);

  // tasklist /FI "PID eq <pid>" prints "INFO: No tasks..." when the PID is
  // gone. We loop every 500ms up to ~10s; that's long enough for the parent
  // to close its Electron/UI server gracefully but short enough to avoid
  // stalling forever if the detection oddly fails.
  const cmd = [
    "@echo off",
    "setlocal",
    `set PARENT_PID=${parentPid}`,
    `set NEW_EXE="${newExePath}"`,
    `set TARGET_EXE="${targetExePath}"`,
    "set /a ATTEMPTS=0",
    ":waitloop",
    'tasklist /FI "PID eq %PARENT_PID%" 2>NUL | find /I "%PARENT_PID%" >NUL',
    "if errorlevel 1 goto doreplace",
    "set /a ATTEMPTS=%ATTEMPTS%+1",
    "if %ATTEMPTS% GEQ 20 goto doreplace",
    // Timeout with /T /NOBREAK is the only idle-wait available in pure cmd.
    "timeout /T 1 /NOBREAK >NUL",
    "goto waitloop",
    ":doreplace",
    "move /Y %NEW_EXE% %TARGET_EXE% >NUL",
    "if errorlevel 1 (",
    "  echo cc-pack-apply: move failed & exit /b 1",
    ")",
    restart ? 'start "" %TARGET_EXE%' : "REM restart not requested",
    // Self-delete — best effort. Leaving the .cmd in %TEMP% is harmless if
    // this fails; Windows will reap it on the next disk-cleanup cycle.
    '(goto) 2>NUL & del "%~f0"',
  ].join("\r\n");

  fs.writeFileSync(sidecarPath, cmd, { encoding: "utf-8" });
  return sidecarPath;
}

export class ApplyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ApplyError";
    this.code = code;
  }
}
