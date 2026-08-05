import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCPClient, ServerState, _deps } from "../../src/lib/mcp-client.js";

const HTTP_RESPONSE_HARD_LIMIT_BYTES = 16 * 1024 * 1024;
const ERROR_CANARY = "ERROR_BODY_CANARY_MUST_NOT_BE_READ";
const originalDeps = { ..._deps };
const openServers = new Set();

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  openServers.add(server);
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

function sendChunkedBody(
  response,
  {
    status,
    totalBytes,
    chunkBytes = 768,
    prefix = "",
    canaryOffset = Number.POSITIVE_INFINITY,
  },
) {
  let resolveClosed;
  const state = {
    bytesSent: 0,
    canarySent: false,
    closed: false,
    closedPromise: new Promise((resolve) => {
      resolveClosed = resolve;
    }),
    responseHeaders: null,
  };
  const chunk = Buffer.alloc(chunkBytes, status >= 400 ? "e" : "x");

  response.on("close", () => {
    state.closed = true;
    resolveClosed();
  });
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Transfer-Encoding", "chunked");
  response.setHeader("Connection", "close");
  state.responseHeaders = response.getHeaders();
  response.writeHead(status);

  const pump = () => {
    if (state.closed || response.destroyed) return;
    if (state.bytesSent >= totalBytes) {
      response.end();
      return;
    }
    const remaining = totalBytes - state.bytesSent;
    let next;
    if (state.bytesSent === 0 && prefix) {
      next = Buffer.from(prefix, "utf8");
    } else if (!state.canarySent && state.bytesSent >= canaryOffset) {
      state.canarySent = true;
      next = Buffer.from(ERROR_CANARY, "utf8");
    } else {
      next = remaining < chunk.length ? chunk.subarray(0, remaining) : chunk;
    }
    if (next.byteLength > remaining) next = next.subarray(0, remaining);
    state.bytesSent += next.byteLength;
    if (response.write(next)) setImmediate(pump);
    else response.once("drain", pump);
  };
  setImmediate(pump);
  return state;
}

async function startChunkedFixture(options) {
  let responseState = null;
  const server = createServer((_request, response) => {
    responseState = sendChunkedBody(response, options);
  });
  const url = await listen(server);
  return { server, url, getResponseState: () => responseState };
}

async function startDeclaredLengthFixture(contentLength) {
  let resolveClosed;
  const state = {
    closed: false,
    closedPromise: new Promise((resolve) => {
      resolveClosed = resolve;
    }),
  };
  const server = createServer((_request, response) => {
    response.on("close", () => {
      state.closed = true;
      resolveClosed();
    });
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": String(contentLength),
      Connection: "close",
    });
    response.flushHeaders();
  });
  const url = await listen(server);
  return { server, state, url };
}

async function expectBodyLimit(connectPromise, expectedLimit) {
  try {
    await connectPromise;
    throw new Error("expected the MCP HTTP response to exceed its byte limit");
  } catch (error) {
    expect(error).toMatchObject({
      code: "CC_MCP_HTTP_RESPONSE_TOO_LARGE",
      limitBytes: expectedLimit,
    });
    expect(error.message).toContain(`${expectedLimit}-byte cap`);
  }
}

async function expectHttpStatus(connectPromise, status) {
  try {
    await connectPromise;
    throw new Error(`expected HTTP ${status}`);
  } catch (error) {
    expect(error).toMatchObject({
      code: "CC_MCP_HTTP_STATUS",
      status,
    });
    return error;
  }
}

