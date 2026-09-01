import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_TERMINATION_GRACE_MS = 5_000;
// Each supervisor starts a fresh Windows PowerShell process whose Add-Type
// compilation can be cold and heavily contended on hosted runners. This only
// delays the outer watchdog; the supervisor's target timeout remains exact.
const WINDOWS_SUPERVISOR_STARTUP_MS = 120_000;
const WINDOWS_JOB_CLEANUP_MS = 10_000;
const POLL_MS = 25;

function outerTimeoutMs(timeoutMs, platform, terminationGraceMs) {
  return (
    timeoutMs +
    (platform === "win32"
      ? WINDOWS_SUPERVISOR_STARTUP_MS +
        WINDOWS_JOB_CLEANUP_MS +
        terminationGraceMs
      : 0)
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function monotonicMilliseconds() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function unixGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitForUnixGroupExit(pid, deadline) {
  while (unixGroupAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await delay(POLL_MS);
  }
  return true;
}

async function terminateUnixProcessGroup(pid, graceMs) {
  if (!unixGroupAlive(pid)) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  if (await waitForUnixGroupExit(pid, Date.now() + graceMs)) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  if (!(await waitForUnixGroupExit(pid, Date.now() + graceMs))) {
    throw new Error("physical harness process group did not terminate");
  }
}

function windowsPowerShellPath() {
  const root = process.env.SystemRoot || process.env.WINDIR;
  if (!root)
    throw new Error("SystemRoot is required for the Windows job supervisor");
  const executable = path.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!fs.existsSync(executable) || !fs.lstatSync(executable).isFile()) {
    throw new Error("Windows PowerShell job supervisor host is unavailable");
  }
  return executable;
}

function spawnTarget(executable, args, options) {
  if (options.platform !== "win32") {
    const request = Buffer.from(
      JSON.stringify({
        schema: "chainlesschain.p1-10-owned-process-request/v1",
        executable,
        args,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      }),
      "utf8",
    ).toString("base64");
    const targetExecutable = options.strongSupervisorPath || executable;
    const targetArguments = options.strongSupervisorPath
      ? ["--request-base64", request]
      : args;
    return {
      child: spawn(targetExecutable, targetArguments, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
      cleanup: (pid) =>
        terminateUnixProcessGroup(pid, options.terminationGraceMs),
      strongContainment: Boolean(options.strongSupervisorPath),
    };
  }

  const request = Buffer.from(
    JSON.stringify({ executable, args, timeoutMs: options.timeoutMs }),
    "utf8",
  ).toString("base64");
  return {
    child: spawn(
      windowsPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        options.windowsSupervisorPath,
        "-RequestBase64",
        request,
      ],
      {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
    // The supervisor owns the harness in a KILL_ON_JOB_CLOSE Job Object and
    // does not exit until QueryInformationJobObject reports zero processes.
    cleanup: async () => {},
    strongContainment: true,
  };
}

export function runOwnedProcess(
  executable,
  args,
  {
    cwd,
    env,
    timeoutMs,
    maxOutputBytes,
    windowsSupervisorPath,
    strongSupervisorPath,
    platform = process.platform,
    terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  },
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("owned process timeout must be a positive integer");
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new Error("owned process output cap must be a positive integer");
  }
  if (platform === "win32") {
    const supervisor = path.resolve(windowsSupervisorPath || "");
    if (
      !path.isAbsolute(windowsSupervisorPath || "") ||
      !fs.existsSync(supervisor) ||
      !fs.lstatSync(supervisor).isFile() ||
      fs.lstatSync(supervisor).isSymbolicLink()
    ) {
      throw new Error(
        "a regular repository Windows Job Object supervisor is required",
      );
    }
    windowsSupervisorPath = supervisor;
  }

  return new Promise((resolve, reject) => {
    const monotonicStartedMs = monotonicMilliseconds();
    const target = spawnTarget(executable, args, {
      cwd,
      env,
      timeoutMs,
      platform,
      terminationGraceMs,
      windowsSupervisorPath,
      strongSupervisorPath,
    });
    const child = target.child;
    let outputBytes = 0;
    let forcedReason = null;
    let finalized = false;
    let closeObserved = false;
    let cleanupPromise = null;
    let forcePromise = null;
    let closeResolve;
    const closePromise = new Promise((resolveClose) => {
      closeResolve = resolveClose;
    });
    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
        cleanupPromise = Promise.resolve();
      } else if (platform === "win32") {
        // Killing the supervisor closes its only Job Object handle; the
        // KILL_ON_JOB_CLOSE limit then terminates every harness descendant.
        child.kill();
        cleanupPromise = Promise.resolve();
      } else {
        cleanupPromise = target.cleanup(child.pid);
      }
      return cleanupPromise;
    };
    const finish = (error, result) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const force = (reason) => {
      if (forcedReason) return;
      forcedReason = reason;
      forcePromise = (async () => {
        try {
          // Begin TERM -> grace -> KILL immediately. Waiting for the direct
          // child's close event first would let a SIGTERM-ignoring tree hang.
          await cleanup();
          if (!closeObserved && Number.isSafeInteger(child.pid)) {
            await Promise.race([
              closePromise,
              delay(terminationGraceMs).then(() => {
                throw new Error(
                  "owned harness process did not report confirmed exit",
                );
              }),
            ]);
          }
          finish(forcedReason);
        } catch (cleanupError) {
          const combined = new Error(
            forcedReason.message +
              "; process-tree cleanup failed: " +
              cleanupError.message,
            { cause: forcedReason },
          );
          finish(combined);
        }
      })();
    };
    const timer = setTimeout(
      () => force(new Error("physical harness exceeded its fixed timeout")),
      // The supervisor starts the target only after PowerShell has loaded and
      // Add-Type has compiled the Job Object bridge. Its target timeout remains
      // exact; this independent outer deadline also budgets startup, confirmed
      // Job cleanup, and parent-side termination without weakening that limit.
      outerTimeoutMs(timeoutMs, platform, terminationGraceMs),
    );
    const consume = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        force(new Error("physical harness output exceeded its fixed cap"));
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => {
      force(error);
    });
    child.on("close", async (code, signal) => {
      closeObserved = true;
      closeResolve();
      if (finalized || forcePromise) return;
      try {
        // A successful direct child may still have left descendants. Always
        // empty and confirm the owned group/job before reporting success.
        await cleanup();
        if (code !== 0 || signal) {
          throw new Error(
            "physical harness failed with code " +
              String(code) +
              " signal " +
              String(signal),
          );
        }
        finish(null, {
          monotonicElapsedMs: monotonicMilliseconds() - monotonicStartedMs,
          containment:
            platform === "win32"
              ? "windows-job-object"
              : target.strongContainment
                ? "strong-external-supervisor"
                : "unix-process-group",
          // A Unix process group can be escaped with setsid(2); report only
          // what was actually proved. The evidence builder rejects this weak
          // containment until a strong OS supervisor is configured.
          processTreeTerminated:
            platform === "win32" || target.strongContainment,
          processGroupEmptied: true,
        });
      } catch (error) {
        finish(error);
      }
    });
  });
}

export const p110OwnedProcessRunnerTestOnly = Object.freeze({
  outerTimeoutMs,
});
