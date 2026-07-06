/**
 * P2 chat-panel fixes (headless):
 *  - "New" resets the active tab's auto-derived title back to a default, so the
 *    fresh conversation re-names itself from ITS first message (it used to keep
 *    the previous conversation's title forever).
 *  - tab restore no longer silently drops a realistic number of saved tabs.
 */
import { describe, it, expect, vi } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { isDefaultTitle } from "../../../vscode-extension/src/chat/conversation-manager.js";

function makeMemento(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => m.set(k, v),
  };
}

function makeProvider({ state } = {}) {
  const posted = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: {},
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    getBridgeEnv: () => ({}),
    deps: {
      createSession: () => ({ running: false, send: () => true, stop() {} }),
      resolveChatLlm: (x) => x,
    },
    state: state || makeMemento(),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted };
}

describe('"New" resets an auto-derived title so the fresh chat re-names itself', () => {
  it("restores a default title after New, letting auto-rename fire again", () => {
    const { provider } = makeProvider();
    provider._handleMessage({ type: "ready" });
    const conv = provider._convs.active();
    // Auto-name it from a first message.
    provider._convs.setTitle(conv.id, "fix the login bug");
    expect(isDefaultTitle(conv.title)).toBe(false);

    provider._handleMessage({ type: "new" });
    // Title is back to a default ("Chat N") → auto-rename can fire again.
    expect(isDefaultTitle(provider._convs.get(conv.id).title)).toBe(true);
  });
});

describe("tab restore does not silently drop realistic tab counts", () => {
  it("restores well beyond the old 12-tab cap", () => {
    // Persist 20 tabs, then restore into a fresh provider.
    const tabs = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      title: `Chat ${i + 1}`,
      mode: "default",
      thinking: "off",
    }));
    const state = makeMemento({
      "chainlesschain.chat.tabs": { tabs, activeIndex: 15 },
    });
    const { provider } = makeProvider({ state });
    provider._activeConv(); // triggers _restoreTabs
    expect(provider._convs.count()).toBe(20);
    // The saved active index is honored (not clamped to 0).
    expect(provider._convs.active().sessionId).toBe("s15");
  });
});
