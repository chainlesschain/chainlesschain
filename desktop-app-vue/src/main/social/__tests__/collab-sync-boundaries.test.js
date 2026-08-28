import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  SocialCollabBoundaryError,
  createSocialCollabBoundaries,
  normalizeSocialCollabUpdate,
  serializeSocialCollabMessage,
} = require("../social-collab-boundaries");
const { CollabSync, MessageType } = require("../collab-sync");

function createP2PManager() {
  const p2pManager = new EventEmitter();
  let protocolHandler;
  p2pManager.node = {
    handle: vi.fn((_protocol, handler) => {
      protocolHandler = handler;
    }),
    unhandle: vi.fn(),
    dialProtocol: vi.fn(async () => ({
      sink: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      abort: vi.fn(),
    })),
  };
  p2pManager.getProtocolHandler = () => protocolHandler;
  return p2pManager;
}

function createAsyncStream(chunks) {
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

function connection(peerId = "peer-1") {
  return { remotePeer: { toString: () => peerId } };
}

const managers = [];

async function createManager(options = {}, yjsCollabManager = null) {
  const p2pManager = createP2PManager();
  const manager = new CollabSync(p2pManager, yjsCollabManager, options);
  managers.push(manager);
  await manager.initialize();
  return { manager, p2pManager };
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.destroy()));
});

