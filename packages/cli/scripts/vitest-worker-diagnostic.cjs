// Temporary, opt-in diagnostic only. No error handlers, extra retries, or IPC
// listeners: an added message listener could itself keep a fork alive.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");
const directory = process.env.CC_VITEST_WORKER_DIAGNOSTIC_DIR;
const entry = String(process.argv[1] || "").replaceAll("\\", "/");
const enabled =
  directory &&
  (/\/vitest\/(?:vitest\.mjs|dist\/workers\/forks\.js)$/.test(entry) ||
    /\/run-vitest-with-worker-retry\.mjs$/.test(entry) ||
    process.env.CC_VITEST_DIAGNOSTIC_PROBE === "1");

if (enabled) {
  fs.mkdirSync(directory, { recursive: true });
  const logPath = path.join(directory, `process-${process.pid}.ndjson`);
  let sequence = 0;
  const start = process.hrtime.bigint();
  const write = (event, details = {}) => {
    try {
      const memory = process.memoryUsage();
      fs.appendFileSync(
        logPath,
        JSON.stringify({
          time: new Date().toISOString(),
          elapsedNs: String(process.hrtime.bigint() - start),
          sequence: ++sequence,
          pid: process.pid,
          ppid: process.ppid,
          event,
          ...details,
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          maxRss: process.resourceUsage().maxRSS,
        }) + "\n",
      );
    } catch {
      // A diagnostic write must not change test/process semantics.
    }
  };
  const stack = () => new Error("diagnostic call site").stack;
  const summarize = (message) => {
    if (!message || typeof message !== "object") return null;
    if (
      !message.__vitest_worker_request__ &&
      !message.__vitest_worker_response__
    )
      return null;
    return {
      type: message.type,
      files: Array.isArray(message.context?.files)
        ? message.context.files.map((file) =>
            typeof file === "string" ? file : file?.filepath,
          )
        : undefined,
      hasError: Boolean(message.error),
    };
  };
  write("loaded", {
    entry,
    node: process.version,
    connected: process.connected,
  });
  const originalExit = process.exit;
  process.exit = function (...args) {
    write("process.exit.call", {
      code: args[0] ?? process.exitCode ?? null,
      stack: stack(),
    });
    return Reflect.apply(originalExit, this, args);
  };
  const originalEmit = process.emit;
  process.emit = function (event, ...args) {
    if (event === "message") {
      const message = summarize(args[0]);
      if (message) write("process.message.receive", message);
    } else if (
      ["disconnect", "beforeExit", "exit", "SIGTERM", "SIGINT"].includes(event)
    ) {
      write(`process.${event}`, {
        code: args[0] ?? null,
        exitCode: process.exitCode ?? null,
        connected: process.connected,
      });
    } else if (event === "uncaughtExceptionMonitor") {
      write("process.uncaughtExceptionMonitor", {
        code: args[0]?.code,
        name: args[0]?.name,
        stack: args[0]?.stack,
      });
    }
    return Reflect.apply(originalEmit, this, [event, ...args]);
  };
  if (process.send) {
    const originalSend = process.send;
    process.send = function (message, ...args) {
      const details = summarize(message);
      if (details) write("process.message.send", details);
      return Reflect.apply(originalSend, this, [message, ...args]);
    };
  }
  if (process.disconnect) {
    const originalDisconnect = process.disconnect;
    process.disconnect = function (...args) {
      write("process.disconnect.call", { stack: stack() });
      return Reflect.apply(originalDisconnect, this, args);
    };
  }
  const instrumented = new WeakSet();
  const observeChild = (child, kind, childEntry) => {
    if (instrumented.has(child)) return child;
    instrumented.add(child);
    const childPid = child.pid;
    write("child.created", { childPid, kind, entry: childEntry });
    const emit = child.emit;
    child.emit = function (event, ...args) {
      if (event === "message") {
        const details = summarize(args[0]);
        if (details) write("child.message.receive", { childPid, ...details });
      } else if (["exit", "close", "disconnect", "error"].includes(event)) {
        write(`child.${event}`, {
          childPid,
          code: event === "error" ? args[0]?.code : (args[0] ?? null),
          signal: args[1] ?? null,
          connected: child.connected,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          stack: event === "error" ? args[0]?.stack : undefined,
        });
      }
      return Reflect.apply(emit, this, [event, ...args]);
    };
    if (child.send) {
      const send = child.send;
      child.send = function (message, ...args) {
        const details = summarize(message);
        if (details)
          write("child.message.send", {
            childPid,
            ...details,
            connected: child.connected,
            exitCode: child.exitCode,
          });
        return Reflect.apply(send, this, [message, ...args]);
      };
    }
    const kill = child.kill;
    child.kill = function (...args) {
      write("child.kill.call", {
        childPid,
        signal: args[0] || "SIGTERM",
        stack: stack(),
      });
      return Reflect.apply(kill, this, args);
    };
    return child;
  };
  for (const method of ["fork", "spawn"]) {
    const original = childProcess[method];
    childProcess[method] = function (...args) {
      const result = Reflect.apply(original, this, args);
      const executable = String(args[0]);
      const childEntry =
        method === "fork" ? executable : String(args[1]?.[0] || executable);
      if (
        /vitest|run-vitest-with-worker-retry|diagnostic-probe/.test(childEntry)
      ) {
        observeChild(result, method, childEntry);
      }
      return result;
    };
  }
  syncBuiltinESMExports();
}
