/**
 * MCP tool search — real agent-loop integration (headless).
 *
 * Forces deferral via CC_TOOL_SEARCH=1 and drives runAgentHeadless with a
 * scripted chatFn:
 *   1. the tools array the LLM sees carries [deferred] stubs + tool_search,
 *      and stays REFERENCE-STABLE across turns (prompt-cache friendliness);
 *   2. a tool_search call returns the full schema in the tool RESULT and the
 *      subsequent mcp__ call is dispatched to mcpClient.callTool;
 *   3. a direct call to an unloaded deferred tool self-heals: first call gets
 *      a schema-embedding error (no server round-trip), the retry goes through.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

const bigSchema = () => {
  const properties = {};
  for (let i = 0; i < 30; i++) {
    properties[`f${i}`] = { type: "string", description: `field ${i} docs` };
  }
  return { type: "object", properties, required: ["f0"] };
};

const fakeMcp = (client) => ({
  mcpClient: client,
  extraToolDefinitions: [
    {
      type: "function",
      function: {
        name: "mcp__weather__get",
        description: "Get the weather forecast.\nDetails on units etc.",
        parameters: bigSchema(),
      },
    },
  ],
  externalToolExecutors: {
    mcp__weather__get: { kind: "mcp", serverName: "weather", toolName: "get" },
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
  instructionsByServer: { weather: "Always pass ISO city codes." },
});

const fakeClient = () => {
  const calls = { callTool: [], disconnectAll: 0 };
  return {
    calls,
    setSessionId() {},
    async callTool(server, tool, args) {
      calls.callTool.push({ server, tool, args });
      return { content: "sunny" };
    },
    async disconnectAll() {
      calls.disconnectAll++;
    },
  };
};

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

const toolCall = (id, name, args) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

describe("runAgentHeadless — MCP tool search integration", () => {
  let envBefore;
  beforeEach(() => {
    envBefore = process.env.CC_TOOL_SEARCH;
    process.env.CC_TOOL_SEARCH = "1"; // force deferral for the tiny fixture
  });
  afterEach(() => {
    if (envBefore === undefined) delete process.env.CC_TOOL_SEARCH;
    else process.env.CC_TOOL_SEARCH = envBefore;
  });

  it("search-then-call: stubs + tool_search visible, schema in tool result, dispatch works", async () => {
    const client = fakeClient();
    const seenTools = [];
    let turn = 0;
    const chatFn = vi.fn(async (_messages, options) => {
      seenTools.push(options.extraToolDefinitions);
      turn += 1;
      if (turn === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              toolCall("c1", "tool_search", {
                query: "select:mcp__weather__get",
              }),
            ],
          },
        };
      }
      if (turn === 2) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [toolCall("c2", "mcp__weather__get", { f0: "NYC" })],
          },
        };
      }
      return { message: { role: "assistant", content: "Sunny." } };
    });
    const { deps, out } = baseDeps({
      loadMcpConfig: async () => fakeMcp(client),
      chatFn,
    });

    const r = await runAgentHeadless(
      {
        prompt: "weather?",
        mcpConfig: "x.json",
        outputFormat: "stream-json",
        sessionId: "s-ts1",
        permissionMode: "bypassPermissions",
        expandFileRefs: false,
      },
      deps,
    );
    expect(r.exitCode).toBe(0);
    // (the "tool search active" stderr announce is text-format only — this run
    // is stream-json, so deferral is proven by the stub assertions below)

    // The LLM sees the STUB (no big schema) plus tool_search.
    const defs1 = seenTools[0];
    const stub = defs1.find((d) => d.function.name === "mcp__weather__get");
    expect(stub.function.description).toMatch(/^\[deferred\]/);
    expect(stub.function.parameters.properties).toEqual({});
    expect(defs1.some((d) => d.function.name === "tool_search")).toBe(true);

    // Prompt-cache friendliness: the tools array reference (and contents) do
    // not change across turns — the loaded schema travels in the tool result.
    expect(seenTools[1]).toBe(seenTools[0]);
    expect(JSON.stringify(seenTools[1])).toBe(JSON.stringify(defs1));

    // tool_search result carried the full schema + server instructions.
    const events = out
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const searchResult = events.find(
      (e) => e.type === "tool_result" && e.tool === "tool_search",
    );
    expect(searchResult).toBeTruthy();
    const payload =
      typeof searchResult.result === "string"
        ? JSON.parse(searchResult.result)
        : searchResult.result;
    expect(payload.tools[0].parameters.required).toEqual(["f0"]);
    expect(payload.tools[0].serverInstructions).toMatch(/ISO city codes/);

    // The follow-up mcp call reached the client with the model's args.
    expect(client.calls.callTool).toEqual([
      { server: "weather", tool: "get", args: { f0: "NYC" } },
    ]);
  });

  it("direct call before search self-heals: schema error first, retry dispatches", async () => {
    const client = fakeClient();
    let turn = 0;
    const chatFn = vi.fn(async () => {
      turn += 1;
      if (turn <= 2) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              toolCall(`c${turn}`, "mcp__weather__get", { f0: "SFO" }),
            ],
          },
        };
      }
      return { message: { role: "assistant", content: "Done." } };
    });
    const { deps, out } = baseDeps({
      loadMcpConfig: async () => fakeMcp(client),
      chatFn,
    });

    const r = await runAgentHeadless(
      {
        prompt: "weather?",
        mcpConfig: "x.json",
        outputFormat: "stream-json",
        sessionId: "s-ts2",
        permissionMode: "bypassPermissions",
        expandFileRefs: false,
      },
      deps,
    );
    expect(r.exitCode).toBe(0);

    const events = out
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const results = events.filter(
      (e) => e.type === "tool_result" && e.tool === "mcp__weather__get",
    );
    expect(results.length).toBe(2);
    const first =
      typeof results[0].result === "string"
        ? JSON.parse(results[0].result)
        : results[0].result;
    expect(first.error).toMatch(/deferred MCP tool/);
    expect(first.schema.required).toEqual(["f0"]);

    // Only the RETRY reached the server — the gated call never left the CLI.
    expect(client.calls.callTool).toEqual([
      { server: "weather", tool: "get", args: { f0: "SFO" } },
    ]);
  });

  it("CC_TOOL_SEARCH=0 keeps the legacy full-schema path byte-identical", async () => {
    process.env.CC_TOOL_SEARCH = "0";
    const client = fakeClient();
    const seenTools = [];
    let turn = 0;
    const chatFn = vi.fn(async (_messages, options) => {
      seenTools.push(options.extraToolDefinitions);
      turn += 1;
      if (turn === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [toolCall("c1", "mcp__weather__get", { f0: "NYC" })],
          },
        };
      }
      return { message: { role: "assistant", content: "ok" } };
    });
    const { deps } = baseDeps({
      loadMcpConfig: async () => fakeMcp(client),
      chatFn,
    });
    await runAgentHeadless(
      {
        prompt: "weather?",
        mcpConfig: "x.json",
        sessionId: "s-ts3",
        permissionMode: "bypassPermissions",
        expandFileRefs: false,
      },
      deps,
    );
    const def = seenTools[0].find(
      (d) => d.function.name === "mcp__weather__get",
    );
    expect(def.function.description).not.toMatch(/\[deferred\]/);
    expect(def.function.parameters.required).toEqual(["f0"]);
    expect(seenTools[0].some((d) => d.function.name === "tool_search")).toBe(
      false,
    );
    expect(client.calls.callTool).toEqual([
      { server: "weather", tool: "get", args: { f0: "NYC" } },
    ]);
  });
});
