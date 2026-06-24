/**
 * Stream-mode resume role sanitation (Claude Code 2.1.187 parity).
 *
 * When a resumed session's persisted transcript ends with a bare `user` turn
 * (the prior run produced NO assistant response), splicing the first live
 * prompt after it would send two adjacent `user` messages — which
 * Anthropic/Bedrock reject as "roles must alternate". The stream merges
 * consecutive same-role turns for the FIRST model call only.
 *
 * Crucially the merge is GATED to the resume boundary: the live turn loop
 * legitimately produces consecutive `user` messages (an interrupted turn's
 * dangling prompt, a PDH §3.5.13 feedback note) that must reach the model
 * distinctly. Those cases are covered by headless-stream-interrupt /
 * headless-stream-pdh; this file pins the resume-degenerate path so the
 * one-shot gate can't regress back into "merge every turn".
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

const noopStore = {
  startSession: () => {},
  appendUserMessage: () => {},
  appendAssistantMessage: () => {},
};

/** Provider payloads must always alternate non-system roles. */
function noConsecutiveSameRole(msgs) {
  for (let i = 1; i < msgs.length; i++) {
    if (
      msgs[i].role !== "system" &&
      msgs[i].role === msgs[i - 1].role &&
      msgs[i - 1].role !== "system"
    ) {
      return false;
    }
  }
  return true;
}

async function runResume(history, liveText) {
  const captured = [];
  const agentLoop = async function* (messages) {
    captured.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "response-complete", content: "ok" };
    yield { type: "run-ended", reason: "complete" };
  };
  async function* input() {
    yield JSON.stringify({ type: "user", text: liveText }) + "\n";
  }
  await runAgentHeadlessStream(
    { expandFileRefs: false, sessionId: "resume-roles-test" },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: () => {},
      writeErr: () => {},
      agentLoop,
      input: input(),
      sessionExists: () => true,
      rebuildMessages: () => history,
      ...noopStore,
    },
  );
  return captured;
}

describe("stream resume role sanitation", () => {
  it("merges a trailing bare-user history into the first live prompt", async () => {
    // Prior run produced NO assistant reply → history ends with a `user` turn.
    const captured = await runResume(
      [{ role: "user", content: "prior prompt with no reply" }],
      "now actually answer",
    );
    expect(captured).toHaveLength(1);
    const payload = captured[0];
    // Provider payload alternates: the two adjacent users folded into one.
    expect(noConsecutiveSameRole(payload)).toBe(true);
    const users = payload.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0].content).toContain("prior prompt with no reply");
    expect(users[0].content).toContain("now actually answer");
  });

  it("leaves a healthy alternating resume untouched (no merge)", async () => {
    // History ends with an assistant turn → live prompt alternates naturally;
    // the one-shot gate must NOT fire, so the live prompt stays a distinct turn.
    const captured = await runResume(
      [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ],
      "follow up",
    );
    expect(captured).toHaveLength(1);
    const payload = captured[0];
    expect(noConsecutiveSameRole(payload)).toBe(true);
    const users = payload.filter((m) => m.role === "user");
    expect(users.map((u) => u.content)).toEqual([
      "earlier question",
      "follow up",
    ]);
  });

  it("keeps EVERY later turn alternating after a degenerate resume (2nd-turn corner)", async () => {
    // The fold must fix the PERSISTENT history, not just the first turn's
    // payload — otherwise the dangling `[user, user]` pair lingers and the
    // SECOND live turn re-sends consecutive users → "roles must alternate".
    const captured = [];
    const agentLoop = async function* (messages) {
      captured.push(messages.map((m) => ({ role: m.role, content: m.content })));
      yield { type: "response-complete", content: "reply" };
      yield { type: "run-ended", reason: "complete" };
    };
    async function* input() {
      yield (
        [
          JSON.stringify({ type: "user", text: "continue please" }),
          JSON.stringify({ type: "user", text: "and again" }),
        ].join("\n") + "\n"
      );
    }
    await runAgentHeadlessStream(
      { expandFileRefs: false, sessionId: "resume-roles-multiturn" },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: () => {},
        writeErr: () => {},
        agentLoop,
        input: input(),
        sessionExists: () => true,
        rebuildMessages: () => [{ role: "user", content: "original task" }],
        ...noopStore,
      },
    );

    expect(captured).toHaveLength(2);
    // BOTH turns' payloads alternate — turn 2 must not carry the leftover pair.
    expect(noConsecutiveSameRole(captured[0])).toBe(true);
    expect(noConsecutiveSameRole(captured[1])).toBe(true);
    // Turn 1 folded the dangling resumed user into the first prompt.
    const t1users = captured[0].filter((m) => m.role === "user");
    expect(t1users).toHaveLength(1);
    expect(t1users[0].content).toContain("original task");
    expect(t1users[0].content).toContain("continue please");
    // Turn 2 saw clean user/assistant/user.
    expect(captured[1].filter((m) => m.role !== "system").map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });
});
