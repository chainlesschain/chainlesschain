// Test harness lifecycle only. This is not a hostile-process containment boundary.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function windowsBatchInvocation(command, args) {
  // cmd expands %/! even inside quotes. Refuse shell syntax in operator paths.
  const quote = (value) => {
    if (/["%!&|<>^\r\n]/u.test(value))
      throw new Error("Unsafe Windows batch argument");
    return `"${value}"`;
  };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`],
    windowsVerbatimArguments: true,
  };
}

export function launchLogged(command, args, { cwd, env, logFile }) {
  const invocation =
    process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command)
      ? windowsBatchInvocation(command, args)
      : { command, args };
  const log = fs.openSync(logFile, "wx", 0o600);
  let child;
  try {
    child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      detached: process.platform !== "win32",
      stdio: ["ignore", log, log],
    });
  } finally {
    fs.closeSync(log);
  }
  const handle = { child, closed: false, done: null, logFile };
  handle.done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      handle.closed = true;
      resolve({ code, signal });
    });
  });
  // A host may fail before readiness. Keep its rejection observed until awaited.
  handle.done.catch(() => {});
  return handle;
}

function cleanupUnconfirmed(message) {
  return Object.assign(new Error(message), {
    code: "CC_DIAGNOSTIC_CLEANUP_UNCONFIRMED",
  });
}

function windowsProcessSnapshot() {
  const script = `$ErrorActionPreference='Stop'; @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, Name, CreationDate FROM Win32_Process' | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;created=if($null -eq $_.CreationDate){$null}else{$_.CreationDate.ToUniversalTime().Ticks.ToString()}} }) | ConvertTo-Json -Compress`;
  const result = spawnSync(
    path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      windowsHide: true,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0)
    throw cleanupUnconfirmed(
      `Windows process identity snapshot failed: ${result.error?.message || result.stderr}`,
    );
  const entries = JSON.parse(result.stdout);
  const snapshot = Array.isArray(entries) ? entries : [entries];
  if (
    !snapshot.every(
      (entry) =>
        Number.isSafeInteger(entry.pid) &&
        Number.isSafeInteger(entry.parentPid) &&
        (entry.created === null || /^\d+$/u.test(entry.created)),
    )
  )
    throw cleanupUnconfirmed("Windows process identity snapshot was malformed");
  return snapshot;
}

function windowsOwnedTree(snapshot, rootPid) {
  const root = snapshot.find((entry) => entry.pid === rootPid);
  if (!root)
    throw cleanupUnconfirmed(
      "Windows host owner disappeared before its process tree could be recorded",
    );
  if (root.created === null)
    throw cleanupUnconfirmed(
      "Windows host owner creation identity is unavailable",
    );
  const owned = [root];
  extendWindowsOwnedTree(snapshot, owned);
  return owned;
}

function extendWindowsOwnedTree(snapshot, owned) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of snapshot) {
      if (entry.created === null) {
        if (
          owned.some(
            (known) => known.pid === entry.pid || known.pid === entry.parentPid,
          )
        )
          throw cleanupUnconfirmed(
            `Windows owned process creation identity is unavailable (${entry.pid})`,
          );
        continue;
      }
      const parent = owned.find(
        (known) =>
          known.pid === entry.parentPid &&
          BigInt(entry.created) >= BigInt(known.created),
      );
      if (
        parent &&
        !owned.some(
          (known) => known.pid === entry.pid && known.created === entry.created,
        )
      ) {
        owned.push(entry);
        changed = true;
      }
    }
  }
}

async function requestGracefulShutdown(request, deadline, evidence) {
  const controller = new AbortController();
  evidence.graceful = { requested: true, acknowledged: false };
  try {
    await withinDeadline(
      Promise.resolve().then(() => request({ signal: controller.signal })),
      deadline,
      "graceful shutdown request",
    );
    evidence.graceful.acknowledged = true;
  } catch (error) {
    // An IDE can close the HTTP connection while exiting. Only the OS tree
    // observation below can establish cleanup, regardless of request outcome.
    evidence.graceful.error = error.message;
  } finally {
    controller.abort();
  }
}

