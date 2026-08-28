import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  FederatedTransportBoundaryError,
  createFederatedTransportBoundaries,
  serializeFederatedMessage,
} = require("../federated-transport-boundaries");
const { ModelParameterSync } = require("../model-parameter-sync");

function createP2PManager() {
  let protocolHandler;
  const node = {
    handle: vi.fn((_protocol, handler) => {
      protocolHandler = handler;
    }),
    unhandle: vi.fn(),
    dialProtocol: vi.fn(),
  };
  return {
    node,
    peers: new Map(),
    getProtocolHandler: () => protocolHandler,
  };
}

function createStream(chunks) {
  return {
    source: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    },
    abort: vi.fn(),
  };
}

function createConnection(peerId = "peer-1") {
  return { remotePeer: { toString: () => peerId } };
}

describe("federated transport boundary config", () => {
  it("rejects unknown, zero, and above-hard-limit values", () => {
    expect(() => createFederatedTransportBoundaries({ typo: 1 })).toThrowError(
      expect.objectContaining({ code: "ERR_FEDERATED_BOUNDARY_CONFIG" }),
    );
    expect(() =>
      createFederatedTransportBoundaries({ maxMessageBytes: 0 }),
    ).toThrowError(FederatedTransportBoundaryError);
    expect(() =>
      createFederatedTransportBoundaries({
        maxMessageBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrowError(FederatedTransportBoundaryError);
  });

  it("rejects messages whose custom serializer erases the JSON object", () => {
    const boundaries = createFederatedTransportBoundaries();
    expect(() =>
      serializeFederatedMessage(
        { type: "federated:test", toJSON: () => undefined },
        boundaries,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_FEDERATED_MESSAGE_INVALID" }),
    );
  });
});

describe("ModelParameterSync bounded transport", () => {
  it("accepts a fragmented bounded message and invokes a removable handler", async () => {
    const p2pManager = createP2PManager();
    const manager = new ModelParameterSync({ p2pManager });
    const listener = vi.fn();
    const unsubscribe = manager.onMessage(listener);
    const payload = Buffer.from(
      JSON.stringify({ type: "federated:request-gradients", roundId: "r1" }),
    );
    const stream = createStream([payload.subarray(0, 8), payload.subarray(8)]);

    await p2pManager.getProtocolHandler()({
      stream,
      connection: createConnection(),
    });

    expect(listener).toHaveBeenCalledWith({
      peerId: "peer-1",
      message: { type: "federated:request-gradients", roundId: "r1" },
    });
    unsubscribe();
    expect(manager.messageHandlers.size).toBe(0);
    manager.destroy();
  });

  it("aborts streams that exceed byte or chunk boundaries", async () => {
    const p2pManager = createP2PManager();
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: { maxMessageBytes: 16, maxStreamChunks: 1 },
    });
    const errors = [];
    manager.on("boundary-error", (error) => errors.push(error.code));
    const byteStream = createStream([Buffer.alloc(17)]);
    await p2pManager.getProtocolHandler()({
      stream: byteStream,
      connection: createConnection(),
    });
    const chunkStream = createStream([Buffer.from("{"), Buffer.from("}")]);
    await p2pManager.getProtocolHandler()({
      stream: chunkStream,
      connection: createConnection(),
    });

    expect(byteStream.abort).toHaveBeenCalledOnce();
    expect(chunkStream.abort).toHaveBeenCalledOnce();
    expect(errors).toEqual([
      "ERR_FEDERATED_MESSAGE_TOO_LARGE",
      "ERR_FEDERATED_STREAM_CHUNKS_EXCEEDED",
    ]);
    manager.destroy();
  });

  it("times out a peer that never finishes its stream", async () => {
    const p2pManager = createP2PManager();
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: { streamDeadlineMs: 20 },
    });
    const stream = {
      source: {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise(() => {}),
            return: vi.fn(),
          };
        },
      },
      abort: vi.fn(),
    };
    const boundaryError = vi.fn();
    manager.on("boundary-error", boundaryError);

    await p2pManager.getProtocolHandler()({
      stream,
      connection: createConnection(),
    });

    expect(stream.abort).toHaveBeenCalledOnce();
    expect(boundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ERR_FEDERATED_STREAM_TIMEOUT" }),
    );
    manager.destroy();
  });

  it("applies one total deadline to retained message handlers", async () => {
    const p2pManager = createP2PManager();
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: { streamDeadlineMs: 20 },
    });
    manager.onMessage(() => new Promise(() => {}));
    const boundaryError = vi.fn();
    manager.on("boundary-error", boundaryError);
    const stream = createStream([
      Buffer.from(JSON.stringify({ type: "federated:test" })),
    ]);

    await p2pManager.getProtocolHandler()({
      stream,
      connection: createConnection(),
    });

    expect(stream.abort).toHaveBeenCalledOnce();
    expect(boundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ERR_FEDERATED_HANDLER_TIMEOUT" }),
    );
    expect(manager._activeInbound).toBe(0);
    manager.destroy();
  });

  it("rejects excess inbound operations and message handlers", async () => {
    const p2pManager = createP2PManager();
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: {
        maxConcurrentInbound: 1,
        maxMessageHandlers: 1,
        streamDeadlineMs: 1000,
      },
    });
    let finishFirst;
    const firstStream = {
      source: {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise((resolve) => {
                finishFirst = resolve;
              }),
            return: vi.fn(),
          };
        },
      },
      abort: vi.fn(),
    };
    const first = p2pManager.getProtocolHandler()({
      stream: firstStream,
      connection: createConnection("peer-1"),
    });
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    const secondStream = createStream([]);
    await p2pManager.getProtocolHandler()({
      stream: secondStream,
      connection: createConnection("peer-2"),
    });
    finishFirst({ done: true });
    await first;

    expect(secondStream.abort).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ERR_FEDERATED_INBOUND_CAPACITY" }),
    );
    const unsubscribe = manager.onMessage(vi.fn());
    expect(() => manager.onMessage(vi.fn())).toThrowError(
      expect.objectContaining({ code: "ERR_FEDERATED_HANDLER_CAPACITY" }),
    );
    unsubscribe();
    manager.destroy();
  });

  it("rejects oversized outbound payloads before dialing", async () => {
    const p2pManager = createP2PManager();
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: { maxMessageBytes: 32 },
    });

    await expect(
      manager._sendMessage("peer-1", {
        type: "federated:test",
        payload: "x".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "ERR_FEDERATED_MESSAGE_TOO_LARGE" });
    expect(p2pManager.node.dialProtocol).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("bounds outbound dialing and releases its capacity after timeout", async () => {
    const p2pManager = createP2PManager();
    p2pManager.node.dialProtocol.mockImplementation(
      () => new Promise(() => {}),
    );
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: { streamDeadlineMs: 20 },
    });

    await expect(
      manager._sendMessage("peer-1", { type: "federated:test" }),
    ).rejects.toMatchObject({ code: "ERR_FEDERATED_STREAM_TIMEOUT" });
    expect(manager._activeOutbound).toBe(0);
    manager.destroy();
  });

  it("rejects excess outbound work and fences a dial that resolves after destroy", async () => {
    const p2pManager = createP2PManager();
    let resolveDial;
    p2pManager.node.dialProtocol.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDial = resolve;
        }),
    );
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: { maxConcurrentOutbound: 1, streamDeadlineMs: 1000 },
    });
    const firstSend = manager._sendMessage("peer-1", {
      type: "federated:test",
    });
    await vi.waitFor(() => expect(resolveDial).toBeTypeOf("function"));
    await expect(
      manager._sendMessage("peer-2", { type: "federated:test" }),
    ).rejects.toMatchObject({ code: "ERR_FEDERATED_OUTBOUND_CAPACITY" });

    manager.destroy();
    const stream = { sink: vi.fn(), abort: vi.fn() };
    resolveDial(stream);
    await expect(firstSend).rejects.toMatchObject({
      code: "ERR_FEDERATED_DESTROYED",
    });
    expect(stream.sink).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledOnce();
    expect(manager._activeOutbound).toBe(0);
    expect(() => manager.onMessage(vi.fn())).toThrowError(
      expect.objectContaining({ code: "ERR_FEDERATED_DESTROYED" }),
    );
  });

  it("caps broadcast peers and detaches the protocol on destroy", async () => {
    const p2pManager = createP2PManager();
    p2pManager.peers.set("peer-1", {});
    p2pManager.peers.set("peer-2", {});
    const manager = new ModelParameterSync({
      p2pManager,
      boundaries: { maxBroadcastPeers: 1 },
    });

    await expect(
      manager._broadcastMessage({ type: "federated:test" }),
    ).rejects.toMatchObject({ code: "ERR_FEDERATED_BROADCAST_CAPACITY" });
    manager.destroy();
    manager.destroy();
    expect(p2pManager.node.unhandle).toHaveBeenCalledOnce();
  });

  it("keeps main-process shutdown wired to federated cleanup", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );
    expect(mainSource).toContain("this.federatedManager.destroy?.()");
  });
});
