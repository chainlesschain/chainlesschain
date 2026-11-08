import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { MCPClient } from "../../src/harness/mcp-client.js";
import { admitMcpTaskResponse } from "../../src/lib/mcp-tasks.js";
import {
  createMcpRecoveryAdmissionController,
  createRecoveryGuardedMcpClient,
} from "../../src/lib/mcp-ledger-recovery-admission.js";

const cleanup = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const task = (status = "working", taskId = "opaque:task/1") => ({
  taskId,
  status,
  createdAt: "2026-11-08T00:00:00Z",
  lastUpdatedAt: "2026-11-08T00:00:01Z",
  ttl: null,
  pollInterval: 5000,
});
const capabilities = () => ({
  tools: {},
  tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
});
async function fixture(options = {}) {
  const messages = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(204).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    messages.push(message);
    if (message.id == null) {
      res.writeHead(202).end();
      return;
    }
    let result;
    if (message.method === "initialize") {
      result = {
        protocolVersion: options.version || "2025-11-25",
        serverInfo: { name: "task-fixture", version: "1" },
        capabilities: options.capabilities || capabilities(),
      };
    } else if (message.method === "tools/list") {
      result = {
        tools: [
          {
            name: "work",
            inputSchema: { type: "object" },
            ...(options.mode === null
              ? {}
              : { execution: { taskSupport: options.mode || "optional" } }),
          },
        ],
      };
    } else {
      if (options.respond) {
        const response = await options.respond(message, req, res);
        if (response === null) return;
        result = response;
      }
      if (result === undefined) {
        if (message.method === "tools/call")
          result =
            message.params.task || options.unexpected
              ? { task: task() }
              : { content: [] };
        else if (message.method === "tasks/get")
          result = task("input_required");
        else if (message.method === "tasks/cancel") result = task("cancelled");
        else if (message.method === "tasks/list")
          result = { tasks: [task()], nextCursor: "opaque/+==?" };
        else
          result = {
            content: [{ type: "text", text: "done" }],
            _meta: {
              "io.modelcontextprotocol/related-task": {
                taskId: "opaque:task/1",
              },
            },
          };
      }
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const client = new MCPClient();
  cleanup.push(() => client.disconnectAll());
  await client.connect("test", {
    transport: "http",
    url: "http://127.0.0.1:" + server.address().port + "/rpc",
  });
  return {
    client,
    messages,
    dispatched: () =>
      messages.filter(
        (m) => m.method === "tools/call" || m.method.startsWith("tasks/"),
      ),
  };
}

describe("experimental MCP Tasks requester over HTTP", () => {
  it("negotiates both levels and keeps acceptance distinct from final result", async () => {
    const { client, messages, dispatched } = await fixture();
    const accepted = await client.callToolTask(
      "test",
      "work",
      { n: 1 },
      { ttl: 60000 },
    );
    expect(accepted).toEqual({ task: task() });
    expect(accepted.content).toBeUndefined();
    expect(await client.getTask("test", accepted.task.taskId)).toEqual(
      task("input_required"),
    );
    // input_required is allowed to retrieve results; no terminal-only deadlock.
    expect(await client.listTasks("test", "opaque/+==?")).toMatchObject({
      nextCursor: "opaque/+==?",
    });
    expect(
      await client.getTaskResult("test", accepted.task.taskId),
    ).toMatchObject({ content: [{ text: "done" }] });
    expect(dispatched().map((m) => m.method)).toEqual([
      "tools/call",
      "tasks/get",
      "tasks/list",
      "tasks/result",
    ]);
    expect(dispatched()[0].params).toMatchObject({
      task: { ttl: 60000 },
      arguments: { n: 1 },
    });
    expect(dispatched()[2].params).toEqual({ cursor: "opaque/+==?" });
    expect(messages[0].params.capabilities.tasks).toBeUndefined();
  });

  it.each([null, "forbidden"])("does not augment mode=%s", async (mode) => {
    const { client, dispatched } = await fixture({ mode });
    await expect(client.callToolTask("test", "work")).rejects.toMatchObject({
      code: "CC_MCP_TASK_FORBIDDEN",
      dispatched: false,
    });
    expect(dispatched()).toHaveLength(0);
    expect(await client.callTool("test", "work")).toEqual({ content: [] });
  });

  it("requires server capability even when a tool advertises optional", async () => {
    const { client, dispatched } = await fixture({
      capabilities: { tools: {} },
    });
    await expect(client.callToolTask("test", "work")).rejects.toMatchObject({
      code: "CC_MCP_TASK_UNSUPPORTED",
    });
    expect(dispatched()).toHaveLength(0);
  });

  it("rejects augmentation after older protocol negotiation", async () => {
    const { client, dispatched } = await fixture({ version: "2025-06-18" });
    await expect(client.callToolTask("test", "work")).rejects.toMatchObject({
      code: "CC_MCP_TASK_UNSUPPORTED",
    });
    expect(dispatched()).toHaveLength(0);
  });

  it("ordinary calls cannot bypass required task mode via options.task", async () => {
    const { client, dispatched } = await fixture({ mode: "required" });
    await expect(
      client.callTool("test", "work", {}, { task: {} }),
    ).rejects.toMatchObject({
      code: "CC_MCP_TASK_REQUIRED",
      dispatched: false,
    });
    expect(dispatched()).toHaveLength(0);
    await expect(client.callToolTask("test", "work")).resolves.toMatchObject({
      task: { status: "working" },
    });
  });

  it("unexpected task acceptance never settles ordinary success", async () => {
    const { client, dispatched } = await fixture({ unexpected: true });
    await expect(client.callTool("test", "work")).rejects.toMatchObject({
      code: "CC_MCP_TASK_UNEXPECTED",
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(dispatched()).toHaveLength(1);
  });

  it.each(["404", "disconnect", "invalid"])(
    "does not replay after create %s",
    async (failure) => {
      const { client, messages, dispatched } = await fixture({
        respond(message, req, res) {
          if (message.method !== "tools/call") return;
          if (failure === "404") {
            res.writeHead(404).end();
            return null;
          }
          if (failure === "disconnect") {
            req.socket.destroy();
            return null;
          }
          return { task: { taskId: "missing-fields" } };
        },
      });
      client.setReconnector("test", async () => {
        throw new Error("must not reconnect");
      });
      await expect(client.callToolTask("test", "work")).rejects.toMatchObject({
        dispatched: true,
        outcomeUnknown: true,
      });
      expect(dispatched()).toHaveLength(1);
      expect(messages.filter((m) => m.method === "initialize")).toHaveLength(1);
    },
  );

  it.each(["list", "cancel"])(
    "checks independent %s capability",
    async (operation) => {
      const caps = capabilities();
      delete caps.tasks[operation];
      const { client, dispatched } = await fixture({ capabilities: caps });
      const accepted = await client.callToolTask("test", "work");
      await expect(
        operation === "list"
          ? client.listTasks("test")
          : client.cancelTask("test", accepted.task.taskId),
      ).rejects.toMatchObject({ code: "CC_MCP_TASK_UNSUPPORTED" });
      expect(dispatched()).toHaveLength(1);
    },
  );

  it.each(["entry", "headers", "session"])(
    "rejects original task after %s identity change",
    async (change) => {
      const { client, dispatched } = await fixture();
      const accepted = await client.callToolTask("test", "work");
      const entry = client.servers.get("test");
      if (change === "entry") client.servers.set("test", { ...entry });
      if (change === "headers")
        entry.httpHeaders = { Authorization: "new-credential" };
      if (change === "session") entry.httpSessionId = "new-session";
      await expect(
        client.getTask("test", accepted.task.taskId),
      ).rejects.toMatchObject({
        code: "CC_MCP_TASK_BINDING_REQUIRED",
        dispatched: false,
      });
      expect(dispatched()).toHaveLength(1);
      // Restore for clean teardown.
      client.servers.set("test", entry);
    },
  );

  it("checks original task binding after a query is in flight", async () => {
    let changed;
    const { client } = await fixture({
      respond(message) {
        if (message.method === "tasks/get") {
          changed();
          return task();
        }
      },
    });
    const accepted = await client.callToolTask("test", "work");
    changed = () => {
      client.servers.get("test").httpHeaders = { Authorization: "rotated" };
    };
    await expect(
      client.getTask("test", accepted.task.taskId),
    ).rejects.toMatchObject({
      code: "CC_MCP_TASK_CONNECTION_CHANGED",
      outcomeUnknown: true,
    });
  });

  it("binds list-discovered IDs without replaying tools", async () => {
    const { client, dispatched } = await fixture();
    await client.listTasks("test");
    await expect(
      client.getTask("test", "opaque:task/1"),
    ).resolves.toMatchObject({ status: "input_required" });
    expect(dispatched().map((m) => m.method)).toEqual([
      "tasks/list",
      "tasks/get",
    ]);
  });

  it("rejects final result for a different task", async () => {
    const { client } = await fixture({
      respond(message) {
        if (message.method === "tasks/result")
          return {
            content: [],
            _meta: {
              "io.modelcontextprotocol/related-task": { taskId: "other" },
            },
          };
      },
    });
    await client.callToolTask("test", "work");
    await expect(
      client.getTaskResult("test", "opaque:task/1"),
    ).rejects.toMatchObject({ code: "CC_MCP_TASK_RESULT_INVALID" });
  });

  it("does not regress terminal state", async () => {
    const { client } = await fixture();
    await client.callToolTask("test", "work");
    await client.cancelTask("test", "opaque:task/1");
    await expect(client.getTask("test", "opaque:task/1")).rejects.toMatchObject(
      { code: "CC_MCP_TASK_STATUS_REGRESSION" },
    );
  });

  it("aborts before dispatch without cancelling a remote task", async () => {
    const { client, dispatched } = await fixture();
    await client.callToolTask("test", "work");
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.getTaskResult("test", "opaque:task/1", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ dispatched: false });
    expect(dispatched()).toHaveLength(1);
  });

  it("keeps task creation idle timeout outcome unknown", async () => {
    const { client, dispatched } = await fixture({
      respond(message) {
        if (message.method === "tools/call") return null;
      },
    });
    await expect(
      client.callToolTask("test", "work", {}, { idleTimeoutMs: 25 }),
    ).rejects.toMatchObject({
      code: "CC_MCP_TOOL_IDLE_TIMEOUT",
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(dispatched().filter((m) => m.method === "tools/call")).toHaveLength(
      1,
    );
  });

  it("keeps a lost cancel acknowledgement uncertain without replaying creation", async () => {
    const { client, dispatched } = await fixture({
      respond(message, req) {
        if (message.method === "tasks/cancel") {
          req.socket.destroy();
          return null;
        }
      },
    });
    await client.callToolTask("test", "work");
    await expect(
      client.cancelTask("test", "opaque:task/1"),
    ).rejects.toMatchObject({
      code: "CC_MCP_TASK_CANCEL_OUTCOME_UNKNOWN",
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(dispatched().map((m) => m.method)).toEqual([
      "tools/call",
      "tasks/cancel",
    ]);
  });

  it("keeps host dispatch admission on the explicit creation path", async () => {
    const { client, dispatched } = await fixture();
    await expect(
      client.callToolTask(
        "test",
        "work",
        {},
        {
          dispatchAdmission() {
            throw Object.assign(new Error("denied"), { dispatched: false });
          },
        },
      ),
    ).rejects.toMatchObject({ dispatched: false });
    expect(dispatched()).toHaveLength(0);
  });

  it("does not return to working after a successful final result", async () => {
    const { client } = await fixture();
    await client.callToolTask("test", "work");
    await client.getTaskResult("test", "opaque:task/1");
    await expect(client.getTask("test", "opaque:task/1")).rejects.toMatchObject(
      {
        code: "CC_MCP_TASK_STATUS_REGRESSION",
      },
    );
  });

  it("rejects duplicate list IDs atomically", async () => {
    const { client } = await fixture({
      respond(message) {
        if (message.method === "tasks/list")
          return {
            tasks: [
              task("completed", "duplicate"),
              task("working", "duplicate"),
            ],
          };
      },
    });
    await expect(client.listTasks("test")).rejects.toMatchObject({
      code: "CC_MCP_TASK_RESULT_INVALID",
    });
    await expect(client.getTask("test", "duplicate")).rejects.toMatchObject({
      code: "CC_MCP_TASK_BINDING_REQUIRED",
    });
  });

  it("reserves remaining capacity before concurrent creations dispatch", async () => {
    let page = 0;
    const { client, dispatched } = await fixture({
      async respond(message) {
        if (message.method === "tasks/list") {
          const count = page === 3 ? 255 : 256;
          const offset = page++ * 256;
          return {
            tasks: Array.from({ length: count }, (_, i) =>
              task("working", "listed-" + (offset + i)),
            ),
          };
        }
        if (message.method === "tools/call") {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { task: task() };
        }
      },
    });
    for (let i = 0; i < 4; i++) await client.listTasks("test");
    const outcomes = await Promise.allSettled([
      client.callToolTask("test", "work"),
      client.callToolTask("test", "work"),
    ]);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1]).toMatchObject({
      status: "rejected",
      reason: {
        code: "CC_MCP_TASK_BINDING_LIMIT",
        dispatched: false,
      },
    });
    expect(
      dispatched().filter((message) => message.method === "tools/call"),
    ).toHaveLength(1);
    await expect(
      client.getTask("test", "opaque:task/1"),
    ).resolves.toMatchObject({ status: "input_required" });
  });

  it("denies invalid local parameters before dispatch", async () => {
    const { client, dispatched } = await fixture();
    await expect(
      client.callToolTask("test", "work", {}, { ttl: -1 }),
    ).rejects.toMatchObject({ code: "CC_MCP_TASK_TTL_INVALID" });
    await expect(client.getTask("test", " ")).rejects.toMatchObject({
      code: "CC_MCP_TASK_ID_INVALID",
    });
    await expect(client.listTasks("test", 123)).rejects.toMatchObject({
      code: "CC_MCP_TASK_CURSOR_INVALID",
    });
    expect(dispatched()).toHaveLength(0);
  });
});

describe("MCP Tasks strict result and host boundary", () => {
  it.each([{}, { task: task() }, { content: [], isError: "false" }])(
    "rejects malformed final result %#",
    (value) => {
      expect(() =>
        admitMcpTaskResponse(
          "test",
          value,
          {},
          { kind: "result", taskId: "opaque:task/1" },
        ),
      ).toThrow();
    },
  );

  it("rejects accessors without invoking them", () => {
    const getter = vi.fn();
    const value = Object.defineProperty({}, "task", {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      admitMcpTaskResponse("test", value, {}, { kind: "create" }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it("guards every task entry point before dispatch or ledger begin", async () => {
    const begin = vi.fn();
    const raw = { callTool: vi.fn() };
    const methods = [
      "callToolTask",
      "getTask",
      "getTaskResult",
      "listTasks",
      "cancelTask",
      "_taskRequest",
    ];
    for (const method of methods) raw[method] = vi.fn();
    const guarded = createRecoveryGuardedMcpClient({
      client: raw,
      ledger: { begin },
      controller: createMcpRecoveryAdmissionController(),
    });
    for (const method of methods) {
      await expect(
        guarded[method]("test", "opaque:task/1"),
      ).rejects.toMatchObject({
        code: "CC_MCP_TASK_DURABLE_ADMISSION_REQUIRED",
        dispatched: false,
      });
      expect(raw[method]).not.toHaveBeenCalled();
    }
    expect(begin).not.toHaveBeenCalled();
  });
});
