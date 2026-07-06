/**
 * P0/P1 chat-panel fixes (headless, no vscode host):
 *  - _safeLlmSetting drops a workspace-settable model/provider that carries
 *    shell metacharacters before it reaches the shell:true argv (injection).
 *  - a question_request in a BACKGROUND tab flags it + is re-surfaced on switch
 *    (was silently dropped → agent hung until user_timeout).
 *  - _pickSession's persisted resume id survives a window reload.
 *  - onLlmConfigured restarts EVERY tab's child, not just the active one.
 */
import { describe, it, expect, vi } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

function makeMemento() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => m.set(k, v),
    _map: m,
  };
}

function makeProvider({ config = {}, state } = {}) {
  const posted = [];
  const warnings = [];
  const created = []; // captured createSession configs
  const vscode = {
    commands: { executeCommand() {} },
    window: {
      showWarningMessage: (msg) => {
        warnings.push(msg);
        return { then: () => {} };
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: (k) => config[k] }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    getBridgeEnv: () => ({}),
    deps: {
      createSession: (cfg) => {
        const sess = {
          cfg,
          running: true,
          send: () => true,
          sendEvent: () => true,
          stop: vi.fn(function () {
            this.running = false;
          }),
        };
        created.push(sess);
        return sess;
      },
      resolveChatLlm: ({ provider: p, model }) => ({ provider: p, model }),
    },
    state: state || makeMemento(),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted, warnings, created };
}

const lastOf = (posted, kind) => posted.filter((p) => p.kind === kind).pop();

describe("_safeLlmSetting — shell-metachar model/provider is dropped", () => {
  it("keeps a normal model but strips an injection payload from the argv", () => {
    const { provider, created, warnings } = makeProvider({
      config: { model: "x & calc", provider: "openai" },
    });
    provider._handleMessage({ type: "ready" }); // bootstrap conv
    const session = provider._ensureSession();
    const args = session.cfg.args.join(" ");
    expect(args).not.toContain("calc");
    expect(args).not.toContain("&");
    // The safe provider still made it through.
    expect(args).toContain("openai");
    // The user was warned once about the ignored setting.
    expect(warnings.some((w) => /unsafe/i.test(w) && /model/.test(w))).toBe(
      true,
    );
  });

  it("passes a clean model through untouched", () => {
    const { provider, created } = makeProvider({
      config: { model: "gpt-4o", provider: "openai" },
    });
    provider._handleMessage({ type: "ready" });
    const session = provider._ensureSession();
    expect(session.cfg.args.join(" ")).toContain("gpt-4o");
  });
});

describe("background-tab question_request", () => {
  it("flags the background tab and re-surfaces the card on switch", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "ready" }); // conv-1 active
    const conv1 = provider._convs.list()[0];
    provider._handleMessage({ type: "newTab" }); // conv-2 active; conv-1 background

    provider._makeOnEvent(conv1.id)({
      type: "question_request",
      id: "q1",
      question: "pick one",
      options: ["a", "b"],
    });

    // Dot + remembered card while backgrounded.
    expect(provider._convs.get(conv1.id).needsApproval).toBe(true);
    expect(provider._convs.get(conv1.id).pendingApproval).toMatchObject({
      kind: "question",
      id: "q1",
    });

    // Switching back re-posts the question card and clears the dot.
    provider._handleMessage({ type: "switchTab", id: conv1.id });
    expect(lastOf(posted, "question")).toMatchObject({ id: "q1" });
    expect(provider._convs.get(conv1.id).needsApproval).toBe(false);
  });

  it("does not flag the ACTIVE tab (its card shows live)", () => {
    const { provider } = makeProvider();
    provider._handleMessage({ type: "ready" });
    const active = provider._convs.activeId();
    provider._makeOnEvent(active)({ type: "question_request", id: "q2" });
    expect(provider._convs.get(active).needsApproval).toBe(false);
  });
});

describe("onLlmConfigured — restarts every tab, not just the active one", () => {
  it("stops the child in a BACKGROUND tab too", () => {
    const { provider } = makeProvider();
    provider._handleMessage({ type: "ready" });
    const conv1 = provider._convs.list()[0];
    const s1 = provider._ensureSession(); // conv-1's child
    provider._handleMessage({ type: "newTab" }); // conv-2 active
    const s2 = provider._ensureSession(); // conv-2's child

    provider.onLlmConfigured();

    expect(s1.stop).toHaveBeenCalled(); // background tab restarted
    expect(s2.stop).toHaveBeenCalled(); // active tab restarted
  });
});

describe("picked resume id persists across a window reload", () => {
  it("restores the tab's NEW session id, not a stale one", () => {
    const state = makeMemento();
    const { provider } = makeProvider({ state });
    provider._handleMessage({ type: "ready" });
    const conv = provider._convs.active();
    // Simulate what _pickSession now does: set the id AND persist the tabs blob
    // (the regression was that it set the id but never persisted, so a reload
    // restored the OLD id from the preferred tabs blob).
    provider._convs.setSessionId(conv.id, "resumed-xyz");
    provider._persistTabs();

    // A fresh window (new provider, SAME workspaceState) restores the pick.
    const { provider: reloaded } = makeProvider({ state });
    const restored = reloaded._activeConv();
    expect(restored.sessionId).toBe("resumed-xyz");
  });
});
