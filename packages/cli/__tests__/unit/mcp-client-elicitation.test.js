import { describe, expect, it, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { MCPClient, _deps } from "../../src/lib/mcp-client.js";

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  proc.stdin = new EventEmitter();
  proc.written = [];
  proc.stdin.write = (data) => {
    const message = JSON.parse(String(data).trim());
    proc.written.push(message);
    const results = {
      initialize: { serverInfo: {}, capabilities: {} },
      "tools/list": { tools: [] },
      "resources/list": { resources: [] },
      "prompts/list": { prompts: [] },
    };
    if (message.id !== undefined && results[message.method]) {
      setImmediate(() => proc.stdout.emit("data", Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: results[message.method],
      }) + "\n")));
    }
    return true;
  };
  return proc;
}

async function serverRequest(proc, frame) {
  proc.stdout.emit("data", Buffer.from(JSON.stringify(frame) + "\n"));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("MCP elicitation/create routing", () => {
  let proc;

  beforeEach(() => {
    proc = fakeProcess();
    _deps.spawn = () => proc;
  });

  it("routes a server request to the injected handler", async () => {
    const client = new MCPClient({
      elicitationHandler: async (request) => ({
        action: "accept",
        content: { confirmed: request.message === "Confirm?" },
      }),
    });
    await client.connect("srv", { command: "fake-mcp" });

    await serverRequest(proc, {
      jsonrpc: "2.0",
      id: 21,
      method: "elicitation/create",
      params: { message: "Confirm?", requestedSchema: { type: "object" } },
    });

    await new Promise((resolve) => setImmediate(resolve));
    const response = proc.written.find((message) => message.id === 21);
    expect(response.result).toEqual({
      action: "accept",
      content: { confirmed: true },
    });
  });

  it("supports event-driven response and fails closed without a host", async () => {
    const client = new MCPClient({ elicitationTimeoutMs: 100 });
    await client.connect("srv", { command: "fake-mcp" });
    const request = new Promise((resolve) =>
      client.once("elicitation-request", (event) => {
        event.respond({ action: "accept", content: { value: 7 } });
        resolve();
      }),
    );
    await serverRequest(proc, {
      jsonrpc: "2.0",
      id: "event-1",
      method: "elicitation/create",
      params: { message: "Value?" },
    });
    await request;
    await new Promise((resolve) => setImmediate(resolve));
    expect(proc.written.find((message) => message.id === "event-1").result).toEqual({
      action: "accept",
      content: { value: 7 },
    });

    const noHost = new MCPClient();
    noHost._sendResponse = () => {};
    await expect(noHost._resolveElicitation("srv", 1, {})).resolves.toEqual({
      action: "decline",
    });
  });

  it("keeps concurrent session-scoped handlers isolated", async () => {
    const client = new MCPClient();
    client.setElicitationHandler(
      async (request) => ({
        action: "accept",
        content: { session: request.session },
      }),
      { sessionId: "session-a" },
    );
    client.setElicitationHandler(
      async (request) => ({
        action: "accept",
        content: { session: request.session },
      }),
      { sessionId: "session-b" },
    );

    const [a, b] = await Promise.all([
      client.withElicitationContext("session-a", () =>
        client._resolveElicitation("srv", "a", { session: "a" }),
      ),
      client.withElicitationContext("session-b", () =>
        client._resolveElicitation("srv", "b", { session: "b" }),
      ),
    ]);
    expect(a.content).toEqual({ session: "a" });
    expect(b.content).toEqual({ session: "b" });
    expect(client.clearElicitationHandler("session-a")).toBe(true);
    expect(client.clearElicitationHandler("session-b")).toBe(true);
  });
});
