import { isAbsolute } from "node:path";
import { EventEmitter } from "node:events";
import { constants } from "node:os";
import { consumeLinuxSubreaperHelper } from "./linux-subreaper-helper.js";

const MAGIC = Buffer.from("CCSUBR01");
const MAX_FRAME = 1024 * 1024;

export function encodeLinuxSubreaperLaunch(command, args, options) {
  if (
    typeof command !== "string" ||
    !command ||
    command.includes("\0") ||
    !Array.isArray(args) ||
    args.length >= 4096 ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
    typeof options.cwd !== "string" ||
    !isAbsolute(options.cwd) ||
    options.cwd.includes("\0") ||
    !options.env ||
    typeof options.env !== "object" ||
    Array.isArray(options.env)
  )
    throw new TypeError("Invalid Linux subreaper launch");
  const entries = Object.entries(options.env);
  if (
    entries.length > 8192 ||
    entries.some(
      ([key, value]) =>
        !key ||
        key.includes("=") ||
        key.includes("\0") ||
        typeof value !== "string" ||
        value.includes("\0"),
    )
  ) {
    throw new TypeError("Invalid Linux subreaper environment");
  }
  const graceMs = options.graceMs ?? 250;
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 2147483647)
    throw new TypeError("Invalid Linux subreaper grace period");
  const strings = [
    options.cwd,
    command,
    ...args,
    ...entries.map(([key, value]) => `${key}=${value}`),
  ].map((value) => Buffer.from(value, "utf8"));
  const length = 24 + strings.reduce((sum, value) => sum + 4 + value.length, 0);
  if (length > MAX_FRAME)
    throw new TypeError("Linux subreaper launch exceeds its byte limit");
  const frame = Buffer.alloc(length);
  MAGIC.copy(frame);
  frame.writeUInt32BE(length, 8);
  frame.writeUInt32BE(args.length + 1, 12);
  frame.writeUInt32BE(entries.length, 16);
  frame.writeUInt32BE(graceMs, 20);
  let offset = 24;
  for (const value of strings) {
    frame.writeUInt32BE(value.length, offset);
    offset += 4;
    value.copy(frame, offset);
    offset += value.length;
  }
  return frame;
}

/**
 * Native lifecycle primitive for an admitted Broker launch plan. Production
 * uses a one-use, privately branded helper descriptor. The explicit path seam
 * remains for native build/verification tests, never Broker request options.
 */
export function spawnLinuxSubreaper(command, args, options, native) {
  // Claim the lease before validating the launch so every rejection closes its
  // descriptor. A bad plan must not strand an otherwise valid installation pin.
  const helper = options.helper
    ? consumeLinuxSubreaperHelper(options.helper)
    : null;
  let launch;
  let child;
  try {
    if (
      (native.platform ?? process.platform) !== "linux" ||
      typeof native.spawn !== "function"
    )
      throw new TypeError("Linux Broker native spawn is required");
    if (
      !options.helper &&
      (typeof options.helperPath !== "string" ||
        !isAbsolute(options.helperPath))
    )
      throw new TypeError(
        "An absolute Linux subreaper helper path is required",
      );
    if (options.helper && options.helperPath)
      throw new TypeError("Ambiguous Linux subreaper helper identity");
    if (
      Object.keys(options).some(
        (key) =>
          !["cwd", "env", "graceMs", "helperPath", "helper"].includes(key),
      )
    )
      throw new TypeError("Unsupported Linux subreaper option");
    launch = encodeLinuxSubreaperLaunch(command, args, options);
    child = native.spawn(helper ? "/proc/self/fd/4" : options.helperPath, [], {
      cwd: options.cwd,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      shell: false,
      detached: false,
      stdio: [
        "pipe",
        "pipe",
        "pipe",
        "pipe",
        ...(helper ? [helper.descriptor] : []),
      ],
    });
  } finally {
    // Native spawn duplicates stdio synchronously. Never reopen the verified
    // executable path; the child's descriptor now owns that exact image.
    helper?.release();
  }
  const control = child.stdio[3];
  let closed = false;
  let requestedSignal = null;
  let buffer = "";
  let bytes = 0;
  let targetPid = null;
  let target = null;
  let cleanup = null;
  let protocolError = null;
  const terminate = (signal = "SIGTERM") => {
    if (!["SIGTERM", "SIGKILL"].includes(signal))
      throw new TypeError("Invalid Linux subreaper stop signal");
    if (closed || control.destroyed || !control.writable) return false;
    if (requestedSignal === "SIGKILL" || requestedSignal === signal)
      return true;
    requestedSignal = signal;
    control.write(signal === "SIGKILL" ? "K" : "T");
    return true;
  };
  control.on("error", () => {
    protocolError ??= "control-channel-failed";
    control.destroy();
  });
  control.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 16 * 1024) {
      protocolError = "control-reply-limit";
      control.destroy();
      return;
    }
    buffer += chunk.toString("ascii");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
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
          targetPid !== null &&
          Number.isInteger(message.code) &&
          message.code >= -1 &&
          message.code <= 255 &&
          Number.isInteger(message.signal) &&
          message.signal >= 0 &&
          message.signal <= 64 &&
          Number.isInteger(message.spawnErrno) &&
          message.spawnErrno >= -1 &&
          message.spawnErrno <= 4095
        ) {
          target = {
            code: message.code,
            signal: message.signal,
            spawnErrno: message.spawnErrno,
          };
        } else if (
          message.type === "cleanup" &&
          cleanup === null &&
          target !== null &&
          typeof message.confirmed === "boolean" &&
          message.rootReaped === true &&
          Number.isSafeInteger(message.reaped) &&
          message.reaped >= 1
        ) {
          cleanup = message;
        } else if (
          message.type === "error" &&
          ["subreaper-unavailable", "cleanup-unconfirmed"].includes(
            message.code,
          )
        ) {
          protocolError ??= message.code;
        } else throw new Error("invalid reply");
      } catch {
        protocolError = "invalid-control-reply";
        control.destroy();
        return;
      }
    }
  });
  const completion = new Promise((resolve) => {
    child.on("error", () => {
      protocolError ??= "supervisor-spawn-failed";
    });
    child.once("close", (code, signal) => {
      closed = true;
      control.destroy();
      if (buffer) protocolError ??= "truncated-control-reply";
      if (!cleanup) protocolError ??= "missing-cleanup-receipt";
      else if (!cleanup.confirmed)
        protocolError ??= "unconfirmed-cleanup-receipt";
      const confirmed =
        cleanup?.confirmed === true &&
        code === 0 &&
        signal === null &&
        !protocolError;
      resolve({
        targetPid,
        target,
        supervisor: { code, signal, closed: true },
        cleanup: {
          mode: "linux-subreaper",
          confirmed,
          descendantsReaped: confirmed,
          reaped: cleanup?.reaped ?? null,
          protocolError,
          // The zero-child fence is a lifecycle fact, not hostile-code isolation.
          processTreeContained: false,
        },
        ...(helper
          ? {
              helper: {
                sourceDigest: helper.sourceDigest,
                imageDigest: helper.imageDigest,
                binding: "unlinked-inherited-fd",
                distribution: helper.distribution,
              },
            }
          : {}),
      });
    });
  });
  control.write(launch);
  return Object.freeze({ child, terminate, completion });
}

