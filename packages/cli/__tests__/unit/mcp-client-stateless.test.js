import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import {
  MCPClient,
  MCPServerConfig,
  isLikelyConnectionError,
  isTransientMcpError,
} from "../../src/harness/mcp-client.js";
import {
  statelessMcpRequest,
  admitStatelessMcpTask,
} from "../../src/lib/mcp-stateless-protocol.js";
import {
  registerMcpCommand,
  managedMcpRowsFromSettings,
  writeProjectMcpServer,
  readProjectMcpRows,
} from "../../src/commands/mcp.js";
import {
  parseMcpServers,
  loadMcpConfig,
} from "../../src/runtime/mcp-config.js";

const close = [];
afterEach(async () => {
  for (const cleanup of close.splice(0).reverse()) await cleanup();
});
const VERSION = "2026-07-28";
const EXTENSION = "io.modelcontextprotocol/tasks";
const task = (status = "working", id = "opaque/task:1") => ({
  taskId: id,
  status,
  createdAt: "2026-11-09T00:00:00Z",
  lastUpdatedAt: "2026-11-09T00:00:01Z",
  ttlMs: null,
  pollIntervalMs: 1000,
  ...(status === "completed"
    ? { result: { content: [{ type: "text", text: "verified result" }] } }
    : {}),
});

async function fixture({
  extension = true,
  respond,
  respondHttp,
  clientOptions,
  connect = true,
} = {}) {
  const requests = [];
  let status = "working";
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ ...message, headers: req.headers, httpMethod: req.method });
    let result;
    if (message.method === "server/discover")
      result = {
        resultType: "complete",
        supportedVersions: [VERSION],
        capabilities: {
          tools: {},
          ...(extension ? { extensions: { [EXTENSION]: {} } } : {}),
        },
      };
    else if (message.method === "tools/list")
      result = { tools: [{ name: "work", inputSchema: { type: "object" } }] };
    else if (message.method === "tools/call")
      result = message.params._meta[
        "io.modelcontextprotocol/clientCapabilities"
      ].extensions
        ? { resultType: "task", ...task() }
        : { content: [{ type: "text", text: "ordinary result" }] };
    else if (message.method === "tasks/get") result = task(status);
    else if (message.method === "tasks/cancel") {
      status = "cancelled";
      result = {};
    } else result = {};
    result = { resultType: "complete", ...result };
    if (respond) result = respond(message, result);
    if (respondHttp?.(message, result, res)) return;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  close.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const client = new MCPClient(clientOptions);
  close.push(() => client.disconnectAll());
  const config = {
    transport: "http",
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    protocolVersion: VERSION,
  };
  if (connect) await client.connect("modern", config);
  return {
    client,
    config,
    requests,
    setStatus: (value) => {
      status = value;
    },
  };
}

