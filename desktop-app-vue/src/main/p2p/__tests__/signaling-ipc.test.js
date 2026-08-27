const handlers = new Map();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  _setIpcMainForTesting,
  registerSignalingIPC,
  unregisterSignalingIPC,
} = require("../signaling-ipc");

beforeEach(() => {
  handlers.clear();
  _setIpcMainForTesting({
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
  });
});

afterEach(() => {
  unregisterSignalingIPC();
});

describe("signaling IPC bounded peer pages", () => {
  it("passes pagination to the server and preserves page metadata", async () => {
    const page = {
      peers: [{ peerId: "p1" }],
      count: 1,
      total: 3,
      cursor: 1,
      nextCursor: 2,
    };
    const server = { getPeers: vi.fn(() => page) };
    registerSignalingIPC({ signalingServer: server });

    const result = await handlers.get("signaling:get-peers")(
      {},
      {
        cursor: 1,
        limit: 1,
      },
    );

    expect(server.getPeers).toHaveBeenCalledWith({ cursor: 1, limit: 1 });
    expect(result).toEqual({ success: true, ...page });
  });

  it("returns a failed result when bounded config validation rejects", async () => {
    const server = {
      setConfig: vi.fn(() => {
        throw new RangeError("maxConnections exceeds hard maximum");
      }),
    };
    registerSignalingIPC({ signalingServer: server });

    const result = await handlers.get("signaling:set-config")(
      {},
      {
        maxConnections: Number.MAX_SAFE_INTEGER,
      },
    );

    expect(result).toMatchObject({
      success: false,
      error: "maxConnections exceeds hard maximum",
    });
  });
});
