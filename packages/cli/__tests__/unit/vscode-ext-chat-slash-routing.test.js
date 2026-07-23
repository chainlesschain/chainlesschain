/**
 * Regression coverage for slash-command routing in the VS Code chat host.
 *
 * These tests intentionally drive ChatViewProvider with fake VS Code, CLI and
 * agent-session dependencies. They protect the trust boundary (webview input
 * must not become arbitrary CLI argv), per-tab async routing, and the
 * session-specific cleanup required by /new, close and resume.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

function makeMemento() {
  const values = new Map();
  return {
    get(key) {
      return values.has(key) ? values.get(key) : null;
    },
    update(key, value) {
      values.set(key, value);
    },
    values,
  };
}

function makeSessionFactory() {
  const sessions = [];
  const createSession = vi.fn((cfg) => {
    const session = {
      cfg,
      running: true,
      sent: [],
      send: vi.fn(function (text) {
        this.sent.push({ type: "user_text", text });
        return true;
      }),
      sendEvent: vi.fn(function (event) {
        this.sent.push(event);
        return true;
      }),
      stop: vi.fn(function () {
        this.running = false;
      }),
      emit(event) {
        cfg.onEvent?.(event);
      },
      emitStderr(text) {
        cfg.onStderr?.(text);
      },
      exit(code = 0) {
        cfg.onExit?.({ code, signal: null });
      },
    };
    sessions.push(session);
    return session;
  });
  createSession.sessions = sessions;
  return createSession;
}

const providers = [];

function makeProvider(overrides = {}) {
  const posted = [];
  const createSession = overrides.createSession || makeSessionFactory();
  const runCliResult =
    overrides.runCliResult ||
    vi.fn(async () => ({ ok: true, code: 0, text: "ok" }));
  const vscode = {
    commands: {
      executeCommand: vi.fn(),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:\\workspace" } }],
      getConfiguration(section) {
        return {
          get(key) {
            if (section === "chainlesschain.cli" && key === "path") {
              return "test-cc";
            }
            return undefined;
          },
        };
      },
    },
    window: {},
  };
  const provider = new ChatViewProvider(vscode, {
    deps: {
      createSession,
      runCliResult,
      resolveChatLlm: () => ({}),
      ...(overrides.deps || {}),
    },
    state: makeMemento(),
  });
  provider.view = {
    webview: {
      postMessage: vi.fn((message) => {
        posted.push(message);
        return Promise.resolve(true);
      }),
    },
  };
  providers.push(provider);
  return { provider, posted, createSession, runCliResult, vscode };
}

afterEach(() => {
  for (const provider of providers.splice(0)) provider.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("VS Code chat session slash-command routing", () => {
  it("routes a normalized unique /sta fallback through the manifest to /status", () => {
    const { provider, posted, createSession, runCliResult } = makeProvider();

    provider._handleMessage({
      type: "slashCommandFallback",
      command: "/ＳＴＡ\u200b",
      args: "--verbose",
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.sessions[0].sent).toHaveLength(1);
    expect(createSession.sessions[0].sent[0]).toMatchObject({
      type: "slash_command",
      command: "status",
      args: "--verbose",
    });
    expect(posted[0]).toEqual({ kind: "info", text: "/status" });
    expect(runCliResult).not.toHaveBeenCalled();
  });

  it("rejects ambiguous, unknown and panel-only fallback tokens without dispatch", () => {
    const { provider, posted, createSession, runCliResult } = makeProvider();

    provider._handleMessage({
      type: "slashCommandFallback",
      command: "/st",
      args: "",
    });
    provider._handleMessage({
      type: "slashCommandFallback",
      command: "/definitely-not-real",
      args: "",
    });
    provider._handleMessage({
      type: "slashCommandFallback",
      command: "/retr",
      args: "",
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(runCliResult).not.toHaveBeenCalled();
    expect(posted).toEqual([
      {
        kind: "error",
        text: "ambiguous command /st — matches /stop, /status",
      },
      {
        kind: "error",
        text: "unknown command /definitely-not-real — try /help",
      },
      {
        kind: "error",
        text: "command /retry is handled inside the panel — type it in full or choose it from suggestions",
      },
    ]);
  });

  it("starts once, reuses the live session and sends correlated status requests without spawning a CLI command", () => {
    const { provider, createSession, runCliResult } = makeProvider();

    provider._handleMessage({
      type: "sessionSlashCommand",
      command: "status",
      args: "--verbose",
    });
    provider._handleMessage({
      type: "sessionSlashCommand",
      command: "status",
      args: "",
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.sessions[0].sent).toHaveLength(2);
    const [first, second] = createSession.sessions[0].sent;
    expect(first).toMatchObject({
      type: "slash_command",
      command: "status",
      args: "--verbose",
    });
    expect(second).toMatchObject({
      type: "slash_command",
      command: "status",
      args: "",
    });
    expect(first.request_id).toMatch(/^slash-/);
    expect(second.request_id).toMatch(/^slash-/);
    expect(second.request_id).not.toBe(first.request_id);
    expect(runCliResult).not.toHaveBeenCalled();
  });

  it("rejects an unknown session command before starting a child", () => {
    const { provider, posted, createSession, runCliResult } = makeProvider();

    provider._handleMessage({
      type: "sessionSlashCommand",
      command: "definitely-not-real",
      args: "",
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(runCliResult).not.toHaveBeenCalled();
    expect(posted.at(-1)).toMatchObject({
      kind: "error",
      text: expect.stringContaining("unsupported session command"),
    });
  });

  it("turns an old CLI capability gap into an actionable error", () => {
    const { provider, posted, createSession } = makeProvider();

    provider._handleMessage({
      type: "sessionSlashCommand",
      command: "status",
      args: "",
    });
    createSession.sessions[0].emit({
      type: "system",
      subtype: "init",
      session_id: "old-cli-session",
    });

    expect(posted.find((message) => message.kind === "error")).toMatchObject({
      kind: "error",
      text: expect.stringMatching(/\/status.*newer cc CLI/),
    });
    expect(provider._activeConv().sessionSlashCommands).toEqual([]);
  });
});

describe("VS Code chat trusted CLI slash-command routing", () => {
  it("tokenizes quoted /init arguments into argv and renders structured failures as errors", async () => {
    const runCliResult = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, code: 0, text: "initialized" })
      .mockResolvedValueOnce({
        ok: false,
        code: 2,
        stderr: "project initialization failed",
        text: "project initialization failed",
      });
    const { provider, posted } = makeProvider({ runCliResult });

    await expect(
      provider._runCliCommand("init", '"--force" --template "data-science"'),
    ).resolves.toBe(true);
    expect(runCliResult).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "test-cc",
        args: ["init", "--force", "--template", "data-science"],
        cwd: "C:\\workspace",
      }),
    );
    expect(posted.at(-1)).toEqual({
      kind: "pre",
      text: "initialized",
    });

    await expect(provider._runCliCommand("init", "--force")).resolves.toBe(
      false,
    );
    expect(posted.at(-1)).toEqual({
      kind: "error",
      text: "project initialization failed",
    });
  });

  it("does not execute a tampered command or a mutating plugin subcommand", async () => {
    const { provider, posted, runCliResult } = makeProvider();

    await expect(
      provider._runCliCommand("arbitrary-command", "--dangerous"),
    ).resolves.toBe(false);
    await expect(
      provider._runCliCommand("plugin", "install untrusted-package"),
    ).resolves.toBe(false);

    expect(runCliResult).not.toHaveBeenCalled();
    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({
      kind: "error",
      text: expect.stringContaining("unsupported panel CLI command"),
    });
    expect(posted[1]).toMatchObject({
      kind: "error",
      text: expect.stringContaining("changes local plugin state"),
    });
  });

  it.each([
    ["options demo --set secret=value", "--set"],
    ["options demo --scope project", "--scope"],
    ["monitors --run", "--run"],
    ["monitors --seconds 30", "--seconds"],
    [
      "browse demo --registry https://example.test/plugins.json --token secret",
      "tokens",
    ],
    [
      "browse --registry http://example.test/plugins.json --allow-insecure-registry",
      "insecure",
    ],
  ])(
    "rejects mutating or sensitive plugin arguments: %s",
    async (raw, hint) => {
      const { provider, posted, runCliResult } = makeProvider();

      await expect(provider._runCliCommand("plugin", raw)).resolves.toBe(false);

      expect(runCliResult).not.toHaveBeenCalled();
      expect(posted.at(-1)).toMatchObject({
        kind: "error",
        text: expect.stringContaining(hint),
      });
    },
  );

  it("allows only bounded read-only plugin variants", async () => {
    const { provider, runCliResult } = makeProvider();

    await expect(
      provider._runCliCommand("plugin", "options demo --json"),
    ).resolves.toBe(true);
    await expect(
      provider._runCliCommand("plugin", "monitors --json"),
    ).resolves.toBe(true);
    await expect(
      provider._runCliCommand(
        "plugin",
        "browse demo --registry https://example.test/plugins.json --json",
      ),
    ).resolves.toBe(true);

    expect(runCliResult.mock.calls.map(([call]) => call.args)).toEqual([
      ["plugin", "options", "demo", "--json"],
      ["plugin", "monitors", "--json"],
      [
        "plugin",
        "browse",
        "demo",
        "--registry",
        "https://example.test/plugins.json",
        "--json",
      ],
    ]);
  });

  it("renders /cost and /context nonzero outcomes as errors", async () => {
    const runCliResult = vi.fn(async () => ({
      ok: false,
      code: 2,
      text: "session not found",
    }));
    const { provider, posted } = makeProvider({ runCliResult });
    provider._activeConv().sessionId = "session-cost";

    await provider._runIntrospect("cost");

    expect(posted.at(-1)).toEqual({
      kind: "error",
      text: "session not found",
    });
  });

  it("does not post a delayed CLI result into a tab selected after execution began", async () => {
    let resolveCli;
    const runCliResult = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCli = resolve;
        }),
    );
    const { provider, posted } = makeProvider({ runCliResult });
    const original = provider._activeConv().id;

    const pending = provider._runCliCommand("changelog", "");
    expect(runCliResult).toHaveBeenCalledTimes(1);
    provider._handleMessage({ type: "newTab" });
    expect(provider._convs.activeId()).not.toBe(original);
    posted.length = 0;

    resolveCli({ ok: true, code: 0, text: "late release notes" });
    await pending;

    expect(posted).toEqual([]);
  });

  it("does not post delayed CLI or introspection results after /new reuses the same tab id", async () => {
    const resolvers = [];
    const runCliResult = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { provider, posted } = makeProvider({ runCliResult });
    provider._activeConv().sessionId = "session-old";

    const cliPending = provider._runCliCommand("changelog", "");
    const introspectPending = provider._runIntrospect("context");
    const originalId = provider._activeConv().id;
    provider._handleMessage({ type: "new" });
    expect(provider._activeConv().id).toBe(originalId);
    posted.length = 0;

    resolvers[0]({ ok: true, code: 0, text: "old release notes" });
    resolvers[1]({ ok: true, code: 0, text: "old context" });
    await Promise.all([cliPending, introspectPending]);

    expect(posted).toEqual([]);
  });
});

describe("VS Code chat reset and tab lifecycle", () => {
  it("/new clears session-owned goal, loop, plan, approval and usage while preserving mode and thinking", () => {
    vi.useFakeTimers();
    const { provider, createSession } = makeProvider();
    const conv = provider._activeConv();
    provider._convs.setMode(conv.id, "acceptEdits");
    provider._convs.setThinking(conv.id, "ultra");
    provider._convs.setGoalCondition(conv.id, "all checks pass");
    provider._setLoop("1s repeat this");
    const oldSession = createSession.sessions[0];
    const sentBeforeReset = oldSession.sent.length;
    const oldTurnState = conv.turnState;
    conv.plan = { active: true, state: "awaiting_approval" };
    conv.needsApproval = true;
    provider._convs.setPendingApproval(conv.id, {
      kind: "approval",
      id: "approval-1",
    });
    provider._lastCallUsage.set(conv.id, { input_tokens: 123 });

    provider._handleMessage({ type: "new" });

    expect(oldSession.stop).toHaveBeenCalledTimes(1);
    expect(conv.session).toBe(null);
    expect(conv.sessionId).toBe(null);
    expect(conv.goalCondition).toBe("");
    expect(conv.plan).toBe(null);
    expect(conv.pendingApproval).toBe(null);
    expect(conv.needsApproval).toBe(false);
    expect(conv.unread).toBe(false);
    expect(provider._lastCallUsage.has(conv.id)).toBe(false);
    expect(provider._loopTimers.has(conv.id)).toBe(false);
    expect(conv.turnState).not.toBe(oldTurnState);
    expect(conv.mode).toBe("acceptEdits");
    expect(conv.thinking).toBe("ultra");

    vi.advanceTimersByTime(5_000);
    expect(oldSession.sent).toHaveLength(sentBeforeReset);
    expect(createSession.sessions).toHaveLength(1);
  });

  it("closing a tab cancels its recurring loop", () => {
    vi.useFakeTimers();
    const { provider, createSession } = makeProvider();
    const conv = provider._activeConv();
    provider._setLoop("1s keep running");
    const oldSession = createSession.sessions[0];
    const sentBeforeClose = oldSession.sent.length;

    provider._handleMessage({ type: "closeTab", id: conv.id });

    expect(provider._loopTimers.has(conv.id)).toBe(false);
    expect(oldSession.stop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(oldSession.sent).toHaveLength(sentBeforeClose);
    expect(createSession.sessions).toHaveLength(1);
  });

  it("resuming another session clears state owned by the previous session", () => {
    vi.useFakeTimers();
    const { provider, posted, createSession } = makeProvider();
    const conv = provider._activeConv();
    provider._convs.setMode(conv.id, "bypassPermissions");
    provider._convs.setThinking(conv.id, "on");
    provider._convs.setGoalCondition(conv.id, "ship the old task");
    provider._setLoop("1s old task");
    const oldSession = createSession.sessions[0];
    const sentBeforeResume = oldSession.sent.length;
    conv.plan = { active: true };
    conv.needsApproval = true;
    provider._convs.setPendingApproval(conv.id, {
      kind: "approval",
      id: "approval-old",
    });
    provider._lastCallUsage.set(conv.id, { output_tokens: 55 });

    provider.resumeSessionId("session-next");

    expect(oldSession.stop).toHaveBeenCalledTimes(1);
    expect(conv.session).toBe(null);
    expect(conv.sessionId).toBe("session-next");
    expect(conv.goalCondition).toBe("");
    expect(conv.plan).toBe(null);
    expect(conv.pendingApproval).toBe(null);
    expect(conv.needsApproval).toBe(false);
    expect(provider._lastCallUsage.has(conv.id)).toBe(false);
    expect(provider._loopTimers.has(conv.id)).toBe(false);
    expect(conv.mode).toBe("bypassPermissions");
    expect(conv.thinking).toBe("on");
    const tabs = posted.filter((message) => message.kind === "tabs").at(-1);
    expect(tabs.tabs.find((tab) => tab.id === conv.id)).toMatchObject({
      needsApproval: false,
      unread: false,
    });

    vi.advanceTimersByTime(5_000);
    expect(oldSession.sent).toHaveLength(sentBeforeResume);
    expect(createSession.sessions).toHaveLength(1);
  });
});

describe("VS Code chat action feedback and stale child isolation", () => {
  it("reports stop, compact and approve no-ops when there is no active target", () => {
    const { provider, posted } = makeProvider();

    provider._handleMessage({ type: "interrupt" });
    provider._handleMessage({ type: "compact" });
    provider._handleMessage({ type: "plan", action: "approve" });

    expect(posted.map((message) => message.text)).toEqual([
      "/stop: no active turn",
      expect.stringContaining("/compact: send a message first"),
      "/approve: there is no active plan",
    ]);
    expect(posted.every((message) => message.kind === "info")).toBe(true);
  });

  it("marks plan continuations active so /stop can interrupt them", () => {
    const { provider, createSession } = makeProvider();
    provider._handleMessage({ type: "send", text: "draft a plan" });
    const conv = provider._activeConv();
    const session = createSession.sessions[0];
    session.emit({ type: "result", is_error: false, result: "planned" });
    conv.plan = { active: true, items: [{ id: "step-1" }] };

    provider._handleMessage({ type: "plan", action: "approve" });

    expect(conv.turnActive).toBe(true);
    provider._handleMessage({ type: "interrupt" });
    expect(session.sendEvent).toHaveBeenLastCalledWith({ type: "interrupt" });

    session.emit({
      type: "plan_update",
      active: true,
      note: "nothing to approve",
    });
    expect(conv.turnActive).toBe(false);
  });

  it("clears stale plan and approval state when a live child is restarted", () => {
    const { provider, posted, createSession } = makeProvider();
    provider._handleMessage({ type: "send", text: "start" });
    const conv = provider._activeConv();
    const session = createSession.sessions[0];
    conv.plan = { active: true };
    provider._convs.setPendingApproval(conv.id, {
      kind: "approval",
      id: "approval-stale",
    });
    conv.needsApproval = true;

    provider._handleMessage({ type: "mode", mode: "acceptEdits" });

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(conv.plan).toBe(null);
    expect(conv.pendingApproval).toBe(null);
    expect(conv.needsApproval).toBe(false);
    expect(posted).toContainEqual({
      kind: "approval_done",
      id: "approval-stale",
      approved: false,
      via: "session-stopped",
    });
  });

  it("stops a recurring /loop before handing the session to a background writer", async () => {
    vi.useFakeTimers();
    const remoteHandoff = {
      runHandoff: vi.fn(async () => ({
        ok: true,
        state: { id: "bg-1" },
      })),
      formatHandoffNote: vi.fn(() => "handed off"),
    };
    const { provider, createSession, vscode } = makeProvider({
      deps: { remoteHandoff },
    });
    vscode.window.showInputBox = vi.fn(async () => "continue in background");
    provider._setLoop("1s recurring task");
    const conv = provider._activeConv();
    const session = createSession.sessions[0];
    expect(provider._loopTimers.has(conv.id)).toBe(true);

    await provider._handoffSession();

    expect(provider._loopTimers.has(conv.id)).toBe(false);
    expect(session.stop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(createSession.sessions).toHaveLength(1);
    expect(remoteHandoff.runHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: conv.sessionId,
        prompt: "continue in background",
      }),
    );
  });

  it("ignores late events and exit callbacks from a replaced child", () => {
    const { provider, posted, createSession } = makeProvider();
    provider._handleMessage({ type: "send", text: "first turn" });
    const conv = provider._activeConv();
    const oldSession = createSession.sessions[0];

    provider._handleMessage({ type: "mode", mode: "acceptEdits" });
    provider._handleMessage({ type: "send", text: "second turn" });
    const currentSession = createSession.sessions[1];
    const sessionId = conv.sessionId;
    posted.length = 0;

    oldSession.emit({
      type: "system",
      subtype: "init",
      session_id: "stale-session-id",
    });
    oldSession.emit({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: "ghost output" } },
    });
    oldSession.emit({
      type: "token_usage",
      usage: { input_tokens: 999_999 },
    });
    oldSession.emit({ type: "result", is_error: false, result: "stale done" });
    oldSession.emitStderr("stale stderr");
    oldSession.exit(17);

    expect(provider._activeConv().session).toBe(currentSession);
    expect(provider._activeConv().sessionId).toBe(sessionId);
    expect(provider._activeConv().turnActive).toBe(true);
    expect(provider._lastCallUsage.has(conv.id)).toBe(false);
    expect(posted).toEqual([]);
    expect(currentSession.running).toBe(true);
  });
});