describe("opt-in stateless MCP Tasks", () => {
  const sseReply = (response, messages) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.end(
      messages
        .map((message) => `data: ${JSON.stringify(message)}\n\n`)
        .join(""),
    );
    return true;
  };

  it.each([
    ["roots", { id: "peer-roots", method: "roots/list", params: {} }],
    [
      "form elicitation",
      {
        id: "peer-form",
        method: "elicitation/create",
        params: {
          message: "synthetic form",
          requestedSchema: {
            type: "object",
            properties: { answer: { type: "string" } },
          },
        },
      },
    ],
    [
      "URL elicitation",
      {
        id: "peer-url",
        method: "elicitation/create",
        params: {
          mode: "url",
          elicitationId: "synthetic-url",
          url: "https://example.invalid/stateless",
          message: "synthetic URL flow",
        },
      },
    ],
    ["catalog refresh", { method: "notifications/tools/list_changed" }],
    [
      "elicitation completion",
      {
        method: "notifications/elicitation/complete",
        params: { elicitationId: "synthetic-url" },
      },
    ],
  ])(
    "rejects unadvertised stateless SSE %s before callbacks or follow-up POSTs",
    async (_label, injected) => {
      const handler = vi.fn(async () => ({
        action: "accept",
        content: { answer: "synthetic-only" },
      }));
      const f = await fixture({
        clientOptions: {
          roots: ["E:/synthetic-private-workspace"],
          elicitationHandler: handler,
        },
        respondHttp: (request, result, response) =>
          request.method === "tools/call" &&
          sseReply(response, [
            { jsonrpc: "2.0", ...injected },
            { jsonrpc: "2.0", id: request.id, result },
          ]),
      });
      const roots = vi.spyOn(f.client, "listRoots");
      const initialRequests = f.requests.length;
      const failure = await f.client
        .callTool("modern", "work", {})
        .catch((error) => error);
      expect(failure).toMatchObject({
        code: "CC_MCP_STATELESS_CLIENT_REQUEST_UNSUPPORTED",
        dispatched: true,
        outcomeUnknown: true,
        retryable: false,
      });
      expect(isLikelyConnectionError(failure)).toBe(false);
      expect(isTransientMcpError(failure)).toBe(false);
      expect(handler).not.toHaveBeenCalled();
      expect(roots).not.toHaveBeenCalled();
      await new Promise((done) => setTimeout(done, 20));
      expect(
        f.requests.slice(initialRequests).map((request) => request.method),
      ).toEqual(["tools/call"]);
      expect(
        f.requests.at(-1).params._meta[
          "io.modelcontextprotocol/clientCapabilities"
        ],
      ).toEqual({});
    },
  );

  it("keeps valid request-correlated progress without legacy control dispatch", async () => {
    const f = await fixture({
      respondHttp: (request, result, response) =>
        request.method === "tools/call" &&
        sseReply(response, [
          {
            jsonrpc: "2.0",
            method: "notifications/progress",
            params: {
              progressToken: request.params._meta.progressToken,
              progress: 1,
              total: 2,
              message: "untrusted peer status",
            },
          },
          { jsonrpc: "2.0", id: request.id, result },
        ]),
    });
    const progress = [];
    f.client.on("tool-progress", (event) => progress.push(event));
    expect(
      (await f.client.callTool("modern", "work", {})).content[0].text,
    ).toBe("ordinary result");
    expect(progress).toEqual([
      {
        server: "modern",
        progressToken: expect.any(String),
        progress: 1,
        total: 2,
      },
    ]);
    expect(
      f.requests.filter((request) => request.method === "tools/call"),
    ).toHaveLength(1);
  });

  it.each(["missing", "foreign", "request-shaped"])(
    "rejects %s progress authority without accepting a later result",
    async (kind) => {
      const f = await fixture({
        respondHttp: (request, result, response) =>
          request.method === "tools/call" &&
          sseReply(response, [
            {
              jsonrpc: "2.0",
              ...(kind === "request-shaped" ? { id: "peer-progress" } : {}),
              method: "notifications/progress",
              params: {
                ...(kind === "missing"
                  ? {}
                  : {
                      progressToken:
                        kind === "foreign"
                          ? "other-operation"
                          : request.params._meta.progressToken,
                    }),
                progress: 1,
              },
            },
            { jsonrpc: "2.0", id: request.id, result },
          ]),
      });
      const progress = vi.fn();
      f.client.on("tool-progress", progress);
      await expect(
        f.client.callTool("modern", "work", {}),
      ).rejects.toMatchObject({
        code: "CC_MCP_STATELESS_CLIENT_REQUEST_UNSUPPORTED",
      });
      expect(progress).not.toHaveBeenCalled();
      expect(
        f.requests.filter((request) => request.method === "tools/call"),
      ).toHaveLength(1);
    },
  );

  it("does not resolve a legacy URL-required error through stateless callbacks", async () => {
    const handler = vi.fn(async () => ({ action: "decline" }));
    const f = await fixture({
      clientOptions: { elicitationHandler: handler },
      respondHttp: (request, _result, response) => {
        if (request.method !== "tools/call") return false;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32042,
              message: "synthetic URL requirement",
              data: {
                elicitations: [
                  {
                    mode: "url",
                    elicitationId: "unsupported-url",
                    url: "https://example.invalid/stateless",
                    message: "synthetic URL flow",
                  },
                ],
              },
            },
          }),
        );
        return true;
      },
    });
    await expect(f.client.callTool("modern", "work", {})).rejects.toMatchObject(
      { code: -32042 },
    );
    expect(handler).not.toHaveBeenCalled();
    expect(
      f.requests.filter((request) => request.method === "tools/call"),
    ).toHaveLength(1);
  });

  it("treats unsupported stateless discovery traffic as fatal", async () => {
    const f = await fixture({
      connect: false,
      respondHttp: (request, result, response) =>
        request.method === "tools/list" &&
        sseReply(response, [
          { jsonrpc: "2.0", id: "peer-roots", method: "roots/list" },
          { jsonrpc: "2.0", id: request.id, result },
        ]),
    });
    const roots = vi.spyOn(f.client, "listRoots");
    await expect(f.client.connect("modern", f.config)).rejects.toMatchObject({
      code: "CC_MCP_STATELESS_CLIENT_REQUEST_UNSUPPORTED",
    });
    expect(roots).not.toHaveBeenCalled();
    expect(f.requests.map((request) => request.method)).toEqual([
      "server/discover",
      "tools/list",
    ]);
  });

  it("discovers without initialize, sessions or background GET and scopes capabilities per request", async () => {
    const f = await fixture();
    expect(f.requests[0].method).toBe("server/discover");
    expect(
      f.requests.every(
        (r) =>
          r.headers["mcp-protocol-version"] === VERSION &&
          r.headers["mcp-method"] === r.method,
      ),
    ).toBe(true);
    expect(f.requests.every((r) => !r.headers["mcp-session-id"])).toBe(true);
    f.client.setElicitationHandler(async () => ({ action: "decline" }));
    await new Promise((done) => setTimeout(done, 20));
    expect(f.client.servers.get("modern")._httpMessageStream).toBeNull();
    expect(f.requests.every((request) => request.httpMethod === "POST")).toBe(
      true,
    );
    const normal = await f.client.callTool("modern", "work", {});
    expect(normal.content[0].text).toBe("ordinary result");
    const accepted = await f.client.callToolTask("modern", "work", {});
    expect(accepted.task).toMatchObject({
      taskId: "opaque/task:1",
      ttl: null,
      pollInterval: 1000,
    });
    const calls = f.requests.filter((r) => r.method === "tools/call");
    expect(
      calls[0].params._meta["io.modelcontextprotocol/clientCapabilities"],
    ).toEqual({});
    expect(
      calls[1].params._meta["io.modelcontextprotocol/clientCapabilities"],
    ).toEqual({ extensions: { [EXTENSION]: {} } });
    expect(calls[1].params).not.toHaveProperty("task");
    expect(calls[1].headers["mcp-name"]).toBe("work");
    await f.client.disconnectAll();
    expect(
      f.requests.every(
        (r) =>
          r.httpMethod === "POST" &&
          r.method !== "initialize" &&
          r.method !== "notifications/initialized",
      ),
    ).toBe(true);
  });

  it("reads the inline result through tasks/get and binds canonical result metadata", async () => {
    const f = await fixture();
    const accepted = await f.client.callToolTask("modern", "work", {});
    f.setStatus("completed");
    const snapshot = await f.client.getTask("modern", accepted.task.taskId);
    expect(snapshot.status).toBe("completed");
    const payload = await f.client.getTaskResult(
      "modern",
      accepted.task.taskId,
    );
    expect(payload.content[0].text).toBe("verified result");
    expect(payload._meta["io.modelcontextprotocol/related-task"].taskId).toBe(
      accepted.task.taskId,
    );
    expect(f.requests.some((r) => r.method === "tasks/result")).toBe(false);
    expect(
      f.requests
        .filter((r) => r.method === "tasks/get")
        .every((r) => r.headers["mcp-name"] === accepted.task.taskId),
    ).toBe(true);
  });

  it("observes cancellation separately from acknowledgement and retains completed tasks", async () => {
    const f = await fixture();
    const accepted = await f.client.callToolTask("modern", "work", {});
    const cancelled = await f.client.cancelTask("modern", accepted.task.taskId);
    expect(cancelled.status).toBe("cancelled");
    expect(f.requests.slice(-2).map((r) => r.method)).toEqual([
      "tasks/cancel",
      "tasks/get",
    ]);
  });

  it("does not call a cancellation acknowledgement remote termination", async () => {
    const f = await fixture({
      respond: (request, result) =>
        request.method === "tasks/get"
          ? { resultType: "complete", ...task("working") }
          : result,
    });
    const accepted = await f.client.callToolTask("modern", "work", {});
    expect(
      (await f.client.cancelTask("modern", accepted.task.taskId)).status,
    ).toBe("working");
  });

  it("refuses unsupported list/TTL and absent extension before task dispatch", async () => {
    const f = await fixture();
    await expect(f.client.listTasks("modern")).rejects.toMatchObject({
      code: "CC_MCP_TASK_UNSUPPORTED",
      dispatched: false,
    });
    await expect(
      f.client.callToolTask("modern", "work", {}, { ttl: 10 }),
    ).rejects.toMatchObject({
      code: "CC_MCP_TASK_TTL_UNSUPPORTED",
      dispatched: false,
    });
    expect(
      f.requests.some(
        (r) => r.method.startsWith("tasks/") || r.method === "tools/call",
      ),
    ).toBe(false);
    const missing = await fixture({ extension: false });
    await expect(
      missing.client.callToolTask("modern", "work", {}),
    ).rejects.toMatchObject({ code: "CC_MCP_TASK_UNSUPPORTED" });
    expect(missing.requests.some((r) => r.method === "tools/call")).toBe(false);
  });

  it("cannot settle an unsolicited task as a synchronous tool result or replay it", async () => {
    const f = await fixture({
      respond: (request, result) =>
        request.method === "tools/call"
          ? { resultType: "task", ...task() }
          : result,
    });
    await expect(f.client.callTool("modern", "work", {})).rejects.toMatchObject(
      { code: "CC_MCP_TASK_UNEXPECTED", outcomeUnknown: true },
    );
    expect(f.requests.filter((r) => r.method === "tools/call")).toHaveLength(1);
  });

  it("refuses a pending result and prevents terminal status regression", async () => {
    const f = await fixture();
    const accepted = await f.client.callToolTask("modern", "work", {});
    await expect(
      f.client.getTaskResult("modern", accepted.task.taskId),
    ).rejects.toMatchObject({ code: "CC_MCP_TASK_RESULT_UNAVAILABLE" });
    f.setStatus("completed");
    await f.client.getTask("modern", accepted.task.taskId);
    f.setStatus("working");
    await expect(
      f.client.getTask("modern", accepted.task.taskId),
    ).rejects.toMatchObject({ code: "CC_MCP_TASK_STATUS_REGRESSION" });
  });

  it("restores only an authenticated server identity on a fresh stateless connection", async () => {
    const f = await fixture();
    const accepted = await f.client.callToolTask("modern", "work", {});
    const key = "a".repeat(64);
    const identityDigest = f.client.getTaskRecoveryIdentity("modern", key);
    await f.client.disconnectAll();
    const next = new MCPClient();
    close.push(() => next.disconnectAll());
    await next.connect("modern", f.config);
    next.restoreTaskBinding("modern", accepted.task, { key, identityDigest });
    f.setStatus("completed");
    expect(
      (await next.getTaskResult("modern", accepted.task.taskId)).content[0]
        .text,
    ).toBe("verified result");
    expect(() =>
      next.restoreTaskBinding("modern", accepted.task, {
        key: "b".repeat(64),
        identityDigest,
      }),
    ).toThrow();
    expect(f.requests.filter((r) => r.method === "tools/call")).toHaveLength(1);
  });
});

