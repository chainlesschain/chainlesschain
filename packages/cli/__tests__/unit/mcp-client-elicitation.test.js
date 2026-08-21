import { describe, expect, it, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  MCPClient,
  _deps,
  normalizeMcpElicitationRequest,
} from "../../src/lib/mcp-client.js";
import { textByteStream } from "../helpers/mcp-http-response.js";

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
      initialize: {
        protocolVersion: message.params?.protocolVersion,
        serverInfo: {},
        capabilities: {},
      },
      "tools/list": { tools: [] },
      "resources/list": { resources: [] },
      "resources/templates/list": { resourceTemplates: [] },
      "prompts/list": { prompts: [] },
    };
    if (message.id !== undefined && results[message.method]) {
      setImmediate(() =>
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: results[message.method],
            }) + "\n",
          ),
        ),
      );
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
    _deps.consumeMcpStdioExecutionAuthority = () => ({
      approvalKind: "test-fixture",
    });
    _deps.materializeApprovedMcpStdioInvocation = (_approval, { config }) =>
      config;
    _deps.prepareMcpStdioExecutableIdentity = ({ config }) => ({
      command: config.command,
      args: config.args || [],
      identity: null,
      authority: Object.freeze({}),
    });
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

  it("advertises form + URL elicitation on the stable protocol revision", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    const initialize = proc.written.find(
      (message) => message.method === "initialize",
    );
    expect(initialize.params).toMatchObject({
      protocolVersion: "2025-11-25",
      capabilities: {
        elicitation: {
          form: {},
          url: {},
        },
      },
    });
  });

  it("does not advertise or accept URL mode on an older protocol revision", async () => {
    const client = new MCPClient({ protocolVersion: "2025-06-18" });
    await client.connect("srv", { command: "fake-mcp" });

    const initialize = proc.written.find(
      (message) => message.method === "initialize",
    );
    expect(initialize.params.capabilities.elicitation).toEqual({
      form: {},
    });
    client.servers.get("srv").protocolVersion = "2025-06-18";
    await expect(
      client._resolveElicitation("srv", "old-url", {
        mode: "url",
        message: "Authorize",
        elicitationId: "old-flow",
        url: "https://example.com/setup",
      }),
    ).rejects.toThrow(/unavailable under MCP 2025-06-18/);
  });

  it("validates URL mode and never returns out-of-band content", async () => {
    const request = normalizeMcpElicitationRequest("srv", 22, {
      mode: "url",
      elicitationId: "setup-1",
      url: "https://example.com/setup?flow=1",
      message: "Complete setup",
    });
    expect(request).toMatchObject({
      mode: "url",
      elicitationId: "setup-1",
      urlHost: "example.com",
    });
    expect(() =>
      normalizeMcpElicitationRequest("srv", 23, {
        mode: "url",
        elicitationId: "bad",
        url: "http://example.com/setup",
        message: "Unsafe",
      }),
    ).toThrow(/HTTPS/);

    const handler = vi.fn(async () => ({
      action: "accept",
      content: { secret: "must-not-cross-client" },
    }));
    const client = new MCPClient({ elicitationHandler: handler });
    await expect(
      client._resolveElicitation("srv", 22, request),
    ).resolves.toEqual({ action: "accept" });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "url",
        urlHost: "example.com",
      }),
    );
  });

  it("emits a structured defer and declines on the wire without a host", async () => {
    const client = new MCPClient();
    const deferred = vi.fn();
    client.on("elicitation-deferred", deferred);
    // A direct host may explicitly defer; removing the only request listener
    // afterward proves the transport's no-host resolution is bounded.
    client.setElicitationHandler(async () => ({ action: "defer" }));

    await expect(
      client._resolveElicitation("srv", 24, {
        message: "Need CI input",
        requestedSchema: { type: "object" },
      }),
    ).resolves.toEqual({ action: "decline" });
    expect(deferred).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "form",
        reason: "no_interactive_host",
        wireAction: "decline",
      }),
    );
  });

  it("declines above the bounded concurrent elicitation capacity", async () => {
    let release;
    const handler = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const client = new MCPClient({
      elicitationHandler: handler,
      maxConcurrentElicitations: 1,
    });
    const deferred = vi.fn();
    client.on("elicitation-deferred", deferred);

    const first = client._resolveElicitation("srv", "first", {
      message: "First request",
    });
    await new Promise((resolve) => setImmediate(resolve));
    await expect(
      client._resolveElicitation("srv", "second", {
        message: "Second request",
      }),
    ).resolves.toEqual({ action: "decline" });
    expect(deferred).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "second",
        reason: "capacity_exceeded",
        wireAction: "decline",
      }),
    );

    release({ action: "accept", content: { ok: true } });
    await expect(first).resolves.toEqual({
      action: "accept",
      content: { ok: true },
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
    expect(
      proc.written.find((message) => message.id === "event-1").result,
    ).toEqual({
      action: "accept",
      content: { value: 7 },
    });

    const noHost = new MCPClient();
    noHost._sendResponse = () => {};
    await expect(
      noHost._resolveElicitation("srv", 1, { message: "No host" }),
    ).resolves.toEqual({
      action: "decline",
    });
  });

  it("cancels event-driven elicitations for only the disconnected server", async () => {
    const client = new MCPClient({ elicitationTimeoutMs: 10_000 });
    client.on("elicitation-request", () => {});

    const disconnected = client._resolveElicitation("srv", "request", {
      message: "First server",
    });
    const sibling = client._resolveElicitation("srv:child", "request", {
      message: "Sibling server",
    });
    await new Promise((resolve) => setImmediate(resolve));

    await expect(client.disconnect("srv")).resolves.toBe(false);
    await expect(disconnected).resolves.toEqual({ action: "cancel" });
    expect(
      [...client._pendingElicitations.values()].map(
        (pending) => pending.request.server,
      ),
    ).toEqual(["srv:child"]);

    expect(client.cancelElicitation("srv:child", "request")).toBe(true);
    await expect(sibling).resolves.toEqual({ action: "cancel" });
    expect(client._pendingElicitations.size).toBe(0);
    expect(client._activeElicitations).toBe(0);
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
        client._resolveElicitation("srv", "a", {
          session: "a",
          message: "Session A",
        }),
      ),
      client.withElicitationContext("session-b", () =>
        client._resolveElicitation("srv", "b", {
          session: "b",
          message: "Session B",
        }),
      ),
    ]);
    expect(a.content).toEqual({ session: "a" });
    expect(b.content).toEqual({ session: "b" });
    expect(client.clearElicitationHandler("session-a")).toBe(true);
    expect(client.clearElicitationHandler("session-b")).toBe(true);
  });

  it("publishes and acknowledges MCP elicitation in the durable inbox", async () => {
    const records = [];
    const store = {
      enqueue: (queue, event, options) => {
        const row = { id: options.id, queue, event };
        records.push(row);
        return row;
      },
      acknowledgeInbox: (id, result) => {
        const row = records.find((item) => item.id === id);
        row.result = result;
        return row;
      },
    };
    const client = new MCPClient({
      eventRuntimeStore: store,
      elicitationHandler: async () => ({
        action: "accept",
        content: { ok: true },
      }),
    });
    await expect(
      client._resolveElicitation("srv", "r1", { message: "ok" }),
    ).resolves.toEqual({
      action: "accept",
      content: { ok: true },
    });
    expect(records[0].event).toMatchObject({
      type: "mcp_elicitation",
      origin: "mcp",
    });
    expect(records[0].result.response.content).toEqual({ ok: true });
  });

  it("does not grant URL-flow authority to a hand-built -32042 error", async () => {
    const handler = vi.fn(async () => ({ action: "accept" }));
    const client = new MCPClient({
      elicitationTimeoutMs: 100,
      elicitationHandler: handler,
    });
    const required = Object.assign(new Error("setup required"), {
      code: -32042,
      data: {
        elicitations: [
          {
            mode: "url",
            elicitationId: "flow-1",
            url: "https://example.com/setup",
            message: "Complete setup",
          },
        ],
      },
    });
    client._callToolOnce = vi.fn().mockRejectedValue(required);
    const completed = vi.fn();
    client.on("elicitation-complete", completed);

    await expect(client.callTool("srv", "finish", {})).rejects.toBe(required);
    expect(client._callToolOnce).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });

  it("does not lose a URL completion that races explicit host consent", async () => {
    let client;
    client = new MCPClient({
      elicitationHandler: async (request) => {
        expect(
          client._handleElicitationComplete(request.server, {
            elicitationId: request.elicitationId,
          }),
        ).toBe(true);
        return { action: "accept" };
      },
    });
    const completed = vi.fn();
    client.on("elicitation-complete", completed);

    await expect(
      client._resolveElicitation("srv", "race-1", {
        mode: "url",
        elicitationId: "flow-race",
        url: "https://example.com/setup",
        message: "Complete setup",
      }),
    ).resolves.toEqual({ action: "accept" });
    await expect(
      client.waitForElicitationCompletion("flow-race", 50),
    ).resolves.toBe(true);
    expect(completed).toHaveBeenCalledOnce();
  });

  it("rejects unbranded -32042 batches before prompting", async () => {
    const handler = vi.fn(async () => ({ action: "accept" }));
    const client = new MCPClient({ elicitationHandler: handler });
    const item = (id) => ({
      mode: "url",
      elicitationId: id,
      url: `https://example.com/setup/${id}`,
      message: "Complete setup",
    });

    await expect(
      client._resolveRequiredUrlElicitations("srv", {
        data: { elicitations: [item("same"), item("same")] },
      }),
    ).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("receives URL requests and completion over Streamable HTTP GET/SSE", async () => {
    const calls = [];
    const sseBody = [
      "id: event-1",
      'data: {"jsonrpc":"2.0","id":"http-elicit-1","method":"elicitation/create","params":{"mode":"url","message":"Authorize","elicitationId":"http-flow-1","url":"https://accounts.example.test/authorize"}}',
      "",
      "id: event-2",
      'data: {"jsonrpc":"2.0","method":"notifications/elicitation/complete","params":{"elicitationId":"http-flow-1"}}',
      "",
      "",
    ].join("\n");
    const response = (
      body = "",
      { status = 200, contentType = "application/json", sessionId = null } = {},
    ) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          if (key === "content-type") return contentType;
          if (key === "mcp-session-id") return sessionId;
          return null;
        },
      },
      body: textByteStream(body),
      async text() {
        return body;
      },
    });
    _deps.fetch = async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET") {
        return response(sseBody, { contentType: "text/event-stream" });
      }
      if (options.method === "DELETE") return response("");
      const message = JSON.parse(options.body);
      if (message.method === "initialize") {
        return response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-11-25",
              serverInfo: { name: "http-test" },
              capabilities: {},
            },
          }),
          { sessionId: "http-session-1" },
        );
      }
      if (message.method === "notifications/initialized") {
        return response("", { status: 202 });
      }
      if (message.method?.endsWith("/list")) {
        const field = message.method.split("/")[0];
        return response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { [field]: [] },
          }),
        );
      }
      // JSON-RPC response to the server-initiated elicitation/create request.
      return response("", { status: 202 });
    };
    const handler = vi.fn(async () => ({
      action: "accept",
      content: { secret: "must-stay-out-of-band" },
    }));
    const client = new MCPClient({ elicitationHandler: handler });
    const completed = vi.fn();
    client.on("elicitation-complete", completed);

    await client.connect("http-srv", {
      url: "https://mcp.example.test/mcp",
    });
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        server: "http-srv",
        mode: "url",
        elicitationId: "http-flow-1",
        urlHost: "accounts.example.test",
      }),
    );
    const getCall = calls.find((call) => call.options.method === "GET");
    expect(getCall.options.headers).toMatchObject({
      Accept: "text/event-stream",
      "Mcp-Session-Id": "http-session-1",
      "MCP-Protocol-Version": "2025-11-25",
    });
    const reply = calls
      .filter((call) => call.options.method === "POST")
      .map((call) => JSON.parse(call.options.body))
      .find((message) => message.id === "http-elicit-1");
    expect(reply.result).toEqual({ action: "accept" });
    expect(completed).toHaveBeenCalledOnce();

    await client.disconnect("http-srv");
  });

  it("resumes a closed HTTP message stream with Last-Event-ID", async () => {
    const calls = [];
    _deps.fetch = async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream" },
          body: textByteStream("id: cursor-1\nretry: 1\ndata:\n\n"),
          async text() {
            return "id: cursor-1\nretry: 1\ndata:\n\n";
          },
        };
      }
      return {
        ok: false,
        status: 405,
        headers: { get: () => null },
        async text() {
          return "";
        },
      };
    };
    const client = new MCPClient();
    client.servers.set("http-resume", {
      config: {},
      state: "connected",
      process: null,
      httpUrl: "https://mcp.example.test/mcp",
      httpHeaders: {},
      httpSessionId: "session-resume",
      protocolVersion: "2025-11-25",
      _httpMessageStream: null,
      _pending: new Map(),
    });

    expect(client._ensureHttpMessageStream("http-resume")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(calls).toHaveLength(2);
    expect(calls[1].headers).toMatchObject({
      "Last-Event-ID": "cursor-1",
      "Mcp-Session-Id": "session-resume",
      "MCP-Protocol-Version": "2025-11-25",
    });
    await client.disconnect("http-resume");
  });
});
