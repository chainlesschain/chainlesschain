import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const {
  ERROR_CODES,
  P2PCommandAdapter,
} = require("../../../src/main/remote/p2p-command-adapter.js");

function createAdapter(options = {}) {
  const p2pManager = {
    on: vi.fn(),
    sendMessage: vi.fn(),
  };
  return {
    adapter: new P2PCommandAdapter(p2pManager, null, {
      enableHeartbeat: false,
      ...options,
    }),
    p2pManager,
  };
}

describe("P2PCommandAdapter backpressure", () => {
  it("rejects outbound commands beyond the pending cap", async () => {
    const { adapter, p2pManager } = createAdapter({ maxPendingRequests: 1 });
    adapter.pendingRequests.set("occupied", {});

    await expect(
      adapter.sendCommand("peer", "status", {}),
    ).rejects.toMatchObject({ code: "OVERLOADED", retryAfterMs: 100 });
    expect(p2pManager.sendMessage).not.toHaveBeenCalled();
  });

  it("returns a retryable overload response at the inbound cap", async () => {
    const { adapter, p2pManager } = createAdapter({ maxRunningCommands: 1 });
    adapter.admittedInboundCommands.add("occupied");

    await adapter.handleCommandRequest("peer", {
      id: "request-2",
      method: "status",
    });

    const response = JSON.parse(p2pManager.sendMessage.mock.calls[0][1]);
    expect(response.payload.error).toMatchObject({
      code: ERROR_CODES.OVERLOADED,
      data: { retryAfterMs: 100, retry_after_ms: 100 },
    });
    expect(adapter.admittedInboundCommands.size).toBe(1);
  });
});