function saveCleanupEvidence(handle) {
  if (handle.logFile && handle.cleanupEvidence)
    fs.writeFileSync(
      `${handle.logFile}.cleanup.json`,
      `${JSON.stringify(handle.cleanupEvidence, null, 2)}\n`,
    );
}

const preparedWindowsTrees = new WeakMap();

/** Capture live Windows ownership before starting a caller's shutdown deadline.
 * This is preparation only: descendants must still be observed absent by stopOwned.
 */
export function captureOwnedProcessTree(handle) {
  if (
    process.platform !== "win32" ||
    !handle?.child.pid ||
    handle.cleanupConfirmed
  )
    return;
  if (preparedWindowsTrees.has(handle)) return;
  const evidence = {
    scope: "known-diagnostic-process-tree",
    owned: [],
    taskkill: null,
    confirmed: false,
  };
  handle.cleanupEvidence = evidence;
  try {
    if (
      handle.closed ||
      handle.child.exitCode !== null ||
      handle.child.signalCode !== null
    )
      throw cleanupUnconfirmed(
        "Windows host owner exited before identity capture",
      );
    evidence.owned = windowsOwnedTree(
      windowsProcessSnapshot(),
      handle.child.pid,
    );
    preparedWindowsTrees.set(handle, evidence.owned);
  } catch (error) {
    evidence.error = error.message;
    throw error;
  } finally {
    saveCleanupEvidence(handle);
  }
}

/** Long-running Windows hosts require a living owner for tree termination.
 * A departed root PID cannot establish ownership of its former descendants.
 * The default permits natural short-command completion, not durable recovery.
 */