async function expectClosedEarly(state, canaryOffset) {
  let timer;
  await Promise.race([
    state.closedPromise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("HTTP fixture was not cancelled")),
        2000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  expect(state.closed).toBe(true);
  expect(state.bytesSent).toBeLessThan(canaryOffset);
  expect(state.canarySent).toBe(false);
}

describe("MCPClient HTTP response body byte limits", () => {
  beforeEach(() => {
    Object.assign(_deps, originalDeps);
    _deps.fetch = (...args) => globalThis.fetch(...args);
  });

  afterEach(async () => {
    Object.assign(_deps, originalDeps);
    for (const server of openServers) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    openServers.clear();
  });

  it("rejects a chunked success body without Content-Length before JSON parsing", async () => {
    const totalBytes = 64 * 1024;
    const fixture = await startChunkedFixture({
      status: 200,
      totalBytes,
      chunkBytes: 768,
    });

    await expectBodyLimit(
      new MCPClient().connect("oversized-success", {
        url: fixture.url,
        maxBufferChars: 1024,
        requestTimeoutMs: 5000,
      }),
      1024,
    );

    expect(fixture.getResponseState().responseHeaders).not.toHaveProperty(
      "content-length",
    );
    expect(fixture.getResponseState().responseHeaders).toHaveProperty(
      "transfer-encoding",
      "chunked",
    );
    await expectClosedEarly(fixture.getResponseState(), totalBytes);
  });

  it.each([401, 404, 503])(
    "bounds and cancels a chunked HTTP %i error body before its canary",
    async (status) => {
      const canaryOffset = 64 * 1024;
      const fixture = await startChunkedFixture({
        status,
        totalBytes: 2 * 1024 * 1024,
        chunkBytes: 768,
        prefix: `visible-error-${status}:`,
        canaryOffset,
      });

      const error = await expectHttpStatus(
        new MCPClient().connect(`oversized-error-${status}`, {
          url: fixture.url,
          maxBufferChars: 1024,
          requestTimeoutMs: 5000,
        }),
        status,
      );

      if (status === 401) expect(error.message).not.toContain("visible-error");
      else expect(error.message).toContain(`visible-error-${status}`);
      expect(error.message).not.toContain(ERROR_CANARY);
      expect(fixture.getResponseState().responseHeaders).not.toHaveProperty(
        "content-length",
      );
      expect(fixture.getResponseState().responseHeaders).toHaveProperty(
        "transfer-encoding",
        "chunked",
      );
      await expectClosedEarly(fixture.getResponseState(), canaryOffset);
    },
  );

  it("cancels an unsurfaced headersHelper error body without reading it", async () => {
    const canaryOffset = 64 * 1024;
    const fixture = await startChunkedFixture({
      status: 500,
      totalBytes: 2 * 1024 * 1024,
      chunkBytes: 768,
      prefix: "helper-secret-must-not-surface:",
      canaryOffset,
    });
    _deps.resolveMcpHeadersHelperContext = () => ({
      cwd: process.cwd(),
      execution: null,
      pluginRoot: null,
    });
    _deps.runMcpHeadersHelper = async () => ({
      Authorization: "Bearer opaque-secret",
    });

    const error = await expectHttpStatus(
      new MCPClient().connect("helper-error", {
        url: fixture.url,
        headersHelper: "fixture-helper",
        requestTimeoutMs: 5000,
      }),
      500,
    );

    expect(error.message).not.toContain("helper-secret");
    expect(error.message).not.toContain(ERROR_CANARY);
    await expectClosedEarly(fixture.getResponseState(), canaryOffset);
  });

  it("does not decode bytes beyond an exact error-preview boundary", async () => {
    const visible = Buffer.from("1234567", "utf8");
    const hidden = Buffer.from("你SECRET_AFTER_BOUNDARY", "utf8");
    const bytes = Buffer.concat([visible, hidden]);
    let cancelled = false;
    _deps.fetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      body: {
        getReader() {
          let read = false;
          return {
            async read() {
              if (read) return { done: true };
              read = true;
              return { done: false, value: bytes };
            },
            async cancel() {
              cancelled = true;
            },
            releaseLock() {},
          };
        },
      },
    });

    const error = await expectHttpStatus(
      new MCPClient().connect("utf8-preview", {
        url: "https://mcp.example.test/rpc",
        maxBufferChars: 8,
      }),
      500,
    );

    expect(cancelled).toBe(true);
    expect(error.message).toContain("1234567");
    expect(error.message).not.toContain("你");
    expect(error.message).not.toContain("SECRET_AFTER_BOUNDARY");
  });

  it("cancels and releases a finite response reader when reading fails", async () => {
    let cancelled = false;
    let released = false;
    _deps.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-type"
            ? "application/json"
            : null;
        },
      },
      body: {
        getReader() {
          return {
            async read() {
              throw new Error("fixture read failed");
            },
            async cancel() {
              cancelled = true;
            },
            releaseLock() {
              released = true;
            },
          };
        },
      },
    });

    await expect(
      new MCPClient().connect("read-failure", {
        url: "https://mcp.example.test/rpc",
      }),
    ).rejects.toThrow("fixture read failed");
    expect(cancelled).toBe(true);
    expect(released).toBe(true);
  });

  it.each([0, Number.MAX_SAFE_INTEGER])(
    "keeps the host-owned ceiling for maxBufferChars=%s and cancels before body read",
    async (maxBufferChars) => {
      const fixture = await startDeclaredLengthFixture(
        HTTP_RESPONSE_HARD_LIMIT_BYTES + 1,
      );

      await expectBodyLimit(
        new MCPClient().connect(`absolute-limit-${maxBufferChars}`, {
          url: fixture.url,
          maxBufferChars,
          requestTimeoutMs: 5000,
        }),
        HTTP_RESPONSE_HARD_LIMIT_BYTES,
      );

      let timer;
      await Promise.race([
        fixture.state.closedPromise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("declared-length response was not cancelled")),
            2000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      expect(fixture.state.closed).toBe(true);
    },
  );

  it.each([
    ["complete", true],
    ["unterminated", false],
  ])(
    "rejects an oversized %s background SSE event by UTF-8 bytes and stops reconnecting",
    async (_label, terminated) => {
      const event = `data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/oversized",
        params: { text: "你".repeat(40) },
      })}`;
      const cap = event.length;
      const wire = Buffer.from(`${event}${terminated ? "\n\n" : ""}`, "utf8");
      let cancelled = false;
      let fetchCalls = 0;
      _deps.fetch = async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          headers: {
            get(name) {
              return String(name).toLowerCase() === "content-type"
                ? "text/event-stream"
                : null;
            },
          },
          body: {
            getReader() {
              let read = false;
              return {
                async read() {
                  if (read) return { done: true };
                  read = true;
                  return { done: false, value: wire };
                },
                async cancel() {
                  cancelled = true;
                },
                releaseLock() {},
              };
            },
          },
        };
      };

      const client = new MCPClient();
      const notifications = [];
      client.on("notification", (notification) =>
        notifications.push(notification),
      );
      client.servers.set("sse-stream", {
        config: { maxBufferChars: cap },
        httpHeaders: {},
        httpSessionId: null,
        httpUrl: "https://mcp.example.test/rpc",
        protocolVersion: "2025-11-25",
        state: ServerState.CONNECTED,
        transportKind: "https",
        _httpMessageStream: null,
        _pending: new Map(),
      });
      const streamError = new Promise((resolve) =>
        client.once("server-stream-error", resolve),
      );

      expect(client._ensureHttpMessageStream("sse-stream")).toBe(true);
      const activeStream = client.servers.get("sse-stream")._httpMessageStream;
      const emitted = await streamError;
      await activeStream.promise;

      expect(Buffer.byteLength(event, "utf8")).toBeGreaterThan(cap);
      expect(emitted).toMatchObject({
        name: "sse-stream",
        code: "CC_MCP_HTTP_RESPONSE_TOO_LARGE",
        limitBytes: cap,
      });
      expect(cancelled).toBe(true);
      expect(fetchCalls).toBe(1);
      expect(notifications).toHaveLength(0);
      expect(client.servers.get("sse-stream")._httpMessageStream).toBeNull();
    },
  );
});
