import { writeSync } from "node:fs";

const [home, sessionId, point] = process.argv.slice(2);
const supportedPoints = new Set(["after-transcript", "after-sidecar"]);
if (!home || !sessionId || !supportedPoints.has(point)) {
  throw new Error(
    "usage: session-scale-pipeline-crash-worker <home> <session> <after-transcript|after-sidecar>",
  );
}

process.env.CHAINLESSCHAIN_HOME = home;
process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";

const store = await import("../../src/harness/jsonl-session-store.js");
const sessionIndex = await import("../../src/harness/session-list-index.js");

function reportAndBlock(payload) {
  const ready = Buffer.from(
    `${JSON.stringify({
      ready: true,
      point,
      pid: process.pid,
      eventHash: payload?.event?.hash || payload?.meta?.last_hash || null,
    })}\n`,
    "utf8",
  );
  writeSync(1, ready, 0, ready.length);
  const blocker = new Int32Array(new SharedArrayBuffer(4));
  for (;;) Atomics.wait(blocker, 0, 0);
}

if (point === "after-transcript") {
  store._sessionScaleFaultHooks.afterTranscriptAppend = reportAndBlock;
} else {
  sessionIndex._sessionScaleFaultHooks.afterMetaSnapshot = reportAndBlock;
}

store.appendEvent(sessionId, "scale_pipeline_probe", { point });
throw new Error(`fault hook did not stop appendEvent at ${point}`);
