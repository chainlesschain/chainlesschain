// Test harness lifecycle only. This is not a hostile-process containment boundary.
import fs from "node:fs";
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
  const handle = { child, closed: false, done: null };
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
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw cleanupUnconfirmed(
          `Windows tree termination was not acknowledged (taskkill ${result.status})`,
        );
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
