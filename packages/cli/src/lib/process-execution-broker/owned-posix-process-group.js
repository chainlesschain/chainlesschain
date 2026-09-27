import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(
  new URL("./owned-posix-process-group-worker.mjs", import.meta.url),
);
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_REPLY_BYTES = 16 * 1024;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function milliseconds(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError("Invalid owned process group deadline");
  }
  return value;
}

/** Read-only observation. Never use this numeric identity to send a signal. */
export function inspectPosixProcessGroup(pgid, { platform, spawnSync }) {
  if (!Number.isSafeInteger(pgid) || pgid < 1) return null;
  try {
    if (platform === "linux") {
      const states = [];
      for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        let raw;
        try {
          raw = readFileSync(`/proc/${entry}/stat`, "utf8");
        } catch (error) {
          if (error.code === "ENOENT" || error.code === "ESRCH") continue;
          return null;
        }
        // comm may itself contain spaces or parentheses.
        const fields = raw
          .slice(raw.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/);
        if (fields.length < 4 || !/^[A-Zt]$/.test(fields[0])) return null;
        if (Number(fields[2]) === pgid) states.push(fields[0]);
      }
      return states;
    }
    if (platform === "darwin") {
      const result = spawnSync("/bin/ps", ["-axo", "pgid=,stat="], {
        encoding: "utf8",
        shell: false,
        timeout: 2000,
        maxBuffer: 4 * 1024 * 1024,
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      });
      if (result.error || result.status !== 0 || !result.stdout?.trim()) {
        return null;
      }
      const states = [];
      for (const line of result.stdout.trim().split("\n")) {
        const match = /^\s*(\d+)\s+([A-Z?][A-Za-z+<>sNXEVL-]*)\s*$/.exec(line);
        if (!match) return null;
        if (Number(match[1]) === pgid) states.push(match[2][0]);
      }
      return states;
    }
  } catch {
    // Missing visibility is not proof of group exit.
  }
  return null;
}

/**
 * Low-level lifecycle primitive for an already admitted Broker launch plan.
 * Callers supply the Broker's native seams; this module grants no execution
 * permission and does not add a sandbox guarantee. Production wiring is kept
 * separate so policy/credential/descriptor plans cannot silently be bypassed.
 *
 * The detached worker remains the group leader after the target exits. Only
 * that living worker sends TERM/KILL to its own group. The caller sends control
 * messages over a private inherited socket, never a delayed numeric signal.
 * A POSIX group is escapable with setsid; confirmation covers group members,
 * not arbitrary descendants or containment against a hostile executable.
 */
export function spawnOwnedPosixProcessGroup(command, args, options, native) {
  const platform = native.platform ?? process.platform;
  if (!["linux", "darwin"].includes(platform)) {
    throw new TypeError("Owned POSIX process groups require Linux or macOS");
  }
  if (
    typeof native.spawn !== "function" ||
    typeof native.spawnSync !== "function"
  ) {
    throw new TypeError("Broker native process seams are required");
  }
  const allowed = new Set(["cwd", "env", "graceMs", "confirmMs"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new TypeError("Unsupported owned process group option");
  }
  if (
    typeof command !== "string" ||
    !command ||
    command.includes("\0") ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
    typeof options.cwd !== "string" ||
    !isAbsolute(options.cwd) ||
    options.cwd.includes("\0") ||
    !options.env ||
    typeof options.env !== "object" ||
    Array.isArray(options.env) ||
    Object.entries(options.env).some(
      ([key, value]) =>
        !key ||
        key.includes("=") ||
        key.includes("\0") ||
        typeof value !== "string" ||
        value.includes("\0"),
    )
  ) {
    throw new TypeError("Invalid owned process group invocation");
  }
  const graceMs = milliseconds(options.graceMs, 250, 5000);
  const confirmMs = milliseconds(options.confirmMs, 2000, 10000);
  const request =
    JSON.stringify({
      type: "launch",
      command,
      args,
      cwd: options.cwd,
      env: options.env,
      graceMs,
    }) + "\n";
  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
    throw new TypeError("Owned process group launch exceeds its byte limit");
  }
  const child = native.spawn(process.execPath, [WORKER], {
    cwd: options.cwd,
    // The target receives the admitted environment over the control socket.
    // NODE_OPTIONS/loader injection must not run in the unsandboxed supervisor.
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  const control = child.stdio[3];
  let supervisorClosed = false;
  let target = null;
  let targetPid = null;
  let terminating = false;
  let protocolError = null;
  let reply = "";
  let replyBytes = 0;
  let requestedSignal = null;
  const terminate = (signal = "SIGTERM") => {
    if (!["SIGTERM", "SIGKILL"].includes(signal)) {
      throw new TypeError("Unsupported owned process group signal");
    }
    if (supervisorClosed || control.destroyed || !control.writable)
      return false;
    if (requestedSignal === "SIGKILL" || requestedSignal === signal)
      return true;
    requestedSignal = signal;
    control.write(JSON.stringify({ type: "stop", signal }) + "\n");
    return true;
  };
  control.on("error", () => {
    protocolError ??= "control-channel-failed";
    // Closing the lifeline asks the living worker to clean its own group.
    control.destroy();
  });
  control.on("data", (chunk) => {
    replyBytes += chunk.length;
    if (replyBytes > MAX_REPLY_BYTES) {
      protocolError = "control-reply-limit";
      control.destroy();
      return;
    }
    reply += chunk.toString("utf8");
    let newline;
    while ((newline = reply.indexOf("\n")) >= 0) {
      const line = reply.slice(0, newline);
      reply = reply.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (
          message.type === "started" &&
          targetPid === null &&
          Number.isSafeInteger(message.pid) &&
          message.pid > 0
        ) {
          targetPid = message.pid;
        } else if (
          message.type === "target-exit" &&
          target === null &&
          (message.code === null || Number.isInteger(message.code)) &&
          (message.signal === null || typeof message.signal === "string")
        ) {
          target = {
            code: message.code,
            signal: message.signal,
            spawnError: message.spawnError ?? null,
          };
        } else if (message.type === "terminating" && !terminating) {
          terminating = true;
        } else {
          throw new Error("invalid reply");
        }
      } catch {
        protocolError = "invalid-control-reply";
        control.destroy();
        return;
      }
    }
  });
  const completion = new Promise((resolveCompletion) => {
    child.on("error", () => {
      protocolError ??= "supervisor-spawn-failed";
    });
    child.once("close", async (code, signal) => {
      supervisorClosed = true;
      if (reply.length > 0) protocolError ??= "truncated-control-reply";
      control.destroy();
      const inspect =
        native.inspectGroup ??
        ((pid) =>
          inspectPosixProcessGroup(pid, {
            platform,
            spawnSync: native.spawnSync,
          }));
      const deadline = performance.now() + confirmMs;
      let states = null;
      do {
        try {
          states = inspect(child.pid);
        } catch {
          states = null;
        }
        if (
          Array.isArray(states) &&
          states.every((state) => state === "Z" || state === "X")
        )
          break;
        await delay(25);
      } while (performance.now() < deadline);
      const groupStopped =
        Array.isArray(states) &&
        states.every((state) => state === "Z" || state === "X");
      resolveCompletion({
        targetPid,
        target,
        supervisor: { code, signal, closed: true },
        cleanup: {
          mode: "posix-process-group",
          confirmed:
            groupStopped &&
            terminating &&
            !protocolError &&
            signal === "SIGKILL",
          groupStopped,
          states,
          protocolError,
          processTreeContained: false,
        },
      });
    });
  });
  control.write(request);
  return Object.freeze({ child, terminate, completion });
}
