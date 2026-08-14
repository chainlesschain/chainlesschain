/**
 * MCP prompts + resource/template exposure (Claude-Code parity).
 *
 *   1. MCPClient       — listResources / listPrompts accessors + getPrompt
 *                        (prompts/get) request shape.
 *   2. mcp-config.js   — setupMcpFromConfig collects resources, resource
 *                        templates, and prompts and registers the generic
 *                        read-only resource tools once.
 *   3. agent loop      — model resource/template list + resource read calls
 *                        are dispatched to the MCP client (real loop).
 *   4. repl/mcp-prompt — parse `/mcp__server__prompt`, render prompt messages,
 *                        expand via the client, render the `/mcp` overview.
 */

import { describe, it, expect, vi } from "vitest";
import { MCPClient, ServerState } from "../../src/harness/mcp-client.js";
import {
  setupMcpFromConfig,
  registerMcpResourceTools,
} from "../../src/runtime/mcp-config.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  parseMcpPromptCommand,
  renderPromptMessages,
  expandMcpPrompt,
  renderMcpSurface,
} from "../../src/repl/mcp-prompt.js";

// ─── 1. MCPClient accessors + getPrompt ──────────────────────────────────────

describe("MCPClient — resources + prompts", () => {
  function seeded() {
    const client = new MCPClient();
    client.servers.set("docs", {
      state: ServerState.CONNECTED,
      tools: [],
      resources: [{ uri: "file:///a.md", name: "A" }],
      prompts: [{ name: "summarize", description: "Summarize text" }],
    });
    client.servers.set("auth", {
      state: ServerState.CONNECTED,
      tools: [],
      resources: [{ uri: "auth://policy", name: "Policy" }],
      prompts: [],
    });
    return client;
  }

  it("listResources annotates each resource with its server", () => {
    const all = seeded().listResources();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.uri === "file:///a.md").server).toBe("docs");
  });

  it("listResources filters by server", () => {
    const r = seeded().listResources("auth");
    expect(r).toEqual([
      { uri: "auth://policy", name: "Policy", server: "auth" },
    ]);
  });

  it("listPrompts annotates + filters by server", () => {
    const client = seeded();
    expect(client.listPrompts()).toHaveLength(1);
    expect(client.listPrompts("docs")[0]).toMatchObject({
      name: "summarize",
      server: "docs",
    });
    expect(client.listPrompts("auth")).toHaveLength(0);
  });

  it("listResources/listPrompts throw for an unknown server", () => {
    expect(() => seeded().listResources("nope")).toThrow("not found");
    expect(() => seeded().listPrompts("nope")).toThrow("not found");
  });

  it("getPrompt sends prompts/get with name + arguments", async () => {
    const client = seeded();
    client._sendRequest = vi.fn(async (server, method, params) => {
      expect(server).toBe("docs");
      expect(method).toBe("prompts/get");
      expect(params).toEqual({
        name: "summarize",
        arguments: { len: "short" },
      });
      return {
        messages: [{ role: "user", content: { type: "text", text: "ok" } }],
      };
    });
    const res = await client.getPrompt("docs", "summarize", { len: "short" });
    expect(res.messages[0].content.text).toBe("ok");
  });

  it("getPrompt rejects when the server is not connected", async () => {
    const client = new MCPClient();
    client.servers.set("docs", { state: ServerState.CONNECTING });
    await expect(client.getPrompt("docs", "x")).rejects.toThrow(
      "not connected",
    );
  });

  it("suppresses peer-controlled HTTP status detail at the resource tool boundary", async () => {
    const canary = "RESOURCE_HTTP_BODY_SECRET_CANARY";
    const readResource = vi.fn(async () => {
      const error = new Error(`HTTP 500: ${canary}`);
      error.code = "CC_MCP_HTTP_STATUS";
      error.status = 500;
      throw error;
    });

    const result = await executeTool(
      "read_mcp_resource",
      { server: "docs", uri: "file:///a.md" },
      {
        mcpClient: { readResource },
        externalToolDescriptors: {
          read_mcp_resource: {
            name: "read_mcp_resource",
            kind: "mcp-resource",
            category: "mcp",
          },
        },
        externalToolExecutors: {
          read_mcp_resource: { kind: "mcp-resource", op: "read" },
        },
      },
    );

    expect(readResource).toHaveBeenCalledWith("docs", "file:///a.md");
    expect(result.error).toBe(
      "MCP resource access failed: MCP HTTP request failed with status 500",
    );
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});

