/**
 * P2PSyncEngine unit tests
 *
 * Uses sql.js (WebAssembly SQLite) instead of better-sqlite3 (native bindings)
 * to avoid native module loading issues in the Vitest environment.
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

// Mock logger before importing the source module
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock uuid to return predictable but unique IDs
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

let initSqlJs;
let P2PSyncEngine;
class SqlJsWrapper {
  constructor(sqlJsDb) {
    this._db = sqlJsDb;
  }

  prepare(sql) {
    const db = this._db;
    return {
      run(...params) {
        const flatParams =
          params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        db.run(sql, flatParams);
        return { changes: db.getRowsModified(), lastInsertRowid: 0 };
      },
      get(...params) {
        const flatParams =
          params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const stmt = db.prepare(sql);
        stmt.bind(flatParams);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const flatParams =
          params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(flatParams);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
    };
  }

  run(sql, ...params) {
    const flatParams =
      params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    this._db.run(sql, flatParams);
    return { changes: this._db.getRowsModified(), lastInsertRowid: 0 };
  }

  query(sql, ...params) {
    return this.prepare(sql).all(...params);
  }
  get(sql, ...params) {
    return this.prepare(sql).get(...params) || null;
  }
  exec(sql) {
    this._db.exec(sql);
  }
  close() {
    this._db.close();
  }
}

class MockDIDManager {
  async getDefaultIdentity() {
    return { did: "did:test:alice", displayName: "Alice" };
  }
  async sign(data) {
    return "mock_signature_" + data.substring(0, 10);
  }
  async verify(signature, data, did) {
    return true;
  }
}

class MockP2PManager {
  constructor() {
    this.handlers = {};
    this.messages = [];
  }
  on(event, handler) {
    this.handlers[event] = handler;
  }
  async broadcastToOrg(orgId, message) {
    this.messages.push({ orgId, message });
    return true;
  }
  simulateMessage(type, data) {
    const handler = this.handlers[type];
    if (handler) {
      handler(data);
    }
  }
}
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS p2p_sync_state (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL, local_version INTEGER DEFAULT 1,
    remote_version INTEGER DEFAULT 1, vector_clock TEXT, cid TEXT,
    sync_status TEXT DEFAULT 'synced', last_synced_at INTEGER,
    UNIQUE(org_id, resource_type, resource_id)
  );
  CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, action TEXT NOT NULL,
    resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, data TEXT,
    version INTEGER NOT NULL, vector_clock TEXT, created_at INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0, last_retry_at INTEGER, status TEXT DEFAULT 'pending',
    completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sync_conflicts (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL, local_version INTEGER NOT NULL,
    remote_version INTEGER NOT NULL, local_data TEXT, remote_data TEXT,
    local_vector_clock TEXT, remote_vector_clock TEXT, resolution_strategy TEXT,
    resolved INTEGER DEFAULT 0, resolved_at INTEGER, resolved_by_did TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY, title TEXT, content TEXT, created_at INTEGER, updated_at INTEGER
  );
`;
describe("P2PSyncEngine", () => {
  let SQL, db, didManager, p2pManager, syncEngine;

  beforeAll(async () => {
    initSqlJs = (await import("sql.js")).default;
    P2PSyncEngine = (await import("../../../src/main/sync/p2p-sync-engine.js"))
      .default;
  });

  beforeEach(async () => {
    uuidCounter = 0;
    SQL = await initSqlJs();
    const rawDb = new SQL.Database();
    db = new SqlJsWrapper(rawDb);
    db.exec(CREATE_TABLES_SQL);
    didManager = new MockDIDManager();
    p2pManager = new MockP2PManager();
    syncEngine = new P2PSyncEngine(db, didManager, p2pManager);
    await syncEngine.initialize();
  });

  afterEach(() => {
    if (syncEngine) {
      syncEngine.stopAutoSync();
    }
    db.close();
  });

  describe("initialization", () => {
    test("should successfully initialize sync engine", () => {
      expect(syncEngine).toBeDefined();
      expect(syncEngine.db).toBe(db);
      expect(syncEngine.didManager).toBe(didManager);
      expect(syncEngine.p2pManager).toBe(p2pManager);
    });

    test("should register P2P message handlers", () => {
      expect(p2pManager.handlers["sync:request"]).toBeDefined();
      expect(p2pManager.handlers["sync:response"]).toBeDefined();
      expect(p2pManager.handlers["sync:change"]).toBeDefined();
      expect(p2pManager.handlers["sync:conflict"]).toBeDefined();
    });
  });

  describe("sync state management", () => {
    const orgId = "org_test123";
    const resourceType = "knowledge";
    const resourceId = "kb_001";

    test("should return null for non-existent sync state", () => {
      const state = syncEngine.getSyncState(orgId, resourceType, resourceId);
      expect(state).toBeNull();
    });

    test("should create new sync state", () => {
      syncEngine.updateSyncState(orgId, resourceType, resourceId, {
        local_version: 1,
        remote_version: 1,
        vector_clock: JSON.stringify({ "did:test:alice": 1 }),
        sync_status: "synced",
        last_synced_at: Date.now(),
      });
      const state = syncEngine.getSyncState(orgId, resourceType, resourceId);
      expect(state).toBeDefined();
      expect(state.local_version).toBe(1);
      expect(state.sync_status).toBe("synced");
    });

    test("should update existing sync state", () => {
      syncEngine.updateSyncState(orgId, resourceType, resourceId, {
        local_version: 1,
        sync_status: "synced",
      });
      syncEngine.updateSyncState(orgId, resourceType, resourceId, {
        local_version: 2,
        sync_status: "pending",
      });
      const state = syncEngine.getSyncState(orgId, resourceType, resourceId);
      expect(state.local_version).toBe(2);
      expect(state.sync_status).toBe("pending");
    });
  });
  describe("conflict detection", () => {
    test("should detect local update (local_wins)", () => {
      const localState = {
        vector_clock: JSON.stringify({
          "did:test:alice": 3,
          "did:test:bob": 1,
        }),
      };
      const remoteState = {
        vector_clock: { "did:test:alice": 2, "did:test:bob": 1 },
      };
      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(false);
      expect(result.winner).toBe("local");
    });

    test("should detect remote update (remote_wins)", () => {
      const localState = {
        vector_clock: JSON.stringify({
          "did:test:alice": 2,
          "did:test:bob": 1,
        }),
      };
      const remoteState = {
        vector_clock: { "did:test:alice": 3, "did:test:bob": 1 },
      };
      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(false);
      expect(result.winner).toBe("remote");
    });

    test("should detect concurrent modification (conflict)", () => {
      const localState = {
        vector_clock: JSON.stringify({
          "did:test:alice": 3,
          "did:test:bob": 1,
        }),
      };
      const remoteState = {
        vector_clock: { "did:test:alice": 2, "did:test:bob": 2 },
      };
      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(true);
      expect(result.winner).toBeNull();
    });

    test("should detect synced state", () => {
      const localState = {
        vector_clock: JSON.stringify({
          "did:test:alice": 2,
          "did:test:bob": 1,
        }),
      };
      const remoteState = {
        vector_clock: { "did:test:alice": 2, "did:test:bob": 1 },
      };
      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(false);
      expect(result.winner).toBeNull();
    });

    test("should handle missing DID case", () => {
      const localState = {
        vector_clock: JSON.stringify({ "did:test:alice": 3 }),
      };
      const remoteState = { vector_clock: { "did:test:bob": 2 } };
      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(true);
    });
  });
  describe("conflict resolution", () => {
    const orgId = "org_test123";
    const resourceId = "member_001";

    test("should resolve conflict with LWW strategy (remote wins)", async () => {
      const localState = {
        local_version: 2,
        vector_clock: JSON.stringify({ "did:test:alice": 2 }),
        last_synced_at: 1000,
      };
      const remoteChange = {
        version: 2,
        vector_clock: { "did:test:bob": 2 },
        timestamp: 2000,
        action: "update",
        data: {
          id: resourceId,
          title: "Updated Title",
          content: "Updated Content",
        },
      };
      db.run(
        `INSERT INTO knowledge_items (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        resourceId,
        "Test",
        "Content",
        Date.now(),
        Date.now(),
      );
      db.run(
        `INSERT INTO sync_conflicts (id, org_id, resource_type, resource_id, local_version, remote_version, local_data, remote_data, local_vector_clock, remote_vector_clock, created_at, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "conflict_" + resourceId,
        orgId,
        "knowledge",
        resourceId,
        2,
        2,
        JSON.stringify({ title: "Test", content: "Content" }),
        JSON.stringify(remoteChange.data),
        JSON.stringify({ "did:test:alice": 2 }),
        JSON.stringify({ "did:test:bob": 2 }),
        Date.now(),
        0,
      );
      const resolved = await syncEngine.resolveLWW(
        orgId,
        "knowledge",
        resourceId,
        localState,
        remoteChange,
      );
      expect(resolved).toBe(true);
      const conflict = db.get(
        `SELECT * FROM sync_conflicts WHERE org_id = ? AND resource_type = ? AND resource_id = ? AND resolved = 1`,
        orgId,
        "knowledge",
        resourceId,
      );
      expect(conflict).toBeDefined();
      expect(conflict.resolution_strategy).toBe("lww");
    });

    test("should resolve conflict with LWW strategy (local wins)", async () => {
      const localState = {
        local_version: 2,
        vector_clock: JSON.stringify({ "did:test:alice": 2 }),
        last_synced_at: 2000,
      };
      const remoteChange = {
        version: 2,
        vector_clock: { "did:test:bob": 2 },
        timestamp: 1000,
        action: "update",
        data: { id: resourceId, name: "Bob" },
      };
      db.run(
        `INSERT INTO knowledge_items (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        resourceId,
        "Test",
        "Content",
        Date.now(),
        Date.now(),
      );
      const resolved = await syncEngine.resolveLWW(
        orgId,
        "knowledge",
        resourceId,
        localState,
        remoteChange,
      );
      expect(resolved).toBe(true);
    });

    test("should select correct conflict resolution strategy", () => {
      expect(syncEngine.getConflictResolutionStrategy("knowledge")).toBe(
        "manual",
      );
      expect(syncEngine.getConflictResolutionStrategy("member")).toBe("lww");
      expect(syncEngine.getConflictResolutionStrategy("role")).toBe("manual");
      expect(syncEngine.getConflictResolutionStrategy("project")).toBe("lww");
    });
  });
  describe("offline queue", () => {
    const orgId = "org_test123";

    test("should add item to offline queue", () => {
      const queueId = syncEngine.addToQueue(
        orgId,
        "update",
        "knowledge",
        "kb_001",
        { title: "Test", content: "Content" },
      );
      expect(queueId).toBeDefined();
      const item = db.get("SELECT * FROM sync_queue WHERE id = ?", queueId);
      expect(item).toBeDefined();
      expect(item.action).toBe("update");
      expect(item.resource_type).toBe("knowledge");
      expect(item.status).toBe("pending");
    });

    test("should process items in offline queue", async () => {
      syncEngine.addToQueue(orgId, "update", "knowledge", "kb_001", {
        title: "Test",
      });
      syncEngine.addToQueue(orgId, "update", "knowledge", "kb_002", {
        title: "Test2",
      });
      const processed = await syncEngine.processQueue(orgId);
      expect(processed).toBeGreaterThan(0);
    });

    test("should retry failed queue items", async () => {
      const queueId = syncEngine.addToQueue(
        orgId,
        "update",
        "knowledge",
        "kb_001",
        { title: "Test" },
      );
      db.run(
        `UPDATE sync_queue SET status = 'failed', retry_count = 1 WHERE id = ?`,
        queueId,
      );
      db.run(`UPDATE sync_queue SET status = 'pending' WHERE id = ?`, queueId);
      const item = db.get("SELECT * FROM sync_queue WHERE id = ?", queueId);
      expect(item.retry_count).toBe(1);
    });

    test("should mark as failed after max retries", () => {
      const queueId = syncEngine.addToQueue(
        orgId,
        "update",
        "knowledge",
        "kb_001",
        { title: "Test" },
      );
      db.run(
        `UPDATE sync_queue SET retry_count = ? WHERE id = ?`,
        syncEngine.config.maxRetryCount + 1,
        queueId,
      );
      const item = db.get("SELECT * FROM sync_queue WHERE id = ?", queueId);
      expect(item.retry_count).toBeGreaterThan(syncEngine.config.maxRetryCount);
    });
  });
  describe("sync statistics", () => {
    const orgId = "org_test123";

    test("should get sync statistics", () => {
      syncEngine.updateSyncState(orgId, "knowledge", "kb_001", {
        sync_status: "synced",
      });
      syncEngine.updateSyncState(orgId, "knowledge", "kb_002", {
        sync_status: "pending",
      });
      syncEngine.updateSyncState(orgId, "knowledge", "kb_003", {
        sync_status: "conflict",
      });
      syncEngine.addToQueue(orgId, "update", "knowledge", "kb_004", {});
      const stats = syncEngine.getSyncStats(orgId);
      expect(stats.total).toBe(3);
      expect(stats.synced).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.conflicts).toBe(1);
      expect(stats.queue_size).toBe(1);
    });

    test("should return empty statistics for empty org", () => {
      const stats = syncEngine.getSyncStats("org_empty");
      expect(stats.total).toBe(0);
      expect(stats.synced).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.conflicts).toBe(0);
    });
  });

  describe("pending resources", () => {
    const orgId = "org_test123";

    test("should get pending resources list", async () => {
      syncEngine.updateSyncState(orgId, "knowledge", "kb_001", {
        local_version: 2,
        sync_status: "pending",
      });
      syncEngine.updateSyncState(orgId, "knowledge", "kb_002", {
        local_version: 3,
        sync_status: "pending",
      });
      syncEngine.updateSyncState(orgId, "knowledge", "kb_003", {
        sync_status: "synced",
      });
      const resources = await syncEngine.getPendingResources(orgId);
      expect(resources.length).toBe(2);
      expect(resources.every((r) => r.sync_status === "pending")).toBe(true);
      expect(resources[0].local_version).toBeGreaterThanOrEqual(
        resources[1].local_version,
      );
    });

    test("should limit returned resources count", async () => {
      for (let i = 0; i < 100; i++) {
        syncEngine.updateSyncState(orgId, "knowledge", `kb_${i}`, {
          sync_status: "pending",
        });
      }
      const resources = await syncEngine.getPendingResources(orgId);
      expect(resources.length).toBeLessThanOrEqual(syncEngine.config.batchSize);
    });
  });
  describe("auto sync", () => {
    const orgId = "org_test123";

    test("should start auto sync", () => {
      syncEngine.startAutoSync(orgId);
      expect(syncEngine.syncTimer).toBeDefined();
      expect(syncEngine.queueTimer).toBeDefined();
    });

    test("should stop auto sync", () => {
      syncEngine.startAutoSync(orgId);
      syncEngine.stopAutoSync();
      expect(syncEngine.syncTimer).toBeNull();
      expect(syncEngine.queueTimer).toBeNull();
    });

    test("should stop old sync before starting new sync", () => {
      syncEngine.startAutoSync("org_old");
      const oldSyncTimer = syncEngine.syncTimer;
      syncEngine.startAutoSync("org_new");
      expect(syncEngine.syncTimer).not.toBe(oldSyncTimer);
    });
  });

  describe("P2P message handling", () => {
    const orgId = "org_test123";

    test("should handle sync request message", async () => {
      const message = {
        org_id: orgId,
        last_sync_time: 0,
        resource_types: ["knowledge"],
      };
      await syncEngine.handleSyncRequest(message);
    });

    test("should handle sync change message", async () => {
      const message = {
        org_id: orgId,
        resource_type: "knowledge",
        resource_id: "kb_001",
        action: "update",
        data: { id: "kb_001", title: "Updated", content: "New content" },
        version: 2,
        vector_clock: { "did:test:bob": 2 },
        author_did: "did:test:bob",
        timestamp: Date.now(),
        signature: "mock_signature",
      };
      db.run(
        `INSERT INTO knowledge_items (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        "kb_001",
        "Original",
        "Original content",
        Date.now(),
        Date.now(),
      );
      await syncEngine.handleSyncChange(message);
    });
  });
});
