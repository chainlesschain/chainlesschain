/**
 * Unit tests for the headless stream-stall hint (Claude-Code 2.1.185 parity).
 *
 * When the connection is alive but the API has gone silent mid-response, a
 * headless `cc agent -p` run would otherwise look frozen with no feedback. The
 * runner wires an `onStall` callback into the agent loop that writes a hint to
 * STDERR (out-of-band for every output format) and, when a hard inactivity
 * timeout is set, tells the user when the stalled stream will auto-retry.
 *
 * The agent loop is injected, so no real model or HTTP is involved — we just
 * trigger the wired `onStall` and assert what reaches stderr vs stdout.
 */

import { describe, it, expect } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

// Build deps with a fake agent loop that fires onStall(ms, timeoutMs) once,
// then completes the turn. Captures stdout/stderr separately.
const makeDeps = (stallMs, timeoutMs) => {
  const out = [];
  const err = [];
  const agentLoop = async function* (_messages, opts) {
    opts.onStall?.(stallMs, timeoutMs);
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", reason: "complete" };
  };
  return {
    out,
    err,
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendTokenUsage: () => {},
      getLastSessionId: () => null,
      agentLoop,
    },
  };
};

describe("runAgentHeadless — stream-stall hint", () => {
  it("writes a stall hint with a retry countdown to stderr", async () => {
    const { err, out, deps } = makeDeps(25000, 180000);
    await runAgentHeadless(
      { prompt: "hi", sessionId: "s-stall", expandFileRefs: false },
      deps,
    );
    const stderr = err.join("");
    expect(stderr).toContain("waiting for API response");
    expect(stderr).toContain("silent 25s");
    // timeoutMs (180s) > ms (25s) → retry countdown of 155s.
    expect(stderr).toContain("will retry in 155s");
    // Hint must never leak onto stdout (would corrupt the answer / JSON).
    expect(out.join("")).not.toContain("waiting for API response");
  });

  it("omits the retry countdown when no hard timeout is set", async () => {
    const { err, deps } = makeDeps(20000, 0);
    await runAgentHeadless(
      { prompt: "hi", sessionId: "s-stall-noretry", expandFileRefs: false },
      deps,
    );
    const stderr = err.join("");
    expect(stderr).toContain("silent 20s");
    expect(stderr).not.toContain("will retry");
  });

  it("keeps the hint out-of-band for stream-json output", async () => {
    const { err, out, deps } = makeDeps(30000, 90000);
    await runAgentHeadless(
      {
        prompt: "hi",
        sessionId: "s-stall-stream",
        outputFormat: "stream-json",
        expandFileRefs: false,
      },
      deps,
    );
    // Stall hint goes to stderr; the NDJSON event stream on stdout is unpolluted.
    expect(err.join("")).toContain("waiting for API response");
    const stdout = out.join("");
    expect(stdout).not.toContain("waiting for API response");
    // stdout must still be parseable NDJSON (init + result envelopes).
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
