/**
 * Lean context (`chainlesschain.chat.leanContext`) — the chat panel injects
 * CC_PROJECT_MEMORY=lean into the agent child's env by default so the system
 * prompt keeps only the primary ENTRY instruction file (cc.md/CLAUDE.md) and
 * sheds the heavy companions (CLAUDE.local.md, .claude/rules/*, rules.md) that a
 * doc-heavy monorepo would otherwise re-pay ~8k+ tokens/turn for. Delivered as
 * an env var — not a CLI flag — so an older `cc` that predates lean mode just
 * falls back to full memory (safe) instead of erroring on an unknown flag.
 * Turning the setting OFF omits the env, restoring full project memory. Scoped
 * to the panel child only (terminal `cc` untouched).
 *
 * Headless in the CLI suite (injected createSession + fake window), mirroring
 * vscode-ext-chat-mode.test.js.
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

/** @param {(key:string)=>any} chatGet  mock for getConfiguration("chainlesschain.chat").get */
function makeProvider(chatGet = () => undefined) {
  const spawns = [];
  const vscode = {
    commands: { executeCommand: () => Promise.resolve() },
    window: {},
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: (section) =>
        section === "chainlesschain.chat"
          ? { get: chatGet }
          : { get: () => undefined },
    },
  };
  const createSession = (cfg) => {
    const s = {
      cfg,
      running: true,
      send: () => true,
      sendEvent: () => true,
      stop() {
        this.running = false;
      },
    };
    spawns.push(s);
    return s;
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession },
    state: makeMemento({}),
  });
  provider.view = {
    webview: { postMessage: () => Promise.resolve() },
  };
  return { provider, spawns };
}

describe("ChatViewProvider — lean context env", () => {
  it("injects CC_PROJECT_MEMORY=lean by default (setting unset)", () => {
    const { provider, spawns } = makeProvider(() => undefined);
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns).toHaveLength(1);
    expect(spawns[0].cfg.env.CC_PROJECT_MEMORY).toBe("lean");
  });

  it("injects CC_PROJECT_MEMORY=lean when explicitly enabled", () => {
    const { provider, spawns } = makeProvider((k) =>
      k === "leanContext" ? true : undefined,
    );
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns[0].cfg.env.CC_PROJECT_MEMORY).toBe("lean");
  });

  it("omits CC_PROJECT_MEMORY when the setting is turned OFF", () => {
    const { provider, spawns } = makeProvider((k) =>
      k === "leanContext" ? false : undefined,
    );
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns).toHaveLength(1);
    expect("CC_PROJECT_MEMORY" in spawns[0].cfg.env).toBe(false);
  });

  it("never passes an unknown --no-project-memory flag (env-only, version-safe)", () => {
    const { provider, spawns } = makeProvider(() => undefined);
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns[0].cfg.args).not.toContain("--no-project-memory");
  });
});
