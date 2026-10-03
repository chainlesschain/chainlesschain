"use strict";

// In workers return before imports, patches, listeners, or IPC interaction.
const entry = String(process.argv[1] || "").replaceAll("\\", "/");
if (
  /\/(?:vitest\.mjs|run-vitest-with-worker-retry\.mjs|probe-parent\.cjs)$/.test(
    entry,
  )
) {
  const fs = require("node:fs");
  const path = require("node:path");
  const cp = require("node:child_process");
  const { syncBuiltinESMExports } = require("node:module");
  const output = process.env.CC_PARENT_DIAGNOSTIC_DIR;
  if (!output) throw new Error("Missing parent diagnostic output directory");
  fs.mkdirSync(output, { recursive: true });
  const children = new Set();
  const seen = new WeakSet();
  let sequence = 0;
  const parent = {
    pid: process.pid,
    ppid: process.ppid,
    entry,
    argv: process.argv,
    node: process.version,
    events: [],
  };
  function errorInfo(error) {
    return error
      ? {
          name: error.name,
          code: error.code,
          message: error.message,
          stack: error.stack,
        }
      : null;
  }
  function add(record, event, detail = {}) {
    record.events.push({
      sequence: ++sequence,
      time: new Date().toISOString(),
      monotonicMs: performance.now(),
      event,
      ...detail,
    });
  }
  function flush(record) {
    try {
      fs.writeFileSync(
        path.join(output, `${process.pid}-${record.id || "parent"}.json`),
        JSON.stringify(record, null, 2),
      );
    } catch {
      /* Observation must never change test exit policy. */
    }
  }
  function listeners(child) {
    return child
      .rawListeners("exit")
      .map((fn) => ({ name: fn.name, original: fn.listener?.name }));
  }
  function summarize(message) {
    if (!message || typeof message !== "object")
      return { valueType: typeof message };
    return {
      request: Boolean(message.__vitest_worker_request__),
      response: Boolean(message.__vitest_worker_response__),
      type: message.type,
      files: message.context?.files?.map((file) =>
        typeof file === "string" ? file : file.filepath,
      ),
      hasError: Boolean(message.error),
      error: errorInfo(message.error),
      rpcMethod: message.m,
      rpcType: message.t,
    };
  }
  function track(child, kind, args) {
    if (seen.has(child)) return child;
    seen.add(child);
    const record = {
      id: `child-${children.size + 1}`,
      parentPid: process.pid,
      pid: child.pid,
      kind,
      executable: args[0],
      args: Array.isArray(args[1]) ? args[1] : [],
      events: [],
      rpc: {},
    };
    children.add(record);
    add(record, "created", {
      connected: child.connected,
      exitListeners: listeners(child),
    });
    const emit = child.emit;
    child.emit = function (event, ...values) {
      if (event === "message") {
        const message = summarize(values[0]);
        if (message.request || message.response)
          add(record, "message", message);
        else {
          const method = `${message.rpcType || "unknown"}:${message.rpcMethod || "response"}`;
          record.rpc[method] = (record.rpc[method] || 0) + 1;
          record.lastRpc = {
            ...message,
            time: new Date().toISOString(),
            monotonicMs: performance.now(),
          };
        }
      } else if (["exit", "close", "disconnect", "error"].includes(event)) {
        add(record, event, {
          code: event === "exit" || event === "close" ? values[0] : undefined,
          signal: values[1],
          error: event === "error" ? errorInfo(values[0]) : undefined,
          connected: child.connected,
          killed: child.killed,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          exitListeners: listeners(child),
        });
      }
      // Preserve evidence before native errors; do not add an error listener.
      if (event === "close" || event === "error") flush(record);
      return Reflect.apply(emit, this, [event, ...values]);
    };
    for (const method of [
      "on",
      "addListener",
      "once",
      "off",
      "removeListener",
      "removeAllListeners",
    ]) {
      const original = child[method];
      child[method] = function (...values) {
        if (
          values[0] === "exit" ||
          (method === "removeAllListeners" && values.length === 0)
        )
          add(record, `listener:${method}`, {
            name: values[1]?.name,
            original: values[1]?.listener?.name,
            before: listeners(child),
          });
        return Reflect.apply(original, this, values);
      };
    }
    for (const method of ["kill", "disconnect", "send"]) {
      if (typeof child[method] !== "function") continue;
      const original = child[method];
      child[method] = function (...values) {
        if (method === "send") {
          const message = summarize(values[0]);
          if (message.request || message.response) add(record, "send", message);
          const callbackIndex = values.length - 1;
          if (typeof values[callbackIndex] === "function") {
            const callback = values[callbackIndex];
            values[callbackIndex] = function (...callbackArgs) {
              if (callbackArgs[0])
                add(record, "send-callback-error", {
                  error: errorInfo(callbackArgs[0]),
                  message,
                });
              return Reflect.apply(callback, this, callbackArgs);
            };
          }
        } else
          add(record, method, {
            signal: values[0],
            stack: new Error(`parent ${method}`).stack,
            exitListeners: listeners(child),
          });
        try {
          return Reflect.apply(original, this, values);
        } catch (error) {
          add(record, `${method}-throw`, { error: errorInfo(error) });
          flush(record);
          throw error;
        }
      };
    }
    for (const name of ["stdin", "stdout", "stderr"]) {
      const stream = child[name];
      if (!stream) continue;
      const emitStream = stream.emit;
      stream.emit = function (event, ...values) {
        if (["close", "end", "error"].includes(event))
          add(record, `${name}:${event}`, {
            error: event === "error" ? errorInfo(values[0]) : undefined,
          });
        return Reflect.apply(emitStream, this, [event, ...values]);
      };
    }
    return child;
  }
  for (const method of ["spawn", "fork"]) {
    const original = cp[method];
    cp[method] = function (...args) {
      return track(Reflect.apply(original, this, args), method, args);
    };
  }
  const kill = process.kill;
  process.kill = function (...args) {
    add(parent, "process.kill", {
      pid: args[0],
      signal: args[1],
      stack: new Error("parent process.kill").stack,
    });
    return Reflect.apply(kill, this, args);
  };
  const emit = process.emit;
  process.emit = function (event, ...args) {
    if (
      ["exit", "beforeExit", "uncaughtExceptionMonitor", "disconnect"].includes(
        event,
      )
    ) {
      add(parent, event, {
        code: args[0] instanceof Error ? undefined : args[0],
        error: args[0] instanceof Error ? errorInfo(args[0]) : undefined,
      });
      for (const record of children) flush(record);
      flush(parent);
    }
    return Reflect.apply(emit, this, [event, ...args]);
  };
  add(parent, "loaded", { addedListeners: 0, workerInstrumentation: false });
  syncBuiltinESMExports();
}
