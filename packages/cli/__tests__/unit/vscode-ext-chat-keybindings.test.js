/**
 * Panel keyboard actions — new conversation (Cmd/Ctrl+Alt+N) and reopen closed
 * chat (Cmd/Ctrl+Shift+T), Claude-Code parity. Both reveal the panel and ride
 * the pending-flush pattern so they work even when the keypress wins the race
 * against the webview's "ready" message. Headless (no vscode host).
 */
import { describe, it, expect } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

function makeMemento(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => m.set(k, v),
  };
}

function makeProvider() {
  const posted = [];
  const info = [];
  const execd = [];
  const vscode = {
    commands: { executeCommand: (c) => execd.push(c) },
    window: { showInformationMessage: (msg) => info.push(msg) },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: {
      createSession: () => ({
        running: true,
        send: () => true,
        sendEvent: () => true,
        stop() {
          this.running = false;
        },
      }),
    },
    state: makeMemento({}),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted, info, execd };
}

const lastTabs = (posted) => posted.filter((p) => p.kind === "tabs").pop();
const lastInfo = (posted) => posted.filter((p) => p.kind === "info").pop();

describe("ChatViewProvider — new conversation", () => {
  it("opens a fresh tab and reveals the panel when the webview is live", () => {
    const { provider, posted, execd } = makeProvider();
    provider._handleMessage({ type: "ready" }); // bootstrap one conversation
    const before = provider._convs.count();
    provider.newConversation();
    expect(execd).toContain("chainlesschainIdeChat.focus");
    expect(provider._convs.count()).toBe(before + 1);
    expect(lastTabs(posted).tabs.length).toBe(before + 1);
  });

  it("queues when the webview is not live yet, then flushes on ready", () => {
    const { provider } = makeProvider();
    provider.newConversation(); // not ready → queued
    expect(provider._pendingNewTab).toBe(true);
    expect(provider._convs.count()).toBe(0);
    provider._handleMessage({ type: "ready" }); // flush
    expect(provider._pendingNewTab).toBe(false);
    // ready bootstraps one conversation, the queued action adds a second
    expect(provider._convs.count()).toBe(2);
  });
});

describe("ChatViewProvider — reopen closed chat", () => {
  it("hints (and opens nothing) when no chat was closed", () => {
    const { provider, info } = makeProvider();
    provider.reopenClosedSession();
    expect(info[0]).toMatch(/no recently-closed/i);
    expect(provider._convs.count()).toBe(0);
  });

  it("closeTab remembers the tab; reopen restores it resuming its session", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "ready" }); // conv-1
    provider._handleMessage({ type: "newTab" }); // conv-2 (active)
    const conv1 = provider._convs.list()[0];
    provider._convs.setSessionId(conv1.id, "sess-A");

    provider._handleMessage({ type: "closeTab", id: conv1.id });
    expect(provider._lastClosed).toMatchObject({ sessionId: "sess-A" });

    provider.reopenClosedSession();
    const tabs = provider._convs.list();
    expect(tabs.some((t) => t.sessionId === "sess-A")).toBe(true);
    expect(provider._lastClosed).toBe(null); // consumed
    expect(lastInfo(posted).text).toContain("sess-A");
  });

  it("queues a reopen fired before the webview is live", () => {
    const { provider } = makeProvider();
    provider._lastClosed = { sessionId: "sess-B", title: "x" };
    provider.reopenClosedSession(); // not ready → queued
    expect(provider._pendingReopen).toEqual({ sessionId: "sess-B" });
    expect(provider._lastClosed).toBe(null);
    provider._handleMessage({ type: "ready" }); // flush
    expect(provider._pendingReopen).toBe(null);
    expect(provider._convs.list().some((t) => t.sessionId === "sess-B")).toBe(
      true,
    );
  });
});
