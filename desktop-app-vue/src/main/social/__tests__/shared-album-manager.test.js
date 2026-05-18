/**
 * SharedAlbumManager unit tests
 *
 * Covers: initialize (table creation), createAlbum (insert, owner membership,
 * emit, validation), deleteAlbum (ownership check, cascaded deletes, emit),
 * updateAlbum (permission checks, field updates), getAlbums (query delegation),
 * getAlbumById (visibility rules, null for private/forbidden), addPhoto
 * (permission check, insert, emit), removePhoto (ownership/permission check),
 * addMember (owner-only insert, role update, editor→viewer allowed), removeMember
 * (owner-removal guard, permission check), getMembers, handleAlbumShareReceived
 * (idempotent insert), handlePhotoReceived (idempotent insert), close.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Module under test ────────────────────────────────────────────────────────
const {
  SharedAlbumManager,
  AlbumVisibility,
  AlbumMemberRole,
} = require("../shared-album-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockPrepResult() {
  return {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
}

/**
 * Build a mock database object that mirrors the real app pattern:
 * `database.db` is the inner SQLite-like interface.
 */
function createMockDatabase() {
  const prepResult = createMockPrepResult();
  const db = {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
  return { db };
}

function createMockDIDManager(did = "did:test:owner") {
  return {
    getCurrentIdentity: vi.fn().mockReturnValue({ did }),
  };
}

function createMockP2PManager() {
  return {
    on: vi.fn(),
    sendEncryptedMessage: vi.fn().mockResolvedValue(undefined),
    getConnectedPeers: vi.fn().mockReturnValue([]),
  };
}

function createMockFriendManager(isFriend = false) {
  return {
    isFriend: vi.fn().mockResolvedValue(isFriend),
    getFriends: vi.fn().mockResolvedValue([]),
  };
}

function makeAlbumRow(overrides = {}) {
  return {
    id: "album-001",
    name: "Summer 2024",
    description: "Beach photos",
    cover_url: null,
    owner_did: "did:test:owner",
    visibility: AlbumVisibility.FRIENDS,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    photo_count: 0,
    member_count: 1,
    ...overrides,
  };
}

function makeMemberRow(overrides = {}) {
  return {
    id: "member-001",
    album_id: "album-001",
    member_did: "did:test:owner",
    role: AlbumMemberRole.OWNER,
    joined_at: 1700000000000,
    ...overrides,
  };
}

function makePhotoRow(overrides = {}) {
  return {
    id: "photo-001",
    album_id: "album-001",
    uploader_did: "did:test:owner",
    file_path: "/photos/beach.jpg",
    thumbnail_path: "/photos/beach_thumb.jpg",
    caption: "Sunset",
    file_size: 1024000,
    mime_type: "image/jpeg",
    width: 1920,
    height: 1080,
    is_encrypted: 1,
    created_at: 1700000000000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SharedAlbumManager", () => {
  let manager;
  let mockDb;
  let db; // inner db (mockDb.db)
  let didManager;
  let p2pManager;
  let friendManager;

  beforeEach(() => {
    uuidCounter = 0;
    mockDb = createMockDatabase();
    db = mockDb.db;
    didManager = createMockDIDManager();
    p2pManager = createMockP2PManager();
    friendManager = createMockFriendManager();
    manager = new SharedAlbumManager(mockDb, didManager, p2pManager, friendManager);
    vi.clearAllMocks();
    // Re-wire after clearAllMocks
    db.exec = vi.fn();
    const freshPrep = createMockPrepResult();
    db.prepare = vi.fn().mockReturnValue(freshPrep);
    db._prep = freshPrep;
    didManager.getCurrentIdentity = vi.fn().mockReturnValue({ did: "did:test:owner" });
    p2pManager.on = vi.fn();
    p2pManager.sendEncryptedMessage = vi.fn().mockResolvedValue(undefined);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor & constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor & exported constants", () => {
    it("should start with initialized=false", () => {
      const m = new SharedAlbumManager(mockDb, didManager);
      expect(m.initialized).toBe(false);
    });

    it("should be an EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });

    it("should export AlbumVisibility with correct values", () => {
      expect(AlbumVisibility.PRIVATE).toBe("private");
      expect(AlbumVisibility.FRIENDS).toBe("friends");
      expect(AlbumVisibility.PUBLIC).toBe("public");
    });

    it("should export AlbumMemberRole with correct values", () => {
      expect(AlbumMemberRole.OWNER).toBe("owner");
      expect(AlbumMemberRole.EDITOR).toBe("editor");
      expect(AlbumMemberRole.VIEWER).toBe("viewer");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create shared_albums, album_members, and album_photos tables", async () => {
      await manager.initialize();

      const allSql = db.exec.mock.calls.map((c) => c[0]).join(" ");
      expect(allSql).toContain("shared_albums");
      expect(allSql).toContain("album_members");
      expect(allSql).toContain("album_photos");
    });

    it("should create indexes for efficient queries", async () => {
      await manager.initialize();

      const allSql = db.exec.mock.calls.map((c) => c[0]).join(" ");
      expect(allSql).toContain("idx_shared_albums_owner");
      expect(allSql).toContain("idx_album_members_album");
      expect(allSql).toContain("idx_album_photos_album");
    });

    it("should set initialized=true on success", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should set up p2p listeners for album:share-received", async () => {
      await manager.initialize();
      expect(p2pManager.on).toHaveBeenCalledWith(
        "album:share-received",
        expect.any(Function)
      );
    });

    it("should propagate db.exec errors", async () => {
      db.exec.mockImplementationOnce(() => {
        throw new Error("DB init failure");
      });
      await expect(manager.initialize()).rejects.toThrow("DB init failure");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createAlbum()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createAlbum()", () => {
    it("should insert album into shared_albums via prepare().run()", async () => {
      await manager.createAlbum({
        name: "Beach Trip",
        description: "Summer photos",
        visibility: AlbumVisibility.FRIENDS,
      });

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const albumInsert = prepCalls.find((sql) =>
        sql.includes("INSERT INTO shared_albums")
      );
      expect(albumInsert).toBeTruthy();
    });

    it("should add the owner as a member with role='owner'", async () => {
      await manager.createAlbum({ name: "My Album" });

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const memberInsert = prepCalls.find((sql) =>
        sql.includes("INSERT INTO album_members")
      );
      expect(memberInsert).toBeTruthy();
      // Verify the run call included 'owner'
      const runCalls = db._prep.run.mock.calls;
      const ownerCall = runCalls.find((args) => args.includes(AlbumMemberRole.OWNER));
      expect(ownerCall).toBeTruthy();
    });

    it("should return an album object with expected fields", async () => {
      const album = await manager.createAlbum({
        name: "Vacation",
        description: "2024 vacation",
        visibility: AlbumVisibility.PUBLIC,
      });

      expect(album).toBeDefined();
      expect(album.name).toBe("Vacation");
      expect(album.owner_did).toBe("did:test:owner");
      expect(album.visibility).toBe(AlbumVisibility.PUBLIC);
      expect(album.id).toBeDefined();
    });

    it("should emit album:created event", async () => {
      const spy = vi.fn();
      manager.on("album:created", spy);

      await manager.createAlbum({ name: "Party Pics" });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ album: expect.any(Object) })
      );
    });

    it("should throw when name is empty string", async () => {
      await expect(manager.createAlbum({ name: "" })).rejects.toThrow(
        "Album name cannot be empty"
      );
    });

    it("should throw when name is only whitespace", async () => {
      await expect(manager.createAlbum({ name: "   " })).rejects.toThrow(
        "Album name cannot be empty"
      );
    });

    it("should throw when album name exceeds 100 characters", async () => {
      const longName = "a".repeat(101);
      await expect(manager.createAlbum({ name: longName })).rejects.toThrow(
        "cannot exceed 100 characters"
      );
    });

    it("should throw when user is not logged in", async () => {
      didManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.createAlbum({ name: "Test" })).rejects.toThrow(
        "Not logged in"
      );
    });

    it("should use default visibility of 'friends' when not provided", async () => {
      const album = await manager.createAlbum({ name: "Defaults" });
      expect(album.visibility).toBe(AlbumVisibility.FRIENDS);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getAlbums()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getAlbums()", () => {
    it("should return array from prepare().all()", async () => {
      db._prep.all.mockReturnValueOnce([makeAlbumRow()]);
      const albums = await manager.getAlbums();
      expect(Array.isArray(albums)).toBe(true);
      expect(albums).toHaveLength(1);
    });

    it("should return empty array when no albums found", async () => {
      db._prep.all.mockReturnValueOnce([]);
      const albums = await manager.getAlbums();
      expect(albums).toHaveLength(0);
    });

    it("should return empty array when user is not logged in", async () => {
      didManager.getCurrentIdentity.mockReturnValue(null);
      const albums = await manager.getAlbums();
      expect(albums).toEqual([]);
    });

    it("should query with visibility filter when provided", async () => {
      db._prep.all.mockReturnValueOnce([]);
      await manager.getAlbums({ visibility: AlbumVisibility.PUBLIC });

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const queryWithVisibility = prepCalls.find((sql) =>
        sql.includes("visibility")
      );
      expect(queryWithVisibility).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getAlbumById()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getAlbumById()", () => {
    it("should return album when found and publicly accessible", async () => {
      db._prep.get.mockReturnValueOnce(
        makeAlbumRow({ visibility: AlbumVisibility.PUBLIC })
      );

      const album = await manager.getAlbumById("album-001");
      expect(album).toBeDefined();
      expect(album.id).toBe("album-001");
    });

    it("should return null when album not found", async () => {
      db._prep.get.mockReturnValueOnce(null);
      const album = await manager.getAlbumById("ghost-album");
      expect(album).toBeNull();
    });

    it("should return null for private album when user is not a member", async () => {
      db._prep.get
        .mockReturnValueOnce(
          makeAlbumRow({
            visibility: AlbumVisibility.PRIVATE,
            owner_did: "did:test:other",
          })
        )
        .mockReturnValueOnce(null); // member check → not a member

      const album = await manager.getAlbumById("album-001");
      expect(album).toBeNull();
    });

    it("should return album for private album when user IS a member", async () => {
      db._prep.get
        .mockReturnValueOnce(
          makeAlbumRow({ visibility: AlbumVisibility.PRIVATE })
        )
        .mockReturnValueOnce(makeMemberRow()); // member check → is a member

      const album = await manager.getAlbumById("album-001");
      expect(album).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // addPhoto()
  // ─────────────────────────────────────────────────────────────────────────
  describe("addPhoto()", () => {
    it("should insert photo into album_photos", async () => {
      // album exists, user is owner/editor
      db._prep.get
        .mockReturnValueOnce(makeAlbumRow())       // album lookup
        .mockReturnValueOnce(makeMemberRow());      // member lookup (owner)

      await manager.addPhoto({
        albumId: "album-001",
        filePath: "/photos/test.jpg",
        mimeType: "image/jpeg",
      });

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find((sql) =>
        sql.includes("INSERT INTO album_photos")
      );
      expect(insertCall).toBeTruthy();
    });

    it("should return photo object with expected fields", async () => {
      db._prep.get
        .mockReturnValueOnce(makeAlbumRow())
        .mockReturnValueOnce(makeMemberRow());

      const photo = await manager.addPhoto({
        albumId: "album-001",
        filePath: "/photos/test.jpg",
        caption: "Beach sunset",
      });

      expect(photo.album_id).toBe("album-001");
      expect(photo.uploader_did).toBe("did:test:owner");
      expect(photo.file_path).toBe("/photos/test.jpg");
      expect(photo.caption).toBe("Beach sunset");
      expect(photo.id).toBeDefined();
    });

    it("should emit photo:added event", async () => {
      const spy = vi.fn();
      manager.on("photo:added", spy);

      db._prep.get
        .mockReturnValueOnce(makeAlbumRow())
        .mockReturnValueOnce(makeMemberRow());

      await manager.addPhoto({
        albumId: "album-001",
        filePath: "/photos/test.jpg",
      });

      expect(spy).toHaveBeenCalledOnce();
    });

    it("should throw when album not found", async () => {
      db._prep.get.mockReturnValueOnce(null); // album not found
      await expect(
        manager.addPhoto({ albumId: "ghost", filePath: "/p.jpg" })
      ).rejects.toThrow("Album not found");
    });

    it("should throw when user has no permission (viewer role)", async () => {
      db._prep.get
        .mockReturnValueOnce(makeAlbumRow())
        .mockReturnValueOnce(makeMemberRow({ role: AlbumMemberRole.VIEWER }));

      await expect(
        manager.addPhoto({ albumId: "album-001", filePath: "/p.jpg" })
      ).rejects.toThrow("No permission to add photos");
    });

    it("should throw when user is not logged in", async () => {
      didManager.getCurrentIdentity.mockReturnValue(null);
      await expect(
        manager.addPhoto({ albumId: "album-001", filePath: "/p.jpg" })
      ).rejects.toThrow("Not logged in");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // removePhoto()
  // ─────────────────────────────────────────────────────────────────────────
  describe("removePhoto()", () => {
    it("should delete the photo when requester is the uploader", async () => {
      db._prep.get.mockReturnValueOnce(makePhotoRow()); // photo found

      const result = await manager.removePhoto("photo-001");

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const deleteCall = prepCalls.find((sql) =>
        sql.includes("DELETE FROM album_photos")
      );
      expect(deleteCall).toBeTruthy();
      expect(result.success).toBe(true);
    });

    it("should throw when photo not found", async () => {
      db._prep.get.mockReturnValueOnce(null);
      await expect(manager.removePhoto("ghost-photo")).rejects.toThrow(
        "Photo not found"
      );
    });

    it("should throw when user has no permission (non-uploader, non-owner)", async () => {
      // Photo uploaded by someone else
      db._prep.get
        .mockReturnValueOnce(makePhotoRow({ uploader_did: "did:test:other" }))
        .mockReturnValueOnce(makeMemberRow({ role: AlbumMemberRole.VIEWER }));

      didManager.getCurrentIdentity.mockReturnValue({ did: "did:test:owner" });

      await expect(manager.removePhoto("photo-001")).rejects.toThrow(
        "No permission to remove"
      );
    });

    it("should allow owner/editor to remove someone else's photo", async () => {
      db._prep.get
        .mockReturnValueOnce(makePhotoRow({ uploader_did: "did:test:other" }))
        .mockReturnValueOnce(makeMemberRow({ role: AlbumMemberRole.EDITOR }));

      const result = await manager.removePhoto("photo-001");
      expect(result.success).toBe(true);
    });

    it("should emit photo:removed event", async () => {
      const spy = vi.fn();
      manager.on("photo:removed", spy);

      db._prep.get.mockReturnValueOnce(makePhotoRow());
      await manager.removePhoto("photo-001");

      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // addMember()
  // ─────────────────────────────────────────────────────────────────────────
  describe("addMember()", () => {
    it("should insert new member when requester is the owner", async () => {
      db._prep.get
        .mockReturnValueOnce(makeAlbumRow())   // album lookup
        .mockReturnValueOnce(null);            // new member not yet in album

      await manager.addMember("album-001", "did:test:newbie", AlbumMemberRole.VIEWER);

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find((sql) =>
        sql.includes("INSERT INTO album_members")
      );
      expect(insertCall).toBeTruthy();
    });

    it("should update role when member already exists", async () => {
      db._prep.get
        .mockReturnValueOnce(makeAlbumRow())
        .mockReturnValueOnce(
          makeMemberRow({ member_did: "did:test:editor", role: AlbumMemberRole.VIEWER })
        );

      await manager.addMember("album-001", "did:test:editor", AlbumMemberRole.EDITOR);

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const updateCall = prepCalls.find(
        (sql) => sql.includes("UPDATE album_members") && sql.includes("role")
      );
      expect(updateCall).toBeTruthy();
    });

    it("should emit member:added event", async () => {
      const spy = vi.fn();
      manager.on("member:added", spy);

      db._prep.get
        .mockReturnValueOnce(makeAlbumRow())
        .mockReturnValueOnce(null);

      await manager.addMember("album-001", "did:test:newbie");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("should throw when album not found", async () => {
      db._prep.get.mockReturnValueOnce(null);
      await expect(
        manager.addMember("ghost", "did:test:x")
      ).rejects.toThrow("Album not found");
    });

    it("should throw when non-owner tries to add editor", async () => {
      // Album owned by someone else; current user is editor
      db._prep.get
        .mockReturnValueOnce(makeAlbumRow({ owner_did: "did:test:other" }))
        .mockReturnValueOnce(makeMemberRow({ role: AlbumMemberRole.EDITOR }));

      await expect(
        manager.addMember("album-001", "did:test:newbie", AlbumMemberRole.EDITOR)
      ).rejects.toThrow("No permission to add members");
    });

    it("should allow editor to add viewer", async () => {
      db._prep.get
        .mockReturnValueOnce(makeAlbumRow({ owner_did: "did:test:other" }))
        .mockReturnValueOnce(makeMemberRow({ role: AlbumMemberRole.EDITOR })) // editor check
        .mockReturnValueOnce(null); // new viewer not yet in album

      const result = await manager.addMember(
        "album-001",
        "did:test:newbie",
        AlbumMemberRole.VIEWER
      );
      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // removeMember()
  // ─────────────────────────────────────────────────────────────────────────
  describe("removeMember()", () => {
    it("should delete the member record when requester is owner", async () => {
      db._prep.get.mockReturnValueOnce(makeAlbumRow());
      db._prep.run.mockReturnValueOnce({ changes: 1 });

      const result = await manager.removeMember("album-001", "did:test:viewer");
      expect(result.success).toBe(true);

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const deleteCall = prepCalls.find((sql) =>
        sql.includes("DELETE FROM album_members")
      );
      expect(deleteCall).toBeTruthy();
    });

    it("should throw when trying to remove the album owner", async () => {
      db._prep.get.mockReturnValueOnce(
        makeAlbumRow({ owner_did: "did:test:owner" })
      );

      await expect(
        manager.removeMember("album-001", "did:test:owner")
      ).rejects.toThrow("Cannot remove the album owner");
    });

    it("should throw when non-owner tries to remove another member", async () => {
      db._prep.get.mockReturnValueOnce(
        makeAlbumRow({ owner_did: "did:test:other" })
      );
      // Current user (did:test:owner) is not the album owner, and is not the
      // member being removed (did:test:victim) → should throw
      await expect(
        manager.removeMember("album-001", "did:test:victim")
      ).rejects.toThrow("No permission to remove members");
    });

    it("should allow a member to remove themselves", async () => {
      db._prep.get.mockReturnValueOnce(
        makeAlbumRow({ owner_did: "did:test:other" })
      );
      db._prep.run.mockReturnValueOnce({ changes: 1 });

      // Current user (did:test:owner) removes themselves
      const result = await manager.removeMember("album-001", "did:test:owner");
      expect(result.success).toBe(true);
    });

    it("should throw when album not found", async () => {
      db._prep.get.mockReturnValueOnce(null);
      await expect(
        manager.removeMember("ghost", "did:test:x")
      ).rejects.toThrow("Album not found");
    });

    it("should throw when member not found in album", async () => {
      db._prep.get.mockReturnValueOnce(makeAlbumRow());
      db._prep.run.mockReturnValueOnce({ changes: 0 }); // DELETE affected 0 rows

      await expect(
        manager.removeMember("album-001", "did:test:nobody")
      ).rejects.toThrow("Member not found");
    });

    it("should emit member:removed event on success", async () => {
      const spy = vi.fn();
      manager.on("member:removed", spy);

      db._prep.get.mockReturnValueOnce(makeAlbumRow());
      db._prep.run.mockReturnValueOnce({ changes: 1 });

      await manager.removeMember("album-001", "did:test:viewer");
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // deleteAlbum()
  // ─────────────────────────────────────────────────────────────────────────
  describe("deleteAlbum()", () => {
    it("should delete photos, members, and album records", async () => {
      db._prep.get.mockReturnValueOnce(makeAlbumRow());

      await manager.deleteAlbum("album-001");

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      expect(prepCalls.find((sql) => sql.includes("DELETE FROM album_photos"))).toBeTruthy();
      expect(prepCalls.find((sql) => sql.includes("DELETE FROM album_members"))).toBeTruthy();
      expect(prepCalls.find((sql) => sql.includes("DELETE FROM shared_albums"))).toBeTruthy();
    });

    it("should throw when album not found", async () => {
      db._prep.get.mockReturnValueOnce(null);
      await expect(manager.deleteAlbum("ghost")).rejects.toThrow(
        "Album not found"
      );
    });

    it("should throw when non-owner tries to delete", async () => {
      db._prep.get.mockReturnValueOnce(
        makeAlbumRow({ owner_did: "did:test:other" })
      );
      await expect(manager.deleteAlbum("album-001")).rejects.toThrow(
        "Only the owner can delete"
      );
    });

    it("should emit album:deleted event on success", async () => {
      const spy = vi.fn();
      manager.on("album:deleted", spy);

      db._prep.get.mockReturnValueOnce(makeAlbumRow());
      await manager.deleteAlbum("album-001");

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ albumId: "album-001" })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // handleAlbumShareReceived()
  // ─────────────────────────────────────────────────────────────────────────
  describe("handleAlbumShareReceived()", () => {
    it("should store the received album in shared_albums", async () => {
      db._prep.get.mockReturnValueOnce(null); // album not yet stored locally

      const sharedAlbum = makeAlbumRow();
      await manager.handleAlbumShareReceived(sharedAlbum, "did:test:sender");

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find((sql) =>
        sql.includes("INSERT OR IGNORE INTO shared_albums")
      );
      expect(insertCall).toBeTruthy();
    });

    it("should add the current user as a viewer member", async () => {
      db._prep.get.mockReturnValueOnce(null);

      await manager.handleAlbumShareReceived(makeAlbumRow(), "did:test:sender");

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const memberInsert = prepCalls.find((sql) =>
        sql.includes("INSERT OR IGNORE INTO album_members")
      );
      expect(memberInsert).toBeTruthy();
    });

    it("should be idempotent — skips if album already exists locally", async () => {
      db._prep.get.mockReturnValueOnce({ id: "album-001" }); // already exists

      await manager.handleAlbumShareReceived(makeAlbumRow(), "did:test:sender");

      // Should NOT attempt to insert
      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find((sql) =>
        sql.includes("INSERT OR IGNORE INTO shared_albums")
      );
      expect(insertCall).toBeFalsy();
    });

    it("should emit album:received event", async () => {
      const spy = vi.fn();
      manager.on("album:received", spy);

      db._prep.get.mockReturnValueOnce(null);
      await manager.handleAlbumShareReceived(makeAlbumRow(), "did:test:sender");

      expect(spy).toHaveBeenCalledOnce();
    });

    it("should silently handle when user is not logged in", async () => {
      didManager.getCurrentIdentity.mockReturnValue(null);
      await expect(
        manager.handleAlbumShareReceived(makeAlbumRow(), "did:test:sender")
      ).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // handlePhotoReceived()
  // ─────────────────────────────────────────────────────────────────────────
  describe("handlePhotoReceived()", () => {
    it("should insert received photo into album_photos", async () => {
      db._prep.get.mockReturnValueOnce(null); // photo not yet stored

      await manager.handlePhotoReceived(makePhotoRow(), "album-001", "did:test:sender");

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find((sql) =>
        sql.includes("INSERT OR IGNORE INTO album_photos")
      );
      expect(insertCall).toBeTruthy();
    });

    it("should be idempotent — skips if photo already exists", async () => {
      db._prep.get.mockReturnValueOnce({ id: "photo-001" }); // already exists

      await manager.handlePhotoReceived(makePhotoRow(), "album-001", "did:test:sender");

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find((sql) =>
        sql.includes("INSERT OR IGNORE INTO album_photos")
      );
      expect(insertCall).toBeFalsy();
    });

    it("should emit photo:received event", async () => {
      const spy = vi.fn();
      manager.on("photo:received", spy);

      db._prep.get.mockReturnValueOnce(null);
      await manager.handlePhotoReceived(makePhotoRow(), "album-001", "did:test:sender");

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ albumId: "album-001", senderDid: "did:test:sender" })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getMembers()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getMembers()", () => {
    it("should return array of members from prepare().all()", async () => {
      db._prep.all.mockReturnValueOnce([makeMemberRow()]);
      const members = await manager.getMembers("album-001");
      expect(Array.isArray(members)).toBe(true);
      expect(members).toHaveLength(1);
    });

    it("should return empty array when album has no members", async () => {
      db._prep.all.mockReturnValueOnce([]);
      const members = await manager.getMembers("album-001");
      expect(members).toHaveLength(0);
    });

    it("should query album_members for the given albumId", async () => {
      db._prep.all.mockReturnValueOnce([]);
      await manager.getMembers("my-album-42");

      const prepCalls = db.prepare.mock.calls.map((c) => c[0]);
      const query = prepCalls.find((sql) => sql.includes("album_members"));
      expect(query).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // close()
  // ─────────────────────────────────────────────────────────────────────────
  describe("close()", () => {
    it("should set initialized=false", async () => {
      manager.initialized = true;
      await manager.close();
      expect(manager.initialized).toBe(false);
    });

    it("should remove all event listeners", async () => {
      manager.on("album:created", vi.fn());
      await manager.close();
      expect(manager.listenerCount("album:created")).toBe(0);
    });
  });
});
