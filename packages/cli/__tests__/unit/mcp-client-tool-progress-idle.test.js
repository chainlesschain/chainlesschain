import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPClient, ServerState } from "../../src/harness/mcp-client.js";

function connectedClient(timeoutMs = 100) {
  const client = new MCPClient();
  client.servers.set("srv", {
    state: ServerState.CONNECTED,
    config: { toolIdleTimeoutMs: timeoutMs },
    _pending: new Map(),
  });
  return client;
}

function pendingTransport(client) {
  let params = null;
  let resolveRequest;
  client._sendRequest = vi.fn(
    (_server, _method, requestParams, options) =>
      new Promise((resolve, reject) => {
        params = requestParams;
        resolveRequest = resolve;
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("transport aborted")),
          { once: true },
        );
      }),
  );
  return {
    get params() {
      return params;
    },
    resolve(result = { content: [] }) {
      resolveRequest(result);
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("MCP tools/call progress idle watchdog", () => {
  it("requests a progress token and renews the deadline from progress notifications", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    const transport = pendingTransport(client);
    const observed = [];
    client.on("tool-progress", (event) => observed.push(event));

    const result = client.callTool("srv", "search", { query: "private" });
    const progressToken = transport.params?._meta?.progressToken;
    expect(progressToken).toMatch(/^cc:/);

    await vi.advanceTimersByTimeAsync(90);
    client._handleMessage("srv", {
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        progressToken,
        progress: 1,
        total: 2,
        message: "private server progress text",
      },
    });
    await vi.advanceTimersByTimeAsync(90);
    transport.resolve();

    await expect(result).resolves.toEqual({ content: [] });
    expect(observed).toEqual([
      {
        server: "srv",
        progressToken,
        progress: 1,
        total: 2,
      },
    ]);
    expect(JSON.stringify(observed)).not.toContain("private server");
    expect(client._toolProgress.size).toBe(0);
  });

  it("cancels a tool with no progress using a stable idle-timeout error", async () => {
    vi.useFakeTimers();
    const client = connectedClient(75);
    pendingTransport(client);

    const result = client.callTool("srv", "slow_tool", {});
    const rejection = expect(result).rejects.toMatchObject({
      code: "CC_MCP_TOOL_IDLE_TIMEOUT",
      timeoutMs: 75,
    });
    await vi.advanceTimersByTimeAsync(75);

    await rejection;
    expect(client._toolProgress.size).toBe(0);
  });
});
