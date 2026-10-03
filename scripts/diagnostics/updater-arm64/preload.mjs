// Diagnostic-only instrumentation. Native calls receive unchanged arguments,
// options and timeout, and their original return values/errors are preserved.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { describeCall, event, snapshot, writeJson } from "./shared.mjs";

const originalSpawn = cp.spawn;
const originalSpawnSync = cp.spawnSync;
const output = process.env.CC_UPDATER_DIAGNOSTIC_OUTPUT;
let sequence = 0;
function begin(command, args, options, synchronous) {
  if (!output) return null;
  const description = describeCall(command, args);
  if (!description) return null;
  const id = `${process.pid}-${++sequence}`;
  const config = {
    id,
    output,
    ...description,
    command,
    args,
    synchronous,
    timeoutMs: options?.timeout ?? null,
    createdAt: Date.now(),
  };
  const configPath = path.join(output, `${id}.config.json`);
  writeJson(configPath, config);
  event(config, "before-native-call", {
    files: snapshot(config),
    timeoutMs: config.timeoutMs,
  });
  const observer = originalSpawn(
    process.execPath,
    [fileURLToPath(new URL("./observer.mjs", import.meta.url)), configPath],
    {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
  observer.on("error", (error) =>
    event(config, "observer-error", { code: error.code }),
  );
  observer.unref();
  // Establish an independent observer before a sync call blocks this thread.
  // This setup cost is recorded separately from the native elapsed time.
  const ack = path.join(output, `${id}.observer-ready`);
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ack) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  config.nativeStartedAt = Date.now();
  writeJson(path.join(output, `${id}.started.json`), {
    at: config.nativeStartedAt,
  });
  event(config, "native-call-start", {
    observerReady: fs.existsSync(ack),
    setupElapsedMs: config.nativeStartedAt - config.createdAt,
  });
  return config;
}
function errorDetails(error) {
  return error
    ? {
        name: error.name,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        message: error.message,
      }
    : null;
}
if (output) {
  cp.spawnSync = function (command, args, options) {
    const config = begin(command, args, options, true);
    if (!config) return originalSpawnSync.apply(this, arguments);
    try {
      const result = originalSpawnSync.apply(this, arguments);
      const returnedAt = Date.now();
      writeJson(path.join(output, `${config.id}.returned.json`), {
        at: returnedAt,
      });
      event(config, "native-sync-return", {
        elapsedMs: returnedAt - config.nativeStartedAt,
        status: result.status,
        signal: result.signal,
        error: errorDetails(result.error),
        childPid: result.pid,
        stdout: String(result.stdout ?? ""),
        stderr: String(result.stderr ?? ""),
        files: snapshot(config),
      });
      return result;
    } catch (error) {
      event(config, "native-sync-throw", {
        elapsedMs: Date.now() - config.nativeStartedAt,
        error: errorDetails(error),
        files: snapshot(config),
      });
      throw error;
    }
  };
  cp.spawn = function (command, args, options) {
    const config = begin(command, args, options, false);
    const child = originalSpawn.apply(this, arguments);
    if (config) {
      event(config, "native-async-return", {
        childPid: child.pid,
        elapsedMs: Date.now() - config.nativeStartedAt,
      });
      child.once("error", (error) =>
        event(config, "native-child-error", { error: errorDetails(error) }),
      );
      child.once("exit", (status, signal) =>
        event(config, "native-child-exit", { status, signal }),
      );
    }
    return child;
  };
  syncBuiltinESMExports();
}
