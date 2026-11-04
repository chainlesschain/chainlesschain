/** Explicit desktop event observation. No connection-file or credential parsing. */
const { spawn } = require("node:child_process");
const { TextDecoder } = require("node:util");
const { buildCliGoalPanelsArgs } = require("./plugin-manager");
const { hardenedEnv } = require("./hardened-env");
const { escapeCmdArgs } = require("./win-shell");
const { stopAgentProcess } = require("./chat/stop-agent-process");
const SCHEMA = "chainlesschain.goal-extension-stream/v1";
const TYPES = ["risk.review.completed", "action.receipt.updated"];
function fail() {
  throw new Error("Goal event stream unavailable or invalid");
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    fail();
}
const text = (value, max) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
    value,
  );
function buildGoalWatchArgs(input) {
  if (!input.connection) fail();
  const args = buildCliGoalPanelsArgs(
    input.id,
    input.name,
    input.scope,
    input.expectedStore,
    input.connection,
  );
  args[1] = "watch";
  return [...args, "--interval=1000", "--duration=60"];
}
function createGoalEventDecoder(input, onRecord) {
  buildGoalWatchArgs(input);
  input = Object.freeze({ ...input });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    total = 0,
    binding = null;
  function line(raw) {
    if (Buffer.byteLength(raw, "utf8") > 16384) fail();
    const value = JSON.parse(raw);
    const base = [
      "schema",
      "kind",
      "source",
      "plugin",
      "observedAt",
      "delivery",
      "replay",
    ];
    exact(value, [
      ...base,
      ...(value.kind === "ready" ? ["goalRef"] : ["event"]),
    ]);
    if (
      value.schema !== SCHEMA ||
      value.source !== "desktop-project" ||
      value.delivery !== "polling" ||
      value.replay !== false ||
      !text(value.observedAt, 64) ||
      !Number.isFinite(Date.parse(value.observedAt))
    )
      fail();
    exact(value.plugin, ["name", "scope", "version"]);
    if (
      value.plugin.name !== input.name ||
      value.plugin.scope !== input.scope ||
      !text(value.plugin.version, 128) ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/u.test(value.plugin.version)
    )
      fail();
    const ref = value.kind === "ready" ? value.goalRef : value.event?.goalRef;
    exact(ref, ["id", "storeId", "revision", "controlGeneration"]);
    if (
      ref.id !== input.id ||
      !/^project-goals-[a-f0-9-]{36}$/u.test(ref.storeId) ||
      (input.expectedStore !== undefined &&
        ref.storeId !== input.expectedStore) ||
      !Number.isSafeInteger(ref.revision) ||
      ref.revision < 1 ||
      !Number.isSafeInteger(ref.controlGeneration) ||
      ref.controlGeneration < 0
    )
      fail();
    const current = JSON.stringify([
      ref.id,
      ref.storeId,
      ref.revision,
      ref.controlGeneration,
      value.plugin.version,
    ]);
    if (value.kind === "ready") {
      if (binding) fail();
      binding = current;
    } else {
      if (value.kind !== "event" || !binding || binding !== current) fail();
      exact(value.event, ["type", "goalRef", "summary", "occurredAt"]);
      if (
        !TYPES.includes(value.event.type) ||
        !text(value.event.summary, 4096) ||
        value.event.occurredAt !== value.observedAt
      )
        fail();
    }
    const result = Object.freeze({
      kind: value.kind,
      text:
        value.kind === "ready"
          ? `Observing ${ref.id}; polling, no history replay.`
          : `${value.observedAt} ${value.event.type}: ${value.event.summary}`,
    });
    onRecord(result);
  }
  return {
    push(chunk) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += bytes.length;
      if (total > 256 * 1024) fail();
      pending += decoder.decode(bytes, { stream: true });
      let index;
      while ((index = pending.indexOf("\n")) >= 0) {
        const raw = pending.slice(0, index).replace(/\r$/u, "");
        pending = pending.slice(index + 1);
        if (!raw) fail();
        line(raw);
      }
      if (Buffer.byteLength(pending, "utf8") > 16384) fail();
    },
    finish() {
      pending += decoder.decode();
      if (pending || !binding) fail();
    },
  };
}

/** Own the child until closure; cancellation never forwards raw stderr. */
function startGoalWatch({ command, cwd, input, onRecord, onEnd, deps = {} }) {
  const argv = buildGoalWatchArgs(input);
  const platform = deps.platform || process.platform;
  const useShell = platform === "win32" && !/\.exe$/iu.test(command);
  const launch = deps.spawn || spawn;
  let accepting = true,
    closed = false,
    failure = false,
    requested = false,
    stopping;
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const decode = createGoalEventDecoder(input, (record) => {
    if (accepting) onRecord(record);
  });
  const child = launch(
    command,
    useShell ? escapeCmdArgs(argv, { platform }) : argv,
    {
      cwd,
      env: hardenedEnv(),
      shell: useShell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  function stop() {
    accepting = false;
    requested = true;
    clearTimeout(timer);
    if (closed) return completion;
    if (!stopping) {
      stopping = (deps.stopProcess || stopAgentProcess)(child, {
        spawn: launch,
        platform,
      });
      stopping.catch(() => {
        failure = true;
      });
    }
    return stopping;
  }
  const timer = setTimeout(() => {
    failure = true;
    void stop().catch(() => {});
  }, 70000);
  timer.unref?.();
  child.stdout.on("data", (chunk) => {
    if (!accepting) return;
    try {
      decode.push(chunk);
    } catch {
      failure = true;
      void stop().catch(() => {});
    }
  });
  let errorBytes = 0;
  child.stderr.on("data", (chunk) => {
    errorBytes += Buffer.byteLength(chunk);
    if (errorBytes > 65536) {
      failure = true;
      void stop().catch(() => {});
    }
  });
  child.once("error", () => {
    failure = true;
    accepting = false;
  });
  child.once("close", async (code) => {
    closed = true;
    clearTimeout(timer);
    if (accepting && !failure) {
      try {
        decode.finish();
      } catch {
        failure = true;
      }
    }
    accepting = false;
    // A Windows wrapper closing does not prove taskkill finished reaping its
    // descendants. Allow synchronous test stops to assign their promise too.
    await Promise.resolve();
    if (stopping) {
      try {
        await stopping;
      } catch {
        failure = true;
      }
    }
    const outcome =
      failure || (!requested && code !== 0)
        ? "unavailable"
        : requested
          ? "stopped"
          : "ended";
    resolveCompletion(outcome);
    onEnd(outcome);
  });
  return { stop, completion };
}
module.exports = { buildGoalWatchArgs, createGoalEventDecoder, startGoalWatch };
