import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const YjsCollabManager = require("../yjs-collab-manager");
const { RealtimeCollabManager } = require("../realtime-collab-manager");
const { createCollabBoundaries } = require("../collab-boundaries");
const { CollabSessionManager } = require("../../collab/collab-session-manager");

function createYjsDatabase(rows = []) {
  const run = vi.fn();
  const database = {
    getDatabase: () => ({
      prepare: (sql) => {
        if (sql.includes("COUNT(*)")) {
          return {
            get: () => ({
              update_count: rows.length,
              total_bytes: rows.reduce(
                (total, row) => total + Buffer.byteLength(row.update_data),
                0,
              ),
            }),
          };
        }
        if (sql.includes("SELECT update_data")) {
          return { all: () => rows };
        }
        return { get: () => null, all: () => [], run };
      },
    }),
  };
  return { database, run };
}

function createRealtimeDatabase(receiveRows = []) {
  const preparedSql = [];
  const run = vi.fn();
  const database = {
    getDatabase: () => ({
      prepare: (sql) => {
        preparedSql.push(sql);
        if (sql.includes("FROM knowledge_yjs_updates")) {
          return { all: () => receiveRows };
        }
        return { get: () => null, all: () => [], run };
      },
    }),
  };
  return { database, preparedSql, run };
}

describe("Yjs retained-state boundaries", () => {
  let manager;

  afterEach(() => manager?.destroy());

  it("evicts the least-recent unretained document at capacity", () => {
    let now = 1;
    manager = new YjsCollabManager(null, createYjsDatabase().database, {
      now: () => now,
      boundaries: { maxActiveDocuments: 1 },
    });

    manager.getDocument("doc-a");
    now += 1;
    manager.getDocument("doc-b");

    expect(manager.documents.has("doc-a")).toBe(false);
    expect(manager.documents.has("doc-b")).toBe(true);
  });

  it("fails with a stable capacity error when every document is retained", () => {
    manager = new YjsCollabManager(null, createYjsDatabase().database, {
      boundaries: { maxActiveDocuments: 1 },
    });
    manager.getDocument("doc-a");
    manager.setAwarenessState("doc-a", "local", { user: "alice" });

    expect(() => manager.getDocument("doc-b")).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_DOCUMENT_CAPACITY" }),
    );
  });

  it("expires remote awareness and idle documents without timers", () => {
    let now = 1;
    manager = new YjsCollabManager(null, createYjsDatabase().database, {
      now: () => now,
      boundaries: {
        awarenessStateTtlMs: 10,
        documentIdleTtlMs: 20,
      },
    });
    manager.setAwarenessState("doc-a", 7, { user: "remote" });

    now = 11;
    expect(manager.sweepRetainedState()).toEqual({
      awarenessStatesRemoved: 1,
      documentsEvicted: 0,
    });
    now = 21;
    expect(manager.sweepRetainedState().documentsEvicted).toBe(1);
    expect(manager.documents.has("doc-a")).toBe(false);
  });

  it("bounds awareness clients per document", () => {
    manager = new YjsCollabManager(null, createYjsDatabase().database, {
      boundaries: { maxAwarenessStatesPerDocument: 1 },
    });
    manager.setAwarenessState("doc-a", 1, { user: "one" });

    expect(() =>
      manager.setAwarenessState("doc-a", 2, { user: "two" }),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_AWARENESS_CAPACITY" }),
    );
  });
});

