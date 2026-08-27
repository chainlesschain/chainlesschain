vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handlers = require("../signaling-handlers");

describe("bounded signaling handlers", () => {
  it("uses the registered socket identity instead of a spoofed from field", () => {
    const targetSocket = {};
    const sent = [];
    handlers.handleMessage(
      { peerId: "registered-peer" },
      { to: "target", from: "spoofed-peer", payload: { ok: true } },
      {
        getPeer: () => ({ socket: targetSocket }),
        isOnline: () => true,
        updateLastSeen: vi.fn(),
      },
      { enqueue: vi.fn() },
      (socket, message) => sent.push({ socket, message }),
    );
    expect(sent[0].message.from).toBe("registered-peer");
  });

  it("returns explicit overload and does not claim an offline enqueue succeeded", () => {
    const sent = [];
    handlers.handleMessage(
      { peerId: "sender" },
      { to: "target", payload: { ok: true } },
      { getPeer: () => null, isOnline: () => false },
      {
        enqueue: () => ({
          success: false,
          code: "OVERLOADED",
          reason: "TOTAL_BYTE_LIMIT",
          retryAfterMs: 250,
        }),
      },
      (_socket, message) => sent.push(message),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "error",
      code: "OVERLOADED",
      reason: "TOTAL_BYTE_LIMIT",
      retryAfterMs: 250,
    });
  });

  it("paginates peer discovery and reports a continuation cursor", () => {
    const sent = [];
    handlers.handleGetPeers(
      { peerId: "self" },
      { cursor: 1, limit: 1 },
      {
        getOnlinePeers: () => [
          { peerId: "self" },
          { peerId: "a" },
          { peerId: "b" },
          { peerId: "c" },
        ],
      },
      (_socket, message) => sent.push(message),
      { peerListPageSize: 2, peerListMaxPageSize: 2, maxMessageBytes: 1024 },
    );
    expect(sent[0]).toMatchObject({
      peers: [{ peerId: "b" }],
      count: 1,
      total: 3,
      cursor: 1,
      nextCursor: 2,
    });
  });

  it("acknowledges only offline messages accepted by the socket", () => {
    const removed = [];
    let sends = 0;
    handlers.handleRegister(
      {},
      { peerId: "p1" },
      {
        getPeer: () => ({ socket: {} }),
        register: () => ({ isReconnect: false, previousConnection: null }),
        isOnline: () => true,
      },
      {
        peek: () => [
          { messageId: "m1", message: { n: 1 }, storedAt: 1 },
          { messageId: "m2", message: { n: 2 }, storedAt: 2 },
        ],
        removeMessage: (_peerId, messageId) => removed.push(messageId),
      },
      (_socket, message) => {
        if (message.type !== "offline-message") return true;
        sends++;
        return sends === 1;
      },
      vi.fn(),
    );
    expect(removed).toEqual(["m1"]);
  });
});
