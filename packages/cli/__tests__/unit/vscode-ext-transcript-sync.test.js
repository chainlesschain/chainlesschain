import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { Window } from "happy-dom";
const require = createRequire(import.meta.url);
const {
  ChatViewProvider,
} = require("../../../vscode-extension/src/chat/chat-view.js");
const {
  appendTranscript,
  parseTranscriptPage,
} = require("../../../vscode-extension/src/chat/transcript-cache.js");
const {
  decodeSyncCursor,
  loadTranscriptChanges,
  parseTranscriptChanges,
  resultTranscriptReferences,
  mergeTranscript,
} = require("../../../vscode-extension/src/chat/transcript-sync.js");
const {
  buildChatHtml,
} = require("../../../vscode-extension/src/chat/chat-html.js");

const root = mkdtempSync(join(tmpdir(), "cc-ide-transcript-sync-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const store = await import("../../src/harness/jsonl-session-store.js");
const { readSessionTranscriptHistory } =
  await import("../../src/lib/session-transcript-history.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));
let sequence = 0;
const start = () => {
  const id = `ide-sync-${++sequence}`;
  store.startSession(id, {});
  return id;
};
const readPage = ({ sessionId, cursor }) =>
  parseTranscriptPage(
    JSON.stringify(
      readSessionTranscriptHistory(sessionId, { cursor, limit: 2 }),
    ),
    sessionId,
  );
const readChanges = ({ sessionId, cursor }) =>
  parseTranscriptChanges(
    JSON.stringify(
      readSessionTranscriptHistory(sessionId, { after: cursor, limit: 2 }),
    ),
    sessionId,
    cursor,
  );
const flush = () => new Promise((done) => setImmediate(done));
function harness(overrides = {}) {
  const posted = [];
  const deps = {
    createSession: vi.fn(),
    loadTranscriptPage: vi.fn(async (o) => readPage(o)),
    loadTranscriptChanges: vi.fn(async (o) => readChanges(o)),
    ...overrides,
  };
  const provider = new ChatViewProvider(
    {
      workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({ get: () => "mock-cc" }),
      },
      commands: {},
      window: {},
    },
    { deps },
  );
  provider.view = {
    webview: {
      postMessage: (message) => {
        posted.push(structuredClone(message));
        return Promise.resolve();
      },
    },
  };
  provider._refreshContextStatus = vi.fn();
  const conv = provider._activeConv();
  conv._sessionToken = {};
  conv.sessionId = start();
  return { provider, conv, posted, deps };
}
function final(conv, clientMessageId, text = "same") {
  const user = store.appendUserMessage(conv.sessionId, "same");
  const assistant = store.appendAssistantMessage(conv.sessionId, text);
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: conv.sessionId,
    transcript_refs: {
      schema: "chainlesschain.session-transcript-references/v1",
      sessionId: conv.sessionId,
      userEventId: user.hash,
      assistantEventId: assistant.hash,
      clientMessageId,
    },
  };
}
function liveTurn(h, id, { tool = false, error = false } = {}) {
  appendTranscript(
    h.conv,
    { kind: "user", text: "same", clientMessageId: id },
    h.conv._sessionToken,
  );
  const onEvent = h.provider._makeOnEvent(h.conv.id, h.conv._sessionToken);
  onEvent({
    type: "stream_event",
    event: { delta: { type: "text_delta", text: tool ? "checking" : "sa" } },
  });
  if (tool) {
    onEvent({ type: "tool_use", tool: "read_file", args: { path: "a" } });
    onEvent({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "sa" } },
    });
  }
  const event = final(h.conv, id);
  if (error) {
    event.is_error = true;
    event.subtype = "error_max_turns";
  }
  onEvent(event);
  return event;
}

