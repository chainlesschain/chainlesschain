import { describe, it, expect, vi } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

/**
 * Claude Code 2.1.187 parity: `--resume` must not fail when the ORIGINAL run
 * produced no assistant response. In that case the persisted transcript ends
 * with a bare `user` turn; splicing the new resume prompt after it would, before
 * the fix, send two consecutive `user` messages — which Anthropic/Bedrock reject
 * as "roles must alternate". runAgentHeadless now merges consecutive same-role
 * turns before the loop, so the payload always alternates.
 */

function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

/** A fake agentLoop that records the messages it was handed, then completes. */
function capturingLoop(captured) {
  return async function* (messages) {
    captured.messages = messages;
    yield { type: "response-complete", content: "ok" };
    yield { type: "run-ended", reason: "complete" };
  };
}

/** Deps that stub the JSONL store so a resumed history can be injected. */
function makeResumeDeps(history) {
  const captured = {};
  return {
    captured,
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => fakeGate(),
      writeOut: () => {},
      writeErr: () => {},
      agentLoop: capturingLoop(captured),
      // session store seams
      sessionExists: () => true,
      rebuildMessages: () => history,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendTokenUsage: () => {},
      appendCompactEvent: () => {},
      getLastSessionId: () => "sid",
    },
  };
}

const roles = (messages) =>
  messages.filter((m) => m && m.role !== "system").map((m) => m.role);

describe("headless-runner — resume role alternation (2.1.187)", () => {
  it("merges the trailing resumed user turn with the new prompt (no consecutive users)", async () => {
    // Prior run produced NO assistant response → history ends with a user turn.
    const { captured, deps } = makeResumeDeps([
      { role: "user", content: "original task" },
    ]);

    await runAgentHeadless(
      { prompt: "continue please", resume: "sid", outputFormat: "json" },
      deps,
    );

    // The non-system roles must strictly alternate — exactly one user turn here.
    expect(roles(captured.messages)).toEqual(["user"]);
    const user = captured.messages.find((m) => m.role === "user");
    expect(user.content).toBe("original task\n\ncontinue please");
  });

  it("leaves a healthy alternating transcript untouched", async () => {
    const { captured, deps } = makeResumeDeps([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);

    await runAgentHeadless(
      { prompt: "c", resume: "sid", outputFormat: "json" },
      deps,
    );

    expect(roles(captured.messages)).toEqual(["user", "assistant", "user"]);
    const users = captured.messages.filter((m) => m.role === "user");
    expect(users.map((m) => m.content)).toEqual(["a", "c"]);
  });

  it("never produces two adjacent same-role non-system messages", async () => {
    // A messier degenerate history: two stacked user turns mid-transcript.
    const { captured, deps } = makeResumeDeps([
      { role: "user", content: "u1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u3" },
    ]);

    await runAgentHeadless(
      { prompt: "u4", resume: "sid", outputFormat: "json" },
      deps,
    );

    const seq = roles(captured.messages);
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).not.toBe(seq[i - 1]);
    }
    // u3 + u4 merge into the final user turn.
    expect(seq).toEqual(["user", "assistant", "user"]);
  });
});
