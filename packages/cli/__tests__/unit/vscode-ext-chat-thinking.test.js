/**
 * Panel extended-thinking toggle (`/think` · `/ultrathink` · `/think-off`),
 * Claude-Code parity. Covers the pure arg builder, the conversation model, and
 * the ChatViewProvider orchestration (toggle → child restart → next spawn
 * carries --think/--ultrathink). Headless (no vscode host; injected createSession).
 */
import { describe, it, expect } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildSessionArgs } from "../../../vscode-extension/src/chat/chat-events.js";
import { ConversationManager } from "../../../vscode-extension/src/chat/conversation-manager.js";

describe("buildSessionArgs — extended thinking", () => {
  it("maps think level to the right flag", () => {
    expect(buildSessionArgs({ think: "on" })).toEqual(["--think"]);
    expect(buildSessionArgs({ think: "ultra" })).toEqual(["--ultrathink"]);
  });

  it("omits the flag for off / unset / unknown", () => {
    expect(buildSessionArgs({})).toEqual([]);
    expect(buildSessionArgs({ think: "off" })).toEqual([]);
    expect(buildSessionArgs({ think: "bogus" })).toEqual([]);
    expect(buildSessionArgs({ think: "" })).toEqual([]);
  });

  it("composes with mode (both spawn-time flags)", () => {
    expect(
      buildSessionArgs({
        provider: "anthropic",
        resume: "s1",
        mode: "acceptEdits",
        think: "ultra",
      }),
    ).toEqual([
      "--provider",
      "anthropic",
      "--resume",
      "s1",
      "--permission-mode",
      "acceptEdits",
      "--ultrathink",
    ]);
  });
});

describe("ConversationManager — thinking field", () => {
  it("defaults to 'off' and round-trips through setThinking", () => {
    const cm = new ConversationManager({});
    const c = cm.create({});
    expect(c.thinking).toBe("off");
    cm.setThinking(c.id, "ultra");
    expect(cm.get(c.id).thinking).toBe("ultra");
    cm.setThinking(c.id, "");
    expect(cm.get(c.id).thinking).toBe("off");
  });
});

function makeMemento(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => m.set(k, v),
  };
}

function makeProvider() {
  const posted = [];
  const spawns = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: {},
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
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
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted, spawns };
}

const lastPost = (posted) => posted[posted.length - 1];

describe("ChatViewProvider — extended thinking", () => {
  it("sets the active conversation's thinking level and acknowledges", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "think", level: "ultra" });
    expect(provider._activeConv().thinking).toBe("ultra");
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("ultra"),
    });
  });

  it("restarts the live child so the next turn carries the thinking flag", () => {
    const { provider, spawns } = makeProvider();
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns[0].cfg.args).not.toContain("--think");
    provider._handleMessage({ type: "think", level: "on" });
    expect(spawns[0].running).toBe(false);
    provider._handleMessage({ type: "send", text: "again" });
    expect(spawns[1].cfg.args).toContain("--think");
  });

  it("rejects an unknown thinking level", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "think", level: "wat" });
    expect(provider._activeConv().thinking).toBe("off");
    expect(lastPost(posted).text).toContain("unknown thinking level");
  });
});
