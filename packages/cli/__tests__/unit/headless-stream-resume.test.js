/**
 * Stream-mode session persistence + resume (chat-panel "session resume").
 * An explicit session id opts into JSONL persistence: prior history is
 * rebuilt into the conversation (fresh system prompt leads), new turns are
 * appended, and the init event reports `resumed_messages`. Anonymous runs
 * stay persistence-free. All store functions are injected — no disk.
 */
import { describe, it, expect, vi } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

function harness({ over = {}, options = {} } = {}) {
  const lines = [];
  const calls = {
    started: [],
    users: [],
    assistants: [],
    rebuilt: 0,
  };
  const seenTurns = [];
  const agentLoop = async function* (messages) {
    seenTurns.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "response-complete", content: "ok-reply" };
    yield { type: "run-ended", reason: "complete" };
  };
  async function* input() {
    yield JSON.stringify({ type: "user", text: "hello there" }) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    agentLoop,
    input: input(),
    sessionExists: () => false,
    startSession: (id, meta) => calls.started.push({ id, meta }),
    appendUserMessage: (id, c) => calls.users.push(c),
    appendAssistantMessage: (id, c) => calls.assistants.push(c),
    rebuildMessages: () => {
      calls.rebuilt += 1;
      return [];
    },
    ...over,
  };
  const run = () =>
    runAgentHeadlessStream({ expandFileRefs: false, ...options }, deps);
  const events = () =>
    lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
  return { run, events, calls, seenTurns };
}

describe("stream persistence + resume", () => {
  it("anonymous runs (no session id) never touch the store", async () => {
    const h = harness();
    await h.run();
    expect(h.calls.started).toHaveLength(0);
    expect(h.calls.users).toHaveLength(0);
    expect(h.calls.assistants).toHaveLength(0);
    const init = h.events().find((e) => e.subtype === "init");
    expect(init.resumed_messages).toBe(0);
  });

  it("an explicit session id starts a session and persists both turn sides", async () => {
    const h = harness({ options: { sessionId: "chat-abc" } });
    await h.run();
    expect(h.calls.started[0]).toMatchObject({ id: "chat-abc" });
    expect(h.calls.users).toEqual(["hello there"]);
    expect(h.calls.assistants).toEqual(["ok-reply"]);
  });

  it("resuming an existing session replays history into the conversation", async () => {
    const prior = [
      { role: "system", content: "stale system prompt — must be dropped" },
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ];
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        sessionExists: () => true,
        rebuildMessages: () => prior,
      },
    });
    await h.run();
    // init reports the resumed count (system turns dropped)
    const init = h.events().find((e) => e.subtype === "init");
    expect(init.resumed_messages).toBe(2);
    expect(init.session_id).toBe("chat-abc");
    // the agent's first turn sees: fresh system + history + the new user msg
    const roles = h.seenTurns[0].map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(h.seenTurns[0][1].content).toBe("earlier question");
    expect(h.seenTurns[0][3].content).toBe("hello there");
    expect(
      h.seenTurns[0].filter(
        (m) => m.role === "system" && /stale/.test(m.content),
      ),
    ).toHaveLength(0);
    // resuming an EXISTING session must not re-create it
    expect(h.calls.started).toHaveLength(0);
    // ...but new turns still persist
    expect(h.calls.users).toEqual(["hello there"]);
    expect(h.calls.assistants).toEqual(["ok-reply"]);
  });

  it("a broken store never fails the stream", async () => {
    const boom = () => {
      throw new Error("disk full");
    };
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        sessionExists: boom,
        startSession: boom,
        appendUserMessage: boom,
        appendAssistantMessage: boom,
      },
    });
    const outcome = await h.run();
    expect(outcome.exitCode).toBe(0);
    const result = h.events().find((e) => e.type === "result");
    expect(result.is_error).toBe(false);
  });
});
