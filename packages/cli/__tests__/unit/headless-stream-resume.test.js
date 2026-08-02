/**
 * Stream-mode session persistence + resume (chat-panel "session resume").
 * An explicit session id opts into JSONL persistence: prior history is
 * rebuilt into the conversation (fresh system prompt leads), new turns are
 * appended, and the init event reports `resumed_messages`. Anonymous runs
 * stay persistence-free. All store functions are injected — no disk.
 */
import { describe, it, expect, vi } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

function verifiedResume(messages, sessionId) {
  return {
    snapshot: {
      schema: "chainlesschain.session-host-snapshot/v1",
      schemaVersion: 1,
      sessionId,
      verified: true,
      revision: `sha256:${"a".repeat(64)}`,
    },
    messages,
    recovery: {
      sessionId,
      records: [],
      unsettled: [],
      incidents: [],
      adjudications: [],
      replayDenied: [],
      verified: true,
      headHash: "b".repeat(64),
      recoveryDigest: `sha256:${"c".repeat(64)}`,
      remediation: null,
    },
  };
}

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
    appendEvent: () => true,
    appendAuthorityEvent: () => true,
    readEvents: () => [],
    readVerifiedEvents: () => [],
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
  return { run, events, output: () => lines.join(""), calls, seenTurns };
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
    const summary = "STREAM_CANONICAL_SUMMARY_PRIVATE_247d9a";
    const prior = [
      { role: "system", content: summary },
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ];
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        sessionExists: () => true,
        readSessionHostResumeState: () => verifiedResume(prior, "chat-abc"),
      },
    });
    await h.run();
    // Public control-plane metadata counts conversational turns, not private
    // canonical system context.
    const init = h.events().find((e) => e.subtype === "init");
    expect(init.resumed_messages).toBe(2);
    expect(init.session_id).toBe("chat-abc");

    // The model sees the fresh host system first and the verified canonical
    // summary exactly once after it, followed by the ordered conversation.
    const turn = h.seenTurns[0];
    expect(turn[0]?.role).toBe("system");
    expect(turn[0]?.content).not.toBe(summary);
    const summaryIndexes = turn.flatMap((message, index) =>
      message.content === summary ? [index] : [],
    );
    expect(summaryIndexes).toHaveLength(1);
    expect(summaryIndexes[0]).toBeGreaterThan(0);
    expect(
      turn
        .filter((message) => message.role !== "system")
        .map((message) => [message.role, message.content]),
    ).toEqual([
      ["user", "earlier question"],
      ["assistant", "earlier answer"],
      ["user", "hello there"],
    ]);
    expect(h.output()).not.toContain(summary);

    // resuming an EXISTING session must not re-create it
    expect(h.calls.started).toHaveLength(0);
    // ...but new turns still persist
    expect(h.calls.users).toEqual(["hello there"]);
    expect(h.calls.assistants).toEqual(["ok-reply"]);
  });

  it("a broken resume store refuses the stream before the model", async () => {
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
    expect(outcome.exitCode).toBe(1);
    const result = h.events().find((e) => e.type === "result");
    expect(result).toMatchObject({
      is_error: true,
      subtype: "error_session_resume",
      code: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
    });
    expect(h.seenTurns).toHaveLength(0);
  });
});
