/**
 * Headless `--resume` transcript tamper gate: a session whose hash chain fails
 * verification is never silently rebuilt into trusted model context. Headless
 * fails closed (error envelope, agent loop never runs); the
 * CC_ALLOW_TAMPERED_RESUME=1 escape hatch resumes with a stderr warning.
 */
import { describe, it, expect, afterEach } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

function baseDeps(overrides = {}) {
  const calls = { agentLoopRuns: 0, out: [], err: [] };
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: (s) => calls.out.push(s),
    writeErr: (s) => calls.err.push(s),
    agentLoop: async function* () {
      calls.agentLoopRuns++;
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    },
    sessionExists: () => true,
    rebuildMessages: () => [
      { role: "user", content: "prior" },
      { role: "assistant", content: "reply" },
    ],
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendCompactEvent: () => {},
    getLastSessionId: () => "sid",
    ...overrides,
  };
  return { deps, calls };
}

const TAMPERED = {
  sessionId: "sid",
  status: "tampered",
  reason: "event content does not match its hash",
  firstInvalidLine: 3,
};

afterEach(() => {
  delete process.env.CC_ALLOW_TAMPERED_RESUME;
});

describe("headless resume tamper gate", () => {
  it("refuses to resume a tampered transcript (fail closed, loop never runs)", async () => {
    const { deps, calls } = baseDeps({ verifySession: () => TAMPERED });
    const res = await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
      },
      deps,
    );
    expect(res.isError).toBe(true);
    expect(res.exitCode).toBe(1);
    expect(res.result).toMatch(/integrity verification/);
    expect(res.result).toMatch(/line 3/);
    expect(calls.agentLoopRuns).toBe(0);
    // machine-readable error envelope still emitted on stdout
    expect(calls.out.join("")).toMatch(/integrity verification/);
  });

  it("CC_ALLOW_TAMPERED_RESUME=1 resumes with a stderr warning", async () => {
    process.env.CC_ALLOW_TAMPERED_RESUME = "1";
    const { deps, calls } = baseDeps({ verifySession: () => TAMPERED });
    const res = await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
      },
      deps,
    );
    expect(res.isError).toBeFalsy();
    expect(calls.agentLoopRuns).toBe(1);
    expect(calls.err.join("")).toMatch(/TAMPERED/);
  });

  it("verified / legacy / partial transcripts resume normally", async () => {
    for (const status of ["verified", "legacy", "partial", "not-found"]) {
      const { deps, calls } = baseDeps({
        verifySession: () => ({ sessionId: "sid", status }),
      });
      const res = await runAgentHeadless(
        {
          prompt: "continue",
          resume: "sid",
          outputFormat: "json",
          expandFileRefs: false,
        },
        deps,
      );
      expect(res.isError).toBeFalsy();
      expect(calls.agentLoopRuns).toBe(1);
    }
  });

  it("a throwing verifier degrades to legacy behaviour (resume proceeds)", async () => {
    const { deps, calls } = baseDeps({
      verifySession: () => {
        throw new Error("verification unavailable");
      },
    });
    const res = await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
      },
      deps,
    );
    expect(res.isError).toBeFalsy();
    expect(calls.agentLoopRuns).toBe(1);
  });
});
