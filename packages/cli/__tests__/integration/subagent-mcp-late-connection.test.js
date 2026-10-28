import "../helpers/test-model-egress.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { setupMcpFromConfig } from "../../src/runtime/mcp-config.js";
import { maybeApplyToolSearch } from "../../src/runtime/mcp-tool-search.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";
import { MCPClient } from "../../src/harness/mcp-client.js";
import { McpLifecycleAuthority } from "../../src/lib/mcp-lifecycle-authority.js";
import { createMcpCallLedger } from "../../src/lib/mcp-call-ledger.js";

let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-late-child-mcp-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reply(name, args, id) {
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
    usage: {},
  };
}

async function lateChild({
  fresh = false,
  parentNames = null,
  childTools = null,
  childServer = "weather",
  mode = "compact",
  hostDeny = false,
  realHttp = false,
  revoke = null,
  abort = false,
  childLoopTools = null,
} = {}) {
  const connection = deferred();
  const connectStarted = deferred();
  let callTool = vi.fn(async () => ({
    content: [{ type: "text", text: "cloudy" }],
  }));
  let client = {
    connect: vi.fn(async () => {
      connectStarted.resolve();
      await connection.promise;
      return {
        tools: [
          {
            name: "get",
            description: "Get weather by city",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
      };
    }),
    callTool,
  };
  const lifecycleAuthority = new McpLifecycleAuthority({
    statePath: path.join(cwd, "mcp-lifecycle.json"),
  });
  let server;
  const httpRequests = [];
  let url = "http://localhost:1/mcp";
  if (realHttp) {
    server = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.writeHead(405).end();
        return;
      }
      if (request.method === "DELETE") {
        response.writeHead(204).end();
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const message = JSON.parse(Buffer.concat(chunks).toString());
      httpRequests.push(message);
      if (message.id == null) {
        response.writeHead(202).end();
        return;
      }
      let result = {};
      if (message.method === "initialize") {
        connectStarted.resolve();
        await connection.promise;
        result = {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "late-weather", version: "1" },
          capabilities: { tools: {} },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [
            {
              name: "get",
              description: "Get weather by city",
              inputSchema: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          ],
        };
      } else if (message.method === "tools/call") {
        result = { content: [{ type: "text", text: "cloudy" }] };
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}/mcp`;
    client = new MCPClient({ lifecycleAuthority });
    callTool = vi.spyOn(client, "callTool");
  }
  const mcp = await setupMcpFromConfig(
    {},
    { createClient: () => client, mcpLifecycleAuthority: lifecycleAuthority },
  );
  maybeApplyToolSearch(mcp, {
    config: { enabled: true, catalogMode: mode, alwaysLoad: [], maxResults: 5 },
  });
  const pendingConnection = setupMcpFromConfig(
    {
      weather: {
        url,
        transport: "http",
        headers: { Authorization: "test-fixture" },
      },
    },
    { into: mcp, mcpLifecycleAuthority: lifecycleAuthority },
  );
  await connectStarted.promise;
  const childRequests = [];
  let childResults = [];
  let rootCalls = 0;
  const controller = new AbortController();
  const ledgerRecords = [];
  const ledger = createMcpCallLedger({
    sink: async (record, { phase }) => {
      ledgerRecords.push(record);
      if (revoke === "ledger" && phase === "started")
        await client.disconnect("weather");
    },
  });
  const chatFn = vi.fn(async (messages, options) => {
    if (!options.subAgentDepth) {
      rootCalls += 1;
      if (rootCalls === 1)
        return reply(
          "spawn_sub_agent",
          {
            role: "worker",
            task: "Look up weather after connection",
            ...(fresh
              ? {}
              : { contextMode: "fork", mcpServers: [childServer] }),
            ...(childTools ? { tools: childTools } : {}),
            permissionMode: "bypassPermissions",
          },
          "spawn",
        );
      return {
        message: { role: "assistant", content: "Parent finished." },
        usage: {},
      };
    }
    childRequests.push(
      (options.extraToolDefinitions || []).map((tool) => tool.function.name),
    );
    if (childRequests.length === 1) {
      if (abort) controller.abort();
      connection.resolve();
      await pendingConnection;
      return reply("list_files", { path: "." }, "wait-for-connection");
    }
    if (childRequests.length === 2)
      return reply(
        "tool_search",
        { query: "select:mcp__weather__get" },
        "discover-late",
      );
    if (childRequests.length === 3) {
      if (revoke === "model") await client.disconnect("weather");
      if (revoke === "schema") {
        const entry = client.servers.get("weather");
        entry.tools = entry.tools.map((tool) => ({
          ...tool,
          description: "new schema",
        }));
      }
      return reply("mcp__weather__get", { city: "Shanghai" }, "invoke-late");
    }
    childResults = messages
      .filter((message) => message.role === "tool")
      .map((message) => JSON.parse(message.content));
    return {
      message: { role: "assistant", content: "Child finished." },
      usage: {},
    };
  });
  const events = [];
  let runError;
  // Production deliberately does not inherit a caller's custom provider
  // function. Inject only that test transport at context construction; retain
  // the actual child context, policy, catalog and loop implementation.
  const createChild = SubAgentContext.create.bind(SubAgentContext);
  vi.spyOn(SubAgentContext, "create").mockImplementation((options) => {
    const context = createChild({
      ...options,
      llmOptions: {
        ...options.llmOptions,
        chatFn,
        runnableProviderFallback: false,
      },
    });
    if (childLoopTools) {
      const run = context.run.bind(context);
      context.run = (prompt, loopOptions) =>
        run(prompt, {
          ...loopOptions,
          enabledToolNames: childLoopTools,
          exactToolNames: true,
        });
    }
    return context;
  });
  try {
    for await (const event of agentLoop(
      [{ role: "user", content: "Delegate weather lookup." }],
      {
        cwd,
        chatFn,
        runnableProviderFallback: false,
        iterationBudget: new IterationBudget({ maxIterations: 10 }),
        ...mcp,
        signal: controller.signal,
        mcpCallLedger: ledger,
        ...(revoke === "admission"
          ? {
              mcpDispatchAdmission: (_metadata, dispatch) => {
                // The host admission contract is synchronous and one-shot.
                const entry = client.servers.get("weather");
                entry.tools = entry.tools.map((tool) => ({
                  ...tool,
                  description: "replaced at dispatch admission",
                }));
                return dispatch();
              },
            }
          : {}),
        ...(parentNames
          ? { enabledToolNames: parentNames, exactToolNames: true }
          : {}),
        ...(hostDeny
          ? {
              hostManagedToolPolicy: {
                tools: { mcp__weather__get: { allowed: false } },
              },
            }
          : {}),
        subAgentContract: {
          permissionMode: "bypassPermissions",
          mcpServers: null,
        },
      },
    ))
      events.push(event);
  } catch (error) {
    if (!abort) throw error;
    runError = error;
  } finally {
    connection.resolve();
    await pendingConnection;
    if (realHttp) {
      await client.disconnectAll();
      await new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      });
    }
  }
  return {
    childRequests,
    childResults,
    callTool,
    events,
    mcp,
    httpRequests,
    ledgerRecords,
    runError,
  };
}

describe("late MCP connection inherited by an already running subagent", () => {
  it.each(["compact", "stubs"])(
    "discovers and invokes the late tool in %s mode",
    async (mode) => {
      const observed = await lateChild({ mode });
      expect(
        observed.childRequests,
        JSON.stringify(
          observed.events.filter(
            (event) =>
              event.type === "tool-result" || event.type === "tool-executed",
          ),
        ),
      ).toHaveLength(4);
      expect(observed.childRequests[0]).toEqual([]);
      expect(observed.childRequests[1]).toContain("tool_search");
      if (mode === "compact")
        expect(observed.childRequests[1]).not.toContain("mcp__weather__get");
      expect(observed.childRequests[2]).toContain("mcp__weather__get");
      expect(observed.childResults[1]).toMatchObject({ count: 1 });
      expect(observed.childResults[2].error).toBeUndefined();
      expect(observed.callTool).toHaveBeenCalledTimes(1);
      expect(observed.mcp.toolSearchRegistry.loaded.size).toBe(0);
    },
  );

  it.each([
    { fresh: true },
    { parentNames: ["spawn_sub_agent", "list_files"] },
    { childTools: ["list_files"] },
    { childServer: "private" },
    { hostDeny: true },
    { parentNames: ["spawn_sub_agent", "list_files", "tool_search"] },
    { childLoopTools: [] },
  ])(
    "keeps capability and policy ceilings after late connection: %j",
    async (options) => {
      const observed = await lateChild(options);
      expect(observed.childRequests).toHaveLength(4);
      expect(observed.childResults[2].error).toBeTruthy();
      expect(observed.callTool).not.toHaveBeenCalled();
    },
  );

  it("completes a real HTTP initialize, list and tool call after the child has started", async () => {
    const observed = await lateChild({ realHttp: true });
    expect(observed.childRequests[0]).toEqual([]);
    expect(observed.childRequests[1]).toEqual(["tool_search"]);
    expect(observed.childResults[2].error).toBeUndefined();
    expect(
      observed.httpRequests.filter(
        (message) => message.method === "initialize",
      ),
    ).toHaveLength(1);
    expect(
      observed.httpRequests.filter(
        (message) => message.method === "tools/list",
      ),
    ).toHaveLength(1);
    expect(
      observed.httpRequests.filter(
        (message) => message.method === "tools/call",
      ),
    ).toHaveLength(1);
    expect(observed.callTool).toHaveBeenCalledTimes(1);
  });

  it.each(["model", "ledger", "schema", "admission"])(
    "rejects catalog revocation at the %s boundary before HTTP dispatch",
    async (revoke) => {
      const observed = await lateChild({ realHttp: true, revoke });
      expect(observed.childResults[1].count).toBe(1);
      expect(observed.childResults[2].error).toContain("catalog changed");
      expect(observed.callTool).toHaveBeenCalledTimes(
        revoke === "admission" ? 1 : 0,
      );
      expect(
        observed.httpRequests.filter(
          (message) => message.method === "tools/call",
        ),
      ).toHaveLength(0);
      if (revoke === "ledger")
        expect(observed.ledgerRecords.at(-1).status).toBe("failed");
    },
  );

  it("does not resume an aborted child when a real late handshake completes", async () => {
    const observed = await lateChild({ realHttp: true, abort: true });
    expect(observed.childRequests).toHaveLength(1);
    expect(observed.callTool).not.toHaveBeenCalled();
    expect(
      observed.httpRequests.filter(
        (message) => message.method === "tools/call",
      ),
    ).toHaveLength(0);
    expect(observed.runError).toBeDefined();
  });
});
