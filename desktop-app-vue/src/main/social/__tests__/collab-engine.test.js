/**
 * SocialCollabEngine unit tests
 *
 * Covers:
 * - initialize() / initializeTables() - both tables + all indexes, initialized flag, error propagation
 * - createDocument() - happy path with defaults, emits document:created,
 *   validates title required, validates title not empty string
 * - openDocument() - happy path (owner has access), tracks in openDocuments,
 *   handles yjsCollabManager when available
 * - inviteCollaborator() - inserts invite to DB with INSERT OR REPLACE
 * - getMyDocuments() - calls prepare with owner_did query
 * - _getCurrentDid() - returns DID from identity, returns null when identity missing
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));
const {
  SocialCollabEngine,
  ContentType,
  Visibility,
  DocStatus,
  InvitePermission,
  InviteStatus,
} = require("../collab-engine");
function createMockPrepResult() {
  return { all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null), run: vi.fn() };
}
function createMockDatabase() {
  const prepResult = createMockPrepResult();
  const mockDb = {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
  return {
    db: mockDb,
    getDatabase: vi.fn().mockReturnValue(mockDb),
    saveToFile: vi.fn(),
  };
}
function createMockDIDManager(did = "did:test:alice") {
  return { getCurrentIdentity: vi.fn().mockReturnValue({ did }) };
}
describe("SocialCollabEngine", () => {
  let engine;
  let mockDatabase;
  let mockDIDManager;
  beforeEach(() => {
    uuidCounter = 0;
    mockDatabase = createMockDatabase();
    mockDIDManager = createMockDIDManager();
    engine = new SocialCollabEngine(mockDatabase, mockDIDManager);
    vi.clearAllMocks();
  });
  describe("module-level constants", () => {
    it("ContentType has MARKDOWN, RICHTEXT, TABLE, WHITEBOARD", () => {
      expect(ContentType.MARKDOWN).toBe("markdown");
      expect(ContentType.RICHTEXT).toBe("richtext");
      expect(ContentType.TABLE).toBe("table");
      expect(ContentType.WHITEBOARD).toBe("whiteboard");
    });
    it("Visibility has PRIVATE, FRIENDS, INVITED", () => {
      expect(Visibility.PRIVATE).toBe("private");
      expect(Visibility.FRIENDS).toBe("friends");
      expect(Visibility.INVITED).toBe("invited");
    });
    it("DocStatus has ACTIVE and ARCHIVED", () => {
      expect(DocStatus.ACTIVE).toBe("active");
      expect(DocStatus.ARCHIVED).toBe("archived");
    });
    it("InvitePermission has EDITOR, COMMENTER, VIEWER", () => {
      expect(InvitePermission.EDITOR).toBe("editor");
      expect(InvitePermission.COMMENTER).toBe("commenter");
      expect(InvitePermission.VIEWER).toBe("viewer");
    });
    it("InviteStatus has PENDING, ACCEPTED, REJECTED", () => {
      expect(InviteStatus.PENDING).toBe("pending");
      expect(InviteStatus.ACCEPTED).toBe("accepted");
      expect(InviteStatus.REJECTED).toBe("rejected");
    });
  });
  describe("constructor", () => {
    it("sets initialized to false", () => {
      expect(engine.initialized).toBe(false);
    });
    it("initializes openDocuments as an empty Map", () => {
      expect(engine.openDocuments).toBeInstanceOf(Map);
      expect(engine.openDocuments.size).toBe(0);
    });
    it("accepts optional yjsCollabManager (defaults to null)", () => {
      expect(engine.yjsCollabManager).toBeNull();
    });
    it("stores yjsCollabManager when provided", () => {
      const yjs = { openDocument: vi.fn() };
      const e2 = new SocialCollabEngine(mockDatabase, mockDIDManager, yjs);
      expect(e2.yjsCollabManager).toBe(yjs);
    });
  });
  describe("initialize()", () => {
    it("creates social_collab_documents and social_collab_invites tables", async () => {
      await engine.initialize();
      const allSql = mockDatabase.db.exec.mock.calls.map((c) => c[0]).join(" ");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS social_collab_documents");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS social_collab_invites");
    });
    it("creates all required indexes", async () => {
      await engine.initialize();
      const allSql = mockDatabase.db.exec.mock.calls.map((c) => c[0]).join(" ");
      expect(allSql).toContain("idx_social_collab_docs_owner");
      expect(allSql).toContain("idx_social_collab_docs_status");
      expect(allSql).toContain("idx_social_collab_invites_doc");
      expect(allSql).toContain("idx_social_collab_invites_invitee");
    });
    it("sets initialized = true", async () => {
      expect(engine.initialized).toBe(false);
      await engine.initialize();
      expect(engine.initialized).toBe(true);
    });
    it("db.exec is called at least 3 times (documents table, invites table, indexes)", async () => {
      await engine.initialize();
      expect(mockDatabase.db.exec.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    it("propagates db.exec errors and leaves initialized = false", async () => {
      mockDatabase.db.exec.mockImplementation(() => {
        throw new Error("exec failed");
      });
      await expect(engine.initialize()).rejects.toThrow("exec failed");
      expect(engine.initialized).toBe(false);
    });
    it("works when database is provided via getDatabase() instead of .db", async () => {
      const dbWithGetDatabase = {
        db: undefined,
        getDatabase: vi.fn().mockReturnValue(mockDatabase.db),
      };
      const e2 = new SocialCollabEngine(dbWithGetDatabase, mockDIDManager);
      await expect(e2.initialize()).resolves.not.toThrow();
      expect(e2.initialized).toBe(true);
    });
  });
  describe("createDocument()", () => {
    beforeEach(async () => {
      await engine.initialize();
      vi.clearAllMocks();
    });
    it("happy path: inserts document and returns success=true with document object", async () => {
      uuidCounter = 0;
      const result = await engine.createDocument({ title: "My Doc" });
      expect(result.success).toBe(true);
      expect(result.document).toBeDefined();
      expect(result.document.title).toBe("My Doc");
      expect(result.document.id).toBe("test-uuid-1");
      expect(result.document.ownerDid).toBe("did:test:alice");
      expect(result.document.status).toBe(DocStatus.ACTIVE);
    });
    it("uses MARKDOWN and PRIVATE as defaults when not specified", async () => {
      const result = await engine.createDocument({ title: "Defaults Doc" });
      expect(result.document.contentType).toBe(ContentType.MARKDOWN);
      expect(result.document.visibility).toBe(Visibility.PRIVATE);
    });
    it("respects explicit contentType and visibility options", async () => {
      const result = await engine.createDocument({
        title: "Table Doc",
        contentType: ContentType.TABLE,
        visibility: Visibility.FRIENDS,
      });
      expect(result.document.contentType).toBe(ContentType.TABLE);
      expect(result.document.visibility).toBe(Visibility.FRIENDS);
    });
    it("calls db.prepare with INSERT INTO social_collab_documents", async () => {
      await engine.createDocument({ title: "Test" });
      const sql = mockDatabase.db.prepare.mock.calls[0][0];
      expect(sql).toContain("INSERT INTO social_collab_documents");
    });
    it("emits document:created event with the new document", async () => {
      const emitted = [];
      engine.on("document:created", (doc) => emitted.push(doc));
      const result = await engine.createDocument({ title: "Event Doc" });
      expect(emitted).toHaveLength(1);
      expect(emitted[0].title).toBe("Event Doc");
      expect(emitted[0]).toBe(result.document);
    });
    it("throws when title is missing (undefined)", async () => {
      await expect(engine.createDocument({ title: undefined })).rejects.toThrow("Document title is required");
    });
    it("throws when title is empty string", async () => {
      await expect(engine.createDocument({ title: "   " })).rejects.toThrow("Document title is required");
    });
    it("throws when title is not a string", async () => {
      await expect(engine.createDocument({ title: 42 })).rejects.toThrow("Document title is required");
    });
    it("throws when identity is not available", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(engine.createDocument({ title: "Test" })).rejects.toThrow("User identity not available");
    });
    it("trims whitespace from title", async () => {
      const result = await engine.createDocument({ title: "  Trimmed  " });
      expect(result.document.title).toBe("Trimmed");
    });
  });
  describe("openDocument()", () => {
    beforeEach(async () => {
      await engine.initialize();
      vi.clearAllMocks();
    });
    function makeDocRow(overrides = {}) {
      return {
        id: "doc-001",
        title: "Test Doc",
        content_type: "markdown",
        owner_did: "did:test:alice",
        visibility: "private",
        status: "active",
        created_at: Date.now(),
        updated_at: Date.now(),
        ...overrides,
      };
    }
    it("returns success=true with document and yjsHandle=null when no yjs manager", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeDocRow());
      const result = await engine.openDocument("doc-001");
      expect(result.success).toBe(true);
      expect(result.document).toBeDefined();
      expect(result.document.id).toBe("doc-001");
      expect(result.yjsHandle).toBeNull();
    });
    it("tracks the current user in openDocuments after opening", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeDocRow());
      await engine.openDocument("doc-001");
      expect(engine.openDocuments.has("doc-001")).toBe(true);
      expect(engine.openDocuments.get("doc-001").users.has("did:test:alice")).toBe(true);
    });
    it("returns collaborators array with current user", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeDocRow());
      const result = await engine.openDocument("doc-001");
      expect(result.collaborators).toContain("did:test:alice");
    });
    it("emits document:opened event", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeDocRow());
      const emitted = [];
      engine.on("document:opened", (e) => emitted.push(e));
      await engine.openDocument("doc-001");
      expect(emitted).toHaveLength(1);
      expect(emitted[0].docId).toBe("doc-001");
      expect(emitted[0].userDid).toBe("did:test:alice");
    });
    it("calls yjsCollabManager.openDocument when yjs manager is available", async () => {
      const mockYjs = { openDocument: vi.fn().mockResolvedValue({ type: "ydoc" }) };
      const e2 = new SocialCollabEngine(mockDatabase, mockDIDManager, mockYjs);
      await e2.initialize();
      vi.clearAllMocks();
      mockDatabase.db._prep.get.mockReturnValue(makeDocRow());
      const result = await e2.openDocument("doc-001");
      expect(mockYjs.openDocument).toHaveBeenCalledWith("doc-001");
      expect(result.yjsHandle).toEqual({ type: "ydoc" });
    });
    it("throws when docId is missing", async () => {
      await expect(engine.openDocument(null)).rejects.toThrow("Document ID is required");
    });
    it("throws when document is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValue(null);
      await expect(engine.openDocument("nonexistent")).rejects.toThrow("Document not found");
    });
    it("throws when document is archived", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeDocRow({ status: "archived" }));
      await expect(engine.openDocument("doc-001")).rejects.toThrow("Cannot open archived document");
    });
    it("throws when non-owner has no accepted invite", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue({ did: "did:test:bob" });
      mockDatabase.db._prep.get.mockReturnValueOnce(makeDocRow()).mockReturnValueOnce(null);
      await expect(engine.openDocument("doc-001")).rejects.toThrow("Access denied");
    });
  });
  describe("inviteCollaborator()", () => {
    beforeEach(async () => {
      await engine.initialize();
      vi.clearAllMocks();
    });
    function makeOwnerDoc() {
      return {
        id: "doc-001",
        title: "Doc",
        content_type: "markdown",
        owner_did: "did:test:alice",
        visibility: "private",
        status: "active",
        created_at: Date.now(),
        updated_at: Date.now(),
      };
    }
    it("inserts an invite with INSERT OR REPLACE and returns success=true", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeOwnerDoc());
      uuidCounter = 0;
      const result = await engine.inviteCollaborator({
        docId: "doc-001",
        inviteeDid: "did:test:carol",
      });
      expect(result.success).toBe(true);
      const sql = mockDatabase.db.prepare.mock.calls[0][0];
      expect(sql).toContain("INSERT OR REPLACE");
      expect(sql).toContain("social_collab_invites");
    });
    it("run() is called with correct invite args", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeOwnerDoc());
      uuidCounter = 0;
      await engine.inviteCollaborator({
        docId: "doc-001",
        inviteeDid: "did:test:carol",
        permission: InvitePermission.VIEWER,
      });
      const args = mockDatabase.db._prep.run.mock.calls[0];
      expect(args[0]).toBe("test-uuid-1");
      expect(args[1]).toBe("doc-001");
      expect(args[2]).toBe("did:test:alice");
      expect(args[3]).toBe("did:test:carol");
      expect(args[4]).toBe(InvitePermission.VIEWER);
    });
    it("emits invite:sent event", async () => {
      mockDatabase.db._prep.get.mockReturnValue(makeOwnerDoc());
      const emitted = [];
      engine.on("invite:sent", (e) => emitted.push(e));
      await engine.inviteCollaborator({ docId: "doc-001", inviteeDid: "did:test:carol" });
      expect(emitted).toHaveLength(1);
      expect(emitted[0].docId).toBe("doc-001");
      expect(emitted[0].inviteeDid).toBe("did:test:carol");
    });
    it("throws when docId or inviteeDid is missing", async () => {
      await expect(engine.inviteCollaborator({ docId: null, inviteeDid: "did:test:carol" }))
        .rejects.toThrow("Document ID and invitee DID are required");
    });
    it("throws when inviting yourself", async () => {
      await expect(engine.inviteCollaborator({
        docId: "doc-001",
        inviteeDid: "did:test:alice",
      })).rejects.toThrow("Cannot invite yourself");
    });
    it("throws when document is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValue(null);
      await expect(engine.inviteCollaborator({
        docId: "nonexistent",
        inviteeDid: "did:test:carol",
      })).rejects.toThrow("Document not found");
    });
    it("throws when caller is not the document owner", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue({ did: "did:test:bob" });
      mockDatabase.db._prep.get.mockReturnValue(makeOwnerDoc());
      await expect(engine.inviteCollaborator({
        docId: "doc-001",
        inviteeDid: "did:test:carol",
      })).rejects.toThrow("Only the document owner can invite collaborators");
    });
  });
  describe("getMyDocuments()", () => {
    beforeEach(async () => {
      await engine.initialize();
      vi.clearAllMocks();
    });
    it("calls db.prepare with SELECT WHERE owner_did query", async () => {
      await engine.getMyDocuments();
      const sql = mockDatabase.db.prepare.mock.calls[0][0];
      expect(sql).toContain("SELECT");
      expect(sql).toContain("social_collab_documents");
      expect(sql).toContain("owner_did");
    });
    it("returns success=true with empty documents array when no docs exist", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      const result = await engine.getMyDocuments();
      expect(result.success).toBe(true);
      expect(result.documents).toEqual([]);
    });
    it("maps database rows to document objects", async () => {
      const now = Date.now();
      mockDatabase.db._prep.all.mockReturnValue([{
        id: "doc-001",
        title: "My Doc",
        content_type: "markdown",
        owner_did: "did:test:alice",
        visibility: "private",
        status: "active",
        created_at: now,
        updated_at: now,
      }]);
      const result = await engine.getMyDocuments();
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].id).toBe("doc-001");
      expect(result.documents[0].contentType).toBe("markdown");
      expect(result.documents[0].ownerDid).toBe("did:test:alice");
    });
    it("passes currentDid, status, limit, offset to query", async () => {
      await engine.getMyDocuments({ status: DocStatus.ARCHIVED, limit: 10, offset: 20 });
      const args = mockDatabase.db._prep.all.mock.calls[0];
      expect(args[0]).toBe("did:test:alice");
      expect(args[1]).toBe(DocStatus.ARCHIVED);
      expect(args[2]).toBe(10);
      expect(args[3]).toBe(20);
    });
    it("returns empty documents when identity is not available", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      const result = await engine.getMyDocuments();
      expect(result.success).toBe(true);
      expect(result.documents).toEqual([]);
    });
  });
  describe("_getCurrentDid()", () => {
    it("returns the DID from the current identity", () => {
      expect(engine._getCurrentDid()).toBe("did:test:alice");
    });
    it("returns null when getCurrentIdentity returns null", () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      expect(engine._getCurrentDid()).toBeNull();
    });
    it("returns null when identity has no did property", () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue({});
      expect(engine._getCurrentDid()).toBeNull();
    });
    it("returns null when didManager is null", () => {
      const e2 = new SocialCollabEngine(mockDatabase, null);
      expect(e2._getCurrentDid()).toBeNull();
    });
    it("returns null when getCurrentIdentity throws", () => {
      mockDIDManager.getCurrentIdentity.mockImplementation(() => {
        throw new Error("identity error");
      });
      expect(engine._getCurrentDid()).toBeNull();
    });
  });
  describe("getDocumentById()", () => {
    it("returns null when docId is falsy", async () => {
      expect(await engine.getDocumentById(null)).toBeNull();
    });
    it("returns null when document does not exist", async () => {
      mockDatabase.db._prep.get.mockReturnValue(null);
      expect(await engine.getDocumentById("nonexistent")).toBeNull();
    });
    it("maps db row to document object correctly", async () => {
      const now = Date.now();
      mockDatabase.db._prep.get.mockReturnValue({
        id: "doc-abc",
        title: "Test",
        content_type: "richtext",
        owner_did: "did:test:alice",
        visibility: "friends",
        status: "active",
        created_at: now,
        updated_at: now,
      });
      const doc = await engine.getDocumentById("doc-abc");
      expect(doc).not.toBeNull();
      expect(doc.id).toBe("doc-abc");
      expect(doc.contentType).toBe("richtext");
      expect(doc.ownerDid).toBe("did:test:alice");
    });
  });
  describe("closeDocument()", () => {
    it("removes user from openDocuments and emits document:closed", async () => {
      engine.openDocuments.set("doc-001", { users: new Set(["did:test:alice"]) });
      const emitted = [];
      engine.on("document:closed", (e) => emitted.push(e));
      await engine.closeDocument("doc-001");
      expect(engine.openDocuments.has("doc-001")).toBe(false);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].docId).toBe("doc-001");
    });
    it("throws when docId is missing", async () => {
      await expect(engine.closeDocument(null)).rejects.toThrow("Document ID is required");
    });
  });
});