describe("incremental collaboration replay boundaries", () => {
  it("pages receives by count and returns an explicit continuation version", async () => {
    const { database } = createRealtimeDatabase([
      { id: 11, update_data: Buffer.from("a"), created_at: 1 },
      { id: 12, update_data: Buffer.from("b"), created_at: 2 },
      { id: 13, update_data: Buffer.from("c"), created_at: 3 },
    ]);
    const manager = new RealtimeCollabManager(database, null, {
      boundaries: { maxReceiveUpdates: 2 },
    });

    await expect(manager.receiveUpdate("doc-a", 10)).resolves.toMatchObject({
      success: true,
      hasMore: true,
      nextVersion: 12,
      updates: [{ version: 11 }, { version: 12 }],
    });
    manager.destroy();
  });

  it("rejects a stored update that cannot fit in one receive page", async () => {
    const { database } = createRealtimeDatabase([
      { id: 1, update_data: Buffer.from("four"), created_at: 1 },
    ]);
    const manager = new RealtimeCollabManager(database, null, {
      boundaries: { maxReceiveBytes: 3 },
    });

    await expect(manager.receiveUpdate("doc-a", 0)).rejects.toMatchObject({
      code: "ERR_COLLAB_RECEIVE_LIMIT",
    });
    manager.destroy();
  });

  it("routes accepted updates through the manager-owned Y.Doc", async () => {
    const { database, preparedSql } = createRealtimeDatabase();
    const yjsManager = {
      boundaries: createCollabBoundaries(),
      applyUpdate: vi.fn(),
    };
    const manager = new RealtimeCollabManager(database, yjsManager);

    await manager.syncUpdate("doc-a", Uint8Array.from([1, 2]), "did:a", 3);

    expect(yjsManager.applyUpdate).toHaveBeenCalledOnce();
    expect(
      preparedSql.some((sql) =>
        sql.includes("INSERT INTO knowledge_yjs_updates"),
      ),
    ).toBe(false);
    manager.destroy();
  });

  it("bounds and releases per-document subscribers", () => {
    const { database } = createRealtimeDatabase();
    const manager = new RealtimeCollabManager(database, null, {
      boundaries: { maxSubscribersPerDocument: 1 },
    });
    const unsubscribe = manager.subscribeToChanges("doc-a", vi.fn());

    expect(() => manager.subscribeToChanges("doc-a", vi.fn())).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_SUBSCRIBER_CAPACITY" }),
    );
    unsubscribe();
    expect(manager.documentSubscribers.has("doc-a")).toBe(false);
    manager.destroy();
  });

  it("rejects unbounded version-history requests", async () => {
    const { database } = createRealtimeDatabase();
    const manager = new RealtimeCollabManager(database, null, {
      boundaries: { maxVersionHistoryEntries: 2 },
    });

    await expect(
      manager.getDocumentHistory("doc-a", { limit: 3 }),
    ).rejects.toMatchObject({ code: "ERR_COLLAB_HISTORY_LIMIT" });
    manager.destroy();
  });
});

describe("offline backlog boundaries", () => {
  it("bounds edit count and retained documents with one stable error", () => {
    const db = { run: vi.fn() };
    const manager = new CollabSessionManager({
      database: db,
      boundaries: {
        maxOfflineDocuments: 1,
        maxOfflineEditsPerDocument: 1,
      },
    });
    manager.bufferOfflineEdit("doc-a", Uint8Array.from([1]));

    expect(() =>
      manager.bufferOfflineEdit("doc-a", Uint8Array.from([2])),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_OFFLINE_BACKLOG" }),
    );
    expect(() =>
      manager.bufferOfflineEdit("doc-b", Uint8Array.from([3])),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_OFFLINE_BACKLOG" }),
    );
    manager.destroy();
  });

  it("expires stale offline edits and releases their byte accounting", () => {
    let now = 1;
    const db = { run: vi.fn() };
    const manager = new CollabSessionManager({
      database: db,
      now: () => now,
      boundaries: { offlineEditTtlMs: 10 },
    });
    manager.bufferOfflineEdit("doc-a", Uint8Array.from([1, 2]));

    now = 11;
    expect(manager.sweepOfflineEdits()).toEqual({
      documentsRemoved: 1,
      editsRemoved: 1,
    });
    expect(manager._offlineEditStats.has("doc-a")).toBe(false);
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM collab_offline_edits"),
      expect.any(Array),
    );
    manager.destroy();
  });
});
