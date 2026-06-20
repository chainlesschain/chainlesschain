/**
 * Panel approval-mode selector (`/auto` · `/bypass` · `/normal`) — Claude-Code
 * auto-accept/bypass parity. Covers the pure arg builder, the conversation
 * model field, and the ChatViewProvider orchestration (mode set → child
 * restart → the next spawn carries `--permission-mode`). All headless in the
 * CLI suite (no vscode host; injected createSession + fake window).
 */
import { describe, it, expect } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import {
  buildSessionArgs,
  PERMISSION_MODES,
} from "../../../vscode-extension/src/chat/chat-events.js";
import { ConversationManager } from "../../../vscode-extension/src/chat/conversation-manager.js";
import * as slashMod from "../../../vscode-extension/src/chat/slash-commands.js";

const slash = slashMod.default || slashMod;

describe("buildSessionArgs — permission mode", () => {
  it("emits --permission-mode for the hands-off modes", () => {
    expect(buildSessionArgs({ mode: "acceptEdits" })).toEqual([
      "--permission-mode",
      "acceptEdits",
    ]);
    expect(buildSessionArgs({ mode: "bypassPermissions" })).toEqual([
      "--permission-mode",
      "bypassPermissions",
    ]);
  });

  it("omits the flag for default / unset / unknown modes", () => {
    expect(buildSessionArgs({})).toEqual([]);
    expect(buildSessionArgs({ mode: "default" })).toEqual([]);
    expect(buildSessionArgs({ mode: "nonsense" })).toEqual([]);
    expect(buildSessionArgs({ mode: "" })).toEqual([]);
  });

  it("composes mode after model/provider/resume", () => {
    expect(
      buildSessionArgs({
        provider: "ollama",
        model: "qwen2.5:7b",
        resume: "sess-1",
        mode: "acceptEdits",
      }),
    ).toEqual([
      "--provider",
      "ollama",
      "--model",
      "qwen2.5:7b",
      "--resume",
      "sess-1",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("PERMISSION_MODES is the allow-list (no 'default')", () => {
    expect(PERMISSION_MODES.has("acceptEdits")).toBe(true);
    expect(PERMISSION_MODES.has("bypassPermissions")).toBe(true);
    expect(PERMISSION_MODES.has("plan")).toBe(true);
    expect(PERMISSION_MODES.has("default")).toBe(false);
  });
});

describe("ConversationManager — mode field", () => {
  it("defaults to 'default' and round-trips through setMode + list()", () => {
    const cm = new ConversationManager({});
    const c = cm.create({});
    expect(c.mode).toBe("default");
    cm.setMode(c.id, "acceptEdits");
    expect(cm.get(c.id).mode).toBe("acceptEdits");
    expect(cm.list()[0].mode).toBe("acceptEdits");
    // falsy → back to default (never an empty mode)
    cm.setMode(c.id, "");
    expect(cm.get(c.id).mode).toBe("default");
  });
});

// --- ChatViewProvider._setMode orchestration ---

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
  const commandCalls = [];
  const vscode = {
    commands: {
      executeCommand(id) {
        commandCalls.push(id);
        return Promise.resolve();
      },
    },
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
  return { provider, posted, spawns, commandCalls };
}

const lastPost = (posted) => posted[posted.length - 1];

describe("ChatViewProvider — approval mode", () => {
  it("sets the active conversation's mode and acknowledges (no live child)", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "mode", mode: "acceptEdits" });
    expect(provider._activeConv().mode).toBe("acceptEdits");
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("auto-accept edits"),
    });
    // no running child → no "applies on next message" qualifier
    expect(lastPost(posted).text).not.toContain("next message");
  });

  it("stops the live child so the next turn respawns with the new mode", () => {
    const { provider, posted, spawns } = makeProvider();
    // First turn spawns a child in default mode (no flag).
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns).toHaveLength(1);
    expect(spawns[0].cfg.args).not.toContain("--permission-mode");
    expect(spawns[0].running).toBe(true);

    // Switch to bypass: the live child is stopped, ack mentions next message.
    provider._handleMessage({ type: "mode", mode: "bypassPermissions" });
    expect(spawns[0].running).toBe(false);
    expect(lastPost(posted).text).toContain("next message");

    // Next turn respawns carrying the flag, resuming nothing new (same conv).
    provider._handleMessage({ type: "send", text: "again" });
    expect(spawns).toHaveLength(2);
    expect(spawns[1].cfg.args).toEqual(
      expect.arrayContaining(["--permission-mode", "bypassPermissions"]),
    );
  });

  it("rejects an unknown mode without touching the conversation", () => {
    const { provider, posted } = makeProvider();
    provider._handleMessage({ type: "mode", mode: "wat" });
    expect(provider._activeConv().mode).toBe("default");
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("unknown mode"),
    });
  });
});

describe("ChatViewProvider — Configure LLM reloads running children", () => {
  it("runs the wizard then restarts the live child so it picks up new config", async () => {
    const { provider, posted, spawns, commandCalls } = makeProvider();
    // A child is already running with the OLD (broken) config.
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns).toHaveLength(1);
    expect(spawns[0].running).toBe(true);

    // Configure LLM: opens the wizard, then (once it closes) stops the child.
    provider._handleMessage({ type: "configureLlm" });
    expect(commandCalls).toContain("chainlesschain.llm.configure");
    // Reload is chained off the wizard promise — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(spawns[0].running).toBe(false);
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("LLM config updated"),
    });
    expect(lastPost(posted).text).toContain("next message");

    // Next turn respawns a FRESH child (reads the updated config.json).
    provider._handleMessage({ type: "send", text: "again" });
    expect(spawns).toHaveLength(2);
    expect(spawns[1].running).toBe(true);
  });

  it("acknowledges with no 'next message' qualifier when no child is running", async () => {
    const { provider, posted, commandCalls } = makeProvider();
    provider._handleMessage({ type: "configureLlm" });
    expect(commandCalls).toContain("chainlesschain.llm.configure");
    await Promise.resolve();
    await Promise.resolve();
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("LLM config updated"),
    });
    expect(lastPost(posted).text).not.toContain("next message");
  });
});

describe("slash-commands menu — mode entries", () => {
  it("lists /auto, /bypass, /normal and filters them by prefix", () => {
    const names = slash.SLASH_COMMANDS.map((r) => r[0]);
    expect(names).toEqual(
      expect.arrayContaining(["/auto", "/bypass", "/normal"]),
    );
    expect(slash.filterSlashCommands("auto").map((r) => r[0])).toEqual([
      "/auto",
    ]);
    expect(slash.filterSlashCommands("b").map((r) => r[0])).toContain(
      "/bypass",
    );
  });
});
