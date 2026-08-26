import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  HttpSseTransport,
} = require("../../../src/main/mcp/transports/http-sse-transport.js");

describe("HttpSseTransport backpressure", () => {
  it("rejects new work when the pending request cap is reached", async () => {
    const transport = new HttpSseTransport({
      maxPendingRequests: 1,
      timeout: 60_000,
      enableHeartbeat: false,
      enableHealthCheck: false,
    });
    transport.isConnected = true;
    transport._sendHttpRequest = vi.fn(() => new Promise(() => {}));

    const first = transport.send({ jsonrpc: "2.0", method: "tools/list" });
    await expect(
      transport.send({ jsonrpc: "2.0", method: "resources/list" }),
    ).rejects.toMatchObject({ code: "OVERLOADED", retryAfterMs: 100 });

    const id = [...transport.pendingResponses.keys()][0];
    transport._handleMessage({ jsonrpc: "2.0", id, result: [] });
    await expect(first).resolves.toEqual([]);
  });
});
