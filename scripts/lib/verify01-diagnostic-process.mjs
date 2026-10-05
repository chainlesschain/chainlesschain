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
  const script = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;created=if($null -eq $_.CreationDate){$null}else{$_.CreationDate.ToUniversalTime().Ticks.ToString()}} }) | ConvertTo-Json -Compress`;
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

/** Long-running Windows hosts require a living owner for tree termination.
 * A departed root PID cannot establish ownership of its former descendants.
 * The default permits natural short-command completion, not durable recovery.
 */
export async function stopOwned(handle, { requireRunningOwner = false } = {}) {
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
      const owned = windowsOwnedTree(windowsProcessSnapshot(), child.pid);
      const result = spawnSync(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          timeout: 10000,
        },
      );
      const evidence = {
        scope: "known-diagnostic-process-tree",
        owned,
        taskkill: {
          status: result.status,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error?.message,
        },
        confirmed: false,
      };
      handle.cleanupEvidence = evidence;
      const saveEvidence = () => {
        if (handle.logFile)
          fs.writeFileSync(
            `${handle.logFile}.cleanup.json`,
            `${JSON.stringify(evidence, null, 2)}\n`,
          );
      };
      saveEvidence();
      try {
        if (result.error) throw result.error;
        const deadline = Date.now() + 10000;
        while (true) {
          const remaining = windowsProcessSnapshot();
          // Retain ancestry even when a known parent has already exited. A
          // post-kill descendant must also disappear before confirmation.
          extendWindowsOwnedTree(remaining, owned);
          evidence.remaining = owned.filter((entry) =>
            remaining.some(
              (live) =>
                live.pid === entry.pid && live.created === entry.created,
            ),
          );
          if (evidence.remaining.length === 0) break;
          if (Date.now() >= deadline)
            throw cleanupUnconfirmed(
              `Windows process identities survived tree termination (taskkill ${result.status}): ${evidence.remaining.map((entry) => entry.pid).join(", ")}; ${result.stderr?.trim() || result.stdout?.trim() || "no taskkill output"}`,
            );
          await delay(100);
        }
        // taskkill can report a race when a member exits during tree traversal.
        // Its exit status alone is never the evidence that cleanup succeeded.
        await withinDeadline(
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
      // The group can outlive its leader. Never signal it again after observing
      // ESRCH: its numeric ID is no longer ours to reuse.
      const groupExists = () => {
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;
          throw error;
        }
      };
      const signalGroup = (signal) => {
        try {
          process.kill(-child.pid, signal);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;
          throw error;
        }
      };
      let exists = signalGroup("SIGTERM");
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
    }
    await withinDeadline(
      handle.done,
      Date.now() + 10000,
      "owned process exit acknowledgement",
    );
    handle.cleanupConfirmed = true;
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
