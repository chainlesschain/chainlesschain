import { readFileSync, writeSync } from "node:fs";

const [home, sessionId, point] = process.argv.slice(2);
const supportedPoints = new Set([
  "after-new-transcript-file-fsync",
  "after-new-transcript-directory-fsync",
  "after-transcript-fsync",
  "after-meta-temp-fsync",
  "after-meta-rename",
  "after-meta-directory-fsync",
  "after-anchor",
]);
if (!home || !sessionId || !supportedPoints.has(point)) {
  throw new Error(
    `usage: session-scale-pipeline-crash-worker <home> <session> <${[
      ...supportedPoints,
    ].join("|")}>`,
  );
}

process.env.CHAINLESSCHAIN_HOME = home;
process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";

const store = await import("../../src/harness/jsonl-session-store.js");
const sessionIndex = await import("../../src/harness/session-list-index.js");

function reportAndBlock(payload) {
  let transcriptHash = null;
  try {
    const lines = readFileSync(store.sessionPath(sessionId), "utf8")
      .trimEnd()
      .split(/\r?\n/);
    transcriptHash = JSON.parse(lines.at(-1) || "null")?.hash || null;
  } catch {
    // The hook payload remains the primary source. This raw fixture read is
    // only a fallback for sidecar-internal milestones that do not carry the
    // event object and must never alter production authority state.
  }
  const ready = Buffer.from(
    `${JSON.stringify({
      ready: true,
      point,
      pid: process.pid,
      eventHash:
        payload?.event?.hash ||
        payload?.meta?.last_hash ||
        payload?.witness?.last_hash ||
        payload?.hash ||
        transcriptHash ||
        null,
    })}\n`,
    "utf8",
  );
  writeSync(1, ready, 0, ready.length);
  const blocker = new Int32Array(new SharedArrayBuffer(4));
  for (;;) Atomics.wait(blocker, 0, 0);
}

const hookByPoint = {
  "after-new-transcript-file-fsync": [
    store._sessionScaleFaultHooks,
    "afterTranscriptFsync",
  ],
  "after-new-transcript-directory-fsync": [
    store._sessionScaleFaultHooks,
    "afterTranscriptDirectoryFsync",
  ],
  "after-transcript-fsync": [
    store._sessionScaleFaultHooks,
    "afterTranscriptFsync",
  ],
  "after-meta-temp-fsync": [
    sessionIndex._sessionScaleFaultHooks,
    "afterMetaTempFsync",
  ],
  "after-meta-rename": [
    sessionIndex._sessionScaleFaultHooks,
    "afterMetaRename",
  ],
  "after-meta-directory-fsync": [
    sessionIndex._sessionScaleFaultHooks,
    "afterMetaDirectoryFsync",
  ],
  "after-anchor": [store._sessionScaleFaultHooks, "afterAntiRollbackPublish"],
};

const [hooks, hookName] = hookByPoint[point];
if (!Object.prototype.hasOwnProperty.call(hooks, hookName)) {
  throw new Error(`production fault hook is unavailable: ${hookName}`);
}
hooks[hookName] = reportAndBlock;

if (point.startsWith("after-new-transcript-")) {
  store.startSession(sessionId, { title: `pipeline ${point}` });
} else {
  store.appendEvent(sessionId, "scale_pipeline_probe", { point });
}
throw new Error(`fault hook did not stop appendEvent at ${point}`);