describe("verified IDE transcript synchronization", () => {
  it("accepts the real CLI sync fixture shared with JetBrains, including metadata and rewind", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../fixtures/session-transcript-sync-v1.json", import.meta.url),
        "utf8",
      ),
    );
    const page = parseTranscriptPage(
      JSON.stringify(fixture.baseline),
      fixture.sessionId,
    );
    const first = parseTranscriptChanges(
      JSON.stringify(fixture.first),
      fixture.sessionId,
      page.syncCursor,
    );
    const second = parseTranscriptChanges(
      JSON.stringify(fixture.second),
      fixture.sessionId,
      first.nextCursor,
    );
    const meta = parseTranscriptChanges(
      JSON.stringify(fixture.metadata),
      fixture.sessionId,
      second.nextCursor,
    );
    const rewind = parseTranscriptPage(
      JSON.stringify(fixture.rewind),
      fixture.sessionId,
    );
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(meta.messages).toHaveLength(0);
    expect(meta.nextCursor).not.toBe(second.nextCursor);
    expect(rewind.generation).not.toBe(page.generation);
    expect(rewind.messages).toEqual(page.messages);
    expect(
      new Set(
        [...page.messages, ...first.messages, ...second.messages].map(
          (row) => row.id,
        ),
      ).size,
    ).toBe(6);
  });
  it("bounds one refresh and continues from the last applied batch without losing rows", async () => {
    const h = harness();
    await h.provider._restoreTranscript(h.conv);
    for (let i = 0; i < 18; i++)
      store.appendAssistantMessage(h.conv.sessionId, "same");
    await h.provider._restoreTranscript(h.conv, null, { syncOnly: true });
    expect(h.deps.loadTranscriptChanges).toHaveBeenCalledTimes(8);
    expect(h.conv.transcript).toHaveLength(16);
    expect(
      decodeSyncCursor(h.conv.transcriptSyncCursor, h.conv.sessionId).offset,
    ).toBe(16);
    await h.provider._restoreTranscript(h.conv);
    expect(h.conv.transcript).toHaveLength(18);
    expect(new Set(h.conv.transcript.map((row) => row.id)).size).toBe(18);
    expect(
      decodeSyncCursor(h.conv.transcriptSyncCursor, h.conv.sessionId).offset,
    ).toBe(18);
  });

  it("keeps interrupted partial text distinct from the stop diagnostic", () => {
    const h = harness();
    h.provider._makeOnEvent(
      h.conv.id,
      h.conv._sessionToken,
    )({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "partial before stop" } },
    });
    h.provider._forceStopConversation(h.conv, "cancelled");
    expect(h.conv.transcript[0]).toMatchObject({
      text: "partial before stop",
      streaming: false,
    });
    expect(h.conv.transcript.at(-1).text).toContain("cancelled");
    expect(h.conv.transcript.every((row) => !row.id && !row.streaming)).toBe(
      true,
    );
  });

  it("associates accepted inputs without a final answer and deduplicates a repeated receipt only after verification", async () => {
    const h = harness();
    await h.provider._restoreTranscript(h.conv);
    appendTranscript(
      h.conv,
      { kind: "user", text: "same", clientMessageId: "input" },
      h.conv._sessionToken,
    );
    const user = store.appendUserMessage(h.conv.sessionId, "same");
    const event = {
      type: "system",
      subtype: "input_accepted",
      session_id: h.conv.sessionId,
      client_message_id: "input",
      receipt: {
        sessionId: h.conv.sessionId,
        clientMessageId: "input",
        eventHash: user.hash,
        inputDigest: "a".repeat(64),
        duplicate: false,
      },
    };
    const callback = h.provider._makeOnEvent(h.conv.id, h.conv._sessionToken);
    callback(event);
    expect(h.conv.transcript[0].eventRef).toBe(user.hash);
    expect(h.conv.transcript[0].id).toBeUndefined();
    await h.provider._restoreTranscript(h.conv, null, { syncOnly: true });
    expect(h.conv.transcript).toHaveLength(1);
    expect(h.conv.transcript[0].eventId).toBe(user.hash);
    appendTranscript(
      h.conv,
      { kind: "user", text: "same", clientMessageId: "input" },
      h.conv._sessionToken,
    );
    callback({ ...event, receipt: { ...event.receipt, duplicate: true } });
    expect(h.conv.transcript).toHaveLength(2);
    await h.provider._restoreTranscript(h.conv, null, { syncOnly: true });
    expect(h.conv.transcript).toHaveLength(1);
    expect(h.conv.transcript[0].eventId).toBe(user.hash);
  });

  it("merges repeated text by verified identity across two tabs, retries and live diagnostics", async () => {
    const h = harness();
    await h.provider._restoreTranscript(h.conv);
    const second = h.provider._convs.create({});
    second.sessionId = start();
    second._sessionToken = {};
    await h.provider._restoreTranscript(second);
    const firstEvent = liveTurn(h, "first", { tool: true, error: true });
    liveTurn({ ...h, conv: second }, "second-tab");
    await flush();
    liveTurn(h, "second");
    await flush();
    expect(h.conv.transcript.filter((r) => r.id)).toHaveLength(4);
    expect(h.conv.transcript.filter((r) => r.role === "user")).toHaveLength(2);
    expect(
      new Set(h.conv.transcript.filter((r) => r.id).map((r) => r.id)).size,
    ).toBe(4);
    expect(
      h.conv.transcript.filter(
        (r) => r.role === "assistant" && r.text === "same",
      ),
    ).toHaveLength(2);
    expect(h.conv.transcript.some((r) => r.text === "checking" && !r.id)).toBe(
      true,
    );
    expect(h.conv.transcript.some((r) => r.role === "tool" && !r.id)).toBe(
      true,
    );
    expect(
      h.conv.transcript.some(
        (r) => r.role === "error" && r.text.includes("budget"),
      ),
    ).toBe(true);
    expect(second.transcript.filter((r) => r.id)).toHaveLength(2);
    expect(
      second.transcript.some(
        (r) => r.eventId === firstEvent.transcript_refs.assistantEventId,
      ),
    ).toBe(false);
    const before = h.conv.transcript.map((r) => r.viewId);
    await h.provider._restoreTranscript(h.conv, null, { syncOnly: true });
    expect(h.conv.transcript.map((r) => r.viewId)).toEqual(before);
    expect(h.deps.loadTranscriptChanges).toHaveBeenCalled();
    expect(h.deps.createSession).not.toHaveBeenCalled();
  });

  it("rejects forged stream ownership and retains unmatched identical live text", () => {
    const h = harness();
    const callback = h.provider._makeOnEvent(h.conv.id, h.conv._sessionToken);
    const event = final(h.conv, "one");
    h.conv._sessionToken = {};
    callback(event);
    expect(h.conv.transcript).toBeUndefined();
    h.provider._makeOnEvent(
      h.conv.id,
      h.conv._sessionToken,
    )({ ...event, session_id: "wrong" });
    expect(h.conv.transcript).toBeUndefined();
    for (const patch of [
      { session_id: "wrong" },
      { transcript_refs: { ...event.transcript_refs, sessionId: "wrong" } },
      {
        transcript_refs: {
          ...event.transcript_refs,
          assistantEventId: ["a".repeat(64)],
        },
      },
      {
        transcript_refs: {
          ...event.transcript_refs,
          assistantEventId: "a".repeat(64) + "\n",
        },
      },
      { transcript_refs: { ...event.transcript_refs, approval: true } },
    ])
      expect(
        resultTranscriptReferences({ ...event, ...patch }, h.conv.sessionId),
      ).toBeNull();
    appendTranscript(
      h.conv,
      { kind: "delta", text: "same" },
      h.conv._sessionToken,
    );
    mergeTranscript(h.conv, readPage({ sessionId: h.conv.sessionId }), {
      baseline: true,
    });
    expect(
      h.conv.transcript.filter(
        (r) => r.role === "assistant" && r.text === "same",
      ),
    ).toHaveLength(2);
    expect(h.conv.transcript.filter((r) => r.id)).toHaveLength(2);
  });

  it("invalidates only stale cursors after a real rewind, preserving live-only diagnostics", async () => {
    const h = harness();
    final(h.conv, "one");
    final(h.conv, "two");
    await h.provider._restoreTranscript(h.conv);
    const oldIds = h.conv.transcript.map((r) => r.id);
    appendTranscript(
      h.conv,
      { kind: "error", text: "local diagnostic" },
      h.conv._sessionToken,
    );
    const messages = store.readVerifiedMessages(h.conv.sessionId);
    const head = store.findLatestEvent(h.conv.sessionId, null).hash;
    store.withSessionAuthorityTransaction(h.conv.sessionId, head, (tx) =>
      tx.appendAuthorityEvent("checkpoint_timeline_commit", {
        action: "restore-conversation",
        messages: messages.slice(0, 2),
        historyPrefix: {
          schema: "chainlesschain.session-history-prefix/v1",
          sourceHead: head,
          sourceMessageCount: 4,
          retainedMessageCount: 2,
        },
        binding: { turns: [] },
      }),
    );
    await h.provider._restoreTranscript(h.conv, null, { syncOnly: true });
    expect(h.conv.transcript.filter((r) => r.id)).toHaveLength(2);
    expect(h.conv.transcript.some((r) => oldIds.includes(r.id))).toBe(false);
    expect(h.conv.transcript.some((r) => r.text === "local diagnostic")).toBe(
      true,
    );
    const cursor = h.conv.transcriptSyncCursor;
    const rows = h.conv.transcript;
    h.deps.loadTranscriptChanges.mockRejectedValueOnce(
      new Error("integrity failure"),
    );
    await h.provider._restoreTranscript(h.conv, null, { syncOnly: true });
    expect(h.conv.transcriptSyncCursor).toBe(cursor);
    expect(h.conv.transcript).toBe(rows);
    expect(h.posted.at(-1).text).toContain("integrity failure");
  });

  it("drops late reads after a new live turn or reset and keeps older navigation independent", async () => {
    const h = harness();
    final(h.conv, "one");
    final(h.conv, "two");
    await h.provider._restoreTranscript(h.conv);
    const original = h.conv.transcriptSyncCursor;
    const older = h.conv.transcriptPageMetadata.nextCursor;
    await h.provider._restoreTranscript(h.conv, older);
    expect(h.conv.transcriptSyncCursor).toBe(original);
    expect(h.posted.at(-1).earlier).toBe(true);
    const beforePosts = h.posted.length;
    liveTurn(h, "three");
    await flush();
    expect(
      h.posted.slice(beforePosts).some((m) => m.kind === "transcript"),
    ).toBe(false);
    const beforeLatest = h.posted.length;
    await h.provider._restoreTranscript(h.conv);
    expect(
      h.posted
        .slice(beforeLatest)
        .filter((m) => m.kind === "transcript" && m.replaceView),
    ).toHaveLength(1);
    expect(
      h.posted
        .findLast((m) => m.kind === "transcript")
        .messages.filter((r) => r.id),
    ).toHaveLength(4);
    let resolve;
    h.deps.loadTranscriptChanges.mockImplementationOnce(
      (o) =>
        new Promise((done) => {
          resolve = () => done(readChanges(o));
        }),
    );
    const pending = h.provider._restoreTranscript(h.conv, null, {
      syncOnly: true,
    });
    const cursor = h.conv.transcriptSyncCursor;
    appendTranscript(
      h.conv,
      { kind: "delta", text: "new partial" },
      h.conv._sessionToken,
    );
    h.conv.turnActive = true;
    resolve();
    await pending;
    expect(h.conv.transcriptSyncCursor).toBe(cursor);
    expect(h.conv.transcript.at(-1).text).toBe("new partial");
    expect(h.conv.transcriptAwaiting).toBe(true);
    h.conv.turnActive = false;
    h.deps.loadTranscriptChanges.mockImplementationOnce(
      (o) =>
        new Promise((done) => {
          resolve = () => done(readChanges(o));
        }),
    );
    const reset = h.provider._restoreTranscript(h.conv, null, {
      syncOnly: true,
    });
    h.provider._clearSessionState(h.conv);
    resolve();
    await reset;
    expect(h.conv.transcript).toEqual([]);
    expect(h.conv.transcriptSyncCursor).toBeNull();
  });

  it("validates contiguous real-store batches, cursor ties and CLI error classification", async () => {
    const sessionId = start();
    const baseline = readPage({ sessionId });
    const conv = { sessionId };
    final(conv, "one");
    final(conv, "two");
    const changes = readChanges({ sessionId, cursor: baseline.syncCursor });
    for (const mutate of [
      (p) => {
        p.from++;
      },
      (p) => {
        p.messages[0].ordinal++;
      },
      (p) => {
        p.messages[1].id = p.messages[0].id;
      },
      (p) => {
        p.hasMore = false;
      },
      (p) => {
        p.generation = "e".repeat(64);
      },
      (p) => {
        p.nextCursor = baseline.syncCursor;
      },
      (p) => {
        p.messages[0].eventId = [p.messages[0].eventId];
      },
    ]) {
      const invalid = structuredClone(changes);
      mutate(invalid);
      expect(() =>
        parseTranscriptChanges(
          JSON.stringify(invalid),
          sessionId,
          baseline.syncCursor,
        ),
      ).toThrow();
    }
    for (const code of [
      "SESSION_TRANSCRIPT_CURSOR_STALE",
      "SESSION_TRANSCRIPT_UNAVAILABLE",
      "CORRUPT_CHAIN",
    ]) {
      const execFile = vi.fn((_command, args, options, cb) => {
        expect(args.join(" ")).toContain("--after");
        expect(options.maxBuffer).toBe(2 * 1024 * 1024);
        cb(
          new Error("exit 1"),
          JSON.stringify({
            schema: "chainlesschain.session-transcript-changes-error/v1",
            sessionId,
            code,
          }),
          "",
        );
      });
      const failure = await loadTranscriptChanges({
        sessionId,
        cursor: baseline.syncCursor,
        deps: { execFile },
      }).catch((error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure.code).toBe(
        code === "SESSION_TRANSCRIPT_CURSOR_STALE" ? code : undefined,
      );
    }
    expect(decodeSyncCursor(changes.nextCursor, sessionId).offset).toBe(2);
    mergeTranscript(conv, baseline, { baseline: true });
    mergeTranscript(conv, changes);
    mergeTranscript(conv, changes);
    expect(conv.transcript).toHaveLength(2);
  });

  it("reconciles the generated webview in place, retaining selection, scroll and tool cards", () => {
    const window = new Window({
      settings: { enableJavaScriptEvaluation: true },
    });
    window.acquireVsCodeApi = () => ({
      postMessage: vi.fn(),
      getState: () => ({}),
      setState: vi.fn(),
    });
    window.document.write(
      buildChatHtml({ nonce: "n", cspSource: "vscode-resource:" }),
    );
    const receive = (data) =>
      window.dispatchEvent(new window.MessageEvent("message", { data }));
    receive({ kind: "tabs", tabs: [{ id: "a", title: "A" }], activeId: "a" });
    receive({
      kind: "delta",
      text: "same",
      transcriptRow: { viewId: "live:answer" },
    });
    receive({
      kind: "turn_end",
      transcriptRow: { viewId: "live:answer", text: "same" },
    });
    receive({
      kind: "tool",
      tool: "read_file",
      summary: "a",
      transcriptRow: { viewId: "live:tool" },
    });
    const log = window.document.getElementById("log");
    const answer = log.querySelector('[data-transcript-view-id="live:answer"]');
    const selectedText = answer.firstChild;
    const range = window.document.createRange();
    range.selectNodeContents(answer);
    window.document.getSelection().addRange(range);
    Object.defineProperties(log, {
      scrollHeight: { get: () => 3000 },
      clientHeight: { get: () => 300 },
    });
    log.scrollTop = 200;
    log.dispatchEvent(new window.Event("scroll"));
    const rows = [
      {
        viewId: "live:answer",
        id: "s:event:0",
        role: "assistant",
        text: "same",
      },
      { viewId: "live:tool", role: "tool", text: "▸ read_file a" },
    ];
    receive({ kind: "transcript", convId: "a", messages: rows });
    receive({
      kind: "transcript",
      convId: "a",
      messages: [...rows, { id: "s:other:0", role: "assistant", text: "same" }],
    });
    expect(log.querySelector('[data-transcript-view-id="live:answer"]')).toBe(
      answer,
    );
    expect(answer.firstChild).toBe(selectedText);
    expect(answer.dataset.transcriptSource).toBe("saved");
    expect(log.querySelector(".tool").dataset.transcriptSource).toBe("live");
    expect(window.document.getSelection().toString()).toBe("same");
    expect(log.querySelectorAll(".assistant")).toHaveLength(2);
    expect(log.querySelectorAll(".tool")).toHaveLength(1);
    expect(log.scrollTop).toBe(200);
    receive({ kind: "transcript", convId: "other", messages: [] });
    expect(answer.isConnected).toBe(true);
    receive({
      kind: "transcript",
      convId: "a",
      messages: [{ ...rows[0], text: "corrected final" }, rows[1]],
    });
    expect(answer.textContent).toBe("same");
    window.document.getSelection().removeAllRanges();
    window.document.dispatchEvent(new window.Event("selectionchange"));
    expect(answer.textContent).toBe("corrected final");
    const nextRange = window.document.createRange();
    nextRange.selectNodeContents(answer);
    window.document.getSelection().addRange(nextRange);
    receive({
      kind: "transcript",
      convId: "a",
      messages: [{ ...rows[0], text: "stale deferred text" }, rows[1]],
    });
    receive({
      kind: "delta",
      text: "newer live",
      transcriptRow: { viewId: "live:new" },
    });
    receive({
      kind: "turn_end",
      transcriptRow: { viewId: "live:new", text: "newer live" },
    });
    window.document.getSelection().removeAllRanges();
    window.document.dispatchEvent(new window.Event("selectionchange"));
    expect(answer.textContent).toBe("corrected final");
    expect(
      log.querySelector('[data-transcript-view-id="live:new"]').textContent,
    ).toBe("newer live");
    window.happyDOM.abort();
  });
});
