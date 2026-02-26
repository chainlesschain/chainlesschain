/**
 * RealtimeCollabManager Unit Tests
 *
 * Tests for the extended real-time collaboration manager that provides:
 * - Document open/close operations
 * - Sync operations (Yjs integration)
 * - Awareness (cursor/selection) tracking
 * - Section locking
 * - Conflict resolution
 * - Inline comments with threading
 * - Version history
 * - Collaboration statistics
 * - Document subscriptions
 * - Export with comments
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Creates a mock database where prepare() returns an object with chainable
 * get/all/run methods. The prepResult reference allows per-test overrides.
 *
 * For openDocument's _updateCollabStats path that calls:
 *   db.prepare(...).get(docId)  ->  expects { count: N }
 * We default get to returning { count: 1 } so the happy path works.
 */
function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 1 }),
    run: vi.fn(),
  };
  return {
    getDatabase: vi.fn().mockReturnValue({
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
    }),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

const { RealtimeCollabManager } = require("../realtime-collab-manager.js");

describe("RealtimeCollabManager", () => {
  let manager;
  let mockDb;
  let prepResult;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    prepResult = mockDb._prep;
    manager = new RealtimeCollabManager(mockDb);
  });

  afterEach(() => {
    for (const [, timer] of manager.lockExpiryTimers) {
      clearTimeout(timer);
    }
    manager.lockExpiryTimers.clear();
    manager.removeAllListeners();
  });

  // =============================================
  // Constructor Tests
  // =============================================

  describe("constructor", () => {
    it("should initialize with database and default state", () => {
      expect(manager.database).toBe(mockDb);
      expect(manager.yjsCollabManager).toBeNull();
      expect(manager.activeLocks).toBeInstanceOf(Map);
      expect(manager.documentSubscribers).toBeInstanceOf(Map);
      expect(manager.lockExpiryTimers).toBeInstanceOf(Map);
    });

    it("should accept optional yjsCollabManager", () => {
      const mockYjs = { createSnapshot: vi.fn() };
      const mgr = new RealtimeCollabManager(mockDb, mockYjs);
      expect(mgr.yjsCollabManager).toBe(mockYjs);
    });

    it("should extend EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });
  });

  // =============================================
  // setYjsManager
  // =============================================

  describe("setYjsManager", () => {
    it("should set the Yjs collaboration manager", () => {
      const mockYjs = { getDocument: vi.fn() };
      manager.setYjsManager(mockYjs);
      expect(manager.yjsCollabManager).toBe(mockYjs);
    });
  });

  // =============================================
  // openDocument
  // =============================================

  describe("openDocument", () => {
    it("should create a session and return success", async () => {
      const result = await manager.openDocument(
        "doc-1",
        "did:user:1",
        "Alice",
        "org-1",
      );

      expect(result.success).toBe(true);
      expect(typeof result.sessionId).toBe("string");
      expect(result.docId).toBe("doc-1");
      expect(typeof result.userColor).toBe("string");
      expect(Array.isArray(result.locks)).toBe(true);
      expect(Array.isArray(result.activeUsers)).toBe(true);
    });

    it("should insert a collaboration session record", async () => {
      await manager.openDocument("doc-1", "did:user:1", "Alice");

      const db = mockDb.getDatabase();
      expect(db.prepare).toHaveBeenCalled();
      expect(prepResult.run).toHaveBeenCalled();
    });

    it("should notify subscribers when a user joins", async () => {
      const callback = vi.fn();
      manager.subscribeToChanges("doc-1", callback);

      await manager.openDocument("doc-1", "did:user:1", "Alice");

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "user_joined",
          user: expect.objectContaining({ did: "did:user:1", name: "Alice" }),
        }),
      );
    });

    it("should emit document-event when user joins", async () => {
      const eventSpy = vi.fn();
      manager.on("document-event", eventSpy);

      await manager.openDocument("doc-1", "did:user:1", "Alice");

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ docId: "doc-1", type: "user_joined" }),
      );
    });

    it("should throw on database error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB failure");
      });

      await expect(
        manager.openDocument("doc-1", "did:user:1", "Alice"),
      ).rejects.toThrow("DB failure");
    });
  });

  // =============================================
  // closeDocument
  // =============================================

  describe("closeDocument", () => {
    it("should update session and remove cursor", async () => {
      prepResult.all.mockReturnValue([]); // no locks to release

      const result = await manager.closeDocument("doc-1", "did:user:1");

      expect(result.success).toBe(true);
      expect(prepResult.run).toHaveBeenCalled();
    });

    it("should notify subscribers when user leaves", async () => {
      prepResult.all.mockReturnValue([]);

      const callback = vi.fn();
      manager.subscribeToChanges("doc-1", callback);

      await manager.closeDocument("doc-1", "did:user:1");

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: "user_left", userDid: "did:user:1" }),
      );
    });

    it("should release user locks on close", async () => {
      prepResult.all.mockReturnValueOnce([{ id: "lock-1" }]);
      prepResult.get.mockReturnValue({
        id: "lock-1",
        locked_by_did: "did:user:1",
        knowledge_id: "doc-1",
      });

      const result = await manager.closeDocument("doc-1", "did:user:1");
      expect(result.success).toBe(true);
    });
  });

  // =============================================
  // syncUpdate
  // =============================================

  describe("syncUpdate", () => {
    it("should store update and return success", async () => {
      const result = await manager.syncUpdate(
        "doc-1",
        "binary-data",
        "did:user:1",
        5,
      );

      expect(result.success).toBe(true);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should notify subscribers of document update", async () => {
      const callback = vi.fn();
      manager.subscribeToChanges("doc-1", callback);

      await manager.syncUpdate("doc-1", "binary-data", "did:user:1", 5);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "document_updated",
          userDid: "did:user:1",
          version: 5,
        }),
      );
    });
  });

  // =============================================
  // receiveUpdate
  // =============================================

  describe("receiveUpdate", () => {
    it("should return updates since fromVersion", async () => {
      prepResult.all.mockReturnValue([
        { update_data: "data1", created_at: 100 },
        { update_data: "data2", created_at: 200 },
      ]);

      const result = await manager.receiveUpdate("doc-1", 0);

      expect(result.success).toBe(true);
      expect(result.updates).toHaveLength(2);
      expect(result.updates[0].data).toBe("data1");
    });

    it("should return empty updates when none available", async () => {
      prepResult.all.mockReturnValue([]);

      const result = await manager.receiveUpdate("doc-1", 100);

      expect(result.success).toBe(true);
      expect(result.updates).toHaveLength(0);
    });
  });

  // =============================================
  // getAwareness
  // =============================================

  describe("getAwareness", () => {
    it("should return active users with cursor positions", async () => {
      prepResult.all.mockReturnValue([
        {
          user_did: "did:user:1",
          user_name: "Alice",
          user_color: "#FF6B6B",
          cursor_line: 10,
          cursor_column: 5,
          selection_start_line: null,
          selection_start_column: null,
          selection_end_line: null,
          selection_end_column: null,
          last_activity: Date.now(),
        },
      ]);

      const result = await manager.getAwareness("doc-1");

      expect(result.success).toBe(true);
      expect(result.users).toHaveLength(1);
      expect(result.users[0].did).toBe("did:user:1");
      expect(result.users[0].cursor).toEqual({ line: 10, column: 5 });
      expect(result.users[0].selection).toBeNull();
    });

    it("should return users with selection ranges", async () => {
      prepResult.all.mockReturnValue([
        {
          user_did: "did:user:2",
          user_name: "Bob",
          user_color: "#4ECDC4",
          cursor_line: 5,
          cursor_column: 3,
          selection_start_line: 5,
          selection_start_column: 3,
          selection_end_line: 8,
          selection_end_column: 10,
          last_activity: Date.now(),
        },
      ]);

      const result = await manager.getAwareness("doc-1");

      expect(result.users[0].selection).toEqual({
        start: { line: 5, column: 3 },
        end: { line: 8, column: 10 },
      });
    });
  });

  // =============================================
  // updateCursor
  // =============================================

  describe("updateCursor", () => {
    it("should update cursor position and notify subscribers", async () => {
      const callback = vi.fn();
      manager.subscribeToChanges("doc-1", callback);

      const cursor = { line: 10, column: 5 };
      const result = await manager.updateCursor(
        "doc-1",
        "did:user:1",
        "Alice",
        cursor,
      );

      expect(result.success).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cursor_moved", cursor }),
      );
    });

    it("should handle cursor with selection", async () => {
      const cursor = { line: 10, column: 5 };
      const selection = {
        start: { line: 10, column: 5 },
        end: { line: 12, column: 8 },
      };
      const result = await manager.updateCursor(
        "doc-1",
        "did:user:1",
        "Alice",
        cursor,
        selection,
      );

      expect(result.success).toBe(true);
    });
  });

  // =============================================
  // acquireLock
  // =============================================

  describe("acquireLock", () => {
    it("should acquire a section lock successfully", async () => {
      vi.useFakeTimers();
      prepResult.all.mockReturnValue([]); // no conflicting locks

      const result = await manager.acquireLock(
        "doc-1",
        "did:user:1",
        "Alice",
        "section",
        10,
        20,
        300000,
      );

      expect(result.success).toBe(true);
      expect(typeof result.lockId).toBe("string");
      expect(typeof result.expiresAt).toBe("number");

      vi.useRealTimers();
    });

    it("should reject lock when conflict exists", async () => {
      prepResult.all.mockReturnValue([
        {
          id: "existing-lock",
          locked_by_did: "did:user:2",
          locked_by_name: "Bob",
          lock_type: "section",
          section_start: 10,
          section_end: 20,
          expires_at: Date.now() + 300000,
        },
      ]);

      const result = await manager.acquireLock(
        "doc-1",
        "did:user:1",
        "Alice",
        "section",
        15,
        25,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("LOCK_CONFLICT");
      expect(result.conflictingLocks).toHaveLength(1);
    });

    it("should allow user to re-lock their own section", async () => {
      vi.useFakeTimers();
      prepResult.all.mockReturnValue([
        {
          id: "existing-lock",
          locked_by_did: "did:user:1",
          locked_by_name: "Alice",
          lock_type: "section",
          section_start: 10,
          section_end: 20,
          expires_at: Date.now() + 300000,
        },
      ]);

      const result = await manager.acquireLock(
        "doc-1",
        "did:user:1",
        "Alice",
        "section",
        10,
        20,
      );

      expect(result.success).toBe(true);
      vi.useRealTimers();
    });

    it("should set an expiry timer for the lock", async () => {
      vi.useFakeTimers();
      prepResult.all.mockReturnValue([]);

      const result = await manager.acquireLock(
        "doc-1",
        "did:user:1",
        "Alice",
        "section",
        10,
        20,
        5000,
      );

      expect(manager.lockExpiryTimers.has(result.lockId)).toBe(true);
      vi.useRealTimers();
    });

    it("should notify subscribers when lock is acquired", async () => {
      vi.useFakeTimers();
      prepResult.all.mockReturnValue([]);
      const callback = vi.fn();
      manager.subscribeToChanges("doc-1", callback);

      await manager.acquireLock(
        "doc-1",
        "did:user:1",
        "Alice",
        "section",
        10,
        20,
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: "lock_acquired" }),
      );
      vi.useRealTimers();
    });
  });

  // =============================================
  // releaseLock
  // =============================================

  describe("releaseLock", () => {
    it("should release lock owned by user", async () => {
      prepResult.get.mockReturnValue({
        id: "lock-1",
        locked_by_did: "did:user:1",
        knowledge_id: "doc-1",
      });

      const result = await manager.releaseLock("lock-1", "did:user:1");

      expect(result.success).toBe(true);
    });

    it("should return LOCK_NOT_FOUND for unknown lock", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.releaseLock("nonexistent", "did:user:1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("LOCK_NOT_FOUND");
    });

    it("should return NOT_LOCK_OWNER if another user tries to release", async () => {
      prepResult.get.mockReturnValue({
        id: "lock-1",
        locked_by_did: "did:user:2",
        knowledge_id: "doc-1",
      });

      const result = await manager.releaseLock("lock-1", "did:user:1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("NOT_LOCK_OWNER");
    });

    it("should clear the expiry timer on release", async () => {
      const timer = setTimeout(() => {}, 99999);
      manager.lockExpiryTimers.set("lock-1", timer);

      prepResult.get.mockReturnValue({
        id: "lock-1",
        locked_by_did: "did:user:1",
        knowledge_id: "doc-1",
      });

      await manager.releaseLock("lock-1", "did:user:1");

      expect(manager.lockExpiryTimers.has("lock-1")).toBe(false);
      clearTimeout(timer);
    });
  });

  // =============================================
  // releaseUserLocks
  // =============================================

  describe("releaseUserLocks", () => {
    it("should release all locks for a user on a document", async () => {
      prepResult.all.mockReturnValueOnce([{ id: "lock-1" }, { id: "lock-2" }]);
      prepResult.get
        .mockReturnValueOnce({
          id: "lock-1",
          locked_by_did: "did:user:1",
          knowledge_id: "doc-1",
        })
        .mockReturnValueOnce({
          id: "lock-2",
          locked_by_did: "did:user:1",
          knowledge_id: "doc-1",
        });

      const result = await manager.releaseUserLocks("doc-1", "did:user:1");

      expect(result.success).toBe(true);
      expect(result.releasedCount).toBe(2);
    });

    it("should return 0 when user has no locks", async () => {
      prepResult.all.mockReturnValue([]);

      const result = await manager.releaseUserLocks("doc-1", "did:user:1");

      expect(result.success).toBe(true);
      expect(result.releasedCount).toBe(0);
    });
  });

  // =============================================
  // requestConflictResolution
  // =============================================

  describe("requestConflictResolution", () => {
    it("should create a conflict record and return conflictId", async () => {
      const conflictData = {
        orgId: "org-1",
        conflictType: "concurrent_edit",
        localVersion: 3,
        remoteVersion: 4,
        localContent: "local text",
        remoteContent: "remote text",
        localUserDid: "did:user:1",
        remoteUserDid: "did:user:2",
      };

      const result = await manager.requestConflictResolution(
        "doc-1",
        conflictData,
      );

      expect(result.success).toBe(true);
      expect(typeof result.conflictId).toBe("string");
      expect(result.conflictId.length).toBeGreaterThan(0);
    });

    it("should notify subscribers of conflict detection", async () => {
      const callback = vi.fn();
      manager.subscribeToChanges("doc-1", callback);

      await manager.requestConflictResolution("doc-1", {
        orgId: null,
        localVersion: 1,
        remoteVersion: 2,
        localContent: "a",
        remoteContent: "b",
        localUserDid: "did:user:1",
        remoteUserDid: "did:user:2",
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: "conflict_detected" }),
      );
      // Verify conflictId is a string
      const callArg = callback.mock.calls[0][0];
      expect(typeof callArg.conflictId).toBe("string");
    });
  });

  // =============================================
  // resolveConflict
  // =============================================

  describe("resolveConflict", () => {
    it("should resolve an existing conflict", async () => {
      prepResult.get.mockReturnValue({
        id: "conflict-1",
        knowledge_id: "doc-1",
      });

      const resolution = {
        strategy: "manual_merge",
        mergedContent: "merged text",
      };
      const result = await manager.resolveConflict(
        "conflict-1",
        "did:user:1",
        resolution,
      );

      expect(result.success).toBe(true);
    });

    it("should return CONFLICT_NOT_FOUND for unknown conflict", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.resolveConflict(
        "nonexistent",
        "did:user:1",
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("CONFLICT_NOT_FOUND");
    });
  });

  // =============================================
  // addInlineComment
  // =============================================

  describe("addInlineComment", () => {
    it("should add a comment and return commentId and threadId", async () => {
      const comment = {
        orgId: "org-1",
        authorDid: "did:user:1",
        authorName: "Alice",
        content: "Great point!",
        positionStart: 100,
        positionEnd: 150,
        parentCommentId: null,
      };

      const result = await manager.addInlineComment("doc-1", comment);

      expect(result.success).toBe(true);
      expect(typeof result.commentId).toBe("string");
      // When no threadId is provided, threadId === commentId (new thread)
      expect(result.threadId).toBe(result.commentId);
    });

    it("should use existing threadId if provided", async () => {
      const comment = {
        orgId: "org-1",
        authorDid: "did:user:1",
        authorName: "Alice",
        content: "Reply",
        positionStart: 100,
        positionEnd: 150,
        threadId: "existing-thread",
        parentCommentId: "parent-comment",
      };

      const result = await manager.addInlineComment("doc-1", comment);

      expect(result.success).toBe(true);
      expect(result.threadId).toBe("existing-thread");
    });

    it("should notify subscribers of new comment", async () => {
      const callback = vi.fn();
      manager.subscribeToChanges("doc-1", callback);

      await manager.addInlineComment("doc-1", {
        orgId: null,
        authorDid: "did:user:1",
        authorName: "Alice",
        content: "Note",
        positionStart: 0,
        positionEnd: 10,
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: "comment_added" }),
      );
      const callArg = callback.mock.calls[0][0];
      expect(typeof callArg.commentId).toBe("string");
    });
  });

  // =============================================
  // resolveComment
  // =============================================

  describe("resolveComment", () => {
    it("should resolve an existing comment", async () => {
      prepResult.get.mockReturnValue({
        id: "comment-1",
        knowledge_id: "doc-1",
        thread_id: "thread-1",
      });

      const result = await manager.resolveComment("comment-1", "did:user:1");

      expect(result.success).toBe(true);
    });

    it("should return COMMENT_NOT_FOUND for unknown comment", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.resolveComment("nonexistent", "did:user:1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("COMMENT_NOT_FOUND");
    });
  });

  // =============================================
  // getComments
  // =============================================

  describe("getComments", () => {
    it("should return comments for a document", async () => {
      prepResult.all.mockReturnValue([
        {
          id: "c1",
          author_did: "did:user:1",
          author_name: "Alice",
          content: "Hello",
          position_start: 0,
          position_end: 10,
          thread_id: "t1",
          parent_comment_id: null,
          status: "open",
          resolved_by: null,
          resolved_at: null,
          created_at: 1000,
          updated_at: 1000,
        },
      ]);

      const result = await manager.getComments("doc-1");

      expect(result.success).toBe(true);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe("c1");
      expect(result.comments[0].authorDid).toBe("did:user:1");
    });

    it("should filter by status", async () => {
      prepResult.all.mockReturnValue([]);

      await manager.getComments("doc-1", { status: "resolved" });

      const db = mockDb.getDatabase();
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by threadId", async () => {
      prepResult.all.mockReturnValue([]);

      await manager.getComments("doc-1", { threadId: "thread-1" });

      expect(prepResult.all).toHaveBeenCalled();
    });
  });

  // =============================================
  // getDocumentHistory
  // =============================================

  describe("getDocumentHistory", () => {
    it("should return version history", async () => {
      prepResult.all.mockReturnValue([
        {
          id: "snap-2",
          snapshot_data: "data2",
          state_vector: "sv2",
          metadata: '{"author":"Alice"}',
          created_at: 2000,
        },
        {
          id: "snap-1",
          snapshot_data: "data1",
          state_vector: "sv1",
          metadata: null,
          created_at: 1000,
        },
      ]);

      const result = await manager.getDocumentHistory("doc-1");

      expect(result.success).toBe(true);
      expect(result.versions).toHaveLength(2);
      expect(result.versions[0].version).toBe(2);
      expect(result.versions[0].metadata).toEqual({ author: "Alice" });
      expect(result.versions[1].metadata).toEqual({});
    });
  });

  // =============================================
  // restoreVersion
  // =============================================

  describe("restoreVersion", () => {
    it("should restore a version and return snapshot data", async () => {
      prepResult.get.mockReturnValue({
        id: "snap-1",
        snapshot_data: "restored-data",
        state_vector: "sv-1",
      });

      const result = await manager.restoreVersion(
        "doc-1",
        "snap-1",
        "did:user:1",
      );

      expect(result.success).toBe(true);
      expect(result.snapshotData).toBe("restored-data");
      expect(result.stateVector).toBe("sv-1");
    });

    it("should return VERSION_NOT_FOUND for unknown version", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.restoreVersion(
        "doc-1",
        "nonexistent",
        "did:user:1",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("VERSION_NOT_FOUND");
    });

    it("should create auto-snapshot before restoring when yjsCollabManager is set", async () => {
      const mockYjs = { createSnapshot: vi.fn().mockResolvedValue(true) };
      manager.setYjsManager(mockYjs);

      prepResult.get.mockReturnValue({
        id: "snap-1",
        snapshot_data: "data",
        state_vector: "sv",
      });

      await manager.restoreVersion("doc-1", "snap-1", "did:user:1");

      expect(mockYjs.createSnapshot).toHaveBeenCalledWith("doc-1", {
        reason: "pre_restore",
        auto: true,
      });
    });
  });

  // =============================================
  // getStats
  // =============================================

  describe("getStats", () => {
    it("should return default stats when no record exists", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.getStats("doc-1");

      expect(result.success).toBe(true);
      expect(result.stats.totalEdits).toBe(0);
      expect(result.stats.totalCollaborators).toBe(0);
    });

    it("should return stats from database", async () => {
      prepResult.get.mockReturnValue({
        total_edits: 42,
        total_collaborators: 5,
        total_conflicts: 2,
        total_comments: 10,
        total_sessions: 15,
        last_edit_at: 1000,
        last_conflict_at: 500,
      });

      const result = await manager.getStats("doc-1");

      expect(result.success).toBe(true);
      expect(result.stats.totalEdits).toBe(42);
      expect(result.stats.totalCollaborators).toBe(5);
      expect(result.stats.totalConflicts).toBe(2);
      expect(result.stats.totalComments).toBe(10);
    });
  });

  // =============================================
  // subscribeToChanges
  // =============================================

  describe("subscribeToChanges", () => {
    it("should add subscriber and return unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribeToChanges("doc-1", callback);

      expect(typeof unsubscribe).toBe("function");
      expect(manager.documentSubscribers.get("doc-1").size).toBe(1);
    });

    it("should unsubscribe when returned function is called", () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribeToChanges("doc-1", callback);

      unsubscribe();

      expect(manager.documentSubscribers.get("doc-1").size).toBe(0);
    });

    it("should support multiple subscribers for the same document", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      manager.subscribeToChanges("doc-1", cb1);
      manager.subscribeToChanges("doc-1", cb2);

      expect(manager.documentSubscribers.get("doc-1").size).toBe(2);
    });
  });

  // =============================================
  // exportWithComments
  // =============================================

  describe("exportWithComments", () => {
    it("should return DOCUMENT_NOT_FOUND when doc does not exist", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.exportWithComments("doc-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("DOCUMENT_NOT_FOUND");
    });

    it("should export document with no comments", async () => {
      prepResult.get.mockReturnValue({
        content: "Hello world",
        title: "Test Doc",
      });
      prepResult.all.mockReturnValue([]);

      const result = await manager.exportWithComments("doc-1");

      expect(result.success).toBe(true);
      expect(result.title).toBe("Test Doc");
      expect(result.content).toBe("Hello world");
      expect(result.commentCount).toBe(0);
    });

    it("should export document with comments in markdown format", async () => {
      prepResult.get.mockReturnValue({
        content: "Hello world content",
        title: "Test Doc",
      });
      prepResult.all.mockReturnValue([
        {
          id: "abcdefgh-1234",
          author_name: "Alice",
          content: "Nice!",
          position_start: 5,
          position_end: 10,
          created_at: 1000000,
        },
      ]);

      const result = await manager.exportWithComments("doc-1", "markdown");

      expect(result.success).toBe(true);
      expect(result.commentCount).toBe(1);
      expect(result.content).toContain("Comments");
      expect(result.content).toContain("Alice");
    });
  });

  // =============================================
  // _generateUserColor
  // =============================================

  describe("_generateUserColor", () => {
    it("should return a color from the palette", () => {
      const color = manager._generateUserColor("did:user:1");
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return consistent color for the same DID", () => {
      const color1 = manager._generateUserColor("did:user:test");
      const color2 = manager._generateUserColor("did:user:test");
      expect(color1).toBe(color2);
    });

    it("should handle null/undefined DID", () => {
      const color = manager._generateUserColor(null);
      expect(typeof color).toBe("string");
    });
  });

  // =============================================
  // _notifySubscribers error handling
  // =============================================

  describe("_notifySubscribers", () => {
    it("should handle errors in subscriber callbacks gracefully", () => {
      const badCallback = vi.fn(() => {
        throw new Error("callback error");
      });
      const goodCallback = vi.fn();

      manager.subscribeToChanges("doc-1", badCallback);
      manager.subscribeToChanges("doc-1", goodCallback);

      // Should not throw
      manager._notifySubscribers("doc-1", { type: "test" });

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  // =============================================
  // Singleton helpers
  // =============================================

  describe("singleton helpers", () => {
    it("getRealtimeCollabManager should create instance with database", () => {
      const {
        getRealtimeCollabManager,
        setRealtimeCollabManager,
      } = require("../realtime-collab-manager.js");
      setRealtimeCollabManager(null); // reset

      const instance = getRealtimeCollabManager(mockDb);
      expect(instance).toBeInstanceOf(RealtimeCollabManager);

      setRealtimeCollabManager(null); // cleanup
    });

    it("getRealtimeCollabManager should return null without database", () => {
      const {
        getRealtimeCollabManager,
        setRealtimeCollabManager,
      } = require("../realtime-collab-manager.js");
      setRealtimeCollabManager(null);

      const instance = getRealtimeCollabManager();
      expect(instance).toBeNull();
    });
  });
});