export async function stopOwned(
  handle,
  {
    requireRunningOwner = false,
    gracefulStop,
    gracefulDeadline = Date.now() + 30000,
  } = {},
) {
  if (!handle?.child.pid) return;
  if (handle.cleanupConfirmed) return;
  if (handle.cleanupPromise) return await handle.cleanupPromise;
  const { child } = handle;
  if (
    process.platform === "win32" &&
    (handle.closed || child.exitCode !== null || child.signalCode !== null)
  ) {
    if (requireRunningOwner)
      throw cleanupUnconfirmed(
        "Windows host owner exited before tree cleanup was confirmed",
      );
    await withinDeadline(
      handle.done,
      Date.now() + 10000,
      "short command exit acknowledgement",
    );
    return;
  }
  handle.cleanupPromise = (async () => {
    if (process.platform === "win32") {
      // Record OS identities while the owner is alive. This confirms the known
      // diagnostic tree, not containment of hostile/detaching descendants.
      captureOwnedProcessTree(handle);
      const owned = preparedWindowsTrees.get(handle);
      preparedWindowsTrees.delete(handle);
      const evidence = handle.cleanupEvidence;
      const saveEvidence = () => saveCleanupEvidence(handle);
      const observeRemaining = () => {
        const snapshot = windowsProcessSnapshot();
        // Retain ancestry even when a known parent has already exited. A
        // post-shutdown descendant must also disappear before confirmation.
        extendWindowsOwnedTree(snapshot, owned);
        evidence.remaining = owned.filter((entry) =>
          snapshot.some(
            (live) => live.pid === entry.pid && live.created === entry.created,
          ),
        );
      };
      saveEvidence();
      try {
        if (gracefulStop && Date.now() < gracefulDeadline) {
          await requestGracefulShutdown(
            gracefulStop,
            gracefulDeadline,
            evidence,
          );
          do {
            observeRemaining();
            if (!evidence.remaining.length || Date.now() >= gracefulDeadline)
              break;
            await delay(Math.min(100, gracefulDeadline - Date.now()));
          } while (evidence.remaining.length && Date.now() < gracefulDeadline);
          if (
            evidence.remaining.length &&
            !evidence.remaining.some(
              (entry) =>
                entry.pid === child.pid && entry.created === owned[0].created,
            )
          )
            throw cleanupUnconfirmed(
              "Windows owner exited during graceful shutdown but known descendants remain; tree termination ownership is unavailable",
            );
        }
        if (!evidence.remaining || evidence.remaining.length) {
          const result = spawnSync(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { shell: false, windowsHide: true, timeout: 10000 },
          );
          evidence.taskkill = {
            status: result.status,
            signal: result.signal,
            // Windows taskkill uses the host's OEM encoding. Preserve exact
            // bytes; the UTF-8 display is explicitly lossy on localized hosts.
            stdout: result.stdout?.toString("utf8") || "",
            stderr: result.stderr?.toString("utf8") || "",
            displayEncoding: "utf8-lossy",
            stdoutBase64: result.stdout?.toString("base64") || "",
            stderrBase64: result.stderr?.toString("base64") || "",
            error: result.error?.message,
          };
          saveEvidence();
          if (result.error) throw result.error;
          const deadline = Date.now() + 10000;
          while (true) {
            observeRemaining();
            if (!evidence.remaining.length) break;
            if (Date.now() >= deadline)
              throw cleanupUnconfirmed(
                `Windows process identities survived tree termination (taskkill ${result.status}): ${evidence.remaining.map((entry) => entry.pid).join(", ")}; ${evidence.taskkill.stderr.trim() || evidence.taskkill.stdout.trim() || "no taskkill output"}`,
              );
            await delay(100);
          }
        }
        // taskkill can report a race when a member exits during tree traversal.
        // Its exit status alone is never the evidence that cleanup succeeded.
        evidence.ownerExit = await withinDeadline(
          handle.done,
          Date.now() + 10000,
          "Windows owner exit acknowledgement",
        );
        evidence.confirmed = true;
      } catch (error) {
        evidence.error = error.message;
        throw error;
      } finally {
        saveEvidence();
      }
    } else {
      const evidence = {
        scope: "owned-diagnostic-process-group",
        groupPid: child.pid,
        signals: [],
        confirmed: false,
      };
      handle.cleanupEvidence = evidence;
      // The group can outlive its leader. Never signal it again after observing
      // ESRCH: its numeric ID is no longer ours to reuse.
      const groupExists = () => {
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;
          // macOS can temporarily deny a group probe during teardown. That
          // still means existence is possible; only ESRCH releases ownership.
          if (error.code === "EPERM") return true;
          throw error;
        }
      };
      const signalGroup = (signal) => {
        try {
          process.kill(-child.pid, signal);
          evidence.signals.push(signal);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;
          throw error;
        }
      };
      try {
        let exists = groupExists();
        if (exists && gracefulStop && Date.now() < gracefulDeadline) {
          await requestGracefulShutdown(
            gracefulStop,
            gracefulDeadline,
            evidence,
          );
          while (exists) {
            exists = groupExists();
            if (!exists || Date.now() >= gracefulDeadline) break;
            await delay(Math.min(100, gracefulDeadline - Date.now()));
          }
        }
        if (exists) exists = signalGroup("SIGTERM");
        const grace = Date.now() + 3000;
        while (exists && Date.now() < grace) {
          exists = groupExists();
          if (exists) await delay(100);
        }
        if (exists) exists = signalGroup("SIGKILL");
        const confirmation = Date.now() + 10000;
        while (exists) {
          exists = groupExists();
          if (!exists) break;
          if (Date.now() >= confirmation)
            throw cleanupUnconfirmed(
              "Owned POSIX process group still exists after SIGKILL",
            );
          await delay(100);
        }
        evidence.ownerExit = await withinDeadline(
          handle.done,
          Date.now() + 10000,
          "POSIX owner exit acknowledgement",
        );
        evidence.confirmed = true;
      } catch (error) {
        evidence.error = error.message;
        throw error;
      } finally {
        saveCleanupEvidence(handle);
      }
    }
    await withinDeadline(
      handle.done,
      Date.now() + 10000,
      "owned process exit acknowledgement",
    );
    handle.cleanupConfirmed = true;
    if (handle.cleanupEvidence) handle.cleanupEvidence.confirmed = true;
  })();
  return await handle.cleanupPromise;
}

export async function withinDeadline(promise, deadline, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} deadline exceeded`)),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function requireSuccess(handle, deadline, label) {
  try {
    const result = await withinDeadline(handle.done, deadline, label);
    if (result.code !== 0 || result.signal !== null)
      throw new Error(`${label} exited ${result.code}/${result.signal}`);
    return result;
  } finally {
    await stopOwned(handle);
  }
}
