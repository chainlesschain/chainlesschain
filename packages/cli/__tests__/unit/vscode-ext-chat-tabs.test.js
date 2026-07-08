/**
 * Chat panel conversation tabs (slice 2 wiring) — ChatViewProvider driving the
 * ConversationManager: per-tab agent child, event routing to the owning tab,
 * and newTab/switchTab/closeTab. Uses a fake vscode + injected session factory
 * (opts.deps.createSession) and drives the extracted `_handleMessage` directly,
 * so it runs headless in the CLI suite.
 */
import { describe, it, expect } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

function makeMemento() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => {
      m.set(k, v);
    },
    _map: m,
  };
}

function makeSessionFactory() {
  const sessions = [];
  const factory = (cfg) => {
    const s = {
      cfg,
      running: true,
      sent: [],
      send(t) {
        this.sent.push({ kind: "send", text: t });
        return true;
      },
      sendEvent(e) {
        this.sent.push(e);
        return true;
      },
      stop() {
        this.running = false;
        this.stopped = true;
      },
      emit(evt) {
        cfg.onEvent && cfg.onEvent(evt);
      },
    };
    sessions.push(s);
    return s;
  };
  factory.sessions = sessions;
  return factory;
}

function makeProvider() {
  const posted = [];
  const factory = makeSessionFactory();
  const vscode = {
    commands: { executeCommand() {} },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: factory },
    state: makeMemento(),
  });
  provider.view = {
    webview: { postMessage: (m) => (posted.push(m), Promise.resolve()) },
  };
  return { provider, posted, factory };
}

const postedKinds = (posted) => posted.map((m) => m && m.kind);

describe("chat tabs — bootstrap + spawn", () => {
  it("the first send bootstraps one conversation and spawns its child", () => {
    const { provider, factory } = makeProvider();
    provider._handleMessage({ type: "send", text: "hi" });
    expect(factory.sessions).toHaveLength(1);
    expect(factory.sessions[0].sent).toEqual([{ kind: "send", text: "hi" }]);
    expect(provider._convs.count()).toBe(1);
    expect(provider._convs.active().session).toBe(factory.sessions[0]);
  });

  it("routes init session_id onto the owning conversation and persists it", () => {
    const { provider, posted, factory } = makeProvider();
    provider._handleMessage({ type: "send", text: "hi" });
    factory.sessions[0].emit({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      model: "m",
      provider: "p",
    });
    expect(provider._convs.active().sessionId).toBe("sess-1");
    expect(provider.opts.state._map.get("chainlesschain.chat.sessionId")).toBe(
      "sess-1",
    );
    expect(postedKinds(posted)).toContain("init"); // surfaced (active tab)
  });
});

