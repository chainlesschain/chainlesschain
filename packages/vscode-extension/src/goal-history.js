/** Explicit one-page recovery. The CLI exclusively owns credentials/checkpoints. */
const { spawn } = require("node:child_process");
const { TextDecoder } = require("node:util");
const { buildCliGoalPanelsArgs } = require("./plugin-manager");
const { hardenedEnv } = require("./hardened-env");
const { escapeCmdArgs } = require("./win-shell");
const { stopAgentProcess } = require("./chat/stop-agent-process");
function invalid() {
  throw new Error("Invalid goal history result");
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    invalid();
}
const text = (value, max) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
    value,
  );
const counter = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const date = (value) => text(value, 64) && Number.isFinite(Date.parse(value));
function ref(raw) {
  exact(raw, ["id", "storeId", "revision", "controlGeneration"]);
  if (
    !text(raw.id, 256) ||
    !/^project-goals-[a-f0-9-]{36}$/u.test(raw.storeId) ||
    !counter(raw.revision, 1) ||
    !counter(raw.controlGeneration)
  )
    invalid();
  return {
    id: raw.id,
    storeId: raw.storeId,
    revision: raw.revision,
    controlGeneration: raw.controlGeneration,
  };
}
function buildGoalReplayArgs(input) {
  if (
    !text(input.connection, 4096) ||
    !text(input.checkpoint, 4096) ||
    !["new", "resume"].includes(input.checkpointMode)
  )
    invalid();
  const args = buildCliGoalPanelsArgs(
    input.id,
    input.name,
    input.scope,
    input.expectedStore,
    input.connection,
  );
  args[1] = "replay";
  return [
    ...args,
    `--checkpoint=${input.checkpoint}`,
    `--checkpoint-mode=${input.checkpointMode}`,
  ];
}
function parseGoalHistory(textValue, input, expected) {
  buildGoalReplayArgs(input);
  if (
    typeof textValue !== "string" ||
    Buffer.byteLength(textValue) > 128 * 1024
  )
    invalid();
  const raw = JSON.parse(textValue);
  exact(raw, [
    "schema",
    "goalRef",
    "plugin",
    "observedAt",
    "delivery",
    "entries",
    "scannedCount",
    "nextCursor",
    "hasMore",
    "truncated",
    "retainedFrom",
    "highWatermark",
  ]);
  const goalRef = ref(raw.goalRef);
  exact(raw.plugin, ["name", "scope", "version"]);
  if (
    raw.schema !== "chainlesschain.goal-extension-history/v1" ||
    raw.delivery !== "at-least-once" ||
    goalRef.id !== input.id ||
    (input.expectedStore !== undefined &&
      goalRef.storeId !== input.expectedStore) ||
    raw.plugin.name !== input.name ||
    raw.plugin.scope !== input.scope ||
    !text(raw.plugin.version, 128) ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/u.test(raw.plugin.version) ||
    !date(raw.observedAt) ||
    !Array.isArray(raw.entries) ||
    raw.entries.length > 20 ||
    !counter(raw.scannedCount) ||
    raw.scannedCount > 20 ||
    raw.entries.length > raw.scannedCount ||
    !counter(raw.retainedFrom, 1) ||
    !counter(raw.highWatermark) ||
    raw.retainedFrom > raw.highWatermark + 1 ||
    raw.highWatermark - raw.retainedFrom >= 1000 ||
    typeof raw.hasMore !== "boolean" ||
    typeof raw.truncated !== "boolean"
  )
    invalid();
  const binding = {
    goalRef,
    plugin: {
      name: raw.plugin.name,
      scope: raw.plugin.scope,
      version: raw.plugin.version,
    },
  };
  if (expected && JSON.stringify(binding) !== JSON.stringify(expected))
    invalid();
  if (raw.highWatermark === 0) {
    if (
      raw.nextCursor !== null ||
      raw.scannedCount ||
      raw.hasMore ||
      raw.truncated ||
      raw.retainedFrom !== 1
    )
      invalid();
  } else if (
    typeof raw.nextCursor !== "string" ||
    !/^[A-Za-z0-9_-]{1,2048}$/u.test(raw.nextCursor)
  )
    invalid();
  if (
    (raw.scannedCount === 0 && raw.hasMore) ||
    (raw.truncated && raw.retainedFrom === 1)
  )
    invalid();
  let prior = raw.retainedFrom - 1;
  const ids = new Set(),
    lines = [`Retained history for ${goalRef.id}; at-least-once delivery.`];
  if (raw.truncated)
    lines.push("Earlier journal entries are outside retention.");
  for (const entry of raw.entries) {
    exact(entry, ["id", "sequence", "sourceRef", "recordedAt", "event"]);
    const source = ref(entry.sourceRef);
    exact(entry.event, ["type", "goalRef", "summary", "occurredAt"]);
    if (
      !/^goal-event-[a-f0-9]{64}$/u.test(entry.id) ||
      ids.has(entry.id) ||
      !counter(entry.sequence, 1) ||
      entry.sequence <= prior ||
      entry.sequence > raw.highWatermark ||
      source.id !== goalRef.id ||
      source.storeId !== goalRef.storeId ||
      source.revision > goalRef.revision ||
      source.controlGeneration > goalRef.controlGeneration ||
      JSON.stringify(ref(entry.event.goalRef)) !== JSON.stringify(goalRef) ||
      !date(entry.recordedAt) ||
      entry.recordedAt !== entry.event.occurredAt ||
      !["risk.review.completed", "action.receipt.updated"].includes(
        entry.event.type,
      ) ||
      !text(entry.event.summary, 4096)
    )
      invalid();
    ids.add(entry.id);
    prior = entry.sequence;
    lines.push(
      `${entry.sequence} ${entry.id} ${entry.recordedAt} ${entry.event.type}: ${entry.event.summary}`,
    );
  }
  lines.push(
    raw.hasMore
      ? "More retained history is available; read the next page explicitly."
      : "Reached this page's watermark. Check again explicitly for newer events.",
  );
  lines.push(
    "CLI exited successfully: checkpoint committed. Records do not prove goal completion.",
  );
  return Object.freeze({
    binding: Object.freeze({
      goalRef: Object.freeze(goalRef),
      plugin: Object.freeze(binding.plugin),
    }),
    hasMore: raw.hasMore,
    text: lines.join("\n"),
  });
}
function historyFailure(stderr) {
  if (/\bGOAL_EVENT_HISTORY_GAP\b/u.test(stderr))
    return "Checkpoint is outside retained history. Keep it; explicitly select a new checkpoint to start from retained history.";
  if (/\bGOAL_EVENT_HISTORY_REGRESSED\b/u.test(stderr))
    return "Database is behind this checkpoint. Keep it and inspect the restored database.";
  if (/\bGOAL_EVENT_CHECKPOINT_EXISTS\b/u.test(stderr))
    return "New checkpoint already exists. Choose another new file or explicitly resume the existing one.";
  if (/\bGOAL_EVENT_CHECKPOINT_MISSING\b/u.test(stderr))
    return "Resume checkpoint is missing. Select the original file; no replacement was created.";
  if (
    /\b(?:GOAL_EVENT_CURSOR_INVALID|GOAL_EVENT_CHECKPOINT_BINDING_CONFLICT)\b/u.test(
      stderr,
    )
  )
    return "Checkpoint does not match the current target, identity or plugin. Keep it and select a matching connection or an explicit new checkpoint.";
  return "Recovery not confirmed. Keep the checkpoint and explicitly resume; it may already have advanced and duplicates are possible.";
}
function startGoalReplay({ command, cwd, input, expected, onEnd, deps = {} }) {
  input = Object.freeze({ ...input });
  const args = buildGoalReplayArgs(input),
    platform = deps.platform || process.platform,
    launch = deps.spawn || spawn,
    useShell = platform === "win32" && !/\.exe$/iu.test(command);
  let closed = false,
    cancelled = false,
    failed = false,
    stopping,
    bytes = 0,
    errorBytes = 0;
  const chunks = [],
    errors = [];
  let resolve;
  const completion = new Promise((done) => {
    resolve = done;
  });
  const child = launch(
    command,
    useShell ? escapeCmdArgs(args, { platform }) : args,
    {
      cwd,
      env: hardenedEnv(),
      shell: useShell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  function stop() {
    cancelled = true;
    clearTimeout(timer);
    if (closed) return completion;
    if (!stopping) {
      stopping = (deps.stopProcess || stopAgentProcess)(child, {
        spawn: launch,
        platform,
      });
      stopping.catch(() => {
        failed = true;
      });
    }
    return stopping;
  }
  const timer = setTimeout(() => {
    failed = true;
    void stop().catch(() => {});
  }, 45000);
  timer.unref?.();
  child.stdout.on("data", (chunk) => {
    if (cancelled) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > 128 * 1024) {
      failed = true;
      void stop().catch(() => {});
    } else chunks.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk) => {
    errorBytes += Buffer.byteLength(chunk);
    if (errorBytes > 65536) {
      failed = true;
      void stop().catch(() => {});
    } else errors.push(Buffer.from(chunk));
  });
  child.once("error", () => {
    failed = true;
  });
  child.once("close", async (code) => {
    closed = true;
    clearTimeout(timer);
    await Promise.resolve();
    if (stopping)
      try {
        await stopping;
      } catch {
        failed = true;
      }
    let result = null;
    if (!cancelled && !failed && code === 0)
      try {
        result = parseGoalHistory(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
          input,
          expected,
        );
      } catch {
        failed = true;
      }
    const outcome = result
      ? { state: "saved", page: result }
      : {
          state: cancelled && !failed ? "cancelled" : "unconfirmed",
          message: historyFailure(Buffer.concat(errors).toString("utf8")),
        };
    resolve(outcome);
    onEnd(outcome);
  });
  return { stop, completion };
}
module.exports = {
  buildGoalReplayArgs,
  parseGoalHistory,
  historyFailure,
  startGoalReplay,
};