// ─── 2. mcp-config — collect resources/templates/prompts + register tools ────

function fakeClient(byServer) {
  return {
    servers: new Map(),
    async connect(name) {
      this.servers.set(name, {});
      const s = byServer[name] || {};
      return {
        name,
        state: "connected",
        tools: s.tools || [],
        resources: s.resources || [],
        resourceTemplates: s.resourceTemplates || [],
        prompts: s.prompts || [],
      };
    },
    listResources(server) {
      const all = [];
      for (const [n, s] of Object.entries(byServer)) {
        for (const r of s.resources || []) all.push({ ...r, server: n });
      }
      return server ? all.filter((r) => r.server === server) : all;
    },
    listResourceTemplates(server) {
      const all = [];
      for (const [n, s] of Object.entries(byServer)) {
        for (const template of s.resourceTemplates || []) {
          all.push({ ...template, server: n });
        }
      }
      return server
        ? all.filter((template) => template.server === server)
        : all;
    },
    async readResource(server, uri) {
      return { contents: [{ uri, text: `read:${server}:${uri}` }] };
    },
    async callTool() {
      return {};
    },
    async disconnectAll() {},
  };
}

describe("setupMcpFromConfig — resources + templates + prompts", () => {
  it("collects resources/templates/prompts and registers generic resource tools", async () => {
    const client = fakeClient({
      docs: {
        resources: [{ uri: "file:///a.md", name: "A" }],
        resourceTemplates: [
          {
            uriTemplate: "file:///{path}",
            name: "Workspace file",
            description: "Read one workspace file",
          },
        ],
        prompts: [{ name: "summarize", description: "d" }],
      },
    });
    const res = await setupMcpFromConfig(
      { docs: { command: "x" } },
      { createClient: () => client },
    );

    expect(res.resources).toEqual([
      { uri: "file:///a.md", name: "A", server: "docs" },
    ]);
    expect(res.resourceTemplates).toEqual([
      {
        uriTemplate: "file:///{path}",
        name: "Workspace file",
        description: "Read one workspace file",
        server: "docs",
      },
    ]);
    expect(res.prompts).toEqual([
      { name: "summarize", description: "d", server: "docs" },
    ]);

    const toolNames = res.extraToolDefinitions.map((d) => d.function.name);
    expect(toolNames).toContain("list_mcp_resources");
    expect(toolNames).toContain("list_mcp_resource_templates");
    expect(toolNames).toContain("read_mcp_resource");
    expect(res.externalToolExecutors.list_mcp_resources).toEqual({
      kind: "mcp-resource",
      op: "list",
    });
    expect(res.externalToolExecutors.read_mcp_resource).toEqual({
      kind: "mcp-resource",
      op: "read",
    });
    expect(res.externalToolExecutors.list_mcp_resource_templates).toEqual({
      kind: "mcp-resource",
      op: "list-templates",
    });
    expect(
      res.externalToolDescriptors.list_mcp_resource_templates,
    ).toMatchObject({
      isReadOnly: true,
      riskLevel: "low",
      effectContract: {
        declaredEffect: "read",
        authorizedEffect: "read",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    });
  });

  it("does NOT register resource tools when no server exposes a resource or template", async () => {
    const client = fakeClient({ tool: { tools: [{ name: "t" }] } });
    const res = await setupMcpFromConfig(
      { tool: { command: "x" } },
      { createClient: () => client },
    );
    expect(res.externalToolExecutors.read_mcp_resource).toBeUndefined();
    expect(
      res.externalToolExecutors.list_mcp_resource_templates,
    ).toBeUndefined();
    expect(res.resources).toEqual([]);
    expect(res.resourceTemplates).toEqual([]);
  });

  it("registers list/read/template tools for a templates-only server", async () => {
    const client = fakeClient({
      catalog: {
        resourceTemplates: [
          { uriTemplate: "catalog://items/{id}", name: "Catalog item" },
        ],
      },
    });
    const res = await setupMcpFromConfig(
      { catalog: { command: "x" } },
      { createClient: () => client },
    );

    expect(res.resources).toEqual([]);
    expect(res.resourceTemplates).toEqual([
      {
        uriTemplate: "catalog://items/{id}",
        name: "Catalog item",
        server: "catalog",
      },
    ]);
    expect(Object.keys(res.externalToolExecutors)).toEqual(
      expect.arrayContaining([
        "list_mcp_resources",
        "list_mcp_resource_templates",
        "read_mcp_resource",
      ]),
    );
  });

  it("keeps the template tool idempotent across accumulating server batches", async () => {
    const client = fakeClient({
      docs: {
        resourceTemplates: [{ uriTemplate: "docs://{slug}", name: "Document" }],
      },
      catalog: {
        resourceTemplates: [
          { uriTemplate: "catalog://{id}", name: "Catalog item" },
        ],
      },
    });
    const first = await setupMcpFromConfig(
      { docs: { command: "x" } },
      { createClient: () => client },
    );
    const accumulated = await setupMcpFromConfig(
      { catalog: { command: "x" } },
      { into: first },
    );

    expect(accumulated.resourceTemplates).toHaveLength(2);
    expect(
      accumulated.extraToolDefinitions.filter(
        (definition) =>
          definition.function.name === "list_mcp_resource_templates",
      ),
    ).toHaveLength(1);
  });

  it("back-fills templates on a legacy accumulating wiring object", async () => {
    const client = fakeClient({
      docs: {
        resourceTemplates: [{ uriTemplate: "docs://{slug}", name: "Document" }],
      },
    });
    const legacyInto = {
      mcpClient: client,
      extraToolDefinitions: [],
      externalToolExecutors: {},
      externalToolDescriptors: {},
      connected: [],
      resources: [],
      prompts: [],
    };

    const accumulated = await setupMcpFromConfig(
      { docs: { command: "x" } },
      { into: legacyInto },
    );

    expect(accumulated).toBe(legacyInto);
    expect(accumulated.resourceTemplates).toEqual([
      {
        uriTemplate: "docs://{slug}",
        name: "Document",
        server: "docs",
      },
    ]);
    expect(
      accumulated.externalToolExecutors.list_mcp_resource_templates,
    ).toEqual({ kind: "mcp-resource", op: "list-templates" });
  });

  it("registerMcpResourceTools is idempotent across accumulating batches", () => {
    const result = {
      extraToolDefinitions: [],
      externalToolExecutors: {},
      externalToolDescriptors: {},
    };
    registerMcpResourceTools(result);
    registerMcpResourceTools(result);
    expect(result.extraToolDefinitions).toHaveLength(2);
  });
});

// ─── 3. agent loop dispatch of the resource tools ────────────────────────────

describe("agent loop — MCP resource tools", () => {
  const baseDeps = (over = {}) => {
    const out = [];
    return {
      out,
      deps: {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => ({
          setSessionPolicy() {},
          setConfirmer() {},
          decide: async () => ({ decision: "allow", via: "t", policy: "t" }),
        }),
        writeOut: (s) => out.push(s),
        writeErr: () => {},
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

  it("dispatches template/list/read resource tools to the MCP client", async () => {
    const client = fakeClient({
      docs: {
        resourceTemplates: [
          { uriTemplate: "file:///{path}", name: "Workspace file" },
        ],
      },
    });
    const readSpy = vi.spyOn(client, "readResource");
    const templateSpy = vi.spyOn(client, "listResourceTemplates");
    const wiring = await setupMcpFromConfig(
      { docs: { command: "x" } },
      { createClient: () => client },
    );

    const modelInputs = [];
    let turn = 0;
    const chatFn = vi.fn(async (messages) => {
      modelInputs.push(JSON.stringify(messages));
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
                  name: "list_mcp_resource_templates",
                  arguments: JSON.stringify({ server: "docs" }),
                },
              },
              {
                id: "c2",
                type: "function",
                function: { name: "list_mcp_resources", arguments: "{}" },
              },
            ],
          },
        };
      }
      if (turn === 2) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "c3",
                type: "function",
                function: {
                  name: "read_mcp_resource",
                  arguments: JSON.stringify({
                    server: "docs",
                    uri: "file:///guide.md",
                  }),
                },
              },
            ],
          },
        };
      }
      return { message: { role: "assistant", content: "done" } };
    });

    const { deps, out } = baseDeps({
      loadMcpConfig: async () => wiring,
      chatFn,
    });

    const r = await runAgentHeadless(
      {
        prompt: "read the docs",
        mcpConfig: "x.json",
        outputFormat: "stream-json",
        sessionId: "s-res",
        permissionMode: "bypassPermissions",
        expandFileRefs: false,
      },
      deps,
    );

    expect(r.exitCode).toBe(0);
    // The model instantiated file:///{path} and kept the owning server explicit.
    expect(readSpy).toHaveBeenCalledWith("docs", "file:///guide.md");
    expect(templateSpy).toHaveBeenCalledOnce();
    expect(templateSpy).toHaveBeenCalledWith("docs");
    expect(modelInputs.join("\n")).toContain("file:///{path}");
    expect(modelInputs.join("\n")).toContain("Workspace file");

    const events = out
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(
      events.some(
        (e) =>
          e.type === "tool_use" && e.tool === "list_mcp_resource_templates",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "tool_use" && e.tool === "list_mcp_resources",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "tool_use" && e.tool === "read_mcp_resource",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && e.is_error)).toBe(
      false,
    );
  }, 30_000);

  it.each([
    {
      label: "HTTP error body",
      canary: "MODEL_SESSION_HTTP_BODY_SECRET_CANARY",
      makeError(canary) {
        const error = new Error(`HTTP 503: ${canary}`);
        error.code = "CC_MCP_HTTP_STATUS";
        error.status = 503;
        return error;
      },
      expected: "MCP HTTP request failed with status 503",
    },
    {
      label: "JSON-RPC message/data",
      canary: "MODEL_SESSION_RPC_ERROR_SECRET_CANARY",
      makeError(canary) {
        const error = new Error(`not connected HTTP 503: ${canary}`);
        error.name = "McpRpcError";
        error.code = -32000;
        error.rpcCode = -32000;
        error.mcpErrorCode = "CC_MCP_RPC_ERROR";
        error.data = { secret: canary };
        return error;
      },
      expected: "MCP server returned a JSON-RPC error (code -32000)",
    },
  ])(
    "keeps $label out of the resource tool event and next model turn",
    async ({ canary, makeError, expected }) => {
      const client = fakeClient({
        docs: { resources: [{ uri: "file:///private.md", name: "Private" }] },
      });
      client.readResource = vi.fn(async () => {
        throw makeError(canary);
      });
      const wiring = await setupMcpFromConfig(
        { docs: { command: "x" } },
        { createClient: () => client },
      );

      const modelInputs = [];
      let turn = 0;
      const chatFn = vi.fn(async (messages) => {
        modelInputs.push(JSON.stringify(messages));
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "c-resource-error",
                  type: "function",
                  function: {
                    name: "read_mcp_resource",
                    arguments: JSON.stringify({
                      server: "docs",
                      uri: "file:///private.md",
                    }),
                  },
                },
              ],
            },
          };
        }
        return { message: { role: "assistant", content: "done" } };
      });
      const persisted = [];
      const { deps, out } = baseDeps({
        loadMcpConfig: async () => wiring,
        chatFn,
        appendAssistantMessage: (...args) => persisted.push(args),
        appendToolCallCompact: (...args) => persisted.push(args),
        appendTokenUsage: (...args) => persisted.push(args),
      });

      const result = await runAgentHeadless(
        {
          prompt: "read private docs",
          mcpConfig: "x.json",
          outputFormat: "stream-json",
          sessionId: "s-resource-error",
          permissionMode: "bypassPermissions",
          expandFileRefs: false,
        },
        deps,
      );

      expect(result.exitCode).toBe(0);
      expect(chatFn).toHaveBeenCalledTimes(2);
      expect(client.readResource).toHaveBeenCalledOnce();
      const exposed = [
        out.join(""),
        ...modelInputs,
        JSON.stringify(persisted),
      ].join("\n");
      expect(exposed).toContain(expected);
      expect(exposed).not.toContain(canary);
    },
    15_000,
  );
});

