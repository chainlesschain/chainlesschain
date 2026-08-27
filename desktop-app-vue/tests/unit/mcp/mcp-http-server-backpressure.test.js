import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const {
  MCPHttpServer,
  HTTP_SERVER_HARD_LIMITS,
  HTTP_SERVER_LIMITS,
} = require("../../../src/main/mcp/sdk/http-server.js");

class FakeRequest extends EventEmitter {
  constructor(headers = {}) {
    super();
    this.headers = headers;
    this.resume = vi.fn();
  }
}

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = null;
    this.writes = [];
    this.writableEnded = false;
    this.writableLength = 0;
    this.destroyed = false;
    this.writeResult = true;
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
  }

  write(value) {
    const payload = String(value);
    this.writes.push(payload);
    this.writableLength += Buffer.byteLength(payload);
    return this.writeResult;
  }

  end(value) {
    if (value != null) this.writes.push(String(value));
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit("finish");
  }
}

function rpcBody(id = 1) {
  return Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }));
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("MCPHttpServer bounded admission and backpressure", () => {
  it("uses bounded defaults and clamps caller-provided limits", () => {
    const defaults = new MCPHttpServer({
      maxSseConnections: 0,
      maxConcurrentRpcRequests: Number.POSITIVE_INFINITY,
    });
    expect(defaults.limits).toMatchObject({
      maxSseConnections: HTTP_SERVER_LIMITS.maxSseConnections,
      maxConcurrentRpcRequests: HTTP_SERVER_LIMITS.maxConcurrentRpcRequests,
    });

    const clamped = new MCPHttpServer({
      maxSseConnections: Number.MAX_SAFE_INTEGER,
      maxConcurrentRpcRequests: Number.MAX_SAFE_INTEGER,
      maxRequestBodyBytes: Number.MAX_SAFE_INTEGER,
      maxSseEventBytes: Number.MAX_SAFE_INTEGER,
      maxSseBufferedBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(clamped.limits).toEqual(HTTP_SERVER_HARD_LIMITS);
    expect(Object.isFrozen(clamped.limits)).toBe(true);
  });

  it("rejects SSE clients before exceeding connection capacity", () => {
    const server = new MCPHttpServer({ maxSseConnections: 1 });
    const firstRequest = new FakeRequest();
    const firstResponse = new FakeResponse();
    const firstClientId = server.handleSSE(firstRequest, firstResponse);

    const rejectedRequest = new FakeRequest();
    const rejectedResponse = new FakeResponse();
    expect(server.handleSSE(rejectedRequest, rejectedResponse)).toBeNull();

    expect(firstClientId).toEqual(expect.any(String));
    expect(server.sseClients.size).toBe(1);
    expect(rejectedResponse.statusCode).toBe(503);
    expect(rejectedResponse.headers["Retry-After"]).toBe("1");
    expect(JSON.parse(rejectedResponse.writes.at(-1))).toMatchObject({
      error: "OVERLOADED",
      scope: "sse_connections",
      retryAfterMs: 1000,
    });
    expect(server.getStats()).toMatchObject({
      activeSSEConnections: 1,
      sseConnectionsRejected: 1,
    });

    firstRequest.emit("close");
    expect(server.sseClients.size).toBe(0);
  });

  it("disconnects buffered and backpressured SSE consumers", () => {
    const server = new MCPHttpServer({ maxSseBufferedBytes: 256 });
    const bufferedRequest = new FakeRequest();
    const bufferedResponse = new FakeResponse();
    const blockedRequest = new FakeRequest();
    const blockedResponse = new FakeResponse();
    server.handleSSE(bufferedRequest, bufferedResponse);
    server.handleSSE(blockedRequest, blockedResponse);

    bufferedResponse.writableLength = 256;
    blockedResponse.writableLength = 0;
    blockedResponse.writeResult = false;
    const result = server.sendNotification("tools/list_changed", {});

    expect(result).toEqual({
      sent: 0,
      disconnected: 2,
      dropped: 0,
      reason: null,
    });
    expect(server.sseClients.size).toBe(0);
    expect(bufferedResponse.writableEnded).toBe(true);
    expect(blockedResponse.writableEnded).toBe(true);
    expect(server.getStats().sseSlowConsumers).toBe(2);
  });

  it("drops oversized SSE events without retaining or broadcasting them", () => {
    const server = new MCPHttpServer({ maxSseEventBytes: 128 });
    const request = new FakeRequest();
    const response = new FakeResponse();
    server.handleSSE(request, response);
    const writesBefore = response.writes.length;

    const result = server.sendNotification("oversized", {
      value: "x".repeat(256),
    });

    expect(result).toMatchObject({
      sent: 0,
      dropped: 1,
      reason: "event_too_large",
    });
    expect(response.writes).toHaveLength(writesBefore);
    expect(server.getStats().sseEventsRejected).toBe(1);
    expect(server.sseClients.size).toBe(1);

    request.emit("close");
  });

  it("returns structured overload before admitting excess RPC work", async () => {
    const server = new MCPHttpServer({ maxConcurrentRpcRequests: 1 });
    let resolveFirst;
    server._routeMethod = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const firstRequest = new FakeRequest();
    const firstResponse = new FakeResponse();
    server._handleJsonRpcRequest(firstRequest, firstResponse);
    firstRequest.emit("data", rpcBody(1));
    firstRequest.emit("end");
    await flushAsyncWork();
    expect(server.activeRpcRequests).toBe(1);

    const rejectedRequest = new FakeRequest();
    const rejectedResponse = new FakeResponse();
    server._handleJsonRpcRequest(rejectedRequest, rejectedResponse);

    expect(rejectedResponse.statusCode).toBe(503);
    expect(rejectedRequest.resume).toHaveBeenCalledOnce();
    expect(JSON.parse(rejectedResponse.writes.at(-1))).toMatchObject({
      error: "OVERLOADED",
      scope: "rpc_requests",
    });
    expect(server.getStats()).toMatchObject({
      activeRpcRequests: 1,
      rpcRequestsOverloaded: 1,
    });

    resolveFirst({ status: "pong" });
    await flushAsyncWork();
    expect(firstResponse.statusCode).toBe(200);
    expect(server.activeRpcRequests).toBe(0);
  });

  it("enforces request limits using UTF-8 bytes, not string length", () => {
    const server = new MCPHttpServer({ maxRequestBodyBytes: 4 });
    server._routeMethod = vi.fn();
    const request = new FakeRequest();
    const response = new FakeResponse();
    server._handleJsonRpcRequest(request, response);

    request.emit("data", Buffer.from("ééé", "utf8"));

    expect(response.statusCode).toBe(413);
    expect(response.writableEnded).toBe(true);
    expect(server._routeMethod).not.toHaveBeenCalled();
    expect(server.getStats()).toMatchObject({
      activeRpcRequests: 0,
      requestBodiesRejected: 1,
    });
  });

  it("rejects an oversized declared body without installing data handlers", () => {
    const server = new MCPHttpServer({ maxRequestBodyBytes: 16 });
    const request = new FakeRequest({ "content-length": "100" });
    const response = new FakeResponse();

    server._handleJsonRpcRequest(request, response);

    expect(response.statusCode).toBe(413);
    expect(request.resume).toHaveBeenCalledOnce();
    expect(request.listenerCount("data")).toBe(0);
    expect(server.activeRpcRequests).toBe(0);
  });
});
