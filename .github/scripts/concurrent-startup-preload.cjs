// External diagnostic only. Never serialize arguments, environment, input,
// command text, error messages, paths, or unrecognized output.
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { syncBuiltinESMExports } = require("node:module");
const STAGES =
  "initialize|traversal|lookup|repair-lock|repair-inspect|repair-write|verify|verify-read|verify-rules|serialize|output-complete";
const PROGRAMS = new Set([
  "powershell.exe",
  "pwsh.exe",
  "cmd.exe",
  "node.exe",
  "node",
  "git.exe",
  "git",
  "icacls.exe",
  "whoami.exe",
  "taskkill.exe",
]);
const SITES = [
  "packages/session-core/lib/private-storage.js",
  "packages/cli/src/lib/evolution/evolution-ledger.js",
  "packages/cli/src/lib/evolution/evolution-artifact-ports.js",
  "packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js",
  "packages/cli/src/lib/evolution/local-ui-evolution-runtime.js",
  "packages/cli/src/lib/artifact-store.js",
  "packages/cli/src/lib/paths.js",
  "packages/cli/src/lib/process-execution-broker/index.js",
  "node_modules/@chainlesschain/session-core/lib/private-storage.js",
];
const byteLength = (value) =>
  typeof value === "string"
    ? Buffer.byteLength(value)
    : Buffer.isBuffer(value) || ArrayBuffer.isView(value)
      ? value.byteLength
      : 0;
const number = (value) => (Number.isSafeInteger(value) ? value : null);

function markers(value) {
  const text = (
    typeof value === "string"
      ? value
      : Buffer.isBuffer(value)
        ? value.toString("utf8")
        : ""
  ).slice(0, 65536);
  const rows = [];
  const expression = new RegExp(
    `^CC_WINDOWS_ACL_(STAGE=(${STAGES})|ELAPSED_MS=(${STAGES}):(0|[1-9][0-9]{0,5}))\\r?$`,
    "gmu",
  );
  for (const match of text.matchAll(expression)) {
    if (rows.length >= 64) break;
    if (match[2]) rows.push({ stage: match[2] });
    else if (Number(match[4]) <= 300000)
      rows.push({ stage: match[3], elapsedMs: Number(match[4]) });
  }
  return rows;
}

function callsite(stack) {
  const normalized = String(stack).replaceAll("\\", "/");
  const result = [];
  for (const line of normalized.split("\n").slice(1, 33)) {
    for (const site of SITES) {
      const start = line.indexOf(site + ":");
      if (start < 0) continue;
      const suffix = /^(\d{1,6}):(\d{1,6})(?:\)|$)/u.exec(
        line.slice(start + site.length + 1),
      );
      if (suffix)
        result.push({
          file: site,
          line: Number(suffix[1]),
          column: Number(suffix[2]),
        });
    }
    if (result.length >= 8) break;
  }
  return result;
}

function captureCallsite(stack) {
  const original = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 32;
    return callsite(stack());
  } catch {
    return [];
  } finally {
    Error.stackTraceLimit = original;
  }
}

function install({
  childProcess,
  write,
  now = () => performance.now(),
  pid = process.pid,
  stack = () => new Error().stack,
}) {
  const started = now();
  let serial = 0;
  const emit = (row) => {
    try {
      write({ ...row, rootPid: pid, atMs: Math.max(0, now() - started) });
    } catch {
      /* Observation cannot change runtime control flow. */
    }
  };
  emit({ kind: "ready", startedEpochMs: Date.now() });
  for (const method of ["spawnSync", "spawn"]) {
    const original = childProcess[method];
    childProcess[method] = function (...args) {
      const id = ++serial;
      const before = now();
      const candidate =
        typeof args[0] === "string"
          ? path.win32.basename(args[0]).toLowerCase()
          : "";
      emit({
        kind: "begin",
        id,
        method,
        program: PROGRAMS.has(candidate) ? candidate : "OTHER",
        callsite: captureCallsite(stack),
      });
      let result;
      try {
        result = Reflect.apply(original, this, args);
      } catch (error) {
        emit({ kind: "throw", id, durationMs: Math.max(0, now() - before) });
        throw error;
      }
      if (method === "spawnSync") {
        emit({
          kind: "return",
          id,
          durationMs: Math.max(0, now() - before),
          pid: number(result?.pid),
          exitCode: number(result?.status),
          stdoutBytes: byteLength(result?.stdout),
          stderrBytes: byteLength(result?.stderr),
          aclMarkers: markers(result?.stderr),
          failed: Boolean(result?.error),
        });
      } else {
        emit({
          kind: "return",
          id,
          durationMs: Math.max(0, now() - before),
          pid: number(result?.pid),
        });
        const counts = { stdoutBytes: 0, stderrBytes: 0 };
        // Observe only bytes already emitted to the application's consumers.
        // Adding a data listener would start draining an otherwise paused pipe.
        for (const channel of ["stdout", "stderr"]) {
          const stream = result?.[channel];
          if (!stream) continue;
          const originalEmit = stream.emit;
          stream.emit = function (event, ...values) {
            if (event === "data")
              counts[`${channel}Bytes`] += byteLength(values[0]);
            return Reflect.apply(originalEmit, this, [event, ...values]);
          };
        }
        result?.once("close", (code) =>
          emit({
            kind: "close",
            id,
            durationMs: Math.max(0, now() - before),
            pid: number(result?.pid),
            exitCode: number(code),
            ...counts,
          }),
        );
      }
      return result;
    };
  }
}

module.exports = { install, markers, callsite };
if (process.env.CC_STARTUP_OBSERVATION_FILE) {
  try {
    const descriptor = fs.openSync(
      process.env.CC_STARTUP_OBSERVATION_FILE,
      "wx",
      0o600,
    );
    let bytes = 0;
    let rows = 0;
    let limited = false;
    install({
      childProcess: require("node:child_process"),
      write(row) {
        if (limited) return;
        let line = JSON.stringify(row) + "\n";
        if (++rows > 1024 || bytes + Buffer.byteLength(line) > 255 * 1024) {
          line = JSON.stringify({ kind: "limit", rootPid: process.pid }) + "\n";
          limited = true;
        }
        bytes += Buffer.byteLength(line);
        fs.writeSync(descriptor, line);
      },
    });
    syncBuiltinESMExports();
  } catch {
    /* Missing ready event is reported by the driver. */
  }
}