// ─── 4. repl/mcp-prompt pure helpers ─────────────────────────────────────────

describe("parseMcpPromptCommand", () => {
  it("parses server + prompt + JSON args", () => {
    expect(
      parseMcpPromptCommand('/mcp__docs__summarize {"len":"short"}'),
    ).toEqual({ server: "docs", name: "summarize", args: { len: "short" } });
  });

  it("treats a non-JSON tail as { input }", () => {
    expect(parseMcpPromptCommand("/mcp__docs__greet hello there")).toEqual({
      server: "docs",
      name: "greet",
      args: { input: "hello there" },
    });
  });

  it("keeps __ inside the prompt name (server is the first segment)", () => {
    expect(parseMcpPromptCommand("/mcp__docs__deep__dive")).toMatchObject({
      server: "docs",
      name: "deep__dive",
    });
  });

  it("returns null for non-mcp lines", () => {
    expect(parseMcpPromptCommand("/plan show")).toBeNull();
    expect(parseMcpPromptCommand("hello")).toBeNull();
    expect(parseMcpPromptCommand("/mcp__onlyserver")).toBeNull();
  });
});

describe("renderPromptMessages", () => {
  it("flattens text + embedded text-resource blocks", () => {
    const text = renderPromptMessages({
      messages: [
        { role: "user", content: { type: "text", text: "line1" } },
        {
          role: "user",
          content: [
            { type: "text", text: "line2" },
            { type: "resource", resource: { text: "line3" } },
            { type: "image", data: "..." },
          ],
        },
      ],
    });
    expect(text).toBe("line1\n\nline2\n\nline3");
  });
});

