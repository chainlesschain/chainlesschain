import { describe, it, expect, vi, beforeEach } from "vitest";

describe("runtime-factory", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates agent runtime with config-backed defaults", async () => {
    const { createAgentRuntimeFactory } =
      await import("../../src/runtime/runtime-factory.js");

    const factory = createAgentRuntimeFactory({
      config: {
        llm: {
          model: "gpt-4o-mini",
          provider: "openai",
          baseUrl: "https://api.example.com",
          apiKey: "secret",
        },
      },
    });

    const runtime = factory.createAgentRuntime();
    expect(runtime.kind).toBe("agent");
    expect(runtime.policy).toMatchObject({
      model: "gpt-4o-mini",
      provider: "openai",
      baseUrl: "https://api.example.com",
      apiKey: "secret",
      sessionId: null,
    });
  });

  it("prefers explicit overrides over config values", async () => {
    const { createAgentRuntimeFactory } =
      await import("../../src/runtime/runtime-factory.js");

    const factory = createAgentRuntimeFactory({
      config: {
        llm: {
          model: "from-config",
          provider: "ollama",
        },
      },
    });

    const runtime = factory.createChatRuntime({
      model: "from-cli",
      provider: "openai",
      baseUrl: "https://override.example.com",
      apiKey: "override-key",
      sessionId: "sess-1",
    });

    expect(runtime.kind).toBe("chat");
    expect(runtime.policy).toMatchObject({
      model: "from-cli",
      provider: "openai",
      baseUrl: "https://override.example.com",
      apiKey: "override-key",
      sessionId: "sess-1",
    });
  });

  it("creates server runtime with normalized server policy", async () => {
    const { createAgentRuntimeFactory } =
      await import("../../src/runtime/runtime-factory.js");

    const runtime = createAgentRuntimeFactory({
      config: {},
    }).createServerRuntime({
      port: 18800,
      host: "127.0.0.1",
      token: "abc",
      maxConnections: 8,
      timeout: 45000,
      allowRemote: true,
      project: "/tmp/project",
    });

    expect(runtime.kind).toBe("server");
    expect(runtime.policy).toMatchObject({
      port: 18800,
      host: "127.0.0.1",
      token: "abc",
      maxConnections: 8,
      timeout: 45000,
      allowRemote: true,
      project: "/tmp/project",
    });
  });

  it("creates ui runtime with normalized ui policy", async () => {
    const { createAgentRuntimeFactory } =
      await import("../../src/runtime/runtime-factory.js");

    const runtime = createAgentRuntimeFactory({ config: {} }).createUiRuntime({
      port: 18810,
      wsPort: 18800,
      host: "127.0.0.1",
      open: false,
      token: "ui-token",
      webPanelDir: "/tmp/panel",
    });

    expect(runtime.kind).toBe("ui");
    expect(runtime.policy).toEqual({
      port: 18810,
      wsPort: 18800,
      host: "127.0.0.1",
      open: false,
      token: "ui-token",
      webPanelDir: "/tmp/panel",
    });
  });

  it("delegates agent and chat session start to injected dependencies", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");
    const startAgentRepl = vi.fn().mockResolvedValue(undefined);
    const startChatRepl = vi.fn().mockResolvedValue(undefined);

    const agentRuntime = new AgentRuntime({
      kind: "agent",
      policy: { model: "m", provider: "p", sessionId: null },
      deps: { startAgentRepl, startChatRepl },
    });

    const chatRuntime = new AgentRuntime({
      kind: "chat",
      policy: { model: "m2", provider: "p2", sessionId: "sess-2" },
      deps: { startAgentRepl, startChatRepl },
    });

    await agentRuntime.startAgentSession();
    await chatRuntime.startChatSession();

    expect(startAgentRepl).toHaveBeenCalledWith({
      model: "m",
      provider: "p",
      sessionId: null,
    });
    expect(startChatRepl).toHaveBeenCalledWith({
      model: "m2",
      provider: "p2",
      sessionId: "sess-2",
    });
  });

  it("resumeSession updates session id and reuses the matching runtime entrypoint", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");
    const startAgentRepl = vi.fn().mockResolvedValue(undefined);

    const runtime = new AgentRuntime({
      kind: "agent",
      policy: { model: "m", provider: "p", sessionId: null },
      deps: { startAgentRepl },
    });

    await runtime.resumeSession("sess-99");

    expect(runtime.policy.sessionId).toBe("sess-99");
    expect(startAgentRepl).toHaveBeenCalledWith({
      model: "m",
      provider: "p",
      sessionId: "sess-99",
    });
  });

  it("runTurn delegates to injected runtime turn handler and emits lifecycle events", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");
    const runTurn = vi.fn().mockResolvedValue({
      output: "done",
    });

    const runtime = new AgentRuntime({
      kind: "agent",
      policy: { model: "m", provider: "p", sessionId: "sess-turn" },
      deps: { runTurn },
    });

    const turnStart = vi.fn();
    const turnEnd = vi.fn();
    runtime.on("turn:start", turnStart);
    runtime.on("turn:end", turnEnd);

    const result = await runtime.runTurn("hello", { source: "test" });

    expect(runTurn).toHaveBeenCalledWith({
      input: "hello",
      meta: { source: "test" },
      kind: "agent",
      policy: {
        model: "m",
        provider: "p",
        sessionId: "sess-turn",
      },
      context: expect.objectContaining({
        kind: "agent",
        policy: {
          model: "m",
          provider: "p",
          sessionId: "sess-turn",
        },
      }),
    });
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(turnEnd).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn:start",
        kind: "agent",
        sessionId: "sess-turn",
        payload: expect.objectContaining({
          kind: "agent",
          input: "hello",
          meta: { source: "test" },
          sessionId: "sess-turn",
          startedAt: expect.any(Number),
        }),
      }),
    );
    expect(turnEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn:end",
        kind: "agent",
        sessionId: "sess-turn",
        payload: expect.objectContaining({
          kind: "agent",
          input: "hello",
          meta: { source: "test" },
          result: { output: "done" },
          sessionId: "sess-turn",
          startedAt: expect.any(Number),
          endedAt: expect.any(Number),
        }),
      }),
    );
    expect(result).toEqual({ output: "done" });
  });

  it("startUiServer boots ws/http servers through injected gateways", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");
    const wsServer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const httpServer = {
      listen: vi.fn((port, host, cb) => cb()),
      on: vi.fn(),
      close: vi.fn((cb) => cb && cb()),
    };
    const openBrowser = vi.fn();

    const runtime = new AgentRuntime({
      kind: "ui",
      policy: {
        port: 18810,
        wsPort: 18800,
        host: "127.0.0.1",
        open: true,
        token: "secret",
        webPanelDir: "/tmp/panel",
      },
      deps: {
        bootstrap: vi.fn().mockResolvedValue({ db: { getDb: () => null } }),
        loadConfig: vi.fn().mockReturnValue({}),
        createSessionManager: vi.fn().mockReturnValue({}),
        createServer: vi.fn().mockReturnValue(wsServer),
        createWebServer: vi.fn().mockReturnValue(httpServer),
        findProjectRoot: vi.fn().mockReturnValue(null),
        loadProjectConfig: vi.fn(),
        openBrowser,
        logger: { log: vi.fn() },
      },
    });

    const result = await runtime.startUiServer();

    expect(runtime.deps.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 18800,
        host: "127.0.0.1",
        token: "secret",
      }),
    );
    expect(runtime.deps.createWebServer).toHaveBeenCalledWith(
      expect.objectContaining({
        wsPort: 18800,
        wsToken: "secret",
        wsHost: "127.0.0.1",
        mode: "global",
        staticDir: "/tmp/panel",
      }),
    );
    expect(wsServer.start).toHaveBeenCalledTimes(1);
    expect(httpServer.listen).toHaveBeenCalledWith(
      18810,
      "127.0.0.1",
      expect.any(Function),
    );
    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:18810");
    expect(result.uiUrl).toBe("http://127.0.0.1:18810");
  });
});