describe("stateless wire admission and persisted configuration", () => {
  it("encodes Unicode and reserved sentinel names without header ambiguity", () => {
    for (const name of [
      "研究/任务",
      "=?base64?opaque?=",
      " spaced ",
      "line\r\nname",
    ]) {
      const wire = statelessMcpRequest("tasks/get", { taskId: name });
      const encoded = wire.headers["Mcp-Name"];
      expect(encoded).toMatch(/^=\?base64\?.*\?=$/);
      expect(Buffer.from(encoded.slice(9, -2), "base64").toString()).toBe(name);
    }
  });

  it("rejects conflicting result identities, legacy aliases and incomplete terminal snapshots", () => {
    const mutations = [
      (value) => {
        value.ttl = null;
      },
      (value) => {
        value.resultType = "task";
      },
      (value) => {
        value.taskId = "other";
      },
      (value) => {
        delete value.result;
      },
      (value) => {
        value.result._meta = {
          "io.modelcontextprotocol/related-task": { taskId: "other" },
        };
      },
      (value) => {
        value.result.resultType = "task";
      },
      (value) => {
        value.result._meta = "malformed";
      },
      (value) => {
        value.inputRequests = {};
      },
    ];
    for (const mutate of mutations) {
      const value = { resultType: "complete", ...task("completed") };
      mutate(value);
      expect(() =>
        admitStatelessMcpTask("s", value, {}, { taskId: "opaque/task:1" }),
      ).toThrow();
    }
  });

  it("persists the protocol override through real SQLite upgrades and unrelated updates", () => {
    const Database = createRequire(import.meta.url)("better-sqlite3");
    const db = new Database(":memory:");
    close.push(() => db.close());
    db.exec(
      "CREATE TABLE mcp_servers(name TEXT PRIMARY KEY,command TEXT,args TEXT,env TEXT,auto_connect INTEGER,created_at TEXT,updated_at TEXT)",
    );
    const config = new MCPServerConfig(db);
    config.add("s", {
      url: "http://127.0.0.1:1/mcp",
      protocolVersion: VERSION,
    });
    expect(config.get("s").protocolVersion).toBe(VERSION);
    config.add("s", {
      url: "http://127.0.0.1:1/mcp",
      headers: { Example: "changed" },
    });
    expect(config.get("s").protocolVersion).toBe(VERSION);
    config.add("s", { url: "http://127.0.0.1:1/mcp", protocolVersion: null });
    expect(config.get("s")).not.toHaveProperty("protocolVersion");
    expect(() =>
      config.add("bad", { command: "node", protocolVersion: VERSION }),
    ).toThrow();
    expect(config.get("bad")).toBeNull();
  });

  it("retains the selected protocol in managed/project configuration and exposes the CLI flag", () => {
    const root = mkdtempSync(join(tmpdir(), "cc-stateless-config-"));
    close.push(() => rmSync(root, { recursive: true, force: true }));
    const value = { url: "http://127.0.0.1:1/mcp", protocolVersion: VERSION };
    expect(
      managedMcpRowsFromSettings({ mcpServers: { s: value } }, "fixture")[0]
        .protocolVersion,
    ).toBe(VERSION);
    const file = writeProjectMcpServer("s", value, root);
    writeProjectMcpServer(
      "s",
      { url: value.url, headers: { Example: "changed" } },
      root,
    );
    expect(
      JSON.parse(readFileSync(file, "utf8")).mcpServers.s.protocolVersion,
    ).toBe(VERSION);
    expect(readProjectMcpRows(root)[0].protocolVersion).toBe(VERSION);
    const program = new Command();
    registerMcpCommand(program);
    const add = program.commands
      .find((c) => c.name() === "mcp")
      .commands.find((c) => c.name() === "add");
    add.parseOptions(["s", "--url", value.url, "--protocol-version", VERSION]);
    expect(add.opts().protocolVersion).toBe(VERSION);
  });

  it("retains the protocol through the real agent MCP loader instead of falling back to initialize", async () => {
    const f = await fixture();
    const configuration = f.config;
    const input = { mcpServers: { agent: configuration } };
    expect(parseMcpServers(input).agent.protocolVersion).toBe(VERSION);
    const client = new MCPClient();
    close.push(() => client.disconnectAll());
    const loaded = await loadMcpConfig("diagnostic-config.json", {
      readFile: () => JSON.stringify(input),
      createClient: () => client,
      writeErr: () => {},
    });
    expect(loaded.connected).toContainEqual(
      expect.objectContaining({ server: "agent" }),
    );
    expect(client.servers.get("agent").protocolVersion).toBe(VERSION);
    expect(f.requests.some((request) => request.method === "initialize")).toBe(
      false,
    );
  });
});