describe("chat tabs — newTab / switchTab / closeTab", () => {
  it("newTab creates a fresh active tab; the next send spawns a SECOND child", () => {
    const { provider, posted, factory } = makeProvider();
    provider._handleMessage({ type: "send", text: "one" }); // conv-1 + child 1
    posted.length = 0;
    provider._handleMessage({ type: "newTab" });
    expect(provider._convs.count()).toBe(2);
    const tabsMsg = posted.find((m) => m.kind === "tabs");
    expect(tabsMsg).toBeTruthy();
    expect(tabsMsg.tabs).toHaveLength(2);
    expect(tabsMsg.activeId).toBe(provider._convs.activeId());

    provider._handleMessage({ type: "send", text: "two" }); // conv-2 child
    expect(factory.sessions).toHaveLength(2);
    expect(factory.sessions[1].sent).toEqual([{ kind: "send", text: "two" }]);
  });

  it("a background tab's events never reach the visible transcript", () => {
    const { provider, posted, factory } = makeProvider();
    provider._handleMessage({ type: "send", text: "one" }); // conv-1 active
    provider._handleMessage({ type: "newTab" }); // conv-2 active
    provider._handleMessage({ type: "send", text: "two" }); // conv-2 child
    posted.length = 0;
    // conv-1 (now background) streams text — must be dropped from the UI.
    factory.sessions[0].emit({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "ghost" } },
    });
    expect(posted).toHaveLength(0);
    // conv-2 (active) streams — surfaces.
    factory.sessions[1].emit({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "live" } },
    });
    expect(posted).toEqual([{ kind: "delta", text: "live" }]);
  });

  it("switchTab re-activates a tab and re-broadcasts the tab set (no reset — webview restores)", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "send", text: "one" });
    const firstId = provider._convs.activeId();
    provider._handleMessage({ type: "newTab" });
    posted.length = 0;
    provider._handleMessage({ type: "switchTab", id: firstId });
    expect(provider._convs.activeId()).toBe(firstId);
    expect(postedKinds(posted)).toEqual(["tabs"]); // no reset — buffer restores
  });

  it("the webview 'ready' signal bootstraps one tab and broadcasts the tab bar", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "ready" });
    expect(provider._convs.count()).toBe(1);
    const tabsMsg = posted.find((m) => m.kind === "tabs");
    expect(tabsMsg).toBeTruthy();
    expect(tabsMsg.tabs).toHaveLength(1);
    expect(tabsMsg.activeId).toBe(provider._convs.activeId());
  });

  it("closeTab stops the child and activates a neighbor; never goes empty", () => {
    const { provider, factory } = makeProvider();
    provider._handleMessage({ type: "send", text: "one" }); // conv-1 + child
    const firstId = provider._convs.activeId();
    provider._handleMessage({ type: "newTab" }); // conv-2 active
    provider._handleMessage({
      type: "closeTab",
      id: provider._convs.activeId(),
    });
    expect(provider._convs.activeId()).toBe(firstId); // neighbor
    expect(provider._convs.count()).toBe(1);

    // Closing the last remaining tab leaves a fresh empty one (never empty).
    provider._handleMessage({ type: "closeTab", id: firstId });
    expect(factory.sessions[0].stopped).toBe(true);
    expect(provider._convs.count()).toBe(1);
    expect(provider._convs.active().session).toBe(null);
  });

  it("dispose stops every tab's child", () => {
    const { provider, factory } = makeProvider();
    provider._handleMessage({ type: "send", text: "one" });
    provider._handleMessage({ type: "newTab" });
    provider._handleMessage({ type: "send", text: "two" });
    expect(factory.sessions).toHaveLength(2);
    provider.dispose();
    expect(factory.sessions.every((s) => s.stopped)).toBe(true);
  });
});

describe("chat tabs — background completion signal", () => {
  // Provider whose fake host captures toasts and lets the test choose the pick.
  function makeProviderWithToast() {
    const posted = [];
    const factory = makeSessionFactory();
    const toasts = [];
    const commands = [];
    const win = {
      _nextPick: undefined,
      showInformationMessage: (msg, ...actions) => {
        toasts.push({ msg, actions });
        return Promise.resolve(win._nextPick);
      },
    };
    const vscode = {
      commands: { executeCommand: (...a) => commands.push(a) },
      window: win,
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/ws" } }],
        getConfiguration: () => ({ get: () => undefined }),
      },
    };
    const provider = new ChatViewProvider(vscode, {
      deps: { createSession: factory },
      state: makeMemento(),
    });
    provider.view = {
      webview: { postMessage: (m) => (posted.push(m), Promise.resolve()) },
    };
    return { provider, posted, factory, toasts, commands, win };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("a turn finishing in a BACKGROUND tab flags it unread, re-broadcasts tabs, and toasts", () => {
    const { provider, posted, factory, toasts } = makeProviderWithToast();
    provider._handleMessage({ type: "send", text: "one" }); // conv-1 active
    const bgId = provider._convs.activeId();
    provider._handleMessage({ type: "newTab" }); // conv-2 active; conv-1 background
    posted.length = 0;
    // conv-1 (background) finishes a turn.
    factory.sessions[0].emit({
      type: "result",
      is_error: false,
      result: "done",
    });
    // tab bar re-broadcast with conv-1 flagged unread; transcript stays gated.
    const tabsMsg = posted.find((m) => m.kind === "tabs");
    expect(tabsMsg).toBeTruthy();
    expect(tabsMsg.tabs.find((t) => t.id === bgId).unread).toBe(true);
    expect(posted.some((m) => m.kind === "turn_end")).toBe(false); // not surfaced
    // a toast fired with a "Show" action.
    expect(toasts).toHaveLength(1);
    expect(toasts[0].actions).toContain("Show");
  });

  it("a turn finishing in the ACTIVE tab does NOT flag unread and does NOT toast", () => {
    const { provider, factory, toasts } = makeProviderWithToast();
    provider._handleMessage({ type: "send", text: "one" }); // conv-1 active
    factory.sessions[0].emit({ type: "result", is_error: false, result: "ok" });
    expect(provider._convs.active().unread).toBe(false);
    expect(toasts).toHaveLength(0);
  });

  it("the 'Show' toast switches to the background tab and focuses the panel", async () => {
    const { provider, factory, commands, win } = makeProviderWithToast();
    provider._handleMessage({ type: "send", text: "one" }); // conv-1
    const bgId = provider._convs.activeId();
    provider._handleMessage({ type: "newTab" }); // conv-2 active
    win._nextPick = "Show"; // the user clicks Show on the next toast
    factory.sessions[0].emit({
      type: "result",
      is_error: false,
      result: "done",
    });
    await flush(); // let the toast's .then run
    expect(provider._convs.activeId()).toBe(bgId); // switched back
    expect(provider._convs.get(bgId).unread).toBe(false); // cleared on switch
    expect(commands.some((c) => c[0] === "chainlesschainIdeChat.focus")).toBe(
      true,
    );
  });

  it("switching to a flagged tab clears its dot", () => {
    const { provider, factory } = makeProviderWithToast();
    provider._handleMessage({ type: "send", text: "one" });
    const bgId = provider._convs.activeId();
    provider._handleMessage({ type: "newTab" });
    factory.sessions[0].emit({
      type: "result",
      is_error: false,
      result: "done",
    });
    expect(provider._convs.get(bgId).unread).toBe(true);
    provider._handleMessage({ type: "switchTab", id: bgId });
    expect(provider._convs.get(bgId).unread).toBe(false);
  });
});

