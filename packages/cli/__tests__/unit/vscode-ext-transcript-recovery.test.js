import { describe, expect, it, vi } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { appendTranscript } from "../../../vscode-extension/src/chat/transcript-cache.js";

function harness({ state, load } = {}) {
  const values = new Map();
  const memento = state || {
    get: (key) => values.get(key),
    update: (key, value) => values.set(key, value),
  };
  const posted = [];
  const createSession = vi.fn();
  const provider = new ChatViewProvider(
    {
      workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({ get: () => "mock-cc" }),
      },
      commands: {},
      window: {},
    },
    {
      state: memento,
      deps: { createSession, loadTranscriptPage: load || vi.fn() },
    },
  );
  provider.view = {
    webview: {
      postMessage: (message) => {
        posted.push(message);
        return Promise.resolve();
      },
    },
  };
  provider._refreshContextStatus = vi.fn();
  return { provider, posted, state: memento, createSession };
}

describe("chat transcript recovery", () => {
  it("recovers a background final answer and keeps two tabs isolated", () => {
    const { provider, posted } = harness();
    const a = provider._activeConv();
    appendTranscript(a, { kind: "user", text: "prompt A" });
    const eventA = provider._makeOnEvent(a.id);
    const b = provider._convs.create({});
    const eventB = provider._makeOnEvent(b.id);
    eventA({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "partial A" } },
    });
    eventB({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "B only" } },
    });
    eventA({ type: "result", result: "complete answer A" });
    expect(
      posted.some((m) => m.kind === "delta" && m.text === "partial A"),
    ).toBe(false);
    provider._handleMessage({ type: "switchTab", id: a.id });
    const replay = posted.findLast((m) => m.kind === "transcript");
    expect(replay.messages.map((m) => m.text)).toEqual([
      "prompt A",
      "complete answer A",
    ]);
    expect(replay.messages.some((m) => m.text.includes("B only"))).toBe(false);
  });

  it("rehydrates canonical text after host recreation without spawning or sending", async () => {
    const first = harness();
    const a = first.provider._activeConv();
    first.provider._convs.setSessionId(a.id, "saved-session");
    first.provider._persistTabs();
    const page = {
      sessionId: "saved-session",
      generation: "g",
      revision: "r",
      messages: [{ role: "assistant", text: "durable answer" }],
      nextCursor: null,
    };
    const load = vi.fn(async () => page);
    const second = harness({ state: first.state, load });
    second.provider._handleMessage({ type: "ready" });
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "saved-session", cursor: null }),
    );
    expect(
      second.posted.findLast((m) => m.kind === "transcript").messages,
    ).toEqual(page.messages);
    expect(second.createSession).not.toHaveBeenCalled();
  });

  it("does not apply a snapshot over newer live events or a reset generation", async () => {
    let resolve;
    const { provider, posted } = harness({
      load: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const conv = provider._activeConv();
    provider._convs.setSessionId(conv.id, "saved");
    const loading = provider._restoreTranscript(conv);
    provider._makeOnEvent(conv.id)({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "new live content" } },
    });
    resolve({ messages: [{ role: "assistant", text: "stale snapshot" }] });
    await loading;
    expect(posted.filter((m) => m.kind === "transcript")).toHaveLength(0);
    const old = provider._restoreTranscript(conv);
    posted.length = 0;
    provider._clearSessionState(conv);
    resolve({ messages: [{ role: "assistant", text: "reset content" }] });
    await old;
    expect(posted.filter((m) => m.kind === "transcript")).toHaveLength(0);
  });
});