/** Broker-facing process handle: close is fenced by the kernel tree receipt. */
export function spawnLinuxSubreaperChild(command, args, options, native) {
  const owner = spawnLinuxSubreaper(command, args, options, native);
  const raw = owner.child;
  const child = new EventEmitter();
  Object.assign(child, {
    pid: raw.pid,
    sandboxWrapperPid: raw.pid,
    stdin: raw.stdin,
    stdout: raw.stdout,
    stderr: raw.stderr,
    stdio: raw.stdio,
    exitCode: null,
    signalCode: null,
    killed: false,
    ownedProcessTreeClosed: owner.completion,
    kill(signal = "SIGTERM") {
      const requested = owner.terminate(signal);
      if (requested) child.killed = true;
      return requested;
    },
    ref() {
      raw.ref?.();
      return child;
    },
    unref() {
      raw.unref?.();
      return child;
    },
  });
  raw.once("spawn", () => child.emit("spawn"));
  owner.completion.then((receipt) => {
    child.ownedProcessTreeEvidence = receipt;
    child.sandboxTargetPid = receipt.targetPid;
    if (!receipt.cleanup.confirmed) {
      const error = new Error(
        "Linux external-agent process-tree cleanup is unconfirmed",
      );
      error.code = raw.pid
        ? "EXTERNAL_AGENT_CLEANUP_UNCONFIRMED"
        : "EXTERNAL_AGENT_SPAWN_FAILED";
      // A failed native spawn never created an owner or target. All other
      // losses retain the close fence: helper exit alone cannot release an
      // agent while an unobserved adopted descendant may still be executing.
      child.emit("error", error);
      if (!raw.pid) {
        child.exitCode = -1;
        child.emit("exit", -1, null);
        child.emit("close", -1, null);
      } else {
        child.emit("cleanup:unconfirmed", receipt);
      }
      return;
    }
    if (receipt.target.spawnErrno) {
      const error = new Error("External agent executable could not be started");
      error.code = "EXTERNAL_AGENT_SPAWN_FAILED";
      child.emit("error", error);
    }
    child.exitCode = receipt.target.code < 0 ? null : receipt.target.code;
    child.signalCode =
      receipt.target.signal === 0
        ? null
        : (Object.keys(constants.signals).find(
            (signal) => constants.signals[signal] === receipt.target.signal,
          ) ?? "SIGUNKNOWN");
    child.emit("exit", child.exitCode, child.signalCode);
    child.emit("close", child.exitCode, child.signalCode);
  });
  return child;
}