describe("chat HTML ships the tab bar (slice 3, parse gate)", () => {
  it("renders #tabs, handles the tabs message, posts the tab verbs, and parses", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain('id="tabs"');
    expect(html).toContain('case "tabs"');
    expect(html).toContain("renderTabBar");
    expect(html).toContain('type: "newTab"');
    expect(html).toContain('type: "switchTab"');
    expect(html).toContain('type: "closeTab"');
    expect(html).toContain('type: "rewind"'); // /rewind slash command
    // Per-tab transcript must use DETACHED DOM NODES, not innerHTML strings —
    // detaching/re-appending real nodes preserves event listeners so approval
    // cards stay clickable after a tab switch. A regression to innerHTML would
    // silently break those buttons.
    expect(html).toContain("detachLogNodes");
    expect(html).toContain("attachLogNodes");
    expect(html).toContain("tabNodes");
    expect(html).not.toContain("tabHtml");
    // Background-tab completion signal: the tab bar renders an unread dot.
    expect(html).toContain("t.unread");
    expect(html).toContain('"dot"');
    // Code-block button bar (Insert + Copy): decorate at the DOM level after
    // mdLite renders (renderer stays a pure string whitelist), wired into both
    // render paths. Insert posts insertCode to the host (insert-at-cursor).
    expect(html).toContain("decorateCodeBlocks");
    expect(html).toContain("decorateCodeBlocks(el)"); // called on the rendered block
    expect(html).toContain("codebar");
    expect(html).toContain('type: "insertCode"');
    expect(html).toContain("clipboard");
    // Every inline script must still parse (dead-panel regression gate).
    const scripts = [
      ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
    ];
    for (const [, body] of scripts) new Function(body);
  });
});

// ─── multi-tab persistence across window reloads ────────────────────────────

