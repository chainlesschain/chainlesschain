import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPClient, ServerState, _deps } from "../../src/harness/mcp-client.js";
import { textByteStream } from "../helpers/mcp-http-response.js";

const originalFetch = _deps.fetch;

afterEach(() => {
  _deps.fetch = originalFetch;
});

function admissionProbe(expectedTransport, onDispatch = null) {
  let inside = false;
  const admission = vi.fn((metadata, dispatch) => {
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(metadata).toMatchObject({
      method: "tools/call",
      transport: expectedTransport,
    });
    inside = true;
    try {
      return dispatch();
    } finally {
      inside = false;
    }
  });
  return {
    admission,
    assertInside() {
      expect(inside).toBe(true);
      onDispatch?.();
    },
  };
}

function connectedEntry(overrides = {}) {
  return {
    state: ServerState.CONNECTED,
    transportKind: "stdio",
    config: { requestTimeoutMs: 1_000 },
    _pending: new Map(),
    ...overrides,
  };
}

function jsonResponse(id, result) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    body: textByteStream(body),
  };
}

describe("MCP tool dispatch admission", () => {
  it("starts the actual stdio write inside the one-shot host admission", async () => {
    const client = new MCPClient();
    const probe = admissionProbe("stdio");
    const write = vi.fn((serialized) => {
      probe.assertInside();
      const request = JSON.parse(serialized);
      queueMicrotask(() =>
        client._handleMessage("stdio", {
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [] },
        }),
      );
      return true;
    });
    client.servers.set(
      "stdio",
      connectedEntry({ process: { stdin: { write } } }),
    );

    await expect(
      client.callTool(
        "stdio",
        "mutate",
        {},
        {
          dispatchAdmission: probe.admission,
        },
      ),
    ).resolves.toEqual({ content: [] });
    expect(probe.admission).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });

  it("starts the actual WebSocket send inside the one-shot host admission", async () => {
    const client = new MCPClient();
    const probe = admissionProbe("ws");
    const socket = {
      readyState: 1,
      send: vi.fn((serialized, callback) => {
        probe.assertInside();
        const request = JSON.parse(serialized);
        callback?.(null);
        queueMicrotask(() =>
          client._handleMessage("ws", {
            jsonrpc: "2.0",
            id: request.id,
            result: { content: [] },
          }),
        );
      }),
    };
    client.servers.set(
      "ws",
      connectedEntry({
        transportKind: "ws",
        config: { url: "ws://fixture.test", requestTimeoutMs: 1_000 },
        socket,
      }),
    );

    await expect(
      client.callTool(
        "ws",
        "mutate",
        {},
        {
          dispatchAdmission: probe.admission,
        },
      ),
    ).resolves.toEqual({ content: [] });
    expect(probe.admission).toHaveBeenCalledOnce();
    expect(socket.send).toHaveBeenCalledOnce();
  });

  it("starts the actual HTTP fetch inside the one-shot host admission", async () => {
    const client = new MCPClient();
    const probe = admissionProbe("https");
    _deps.fetch = vi.fn((_url, options) => {
      probe.assertInside();
      const request = JSON.parse(options.body);
      return Promise.resolve(jsonResponse(request.id, { content: [] }));
    });
    client.servers.set(
      "http",
      connectedEntry({
        transportKind: "https",
        httpUrl: "https://fixture.test/mcp",
        httpHeaders: {},
        protocolVersion: "2025-11-25",
        _httpRequestControllers: new Set(),
      }),
    );

    await expect(
      client.callTool(
        "http",
        "mutate",
        {},
        {
          dispatchAdmission: probe.admission,
        },
      ),
    ).resolves.toEqual({ content: [] });
    expect(probe.admission).toHaveBeenCalledOnce();
    expect(_deps.fetch).toHaveBeenCalledOnce();
  });

  it("rechecks the same host admission for a reconnect retry", async () => {
    const client = new MCPClient();
    const probe = admissionProbe("https");
    let attempt = 0;
    _deps.fetch = vi.fn((_url, options) => {
      probe.assertInside();
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(
          Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }),
        );
      }
      const request = JSON.parse(options.body);
      return Promise.resolve(jsonResponse(request.id, { content: [] }));
    });
    client.servers.set(
      "retry",
      connectedEntry({
        transportKind: "https",
        httpUrl: "https://fixture.test/mcp",
        httpHeaders: {},
        protocolVersion: "2025-11-25",
        _httpRequestControllers: new Set(),
      }),
    );
    client._reconnectors.set("retry", vi.fn());
    client._tryReconnect = vi.fn(async () => true);

    await expect(
      client.callTool(
        "retry",
        "mutate",
        {},
        {
          dispatchAdmission: probe.admission,
        },
      ),
    ).resolves.toEqual({ content: [] });
    expect(probe.admission).toHaveBeenCalledTimes(2);
    expect(_deps.fetch).toHaveBeenCalledTimes(2);
    expect(client._tryReconnect).toHaveBeenCalledOnce();
  });

  it("cannot send after an admission callback returns without dispatching", async () => {
    const client = new MCPClient();
    let retainedDispatch = null;
    const write = vi.fn();
    client.servers.set(
      "stdio",
      connectedEntry({ process: { stdin: { write } } }),
    );

    await expect(
      client.callTool(
        "stdio",
        "mutate",
        {},
        {
          dispatchAdmission: (_metadata, dispatch) => {
            retainedDispatch = dispatch;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "CC_MCP_DISPATCH_ADMISSION_REQUIRED" });
    expect(() => retainedDispatch()).toThrow(
      expect.objectContaining({ code: "CC_MCP_DISPATCH_ADMISSION_INVALID" }),
    );
    expect(write).not.toHaveBeenCalled();
  });
});