describe("expandMcpPrompt", () => {
  it("calls getPrompt and returns rendered text", async () => {
    const mcpClient = {
      getPrompt: vi.fn(async () => ({
        messages: [{ role: "user", content: { type: "text", text: "X" } }],
      })),
    };
    const text = await expandMcpPrompt("/mcp__docs__greet {}", mcpClient);
    expect(text).toBe("X");
    expect(mcpClient.getPrompt).toHaveBeenCalledWith("docs", "greet", {});
  });

  it("returns null for a non-mcp line (falls through unchanged)", async () => {
    expect(await expandMcpPrompt("/plan", {})).toBeNull();
  });

  it("throws when no client is connected", async () => {
    await expect(expandMcpPrompt("/mcp__docs__greet", null)).rejects.toThrow(
      "No MCP servers",
    );
  });
});

describe("renderMcpSurface", () => {
  it("lists resources + prompts from the client", () => {
    const mcpClient = {
      listResources: () => [{ uri: "file:///a", name: "A", server: "docs" }],
      listPrompts: () => [{ name: "greet", description: "d", server: "docs" }],
    };
    const txt = renderMcpSurface(mcpClient);
    expect(txt).toContain("MCP resources (1)");
    expect(txt).toContain("file:///a [docs]");
    expect(txt).toContain("/mcp__docs__greet");
  });

  it("reports nothing connected with no client", () => {
    expect(renderMcpSurface(null)).toMatch(/No MCP servers/);
  });
});