describe("chat tabs — persistence across reload", () => {
  it("restores N tabs (title/session/mode/thinking/active) into a fresh provider", () => {
    const memento = makeMemento();
    const factory = makeSessionFactory();
    const vscode = {
      commands: { executeCommand() {} },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/ws" } }],
        getConfiguration: () => ({ get: () => undefined }),
      },
    };
    const p1 = new ChatViewProvider(vscode, {
      deps: { createSession: factory },
      state: memento,
    });
    p1.view = { webview: { postMessage: () => Promise.resolve() } };

    // Tab 1 gets a session id + a first message (auto-title).
    p1._handleMessage({ type: "send", text: "fix the login bug in auth.js" });
    factory.sessions[0].emit({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
    });
    // Tab 2: new tab, bypass mode, its own session.
    p1._handleMessage({ type: "newTab" });
    p1._handleMessage({ type: "mode", mode: "bypassPermissions" });
    p1._handleMessage({ type: "send", text: "write docs for the new API" });
    factory.sessions.at(-1).emit({
      type: "system",
      subtype: "init",
      session_id: "sess-2",
    });

    // Reload: a brand-new provider over the SAME workspaceState.
    const p2 = new ChatViewProvider(vscode, {
      deps: { createSession: makeSessionFactory() },
      state: memento,
    });
    p2._activeConv(); // what the webview "ready" handler triggers
    const tabs = p2._convs.list();
    expect(tabs).toHaveLength(2);
    expect(tabs[0].title).toBe("fix the login bug in auth.js");
    expect(tabs[0].sessionId).toBe("sess-1");
    expect(tabs[1].sessionId).toBe("sess-2");
    expect(tabs[1].active).toBe(true); // tab 2 was active at "reload"
    expect(p2._convs.get(tabs[1].id).mode).toBe("bypassPermissions");
    expect(p2._convs.get(tabs[0].id).mode).toBe("default");
  });

  it("falls back to the legacy single-session key when no tab set was saved", () => {
    const memento = makeMemento();
    memento.update("chainlesschain.chat.sessionId", "legacy-sess");
    const p = new ChatViewProvider(
      {
        commands: { executeCommand() {} },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: "/ws" } }],
          getConfiguration: () => ({ get: () => undefined }),
        },
      },
      { deps: { createSession: makeSessionFactory() }, state: memento },
    );
    const conv = p._activeConv();
    expect(p._convs.count()).toBe(1);
    expect(conv.sessionId).toBe("legacy-sess");
  });

  it("closing a tab persists immediately (a reload right after must not resurrect it)", () => {
    const memento = makeMemento();
    const { provider } = (() => {
      const factory = makeSessionFactory();
      const provider = new ChatViewProvider(
        {
          commands: { executeCommand() {} },
          workspace: {
            workspaceFolders: [{ uri: { fsPath: "/ws" } }],
            getConfiguration: () => ({ get: () => undefined }),
          },
        },
        { deps: { createSession: factory }, state: memento },
      );
      provider.view = { webview: { postMessage: () => Promise.resolve() } };
      return { provider };
    })();
    provider._handleMessage({ type: "newTab" });
    provider._handleMessage({ type: "newTab" });
    const ids = provider._convs.list().map((t) => t.id);
    provider._handleMessage({ type: "closeTab", id: ids[1] });
    const saved = memento.get("chainlesschain.chat.tabs");
    expect(saved.tabs).toHaveLength(2);
  });
});

// ─── tab auto-naming from the first message ─────────────────────────────────

describe("chat tabs — auto-title from first message", () => {
  it("replaces the default title once, and never a later or custom one", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({
      type: "send",
      text: "  refactor   the payment   module to use the new gateway API  ",
    });
    const conv = provider._activeConv();
    expect(conv.title).toBe("refactor the payment module t…");
    expect(conv.title.length).toBeLessThanOrEqual(30);
    // Tab bar was refreshed with the new title.
    const tabsMsg = posted.filter((m) => m.kind === "tabs").at(-1);
    expect(tabsMsg.tabs[0].title).toBe(conv.title);

    // Second message must not rename.
    provider._handleMessage({ type: "send", text: "also add tests" });
    expect(provider._activeConv().title).toBe("refactor the payment module t…");

    // A custom title is never overwritten by sends.
    provider._convs.setTitle(conv.id, "My tab");
    provider._handleMessage({ type: "send", text: "another message" });
    expect(provider._activeConv().title).toBe("My tab");
  });

  it("keeps the default title for image-only messages (blank text)", () => {
    const { provider } = makeProvider();
    provider._handleMessage({ type: "send", text: "   " });
    expect(provider._activeConv().title).toMatch(/^Chat \d+$/);
  });
});
