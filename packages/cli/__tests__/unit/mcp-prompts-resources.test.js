/**
 * MCP prompts + resource exposure (Claude-Code parity).
 *
 *   1. MCPClient       — listResources / listPrompts accessors + getPrompt
 *                        (prompts/get) request shape.
 *   2. mcp-config.js   — setupMcpFromConfig collects a server's resources +
 *                        prompts and registers the generic list/read resource
 *                        tools (once, only when a resource exists).
 *   3. agent loop      — a model `list_mcp_resources` / `read_mcp_resource`
 *                        call is dispatched to the MCP client (real loop).
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
});

// ─── 2. mcp-config — collect resources/prompts + register resource tools ─────

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
    async readResource(server, uri) {
      return { contents: [{ uri, text: `read:${server}:${uri}` }] };
    },
    async callTool() {
      return {};
    },
    async disconnectAll() {},
  };
}

describe("setupMcpFromConfig — resources + prompts", () => {
  it("collects resources + prompts and registers the generic resource tools", async () => {
    const client = fakeClient({
      docs: {
        resources: [{ uri: "file:///a.md", name: "A" }],
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
    expect(res.prompts).toEqual([
      { name: "summarize", description: "d", server: "docs" },
    ]);

    const toolNames = res.extraToolDefinitions.map((d) => d.function.name);
    expect(toolNames).toContain("list_mcp_resources");
    expect(toolNames).toContain("read_mcp_resource");
    expect(res.externalToolExecutors.list_mcp_resources).toEqual({
      kind: "mcp-resource",
      op: "list",
    });
    expect(res.externalToolExecutors.read_mcp_resource).toEqual({
      kind: "mcp-resource",
      op: "read",
    });
  });

  it("does NOT register resource tools when no server exposes a resource", async () => {
    const client = fakeClient({ tool: { tools: [{ name: "t" }] } });
    const res = await setupMcpFromConfig(
      { tool: { command: "x" } },
      { createClient: () => client },
    );
    expect(res.externalToolExecutors.read_mcp_resource).toBeUndefined();
    expect(res.resources).toEqual([]);
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

  it("dispatches list_mcp_resources + read_mcp_resource to the MCP client", async () => {
    const client = fakeClient({
      docs: { resources: [{ uri: "file:///a.md", name: "A" }] },
    });
    const readSpy = vi.spyOn(client, "readResource");
    const wiring = await setupMcpFromConfig(
      { docs: { command: "x" } },
      { createClient: () => client },
    );

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
                id: "c2",
                type: "function",
                function: {
                  name: "read_mcp_resource",
                  arguments: JSON.stringify({ uri: "file:///a.md" }),
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
    // read_mcp_resource auto-resolved the owning server from the uri.
    expect(readSpy).toHaveBeenCalledWith("docs", "file:///a.md");

    const events = out
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
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
  });
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
