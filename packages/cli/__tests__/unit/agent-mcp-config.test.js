/**
 * Unit + integration tests for `cc agent --mcp-config` (Claude-Code parity).
 *
 *   1. mcp-config.js  — parse/normalize config, build agent-loop wiring from a
 *      connected (faked) MCP client, fail-fast on a bad/empty config file.
 *   2. headless-runner — the loaded {mcpClient, extraToolDefinitions, ...} are
 *      threaded into the loop options; servers are disconnected at the end.
 *   3. real agent loop — an `mcp__<server>__<tool>` call from the model is
 *      dispatched to mcpClient.callTool() and its result flows back.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseMcpServers,
  mcpToolName,
  mcpAuthHint,
  hasHeaderInsensitive,
  setupMcpFromConfig,
  loadMcpConfig,
  resolvePermissionPromptTool,
  parsePermissionDecision,
  makePermissionPromptConfirmer,
} from "../../src/runtime/mcp-config.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

// setupMcpFromConfig dynamically imports mcp-oauth to discover a stored bearer
// for url-based servers. A file-scoped mock returns a token so the injection
// guard can be exercised. Existing url tests all carry an explicit Authorization
// header (guard short-circuits → no import), so this mock doesn't perturb them.
vi.mock("../../src/lib/mcp-oauth.js", () => ({
  ensureValidToken: vi.fn(async () => "DISCOVERED_TOKEN"),
}));

// A minimal fake MCP client whose connect() returns a fixed tool inventory.
function fakeClient(toolsByServer = {}) {
  const calls = { connect: [], callTool: [], disconnectAll: 0, sessionId: [] };
  return {
    calls,
    sessionId: null,
    setSessionId(id) {
      this.sessionId = id;
      calls.sessionId.push(id);
    },
    async connect(name, config) {
      calls.connect.push({ name, config });
      const tools = toolsByServer[name];
      if (tools === "throw") throw new Error("connect boom");
      return { name, state: "connected", tools: tools || [] };
    },
    async callTool(server, tool, args) {
      calls.callTool.push({ server, tool, args });
      return { content: `${server}/${tool}:${JSON.stringify(args)}` };
    },
    async disconnectAll() {
      calls.disconnectAll++;
    },
  };
}

describe("parseMcpServers", () => {
  it("accepts the Claude-Code {mcpServers} shape", () => {
    const out = parseMcpServers({
      mcpServers: { weather: { command: "npx", args: ["-y", "w"] } },
    });
    expect(out.weather).toMatchObject({ command: "npx", args: ["-y", "w"] });
  });

  it("accepts the {servers} bundle shape and a bare map", () => {
    expect(parseMcpServers({ servers: { a: { url: "http://x" } } }).a).toEqual({
      command: undefined,
      args: [],
      env: {},
      url: "http://x",
      transport: undefined,
      headers: {},
    });
    expect(parseMcpServers({ b: { command: "c" } }).b.command).toBe("c");
  });

  it("skips non-object entries and defaults args/env/headers", () => {
    const out = parseMcpServers({
      mcpServers: { bad: 5, ok: { command: "x" } },
    });
    expect(out.bad).toBeUndefined();
    expect(out.ok).toEqual({
      command: "x",
      args: [],
      env: {},
      url: undefined,
      transport: undefined,
      headers: {},
    });
  });
});

describe("mcpToolName", () => {
  it("namespaces server + tool", () => {
    expect(mcpToolName("weather", "get")).toBe("mcp__weather__get");
  });
});

describe("setupMcpFromConfig", () => {
  it("builds tool defs + executor map from connected servers", async () => {
    const client = fakeClient({
      weather: [
        {
          name: "get",
          description: "get weather",
          inputSchema: { type: "object", properties: { city: {} } },
        },
      ],
    });
    const res = await setupMcpFromConfig(
      { weather: { command: "npx" } },
      { createClient: () => client },
    );

    expect(res.connected).toMatchObject([{ server: "weather", tools: 1 }]);
    expect(res.extraToolDefinitions).toHaveLength(1);
    expect(res.extraToolDefinitions[0].function).toMatchObject({
      name: "mcp__weather__get",
      description: "get weather",
      parameters: { type: "object", properties: { city: {} } },
    });
    expect(res.externalToolExecutors["mcp__weather__get"]).toEqual({
      kind: "mcp",
      serverName: "weather",
      toolName: "get",
    });
    expect(res.externalToolDescriptors["mcp__weather__get"]).toMatchObject({
      kind: "mcp",
      source: "weather",
    });
  });

  it("defaults parameters when a tool has no inputSchema", async () => {
    const client = fakeClient({ s: [{ name: "t" }] });
    const res = await setupMcpFromConfig(
      { s: { command: "x" } },
      { createClient: () => client },
    );
    expect(res.extraToolDefinitions[0].function.parameters).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("logs and skips a server that fails to connect (best-effort)", async () => {
    const client = fakeClient({ good: [{ name: "g" }], bad: "throw" });
    const errs = [];
    const res = await setupMcpFromConfig(
      { bad: { command: "x" }, good: { command: "y" } },
      { createClient: () => client, writeErr: (s) => errs.push(s) },
    );
    expect(errs.join("")).toMatch(/failed to connect "bad": connect boom/);
    expect(res.connected).toMatchObject([{ server: "good", tools: 1 }]);
    expect(res.extraToolDefinitions).toHaveLength(1);
  });

  it("appends a `cc mcp login` hint when a URL server fails with HTTP 401", async () => {
    // Explicit (stale) Authorization avoids the OAuth-discovery path so the
    // test is offline; the connect then throws the transport's HTTP 401.
    const client = {
      servers: { has: () => false },
      setSessionId() {},
      async connect() {
        throw new Error("HTTP 401: Unauthorized");
      },
      async disconnectAll() {},
    };
    const errs = [];
    await setupMcpFromConfig(
      {
        remote: {
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer stale" },
        },
      },
      { createClient: () => client, writeErr: (s) => errs.push(s) },
    );
    const out = errs.join("");
    expect(out).toMatch(/failed to connect "remote": HTTP 401/);
    expect(out).toMatch(/cc mcp login https:\/\/mcp\.example\.com\/sse/);
  });

  it("surfaces res.toolsError (connected but tools fetch failed) instead of a silent 0-tools, with auth hint on 401", async () => {
    const client = {
      servers: { has: () => false },
      setSessionId() {},
      async connect(name) {
        // Initialize OK, but tools/list failed with auth — mirrors mcp-client.
        return {
          name,
          state: "connected",
          tools: [],
          toolsError: "HTTP 401: Unauthorized",
        };
      },
      async disconnectAll() {},
    };
    const errs = [];
    const res = await setupMcpFromConfig(
      {
        remote: {
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer stale" },
        },
      },
      { createClient: () => client, writeErr: (s) => errs.push(s) },
    );
    const out = errs.join("");
    expect(out).toMatch(/"remote" connected but tools fetch failed: HTTP 401/);
    expect(out).toMatch(/cc mcp login https:\/\/mcp\.example\.com\/sse/);
    // Still recorded as connected (with 0 tools) — not dropped.
    expect(res.connected).toMatchObject([{ server: "remote", tools: 0 }]);
  });

  it("a non-auth toolsError is reported without a login hint", async () => {
    const client = {
      servers: { has: () => false },
      setSessionId() {},
      async connect(name) {
        return {
          name,
          state: "connected",
          tools: [],
          toolsError: "HTTP 500: internal error",
        };
      },
      async disconnectAll() {},
    };
    const errs = [];
    await setupMcpFromConfig(
      {
        remote: {
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer stale" },
        },
      },
      { createClient: () => client, writeErr: (s) => errs.push(s) },
    );
    const out = errs.join("");
    expect(out).toMatch(/connected but tools fetch failed: HTTP 500/);
    expect(out).not.toMatch(/cc mcp login/);
  });

  it("mcpAuthHint: returns a `cc mcp login` hint for HTTP 401/403/Unauthorized on a url server", () => {
    expect(mcpAuthHint("https://x/sse", "HTTP 401: Unauthorized")).toMatch(
      /cc mcp login https:\/\/x\/sse/,
    );
    expect(mcpAuthHint("https://x/sse", "HTTP 403: Forbidden")).toMatch(
      /cc mcp login/,
    );
    expect(mcpAuthHint("https://x/sse", "request was Unauthorized")).toMatch(
      /cc mcp login/,
    );
  });

  it("mcpAuthHint: returns null for non-auth errors, other HTTP codes, or stdio (no url)", () => {
    expect(mcpAuthHint("https://x/sse", "ECONNREFUSED")).toBeNull();
    expect(mcpAuthHint("https://x/sse", "HTTP 500: boom")).toBeNull();
    expect(mcpAuthHint("https://x/sse", "HTTP 404: not found")).toBeNull();
    expect(mcpAuthHint(undefined, "HTTP 401: Unauthorized")).toBeNull();
    expect(mcpAuthHint("", "Unauthorized")).toBeNull();
  });

  it("passes deps.sessionId to the client (stdio MCP identity env)", async () => {
    const client = fakeClient({ s: [{ name: "t" }] });
    await setupMcpFromConfig(
      { s: { command: "x" } },
      { createClient: () => client, sessionId: "sess-77" },
    );
    expect(client.sessionId).toBe("sess-77");
    expect(client.calls.sessionId).toEqual(["sess-77"]);
  });

  it("does not call setSessionId when no sessionId is given", async () => {
    const client = fakeClient({ s: [{ name: "t" }] });
    await setupMcpFromConfig(
      { s: { command: "x" } },
      { createClient: () => client },
    );
    expect(client.calls.sessionId).toEqual([]);
  });

  it("injects the discovered OAuth bearer for a url server with no auth header", async () => {
    const client = fakeClient({ remote: [{ name: "t" }] });
    await setupMcpFromConfig(
      { remote: { url: "https://mcp.example.com/sse" } },
      { createClient: () => client },
    );
    const { config } = client.calls.connect[0];
    expect(config.headers.Authorization).toBe("Bearer DISCOVERED_TOKEN");
  });

  it("does NOT inject (or duplicate) a bearer when the caller supplied an auth header in ANY casing", async () => {
    // Regression: the inject guard once only matched `.Authorization` /
    // `.authorization`. An all-caps `AUTHORIZATION` slipped past it, so our
    // stored token was added as a SECOND, conflicting header — leaking it where
    // the user explicitly pinned their own credential. The guard is now
    // case-insensitive: a caller header in any casing wins, untouched.
    const client = fakeClient({ remote: [{ name: "t" }] });
    await setupMcpFromConfig(
      {
        remote: {
          url: "https://mcp.example.com/sse",
          headers: { AUTHORIZATION: "Bearer mine" },
        },
      },
      { createClient: () => client },
    );
    const { config } = client.calls.connect[0];
    // Caller's header is preserved verbatim …
    expect(config.headers.AUTHORIZATION).toBe("Bearer mine");
    // … and no second canonical-cased header carrying our token was added.
    expect(config.headers.Authorization).toBeUndefined();
    const authHeaders = Object.keys(config.headers).filter(
      (k) => k.toLowerCase() === "authorization",
    );
    expect(authHeaders).toEqual(["AUTHORIZATION"]);
  });
});

describe("hasHeaderInsensitive", () => {
  it("matches a header name regardless of casing", () => {
    expect(hasHeaderInsensitive({ Authorization: "x" }, "authorization")).toBe(
      true,
    );
    expect(hasHeaderInsensitive({ AUTHORIZATION: "x" }, "Authorization")).toBe(
      true,
    );
    expect(hasHeaderInsensitive({ "content-type": "x" }, "CONTENT-TYPE")).toBe(
      true,
    );
  });

  it("returns false for an absent header or a non-object map", () => {
    expect(hasHeaderInsensitive({ "x-foo": "y" }, "Authorization")).toBe(false);
    expect(hasHeaderInsensitive(null, "Authorization")).toBe(false);
    expect(hasHeaderInsensitive(undefined, "Authorization")).toBe(false);
    expect(hasHeaderInsensitive("nope", "Authorization")).toBe(false);
  });
});

describe("loadMcpConfig", () => {
  it("throws on unreadable / invalid JSON", async () => {
    await expect(
      loadMcpConfig("x.json", {
        readFile: () => "{not json",
      }),
    ).rejects.toThrow(/cannot read\/parse/);
  });

  it("throws when no servers are present", async () => {
    await expect(
      loadMcpConfig("x.json", { readFile: () => JSON.stringify({}) }),
    ).rejects.toThrow(/no servers found/);
  });

  it("parses a file and connects via the injected client", async () => {
    const client = fakeClient({ weather: [{ name: "get" }] });
    const res = await loadMcpConfig("x.json", {
      readFile: () =>
        JSON.stringify({ mcpServers: { weather: { command: "npx" } } }),
      createClient: () => client,
    });
    expect(client.calls.connect[0].name).toBe("weather");
    expect(res.externalToolExecutors["mcp__weather__get"].serverName).toBe(
      "weather",
    );
  });
});

describe("runAgentHeadless — --mcp-config wiring", () => {
  const baseDeps = (over = {}) => {
    const out = [];
    const err = [];
    return {
      out,
      err,
      deps: {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => ({
          setSessionPolicy() {},
          setConfirmer() {},
          decide: async () => ({ decision: "allow", via: "t", policy: "t" }),
        }),
        writeOut: (s) => out.push(s),
        writeErr: (s) => err.push(s),
        sessionExists: () => false,
        startSession: () => {},
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendTokenUsage: () => {},
        getLastSessionId: () => null,
        ...over,
      },
    };
  };

  const fakeMcp = (mcpClient) => ({
    mcpClient,
    extraToolDefinitions: [
      {
        type: "function",
        function: {
          name: "mcp__weather__get",
          description: "d",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      },
    ],
    externalToolExecutors: {
      mcp__weather__get: {
        kind: "mcp",
        serverName: "weather",
        toolName: "get",
      },
    },
    externalToolDescriptors: {
      mcp__weather__get: {
        name: "mcp__weather__get",
        kind: "mcp",
        category: "mcp",
        source: "weather",
      },
    },
    connected: [{ server: "weather", tools: 1 }],
  });

  it("threads mcp wiring into the loop options and disconnects at the end", async () => {
    const captured = {};
    const client = fakeClient();
    const { deps } = baseDeps({
      loadMcpConfig: async () => fakeMcp(client),
      agentLoop: async function* (_messages, options) {
        captured.options = options;
        yield { type: "response-complete", content: "ok" };
        yield { type: "run-ended", reason: "complete" };
      },
      chatFn: vi.fn(),
    });
    await runAgentHeadless(
      { prompt: "weather?", mcpConfig: "x.json", sessionId: "s-w" },
      deps,
    );
    expect(captured.options.mcpClient).toBe(client);
    expect(captured.options.extraToolDefinitions[0].function.name).toBe(
      "mcp__weather__get",
    );
    expect(captured.options.externalToolExecutors.mcp__weather__get).toEqual({
      kind: "mcp",
      serverName: "weather",
      toolName: "get",
    });
    expect(client.calls.disconnectAll).toBe(1);
  });

  it("dispatches an mcp__server__tool call to mcpClient.callTool (real loop)", async () => {
    const client = fakeClient();
    let turn = 0;
    const chatFn = vi.fn(async () => {
      turn += 1;
      if (turn === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "mcp__weather__get",
                  arguments: JSON.stringify({ city: "NYC" }),
                },
              },
            ],
          },
        };
      }
      return { message: { role: "assistant", content: "It is sunny in NYC." } };
    });
    const { deps, out } = baseDeps({
      loadMcpConfig: async () => fakeMcp(client),
      chatFn,
    });

    const r = await runAgentHeadless(
      {
        prompt: "weather in NYC?",
        mcpConfig: "x.json",
        outputFormat: "stream-json",
        sessionId: "s-mcp",
        permissionMode: "bypassPermissions",
        expandFileRefs: false,
      },
      deps,
    );

    // The model's mcp tool call reached the MCP client.
    expect(client.calls.callTool).toEqual([
      { server: "weather", tool: "get", args: { city: "NYC" } },
    ]);
    expect(client.calls.disconnectAll).toBe(1);
    expect(r.exitCode).toBe(0);

    const events = out
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(
      events.some(
        (e) => e.type === "tool_use" && e.tool === "mcp__weather__get",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && !e.is_error)).toBe(
      true,
    );
    expect(events.at(-1)).toMatchObject({
      type: "result",
      result: "It is sunny in NYC.",
    });
  });

  it("fails fast when the config file is bad", async () => {
    const { deps, err } = baseDeps({
      loadMcpConfig: async () => {
        throw new Error('--mcp-config: no servers found in "x.json".');
      },
    });
    const r = await runAgentHeadless(
      { prompt: "hi", mcpConfig: "x.json", sessionId: "s-bad" },
      deps,
    );
    expect(r.exitCode).toBe(1);
    expect(err.join("")).toMatch(/no servers found/);
  });
});

describe("resolvePermissionPromptTool", () => {
  const mcp = {
    externalToolExecutors: {
      mcp__auth__approve: {
        kind: "mcp",
        serverName: "auth",
        toolName: "approve",
      },
    },
  };
  it("resolves a loaded mcp tool to {server, tool}", () => {
    expect(resolvePermissionPromptTool(mcp, "mcp__auth__approve")).toEqual({
      server: "auth",
      tool: "approve",
    });
  });
  it("throws when no mcp was loaded", () => {
    expect(() =>
      resolvePermissionPromptTool(null, "mcp__auth__approve"),
    ).toThrow(/requires --mcp-config/);
  });
  it("throws (listing available) when the tool is not loaded", () => {
    expect(() => resolvePermissionPromptTool(mcp, "mcp__auth__nope")).toThrow(
      /not found among loaded MCP tools\. Available: mcp__auth__approve/,
    );
  });
});

describe("parsePermissionDecision", () => {
  it("allows on JSON {behavior:'allow'} text content", () => {
    const r = parsePermissionDecision({
      content: [{ type: "text", text: '{"behavior":"allow","message":"ok"}' }],
    });
    expect(r).toMatchObject({ allow: true, reason: "ok" });
  });
  it("denies on {behavior:'deny'}", () => {
    expect(
      parsePermissionDecision({
        content: [{ type: "text", text: '{"behavior":"deny"}' }],
      }).allow,
    ).toBe(false);
  });
  it("reads a top-level {allow:true} object", () => {
    expect(parsePermissionDecision({ allow: true }).allow).toBe(true);
  });
  it("denies (fail-closed) on isError, empty, or unparseable", () => {
    expect(parsePermissionDecision({ isError: true }).allow).toBe(false);
    expect(parsePermissionDecision(null).allow).toBe(false);
    expect(
      parsePermissionDecision({ content: [{ type: "text", text: "maybe" }] })
        .allow,
    ).toBe(false);
  });
});

describe("makePermissionPromptConfirmer", () => {
  it("calls the MCP tool with {tool_name, input} and returns the verdict", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: '{"behavior":"allow"}' }],
    }));
    const confirm = makePermissionPromptConfirmer({
      mcpClient: { callTool },
      server: "auth",
      tool: "approve",
    });
    const ok = await confirm({ tool: "run_shell", args: { cmd: "ls" } });
    expect(ok).toBe(true);
    expect(callTool).toHaveBeenCalledWith("auth", "approve", {
      tool_name: "run_shell",
      input: { cmd: "ls" },
    });
  });
  it("denies on a deny verdict", async () => {
    const confirm = makePermissionPromptConfirmer({
      mcpClient: {
        callTool: async () => ({
          content: [{ type: "text", text: '{"behavior":"deny"}' }],
        }),
      },
      server: "auth",
      tool: "approve",
    });
    expect(await confirm({ tool: "x", args: {} })).toBe(false);
  });
  it("fails closed when the tool throws", async () => {
    const confirm = makePermissionPromptConfirmer({
      mcpClient: {
        callTool: async () => {
          throw new Error("server down");
        },
      },
      server: "auth",
      tool: "approve",
    });
    expect(await confirm({ tool: "x", args: {} })).toBe(false);
  });
});

describe("runAgentHeadless — --permission-prompt-tool wiring", () => {
  const fakeMcpWithApprove = (callTool) => ({
    mcpClient: { callTool, disconnectAll: async () => {} },
    extraToolDefinitions: [],
    externalToolExecutors: {
      mcp__auth__approve: {
        kind: "mcp",
        serverName: "auth",
        toolName: "approve",
      },
    },
    externalToolDescriptors: {},
    connected: [{ server: "auth", tools: 1 }],
  });

  // A gate that records the confirmer installed on it.
  const recordingGate = () => {
    const state = { confirmer: null };
    return {
      state,
      setSessionPolicy() {},
      setConfirmer(fn) {
        state.confirmer = fn;
      },
      decide: async () => ({ decision: "allow", via: "t", policy: "t" }),
    };
  };

  const deps = (over = {}) => {
    const err = [];
    return {
      err,
      d: {
        bootstrap: async () => ({ db: null }),
        writeOut: () => {},
        writeErr: (s) => err.push(s),
        sessionExists: () => false,
        startSession: () => {},
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendTokenUsage: () => {},
        getLastSessionId: () => null,
        agentLoop: async function* () {
          yield { type: "response-complete", content: "ok" };
          yield { type: "run-ended", reason: "complete" };
        },
        ...over,
      },
    };
  };

  it("installs an MCP-backed confirmer that routes approvals to the tool", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: '{"behavior":"allow"}' }],
    }));
    const gate = recordingGate();
    const { d } = deps({
      getApprovalGate: async () => gate,
      loadMcpConfig: async () => fakeMcpWithApprove(callTool),
    });
    await runAgentHeadless(
      {
        prompt: "hi",
        mcpConfig: "x.json",
        permissionPromptTool: "mcp__auth__approve",
        sessionId: "s-ppt",
      },
      d,
    );
    // The confirmer installed last is the MCP-backed one: invoking it hits the tool.
    expect(typeof gate.state.confirmer).toBe("function");
    const verdict = await gate.state.confirmer({ tool: "run_shell", args: {} });
    expect(verdict).toBe(true);
    expect(callTool).toHaveBeenCalledWith("auth", "approve", {
      tool_name: "run_shell",
      input: {},
    });
  });

  it("fails fast when the named tool was not loaded", async () => {
    const { d, err } = deps({
      getApprovalGate: async () => recordingGate(),
      loadMcpConfig: async () => fakeMcpWithApprove(vi.fn()),
    });
    const r = await runAgentHeadless(
      {
        prompt: "hi",
        mcpConfig: "x.json",
        permissionPromptTool: "mcp__auth__missing",
        sessionId: "s-ppt-bad",
      },
      d,
    );
    expect(r.exitCode).toBe(1);
    expect(err.join("")).toMatch(/not found among loaded MCP tools/);
  });
});

// ── Registered MCP servers (cc mcp add) → agent loop ────────────────────────

import {
  loadRegisteredMcp,
  resolveAgentMcp,
} from "../../src/runtime/mcp-config.js";

// A fake MCP client that tracks connected servers (so skip-existing works) and
// returns one tool per server.
function regClient() {
  const servers = new Map();
  return {
    servers,
    async connect(name, cfg) {
      servers.set(name, cfg);
      return { tools: [{ name: "t", description: `tool on ${name}` }] };
    },
    async callTool() {
      return {};
    },
    async disconnectAll() {},
  };
}

describe("loadRegisteredMcp", () => {
  it("returns null without a db", async () => {
    expect(await loadRegisteredMcp(null)).toBeNull();
  });

  it("connects auto-connect servers and builds the channels", async () => {
    const client = regClient();
    const res = await loadRegisteredMcp(
      {},
      {
        createClient: () => client,
        makeServerConfig: () => ({
          getAutoConnect: () => [
            { name: "weather", command: "x", args: [], env: {} },
          ],
          list: () => [],
        }),
      },
    );
    expect(res.connected).toMatchObject([{ server: "weather", tools: 1 }]);
    expect(res.externalToolExecutors["mcp__weather__t"]).toMatchObject({
      kind: "mcp",
      serverName: "weather",
    });
  });

  it("uses list() (all servers) when all:true", async () => {
    let used = null;
    await loadRegisteredMcp(
      {},
      {
        all: true,
        createClient: () => regClient(),
        makeServerConfig: () => ({
          list: () => {
            used = "list";
            return [];
          },
          getAutoConnect: () => {
            used = "auto";
            return [];
          },
        }),
      },
    );
    expect(used).toBe("list");
  });

  it("returns null when no servers are registered", async () => {
    const res = await loadRegisteredMcp(
      {},
      { makeServerConfig: () => ({ getAutoConnect: () => [] }) },
    );
    expect(res).toBeNull();
  });
});

describe("resolveAgentMcp", () => {
  const fileDeps = (servers) => ({
    readFile: () => JSON.stringify({ mcpServers: servers }),
  });

  it("merges --mcp-config + registered into ONE client", async () => {
    const client = regClient();
    const res = await resolveAgentMcp(
      { mcpConfigPath: "x.json", db: {}, includeRegistered: true },
      {
        ...fileDeps({ adhoc: { command: "c" } }),
        createClient: () => client,
        makeServerConfig: () => ({
          getAutoConnect: () => [
            { name: "reg", command: "r", args: [], env: {} },
          ],
        }),
      },
    );
    expect(res.mcpClient).toBe(client);
    expect(res.connected.map((c) => c.server).sort()).toEqual(["adhoc", "reg"]);
    expect(res.extraToolDefinitions).toHaveLength(2);
  });

  it("forwards args.sessionId down to the client (stdio MCP identity env)", async () => {
    const client = fakeClient({ adhoc: [{ name: "t" }] });
    await resolveAgentMcp(
      { mcpConfigPath: "x.json", sessionId: "sess-99" },
      { ...fileDeps({ adhoc: { command: "c" } }), createClient: () => client },
    );
    expect(client.calls.sessionId).toEqual(["sess-99"]);
  });

  it("ad-hoc name wins over a registered clash (skip-existing)", async () => {
    const client = regClient();
    const res = await resolveAgentMcp(
      { mcpConfigPath: "x.json", db: {} },
      {
        ...fileDeps({ dup: { command: "adhoc" } }),
        createClient: () => client,
        makeServerConfig: () => ({
          getAutoConnect: () => [
            { name: "dup", command: "reg", args: [], env: {} },
          ],
        }),
      },
    );
    expect(res.connected).toMatchObject([{ server: "dup", tools: 1 }]); // connected once
    expect(client.servers.get("dup").command).toBe("adhoc");
  });

  it("includeRegistered:false skips the registry (file only)", async () => {
    const res = await resolveAgentMcp(
      { db: {}, includeRegistered: false },
      {
        makeServerConfig: () => ({
          getAutoConnect: () => [{ name: "reg", command: "r" }],
        }),
      },
    );
    expect(res).toBeNull();
  });

  it("still fail-fasts on a bad --mcp-config file", async () => {
    await expect(
      resolveAgentMcp(
        { mcpConfigPath: "x.json", db: {} },
        { readFile: () => "{bad" },
      ),
    ).rejects.toThrow(/cannot read\/parse/);
  });
});