describe("social collaboration boundaries", () => {
  it("rejects unknown, inconsistent, and oversized boundary inputs", () => {
    expect(() => createSocialCollabBoundaries({ typo: 1 })).toThrowError(
      expect.objectContaining({
        code: "ERR_SOCIAL_COLLAB_BOUNDARY_CONFIG",
      }),
    );
    expect(() =>
      createSocialCollabBoundaries({
        maxMessageBytes: 8,
        maxUpdateBytes: 16,
      }),
    ).toThrowError(SocialCollabBoundaryError);
    const boundaries = createSocialCollabBoundaries({ maxUpdateBytes: 2 });
    expect(() =>
      normalizeSocialCollabUpdate(Uint8Array.from([1, 2, 3]), boundaries),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_SOCIAL_COLLAB_UPDATE_TOO_LARGE" }),
    );
  });

  it("accepts fragmented async-iterable messages through the public Yjs path", async () => {
    const yjsCollabManager = { applyUpdate: vi.fn() };
    const { manager, p2pManager } = await createManager({}, yjsCollabManager);
    const updateListener = vi.fn();
    manager.on("sync:update", updateListener);
    const payload = serializeSocialCollabMessage(
      {
        type: MessageType.UPDATE,
        docId: "doc-1",
        data: [1, 2, 3],
        timestamp: 1,
      },
      manager.boundaries,
    );

    await p2pManager.getProtocolHandler()({
      stream: createAsyncStream([payload.subarray(0, 7), payload.subarray(7)]),
      connection: connection(),
    });

    expect(yjsCollabManager.applyUpdate).toHaveBeenCalledWith(
      "doc-1",
      Uint8Array.from([1, 2, 3]),
      "network",
    );
    expect(updateListener).toHaveBeenCalledWith(
      expect.objectContaining({ docId: "doc-1", peerId: "peer-1" }),
    );
  });

  it("supports legacy event streams while detaching their listeners", async () => {
    const { manager, p2pManager } = await createManager();
    const stream = new EventEmitter();
    stream.abort = vi.fn();
    const payload = serializeSocialCollabMessage(
      {
        type: MessageType.SYNC_START,
        docId: "doc-event",
        timestamp: 1,
      },
      manager.boundaries,
    );
    const handling = p2pManager.getProtocolHandler()({
      stream,
      connection: connection(),
    });
    stream.emit("data", payload);
    stream.emit("end");
    await handling;

    expect(manager.getSyncPeers("doc-event")).toEqual(["peer-1"]);
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("end")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
  });

  it("aborts byte, chunk, and deadline violations without retaining slots", async () => {
    const { manager, p2pManager } = await createManager({
      boundaries: {
        maxMessageBytes: 64,
        maxUpdateBytes: 16,
        maxStreamChunks: 1,
        streamDeadlineMs: 20,
      },
    });
    const errors = [];
    manager.on("boundary-error", (error) => errors.push(error.code));

    const byteStream = createAsyncStream([Buffer.alloc(65)]);
    await p2pManager.getProtocolHandler()({
      stream: byteStream,
      connection: connection(),
    });
    const chunkStream = createAsyncStream([Buffer.from("{"), Buffer.from("}")]);
    await p2pManager.getProtocolHandler()({
      stream: chunkStream,
      connection: connection(),
    });
    const timeoutStream = {
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
    await p2pManager.getProtocolHandler()({
      stream: timeoutStream,
      connection: connection(),
    });

    expect(errors).toEqual([
      "ERR_SOCIAL_COLLAB_MESSAGE_TOO_LARGE",
      "ERR_SOCIAL_COLLAB_STREAM_CHUNKS_EXCEEDED",
      "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
    ]);
    expect(byteStream.abort).toHaveBeenCalledOnce();
    expect(chunkStream.abort).toHaveBeenCalledOnce();
    expect(timeoutStream.abort).toHaveBeenCalledOnce();
    expect(manager.transport._activeInbound).toBe(0);
  });

  it("caps concurrent inbound operations", async () => {
    const { manager, p2pManager } = await createManager({
      boundaries: {
        maxConcurrentInbound: 1,
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
      connection: connection("peer-1"),
    });
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    const secondStream = createAsyncStream([]);
    await p2pManager.getProtocolHandler()({
      stream: secondStream,
      connection: connection("peer-2"),
    });
    finishFirst({ done: true });
    await first;

    expect(secondStream.abort).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ERR_SOCIAL_COLLAB_INBOUND_CAPACITY" }),
    );
    expect(manager.transport._activeInbound).toBe(0);
  });

  it("bounds retained documents and peers", async () => {
    const { manager } = await createManager({
      boundaries: { maxActiveDocuments: 1, maxPeersPerDocument: 1 },
    });
    await manager.startSync("doc-1", "peer-1");

    await expect(manager.startSync("doc-2", "peer-2")).rejects.toMatchObject({
      code: "ERR_SOCIAL_COLLAB_DOCUMENT_CAPACITY",
    });
    await expect(manager.startSync("doc-1", "peer-2")).rejects.toMatchObject({
      code: "ERR_SOCIAL_COLLAB_PEER_CAPACITY",
    });
    expect(manager.syncSessions.size).toBe(1);
    expect(manager.getSyncPeers("doc-1")).toEqual(["peer-1"]);
  });

  it("rolls back session admission when the first send fails", async () => {
    const { manager, p2pManager } = await createManager();
    p2pManager.node.dialProtocol.mockRejectedValueOnce(new Error("offline"));

    await expect(manager.startSync("doc-rollback", "peer-1")).rejects.toThrow(
      "offline",
    );
    expect(manager.syncSessions.size).toBe(0);
  });

  it("rejects oversized outbound updates before dialing", async () => {
    const { manager, p2pManager } = await createManager({
      boundaries: { maxUpdateBytes: 2 },
    });

    await expect(
      manager.broadcastUpdate("doc-1", Uint8Array.from([1, 2, 3])),
    ).rejects.toMatchObject({ code: "ERR_SOCIAL_COLLAB_UPDATE_TOO_LARGE" });
    expect(p2pManager.node.dialProtocol).not.toHaveBeenCalled();
  });

  it("fences late outbound work and fully detaches on destroy", async () => {
    const { manager, p2pManager } = await createManager({
      boundaries: { streamDeadlineMs: 1000 },
    });
    let resolveDial;
    p2pManager.node.dialProtocol.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDial = resolve;
        }),
    );
    const send = manager.requestFullState("doc-1", "peer-1");
    await vi.waitFor(() => expect(resolveDial).toBeTypeOf("function"));
    manager.syncSessions.set("doc-1", {
      active: true,
      peers: new Set(["peer-1"]),
    });

    await manager.destroy();
    const stream = { sink: vi.fn(), close: vi.fn(), abort: vi.fn() };
    resolveDial(stream);
    await expect(send).rejects.toMatchObject({
      code: "ERR_SOCIAL_COLLAB_DESTROYED",
    });

    expect(stream.sink).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledOnce();
    expect(p2pManager.node.unhandle).toHaveBeenCalledOnce();
    expect(p2pManager.listenerCount("peer:connected")).toBe(0);
    expect(p2pManager.listenerCount("peer:disconnected")).toBe(0);
    expect(manager.syncSessions.size).toBe(0);
    expect(manager.pendingUpdates).toBeUndefined();
  });

  it("actively cancels an inbound iterator during destroy", async () => {
    const { manager, p2pManager } = await createManager({
      boundaries: { streamDeadlineMs: 1000 },
    });
    const iteratorReturn = vi.fn();
    const stream = {
      source: {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise(() => {}),
            return: iteratorReturn,
          };
        },
      },
      abort: vi.fn(),
    };
    const transport = manager.transport;
    const handling = p2pManager.getProtocolHandler()({
      stream,
      connection: connection(),
    });
    await vi.waitFor(() => expect(transport._activeInbound).toBe(1));

    await manager.destroy();
    await handling;

    expect(iteratorReturn).toHaveBeenCalledOnce();
    expect(stream.abort).toHaveBeenCalledOnce();
    expect(transport._activeInbound).toBe(0);
  });

  it("keeps application shutdown wired to the production instance", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );
    expect(mainSource).toContain("this.collabSync = instances.collabSync");
    expect(mainSource).toContain("await this.collabSync.destroy?.()");
  });
});
