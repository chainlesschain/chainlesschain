import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

const require = createRequire(import.meta.url);
const queueStore = require("../../src/lib/async-hook-queue.cjs");

/**
 * A failed async-hook REWAKE (a background check that opted in and FAILED) is the
 * one actionable signal the supervisor produces, but it lives only in memory
 * until the turn loop drains it. If the run dies in that window it's lost. The
 * supervisor now parks it in a durable per-session queue; on `--resume` the
 * runner recovers it and surfaces it to the model as a system "Recovery notice",
 * instead of silently swallowing the failure.
 */

function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

function capturingLoop(captured) {
  return async function* (messages) {
    captured.messages = messages;
    yield { type: "response-complete", content: "ok" };
    yield { type: "run-ended", reason: "complete" };
  };
}

/** Exact-match in-memory fs (the queue only uses these five calls). */
function memFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error("ENOENT " + p);
      return files.get(p);
    },
    writeFileSync: (p, d) => files.set(p, d),
    renameSync: (a, b) => {
      files.set(b, files.get(a));
      files.delete(a);
    },
    mkdirSync: () => {},
  };
}

function makeDeps(history, qfs, qpath) {
  const captured = {};
  return {
    captured,
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => fakeGate(),
      writeOut: () => {},
      writeErr: () => {},
      agentLoop: capturingLoop(captured),
      sessionExists: () => true,
      rebuildMessages: () => history,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendTokenUsage: () => {},
      appendCompactEvent: () => {},
      getLastSessionId: () => "sid",
      asyncHookQueueFs: qfs,
      asyncHookQueuePath: qpath,
    },
  };
}

const systemContents = (messages) =>
  (messages || [])
    .filter((m) => m && m.role === "system")
    .map((m) => m.content)
    .join("\n");

const QPATH = "/virtual/async-hook-queue.json";

describe("headless-runner — async-hook rewake recovery on resume", () => {
  it("surfaces a parked failed rewake as a Recovery-notice system message", async () => {
    const qfs = memFs();
    // Simulate the prior (crashed) run having parked a failed rewake for "sid".
    queueStore.appendRewake(
      {
        sessionId: "sid",
        records: [
          {
            command: "npm test",
            event: "Stop",
            exitCode: 1,
            error: "2 failing",
            ts: 1,
            ms: 5,
          },
        ],
        now: 1,
      },
      QPATH,
      qfs,
    );

    const { captured, deps } = makeDeps(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      qfs,
      QPATH,
    );

    await runAgentHeadless(
      { prompt: "continue", resume: "sid", outputFormat: "json" },
      deps,
    );

    const sys = systemContents(captured.messages);
    expect(sys).toContain("Recovery notice");
    expect(sys).toContain("npm test");
    expect(sys).toContain("2 failing");
    // The bucket was cleared on take → a second resume recovers nothing.
    expect(
      queueStore.takePending({ sessionId: "sid", now: 9 }, QPATH, qfs),
    ).toEqual([]);
  });

  it("injects NOTHING when the session has no parked rewake (byte-unchanged)", async () => {
    const qfs = memFs();
    const { captured, deps } = makeDeps(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      qfs,
      QPATH,
    );

    await runAgentHeadless(
      { prompt: "continue", resume: "sid", outputFormat: "json" },
      deps,
    );

    expect(systemContents(captured.messages)).not.toContain("Recovery notice");
    expect(qfs.files.size).toBe(0); // never wrote anything
  });
});
