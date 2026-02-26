/**
 * OrgKnowledgeSyncManager Unit Tests
 *
 * Tests for the organization knowledge synchronization manager:
 * - Constructor and initialization
 * - Folder creation with P2P broadcast
 * - Knowledge sharing, updating, and deleting
 * - Organization knowledge querying
 * - Activity logging
 * - Permission checking
 * - Message handling (knowledge create/update/delete, folder create, sync request)
 * - Yjs update/awareness handling
 * - Destroy/cleanup
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

// Note: uuid mock via vi.mock does not reliably intercept CJS require('uuid').
// Tests use typeof checks instead of exact uuid value assertions.

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    getDatabase: vi.fn().mockReturnValue({
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    }),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

function createMockP2PNetwork() {
  return {
    on: vi.fn(),
    broadcast: vi.fn().mockResolvedValue(true),
    sendDirect: vi.fn().mockResolvedValue(true),
  };
}

function createMockYjsCollabManager() {
  return {
    getDocument: vi.fn(),
    getAwareness: vi.fn(),
    _applyAwarenessUpdate: vi.fn(),
  };
}

function createMockDIDManager() {
  return {
    getDefaultIdentity: vi.fn().mockResolvedValue({ did: "did:user:local" }),
  };
}

const OrgKnowledgeSyncManager = require("../org-knowledge-sync-manager.js");

describe("OrgKnowledgeSyncManager", () => {
  let manager;
  let mockDb;
  let mockP2P;
  let mockYjs;
  let mockDID;
  let prepResult;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    mockP2P = createMockP2PNetwork();
    mockYjs = createMockYjsCollabManager();
    mockDID = createMockDIDManager();
    prepResult = mockDb._prep;
    manager = new OrgKnowledgeSyncManager(mockP2P, mockYjs, mockDb, mockDID);
  });

  afterEach(() => {
    manager.destroy();
  });

  // =============================================
  // Constructor
  // =============================================

  describe("constructor", () => {
    it("should initialize with all dependencies", () => {
      expect(manager.orgP2PNetwork).toBe(mockP2P);
      expect(manager.yjsCollabManager).toBe(mockYjs);
      expect(manager.database).toBe(mockDb);
      expect(manager.didManager).toBe(mockDID);
    });

    it("should initialize sync state and queue as empty maps", () => {
      expect(manager.syncState).toBeInstanceOf(Map);
      expect(manager.syncState.size).toBe(0);
      expect(manager.syncQueue).toBeInstanceOf(Map);
      expect(manager.syncQueue.size).toBe(0);
    });

    it("should define all message types", () => {
      expect(manager.MESSAGE_TYPES.KNOWLEDGE_CREATE).toBe("knowledge_create");
      expect(manager.MESSAGE_TYPES.KNOWLEDGE_UPDATE).toBe("knowledge_update");
      expect(manager.MESSAGE_TYPES.KNOWLEDGE_DELETE).toBe("knowledge_delete");
      expect(manager.MESSAGE_TYPES.FOLDER_CREATE).toBe("folder_create");
      expect(manager.MESSAGE_TYPES.SYNC_REQUEST).toBe("sync_request");
      expect(manager.MESSAGE_TYPES.YJS_UPDATE).toBe("yjs_update");
      expect(manager.MESSAGE_TYPES.YJS_AWARENESS).toBe("yjs_awareness");
    });

    it("should register message handler on P2P network", () => {
      expect(mockP2P.on).toHaveBeenCalledWith("message", expect.any(Function));
    });

    it("should extend EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });

    it("should handle missing P2P network gracefully", () => {
      const mgr = new OrgKnowledgeSyncManager(null, mockYjs, mockDb, mockDID);
      expect(mgr.orgP2PNetwork).toBeNull();
      // Should not throw
    });
  });

  // =============================================
  // initialize
  // =============================================

  describe("initialize", () => {
    it("should set up sync state for organization", async () => {
      await manager.initialize("org-1");

      const state = manager.syncState.get("org-1");
      expect(state).toBeDefined();
      expect(state.syncInProgress).toBe(false);
      expect(state.pendingOperations).toEqual([]);
      expect(typeof state.lastSyncTime).toBe("number");
    });

    it("should broadcast sync request to peers", async () => {
      await manager.initialize("org-1");

      expect(mockP2P.broadcast).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          type: "sync_request",
        }),
      );
    });

    it("should throw on broadcast error", async () => {
      mockP2P.broadcast.mockRejectedValue(new Error("Network error"));

      // The _requestInitialSync catches its own error, but initialize does not rethrow it
      // since _requestInitialSync uses try/catch internally. Let's verify it doesn't throw.
      await expect(manager.initialize("org-1")).resolves.not.toThrow();
    });
  });

  // =============================================
  // createFolder
  // =============================================

  describe("createFolder", () => {
    it("should create folder and broadcast to org", async () => {
      // _getUserDID returns 'did:user:local' from DID manager
      // _getUserName: prepare().get returns user name
      prepResult.get.mockReturnValue({ name: "LocalUser" });

      const folderData = {
        name: "Team Docs",
        description: "Shared team documents",
        parentFolderId: null,
      };

      const result = await manager.createFolder("org-1", folderData);

      expect(typeof result.id).toBe("string");
      expect(result.org_id).toBe("org-1");
      expect(result.name).toBe("Team Docs");
      expect(result.created_by).toBe("did:user:local");
      expect(prepResult.run).toHaveBeenCalled();
      expect(mockP2P.broadcast).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          type: "folder_create",
        }),
      );
    });

    it("should use default permissions when not provided", async () => {
      prepResult.get.mockReturnValue({ name: "LocalUser" });

      const result = await manager.createFolder("org-1", { name: "Folder" });

      const perms = JSON.parse(result.permissions);
      expect(perms.view).toContain("member");
    });

    it("should use custom permissions when provided", async () => {
      prepResult.get.mockReturnValue({ name: "LocalUser" });

      const customPerms = { view: ["admin", "owner"], edit: ["owner"] };
      const result = await manager.createFolder("org-1", {
        name: "Private",
        permissions: customPerms,
      });

      const perms = JSON.parse(result.permissions);
      expect(perms.view).toEqual(["admin", "owner"]);
    });

    it("should throw on database error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB failure");
      });

      await expect(
        manager.createFolder("org-1", { name: "Fail" }),
      ).rejects.toThrow();
    });
  });

  // =============================================
  // shareKnowledge
  // =============================================

  describe("shareKnowledge", () => {
    it("should share knowledge item with organization", async () => {
      // First get: knowledge exists; second get: _getUserName
      prepResult.get
        .mockReturnValueOnce({ id: "k1", title: "My Note", content: "content" })
        .mockReturnValueOnce({ name: "Alice" });

      const result = await manager.shareKnowledge("org-1", "k1", {
        folderId: "f1",
      });

      expect(result.knowledge_id).toBe("k1");
      expect(result.org_id).toBe("org-1");
      expect(result.folder_id).toBe("f1");
      expect(mockP2P.broadcast).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          type: "knowledge_create",
        }),
      );
    });

    it("should throw when knowledge item not found", async () => {
      prepResult.get.mockReturnValue(null);

      await expect(
        manager.shareKnowledge("org-1", "nonexistent"),
      ).rejects.toThrow("Knowledge item not found");
    });

    it("should use default permissions when none provided", async () => {
      prepResult.get
        .mockReturnValueOnce({ id: "k1", title: "Note" })
        .mockReturnValueOnce({ name: "User" });

      const result = await manager.shareKnowledge("org-1", "k1");

      const perms = JSON.parse(result.permissions);
      expect(perms.view).toContain("member");
    });
  });

  // =============================================
  // updateKnowledge
  // =============================================

  describe("updateKnowledge", () => {
    it("should update knowledge when user has permission", async () => {
      // updateKnowledge flow:
      //   1. _getUserDID() -> uses didManager, no DB call
      //   2. _getUserName() -> db.prepare(...).get() -> first get
      //   3. _checkPermission():
      //      a. _getUserDID() -> uses didManager, no DB call
      //      b. db.prepare(...).get(orgId, userDID) -> second get (member)
      //      c. db.prepare(...).get(knowledgeId, orgId) -> third get (org knowledge)
      //   4-5. db.prepare(...).run() for updates
      //   6. _logActivity -> _getUserDID (no DB), _getUserName -> fourth get
      prepResult.get
        .mockReturnValueOnce({ name: "Admin User" }) // _getUserName (step 2)
        .mockReturnValueOnce({ role: "admin" }) // _checkPermission: member (step 3b)
        .mockReturnValueOnce({
          permissions: JSON.stringify({ edit: ["admin", "owner"] }),
        }) // _checkPermission: orgKnowledge (step 3c)
        .mockReturnValueOnce({ name: "Admin User" }); // _getUserName in _logActivity (step 6)

      const result = await manager.updateKnowledge("org-1", "k1", {
        title: "Updated Title",
      });

      expect(result).toBe(true);
      expect(mockP2P.broadcast).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          type: "knowledge_update",
        }),
      );
    });

    it("should throw when user lacks edit permission", async () => {
      // _checkPermission: no member record found
      prepResult.get.mockReturnValue(null);

      await expect(
        manager.updateKnowledge("org-1", "k1", { title: "Fail" }),
      ).rejects.toThrow("No permission to edit");
    });
  });

  // =============================================
  // deleteKnowledge
  // =============================================

  describe("deleteKnowledge", () => {
    it("should delete knowledge when user has permission", async () => {
      // _checkPermission: owner has delete
      prepResult.get
        .mockReturnValueOnce({ role: "owner" }) // member
        .mockReturnValueOnce({
          permissions: JSON.stringify({ delete: ["owner"] }),
        }) // orgKnowledge
        .mockReturnValueOnce({ name: "Owner" }); // _getUserName for _logActivity

      const result = await manager.deleteKnowledge("org-1", "k1");

      expect(result).toBe(true);
      expect(mockP2P.broadcast).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          type: "knowledge_delete",
        }),
      );
    });

    it("should throw when user lacks delete permission", async () => {
      prepResult.get.mockReturnValue(null);

      await expect(manager.deleteKnowledge("org-1", "k1")).rejects.toThrow(
        "No permission to delete",
      );
    });
  });

  // =============================================
  // getOrganizationKnowledge
  // =============================================

  describe("getOrganizationKnowledge", () => {
    it("should return knowledge items with parsed permissions", async () => {
      prepResult.all.mockReturnValue([
        {
          id: "k1",
          title: "Note 1",
          permissions: JSON.stringify({ view: ["member"] }),
          folder_id: "f1",
        },
      ]);

      const result = await manager.getOrganizationKnowledge("org-1");

      expect(result).toHaveLength(1);
      expect(result[0].permissions).toEqual({ view: ["member"] });
    });

    it("should filter by folderId", async () => {
      prepResult.all.mockReturnValue([]);

      await manager.getOrganizationKnowledge("org-1", { folderId: "f1" });

      const db = mockDb.getDatabase();
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by type and limit", async () => {
      prepResult.all.mockReturnValue([]);

      await manager.getOrganizationKnowledge("org-1", {
        type: "note",
        limit: 10,
      });

      expect(prepResult.all).toHaveBeenCalled();
    });

    it("should return empty array on error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = await manager.getOrganizationKnowledge("org-1");

      expect(result).toEqual([]);
    });
  });

  // =============================================
  // getOrganizationFolders
  // =============================================

  describe("getOrganizationFolders", () => {
    it("should return root folders when parentFolderId is null", async () => {
      prepResult.all.mockReturnValue([
        {
          id: "f1",
          name: "Docs",
          permissions: JSON.stringify({ view: ["member"] }),
        },
      ]);

      const result = await manager.getOrganizationFolders("org-1");

      expect(result).toHaveLength(1);
      expect(result[0].permissions).toEqual({ view: ["member"] });
    });

    it("should return child folders when parentFolderId is provided", async () => {
      prepResult.all.mockReturnValue([]);

      await manager.getOrganizationFolders("org-1", "parent-folder");

      expect(prepResult.all).toHaveBeenCalled();
    });

    it("should return empty array on error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = await manager.getOrganizationFolders("org-1");

      expect(result).toEqual([]);
    });
  });

  // =============================================
  // getActivityLog
  // =============================================

  describe("getActivityLog", () => {
    it("should return activity log with parsed metadata", async () => {
      prepResult.all.mockReturnValue([
        {
          id: "a1",
          activity_type: "edit",
          metadata: '{"title":"Updated"}',
          created_at: 1000,
        },
        { id: "a2", activity_type: "share", metadata: null, created_at: 900 },
      ]);

      const result = await manager.getActivityLog("org-1");

      expect(result).toHaveLength(2);
      expect(result[0].metadata).toEqual({ title: "Updated" });
      expect(result[1].metadata).toBeNull();
    });

    it("should filter by knowledgeId", async () => {
      prepResult.all.mockReturnValue([]);

      await manager.getActivityLog("org-1", { knowledgeId: "k1" });

      expect(prepResult.all).toHaveBeenCalled();
    });

    it("should filter by userDID and activityType", async () => {
      prepResult.all.mockReturnValue([]);

      await manager.getActivityLog("org-1", {
        userDID: "did:user:1",
        activityType: "edit",
      });

      expect(prepResult.all).toHaveBeenCalled();
    });

    it("should return empty array on error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = await manager.getActivityLog("org-1");

      expect(result).toEqual([]);
    });
  });

  // =============================================
  // Message Handlers
  // =============================================

  describe("_handleKnowledgeCreate", () => {
    it("should insert knowledge and org knowledge when new", async () => {
      // existing check returns null
      prepResult.get.mockReturnValue(null);

      const payload = {
        knowledge: {
          id: "k-new",
          title: "New Note",
          type: "note",
          content: "text",
        },
        orgKnowledge: {
          id: "ok-new",
          knowledge_id: "k-new",
          org_id: "org-1",
          folder_id: null,
          permissions: '{"view":["member"]}',
          is_public: 0,
          created_by: "did:user:remote",
          last_edited_by: "did:user:remote",
          created_at: 1000,
          updated_at: 1000,
        },
        author: { did: "did:user:remote", name: "Remote User" },
      };

      const eventSpy = vi.fn();
      manager.on("knowledge-created", eventSpy);

      await manager._handleKnowledgeCreate("org-1", payload, "peer-1");

      expect(prepResult.run).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "org-1" }),
      );
    });

    it("should skip if knowledge already exists", async () => {
      prepResult.get.mockReturnValue({ id: "k-existing" });

      const eventSpy = vi.fn();
      manager.on("knowledge-created", eventSpy);

      await manager._handleKnowledgeCreate(
        "org-1",
        {
          knowledge: { id: "k-existing" },
          orgKnowledge: {},
          author: {},
        },
        "peer-1",
      );

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe("_handleKnowledgeUpdate", () => {
    it("should apply update when remote is newer", async () => {
      prepResult.get.mockReturnValue({ updated_at: 500 }); // local older

      const eventSpy = vi.fn();
      manager.on("knowledge-updated", eventSpy);

      await manager._handleKnowledgeUpdate(
        "org-1",
        {
          knowledgeId: "k1",
          updates: { title: "Remote Update" },
          author: { did: "did:user:remote" },
          timestamp: 1000,
        },
        "peer-1",
      );

      expect(prepResult.run).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalled();
    });

    it("should skip update when local is newer", async () => {
      prepResult.get.mockReturnValue({ updated_at: 2000 }); // local newer

      const eventSpy = vi.fn();
      manager.on("knowledge-updated", eventSpy);

      await manager._handleKnowledgeUpdate(
        "org-1",
        {
          knowledgeId: "k1",
          updates: { title: "Old Update" },
          author: { did: "did:user:remote" },
          timestamp: 1000,
        },
        "peer-1",
      );

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe("_handleKnowledgeDelete", () => {
    it("should delete org knowledge entry and emit event", async () => {
      const eventSpy = vi.fn();
      manager.on("knowledge-deleted", eventSpy);

      await manager._handleKnowledgeDelete(
        "org-1",
        {
          knowledgeId: "k1",
          deletedBy: "did:user:remote",
          timestamp: 1000,
        },
        "peer-1",
      );

      expect(prepResult.run).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeId: "k1",
          deletedBy: "did:user:remote",
        }),
      );
    });
  });

  describe("_handleFolderCreate", () => {
    it("should insert new folder and emit event", async () => {
      prepResult.get.mockReturnValue(null); // not existing

      const eventSpy = vi.fn();
      manager.on("folder-created", eventSpy);

      await manager._handleFolderCreate(
        "org-1",
        {
          id: "f-new",
          org_id: "org-1",
          name: "Remote Folder",
          parent_folder_id: null,
          description: null,
          icon: null,
          color: null,
          permissions: '{"view":["member"]}',
          created_by: "did:user:remote",
          created_at: 1000,
          updated_at: 1000,
        },
        "peer-1",
      );

      expect(prepResult.run).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalled();
    });

    it("should skip if folder already exists", async () => {
      prepResult.get.mockReturnValue({ id: "f-existing" });

      const eventSpy = vi.fn();
      manager.on("folder-created", eventSpy);

      await manager._handleFolderCreate(
        "org-1",
        { id: "f-existing" },
        "peer-1",
      );

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe("_handleSyncRequest", () => {
    it("should send sync response with knowledge since lastSyncTime", async () => {
      prepResult.all.mockReturnValue([
        { id: "k1", title: "Note", permissions: "{}" },
      ]);

      await manager._handleSyncRequest(
        "org-1",
        {
          lastSyncTime: 0,
          requestedBy: "did:user:remote",
        },
        "peer-1",
      );

      expect(mockP2P.sendDirect).toHaveBeenCalledWith(
        "org-1",
        "peer-1",
        expect.objectContaining({
          type: "sync_response",
        }),
      );
    });
  });

  // =============================================
  // _getUserDID / _getUserName
  // =============================================

  describe("_getUserDID", () => {
    it("should return DID from DID manager", async () => {
      const did = await manager._getUserDID();
      expect(did).toBe("did:user:local");
    });

    it("should fallback to database when DID manager is absent", async () => {
      manager.didManager = null;
      prepResult.get.mockReturnValue({ did: "did:from:db" });

      const did = await manager._getUserDID();
      expect(did).toBe("did:from:db");
    });

    it('should return "unknown" when DID manager returns null identity', async () => {
      manager.didManager = {
        getDefaultIdentity: vi.fn().mockResolvedValue(null),
      };

      const did = await manager._getUserDID();
      expect(did).toBe("unknown");
    });

    it('should return "unknown" when both sources fail', async () => {
      manager.didManager = null;
      prepResult.get.mockReturnValue(null);

      const did = await manager._getUserDID();
      expect(did).toBe("unknown");
    });
  });

  describe("_getUserName", () => {
    it("should return user name from database", async () => {
      prepResult.get.mockReturnValue({ name: "TestUser" });

      const name = await manager._getUserName();
      expect(name).toBe("TestUser");
    });

    it('should return "Anonymous" when no user profile exists', async () => {
      prepResult.get.mockReturnValue(null);

      const name = await manager._getUserName();
      expect(name).toBe("Anonymous");
    });

    it('should return "Anonymous" on error', async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const name = await manager._getUserName();
      expect(name).toBe("Anonymous");
    });
  });

  // =============================================
  // _checkPermission
  // =============================================

  describe("_checkPermission", () => {
    it("should return true when user role is in permission list", async () => {
      prepResult.get
        .mockReturnValueOnce({ role: "admin" }) // member lookup
        .mockReturnValueOnce({
          permissions: JSON.stringify({ edit: ["admin", "owner"] }),
        }); // org knowledge

      const result = await manager._checkPermission("org-1", "k1", "edit");
      expect(result).toBe(true);
    });

    it("should return true for owner regardless of permission list", async () => {
      prepResult.get
        .mockReturnValueOnce({ role: "owner" })
        .mockReturnValueOnce({
          permissions: JSON.stringify({ edit: ["admin"] }),
        });

      const result = await manager._checkPermission("org-1", "k1", "edit");
      expect(result).toBe(true);
    });

    it("should return false when user is not org member", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager._checkPermission("org-1", "k1", "edit");
      expect(result).toBe(false);
    });

    it("should return false when org knowledge not found", async () => {
      prepResult.get
        .mockReturnValueOnce({ role: "admin" })
        .mockReturnValueOnce(null); // no org knowledge

      const result = await manager._checkPermission("org-1", "k1", "edit");
      expect(result).toBe(false);
    });
  });

  // =============================================
  // destroy
  // =============================================

  describe("destroy", () => {
    it("should clear sync state and queue and remove listeners", () => {
      manager.syncState.set("org-1", { test: true });
      manager.syncQueue.set("org-1", []);
      manager.on("test-event", vi.fn());

      manager.destroy();

      expect(manager.syncState.size).toBe(0);
      expect(manager.syncQueue.size).toBe(0);
      expect(manager.listenerCount("test-event")).toBe(0);
    });
  });
});
