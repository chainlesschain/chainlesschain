/**
 * CommunityManager Unit Tests
 *
 * Covers:
 * - initialize() / initializeTables() table creation
 * - createCommunity() happy path, validation errors
 * - getCommunities() / getCommunityById()
 * - joinCommunity() happy path, duplicate member, banned member, re-join
 * - leaveCommunity() happy path, owner cannot leave
 * - getMembers()
 * - promoteMember() / demoteMember() role hierarchy
 * - banMember() / unbanMember()
 * - searchCommunities() with and without query
 * - Event emissions
 * - Error propagation
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

// ─── Import module under test ─────────────────────────────────────────────────
const { CommunityManager, CommunityStatus, MemberRole, MemberStatus } = require("../community-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    saveToFile: vi.fn(),
  };
}

function createMockDIDManager(did = "did:test:alice") {
  return {
    getCurrentIdentity: vi.fn().mockReturnValue({ did }),
  };
}

function createMockP2PManager() {
  return {
    broadcast: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    sendMessage: vi.fn(),
  };
}

function makeCommunityRow(overrides = {}) {
  return {
    id: "community-001",
    name: "Test Community",
    description: "A test community",
    icon_url: "",
    rules_md: "",
    creator_did: "did:test:alice",
    member_limit: 1000,
    member_count: 1,
    status: "active",
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

function makeMemberRow(overrides = {}) {
  return {
    id: "member-001",
    community_id: "community-001",
    member_did: "did:test:alice",
    role: "member",
    nickname: null,
    status: "active",
    joined_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CommunityManager", () => {
  let manager;
  let mockDatabase;
  let mockDIDManager;
  let mockP2PManager;

  beforeEach(() => {
    uuidCounter = 0;
    mockDatabase = createMockDatabase();
    mockDIDManager = createMockDIDManager();
    mockP2PManager = createMockP2PManager();
    manager = new CommunityManager(mockDatabase, mockDIDManager, mockP2PManager);
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create communities and community_members tables via db.exec", async () => {
      await manager.initialize();

      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const allExecSql = execCalls.join("\n");

      expect(allExecSql).toContain("CREATE TABLE IF NOT EXISTS communities");
      expect(allExecSql).toContain("CREATE TABLE IF NOT EXISTS community_members");
      expect(manager.initialized).toBe(true);
    });

    it("should create indexes for communities and community_members", async () => {
      await manager.initialize();

      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const allExecSql = execCalls.join("\n");

      expect(allExecSql).toContain("idx_communities_creator");
      expect(allExecSql).toContain("idx_community_members_community");
    });

    it("should set initialized = true on success", async () => {
      expect(manager.initialized).toBe(false);
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent — second call should still work", async () => {
      await manager.initialize();
      await manager.initialize();
      // Both calls succeed; initialized stays true
      expect(manager.initialized).toBe(true);
    });

    it("should register P2P event listeners when p2pManager is provided", async () => {
      await manager.initialize();
      expect(mockP2PManager.on).toHaveBeenCalledWith("community:join-request", expect.any(Function));
      expect(mockP2PManager.on).toHaveBeenCalledWith("community:sync", expect.any(Function));
    });

    it("should skip P2P listener setup when no p2pManager is provided", async () => {
      const managerNoPeer = new CommunityManager(mockDatabase, mockDIDManager, null);
      // Should not throw
      await managerNoPeer.initialize();
      expect(managerNoPeer.initialized).toBe(true);
    });

    it("should throw when db.exec throws", async () => {
      mockDatabase.db.exec.mockImplementation(() => {
        throw new Error("DB exec failure");
      });

      await expect(manager.initialize()).rejects.toThrow("DB exec failure");
      expect(manager.initialized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createCommunity()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createCommunity()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should insert a community and add creator as owner member, returning community object", async () => {
      const community = await manager.createCommunity({
        name: "My Community",
        description: "A great place",
        rulesMd: "Be nice.",
      });

      expect(community).toMatchObject({
        name: "My Community",
        description: "A great place",
        creator_did: "did:test:alice",
        status: CommunityStatus.ACTIVE,
        member_count: 1,
      });
      expect(community.id).toBeTruthy();

      // Should have called prepare for INSERT into communities and community_members
      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO communities"),
      );
      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO community_members"),
      );
    });

    it("should call saveToFile after creating community", async () => {
      await manager.createCommunity({ name: "Test" });
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
    });

    it("should emit community:created event with the new community", async () => {
      const listener = vi.fn();
      manager.on("community:created", listener);

      const community = await manager.createCommunity({ name: "Event Test" });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ community });
    });

    it("should throw if name is missing", async () => {
      await expect(manager.createCommunity({ name: "" })).rejects.toThrow(
        "Community name cannot be empty",
      );
    });

    it("should throw if name is only whitespace", async () => {
      await expect(manager.createCommunity({ name: "   " })).rejects.toThrow(
        "Community name cannot be empty",
      );
    });

    it("should throw if name exceeds 100 characters", async () => {
      const longName = "A".repeat(101);
      await expect(manager.createCommunity({ name: longName })).rejects.toThrow(
        "Community name cannot exceed 100 characters",
      );
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.createCommunity({ name: "Test" })).rejects.toThrow("User not logged in");
    });

    it("should use default values for optional fields", async () => {
      const community = await manager.createCommunity({ name: "Defaults Community" });
      expect(community.description).toBe("");
      expect(community.icon_url).toBe("");
      expect(community.rules_md).toBe("");
      expect(community.member_limit).toBe(1000);
    });

    it("should insert creator as owner role in community_members", async () => {
      await manager.createCommunity({ name: "Role Test" });

      // Find the call that inserts into community_members
      const memberInsertCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO community_members"),
      );
      expect(memberInsertCall).toBeTruthy();

      const runCall = mockDatabase.db._prep.run.mock.calls;
      // One of the run calls should include 'owner'
      const ownerCall = runCall.find((args) => args.includes(MemberRole.OWNER));
      expect(ownerCall).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getCommunities()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getCommunities()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return empty array when no communities exist", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      const result = await manager.getCommunities();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("should return communities from database", async () => {
      const rows = [makeCommunityRow(), makeCommunityRow({ id: "community-002", name: "Second" })];
      mockDatabase.db._prep.all.mockReturnValue(rows);

      const result = await manager.getCommunities();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Test Community");
    });

    it("should return empty array when user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      const result = await manager.getCommunities();
      expect(result).toEqual([]);
    });

    it("should return empty array on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await manager.getCommunities();
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getCommunityById()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getCommunityById()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return a community when found", async () => {
      const row = makeCommunityRow();
      // First prepare().get() returns community, second returns member role
      mockDatabase.db._prep.get
        .mockReturnValueOnce(row)
        .mockReturnValueOnce({ role: "owner" });

      const community = await manager.getCommunityById("community-001");
      expect(community).not.toBeNull();
      expect(community.id).toBe("community-001");
      expect(community.my_role).toBe("owner");
    });

    it("should return null when community is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValue(null);
      const community = await manager.getCommunityById("nonexistent");
      expect(community).toBeNull();
    });

    it("should set my_role to null if user is not a member", async () => {
      const row = makeCommunityRow();
      mockDatabase.db._prep.get
        .mockReturnValueOnce(row)
        .mockReturnValueOnce(null); // not a member

      const community = await manager.getCommunityById("community-001");
      expect(community.my_role).toBeNull();
    });

    it("should return null on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const community = await manager.getCommunityById("community-001");
      expect(community).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // joinCommunity()
  // ─────────────────────────────────────────────────────────────────────────
  describe("joinCommunity()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should insert a new member with role=member and emit community:member-joined", async () => {
      const community = makeCommunityRow({ member_count: 5 });
      // prepare().get(): community lookup, then existing member check = null
      mockDatabase.db._prep.get
        .mockReturnValueOnce(community) // community lookup
        .mockReturnValueOnce(null); // no existing member

      const listener = vi.fn();
      manager.on("community:member-joined", listener);

      const result = await manager.joinCommunity("community-001", "did:test:bob");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        communityId: "community-001",
        memberDid: "did:test:bob",
      });
    });

    it("should increment member_count after joining", async () => {
      const community = makeCommunityRow({ member_count: 5 });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(community)
        .mockReturnValueOnce(null);

      await manager.joinCommunity("community-001", "did:test:bob");

      // Check that an UPDATE member_count call was made
      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("member_count = member_count + 1"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should throw if community is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(
        manager.joinCommunity("nonexistent", "did:test:bob"),
      ).rejects.toThrow("Community not found");
    });

    it("should throw if community is not active", async () => {
      const community = makeCommunityRow({ status: "archived" });
      mockDatabase.db._prep.get.mockReturnValueOnce(community);
      await expect(
        manager.joinCommunity("community-001", "did:test:bob"),
      ).rejects.toThrow("Community is not active");
    });

    it("should throw if community has reached member limit", async () => {
      const community = makeCommunityRow({ member_count: 1000, member_limit: 1000 });
      mockDatabase.db._prep.get.mockReturnValueOnce(community);
      await expect(
        manager.joinCommunity("community-001", "did:test:bob"),
      ).rejects.toThrow("Community has reached its member limit");
    });

    it("should throw if member is already active", async () => {
      const community = makeCommunityRow();
      const existingMember = makeMemberRow({ status: "active" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(community)
        .mockReturnValueOnce(existingMember);

      await expect(
        manager.joinCommunity("community-001", "did:test:alice"),
      ).rejects.toThrow("Already a member of this community");
    });

    it("should throw if member is banned", async () => {
      const community = makeCommunityRow();
      const bannedMember = makeMemberRow({ status: "banned" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(community)
        .mockReturnValueOnce(bannedMember);

      await expect(
        manager.joinCommunity("community-001", "did:test:alice"),
      ).rejects.toThrow("You are banned from this community");
    });

    it("should re-join a member who previously left by updating status", async () => {
      const community = makeCommunityRow();
      const leftMember = makeMemberRow({ status: "left" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(community)
        .mockReturnValueOnce(leftMember);

      const result = await manager.joinCommunity("community-001", "did:test:alice");
      expect(result).toEqual({ success: true });

      // Should UPDATE (not INSERT) for the existing record
      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE community_members SET status = ?"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should throw if user is not logged in and no memberDid provided", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.joinCommunity("community-001")).rejects.toThrow(
        "User not logged in",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // leaveCommunity()
  // ─────────────────────────────────────────────────────────────────────────
  describe("leaveCommunity()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update member status to 'left' and decrement member_count", async () => {
      const member = makeMemberRow({ role: "member" });
      mockDatabase.db._prep.get.mockReturnValueOnce(member);

      const listener = vi.fn();
      manager.on("community:member-left", listener);

      const result = await manager.leaveCommunity("community-001");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        communityId: "community-001",
        memberDid: "did:test:alice",
      });

      // Status update
      const statusUpdate = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE community_members SET status = ?"),
      );
      expect(statusUpdate).toBeTruthy();

      // member_count decrement
      const countUpdate = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("member_count = MAX(member_count - 1, 0)"),
      );
      expect(countUpdate).toBeTruthy();
    });

    it("should throw if member is the owner", async () => {
      const ownerMember = makeMemberRow({ role: "owner" });
      mockDatabase.db._prep.get.mockReturnValueOnce(ownerMember);

      await expect(manager.leaveCommunity("community-001")).rejects.toThrow(
        "Owner cannot leave the community",
      );
    });

    it("should throw if user is not a member", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(manager.leaveCommunity("community-001")).rejects.toThrow(
        "You are not a member of this community",
      );
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.leaveCommunity("community-001")).rejects.toThrow(
        "User not logged in",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getMembers()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getMembers()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return members array", async () => {
      const rows = [
        makeMemberRow({ role: "owner" }),
        makeMemberRow({ id: "member-002", member_did: "did:test:bob", role: "member" }),
      ];
      mockDatabase.db._prep.all.mockReturnValue(rows);

      const result = await manager.getMembers("community-001");
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("owner");
    });

    it("should return empty array when no members", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      const result = await manager.getMembers("community-001");
      expect(result).toEqual([]);
    });

    it("should return empty array on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await manager.getMembers("community-001");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // promoteMember()
  // ─────────────────────────────────────────────────────────────────────────
  describe("promoteMember()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should promote a member to moderator when requester is owner", async () => {
      const requester = makeMemberRow({ role: "owner" });
      const target = makeMemberRow({ id: "member-002", member_did: "did:test:bob", role: "member" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester) // requester lookup
        .mockReturnValueOnce(target); // target lookup

      const listener = vi.fn();
      manager.on("community:member-promoted", listener);

      const result = await manager.promoteMember("community-001", "did:test:bob", MemberRole.MODERATOR);
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        communityId: "community-001",
        memberDid: "did:test:bob",
        newRole: MemberRole.MODERATOR,
      });
    });

    it("should throw if requester lacks permissions (is a regular member)", async () => {
      const requester = makeMemberRow({ role: "member" });
      mockDatabase.db._prep.get.mockReturnValueOnce(requester);

      await expect(
        manager.promoteMember("community-001", "did:test:bob", MemberRole.MODERATOR),
      ).rejects.toThrow("Insufficient permissions to promote members");
    });

    it("should throw if non-owner tries to promote to admin", async () => {
      const requester = makeMemberRow({ role: "admin" });
      const target = makeMemberRow({ id: "member-002", member_did: "did:test:bob", role: "member" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      await expect(
        manager.promoteMember("community-001", "did:test:bob", MemberRole.ADMIN),
      ).rejects.toThrow("Only the owner can promote to admin");
    });

    it("should throw if target member is not found", async () => {
      const requester = makeMemberRow({ role: "owner" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(null); // target not found

      await expect(
        manager.promoteMember("community-001", "did:test:bob", MemberRole.MODERATOR),
      ).rejects.toThrow("Target member not found");
    });

    it("should throw if newRole is invalid", async () => {
      const requester = makeMemberRow({ role: "owner" });
      const target = makeMemberRow({ id: "member-002", member_did: "did:test:bob", role: "member" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      await expect(
        manager.promoteMember("community-001", "did:test:bob", "superuser"),
      ).rejects.toThrow("Invalid role for promotion");
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(
        manager.promoteMember("community-001", "did:test:bob", MemberRole.MODERATOR),
      ).rejects.toThrow("User not logged in");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // demoteMember()
  // ─────────────────────────────────────────────────────────────────────────
  describe("demoteMember()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should demote a moderator to member when requester is owner", async () => {
      const requester = makeMemberRow({ role: "owner" });
      const target = makeMemberRow({
        id: "member-002",
        member_did: "did:test:bob",
        role: "moderator",
      });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      const listener = vi.fn();
      manager.on("community:member-demoted", listener);

      const result = await manager.demoteMember("community-001", "did:test:bob");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        communityId: "community-001",
        memberDid: "did:test:bob",
      });
    });

    it("should throw if requester is not the owner", async () => {
      const requester = makeMemberRow({ role: "admin" });
      mockDatabase.db._prep.get.mockReturnValueOnce(requester);

      await expect(
        manager.demoteMember("community-001", "did:test:bob"),
      ).rejects.toThrow("Only the owner can demote members");
    });

    it("should throw if target is the owner", async () => {
      const requester = makeMemberRow({ role: "owner" });
      const target = makeMemberRow({ id: "member-002", member_did: "did:test:bob", role: "owner" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      await expect(
        manager.demoteMember("community-001", "did:test:bob"),
      ).rejects.toThrow("Cannot demote the owner");
    });

    it("should throw if target member is not found", async () => {
      const requester = makeMemberRow({ role: "owner" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(null);

      await expect(
        manager.demoteMember("community-001", "did:test:bob"),
      ).rejects.toThrow("Target member not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // banMember()
  // ─────────────────────────────────────────────────────────────────────────
  describe("banMember()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should ban a regular member when requester is moderator or above", async () => {
      const requester = makeMemberRow({ role: "moderator" });
      const target = makeMemberRow({
        id: "member-002",
        member_did: "did:test:bob",
        role: "member",
      });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      const listener = vi.fn();
      manager.on("community:member-banned", listener);

      const result = await manager.banMember("community-001", "did:test:bob");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        communityId: "community-001",
        memberDid: "did:test:bob",
      });

      // Should update status to 'banned'
      const banUpdate = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE community_members SET status = ?"),
      );
      expect(banUpdate).toBeTruthy();
    });

    it("should throw if requester lacks permissions", async () => {
      const requester = makeMemberRow({ role: "member" });
      mockDatabase.db._prep.get.mockReturnValueOnce(requester);

      await expect(
        manager.banMember("community-001", "did:test:bob"),
      ).rejects.toThrow("Insufficient permissions to ban members");
    });

    it("should throw if trying to ban someone with equal or higher role", async () => {
      // Moderator cannot ban an admin
      const requester = makeMemberRow({ role: "moderator" });
      const target = makeMemberRow({ id: "member-002", member_did: "did:test:bob", role: "admin" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      await expect(
        manager.banMember("community-001", "did:test:bob"),
      ).rejects.toThrow("Cannot ban a member with equal or higher role");
    });

    it("should throw if trying to ban the owner", async () => {
      const requester = makeMemberRow({ role: "admin" });
      const target = makeMemberRow({ id: "member-002", member_did: "did:test:owner", role: "owner" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      await expect(
        manager.banMember("community-001", "did:test:owner"),
      ).rejects.toThrow("Cannot ban a member with equal or higher role");
    });

    it("should throw if target member is not found", async () => {
      const requester = makeMemberRow({ role: "admin" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(null);

      await expect(
        manager.banMember("community-001", "did:test:bob"),
      ).rejects.toThrow("Target member not found");
    });

    it("should decrement member_count when banning", async () => {
      const requester = makeMemberRow({ role: "owner" });
      const target = makeMemberRow({ id: "member-002", member_did: "did:test:bob", role: "member" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(requester)
        .mockReturnValueOnce(target);

      await manager.banMember("community-001", "did:test:bob");

      const countUpdate = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("member_count = MAX(member_count - 1, 0)"),
      );
      expect(countUpdate).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // searchCommunities()
  // ─────────────────────────────────────────────────────────────────────────
  describe("searchCommunities()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should call prepare with a LIKE query when query string is provided", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      await manager.searchCommunities("blockchain");

      const prepareCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("LIKE"),
      );
      expect(prepareCall).toBeTruthy();
    });

    it("should return matching communities", async () => {
      const rows = [makeCommunityRow({ name: "Blockchain Devs" })];
      mockDatabase.db._prep.all.mockReturnValue(rows);

      const result = await manager.searchCommunities("blockchain");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Blockchain Devs");
    });

    it("should return all active communities when query is empty", async () => {
      const rows = [makeCommunityRow(), makeCommunityRow({ id: "c2", name: "Another" })];
      mockDatabase.db._prep.all.mockReturnValue(rows);

      const result = await manager.searchCommunities("");
      expect(result).toHaveLength(2);

      // Should NOT use LIKE (just return all active)
      const likeCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("LIKE"),
      );
      expect(likeCall).toBeFalsy();
    });

    it("should return empty array on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await manager.searchCommunities("test");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Exported Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("exported constants", () => {
    it("should export CommunityStatus with expected values", () => {
      expect(CommunityStatus.ACTIVE).toBe("active");
      expect(CommunityStatus.ARCHIVED).toBe("archived");
      expect(CommunityStatus.BANNED).toBe("banned");
    });

    it("should export MemberRole with expected values", () => {
      expect(MemberRole.OWNER).toBe("owner");
      expect(MemberRole.ADMIN).toBe("admin");
      expect(MemberRole.MODERATOR).toBe("moderator");
      expect(MemberRole.MEMBER).toBe("member");
    });

    it("should export MemberStatus with expected values", () => {
      expect(MemberStatus.ACTIVE).toBe("active");
      expect(MemberStatus.BANNED).toBe("banned");
      expect(MemberStatus.LEFT).toBe("left");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor / EventEmitter
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should be an EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });

    it("should accept database, didManager, and p2pManager via constructor", () => {
      expect(manager.database).toBe(mockDatabase);
      expect(manager.didManager).toBe(mockDIDManager);
      expect(manager.p2pManager).toBe(mockP2PManager);
    });

    it("should start with initialized = false", () => {
      const fresh = new CommunityManager(mockDatabase, mockDIDManager);
      expect(fresh.initialized).toBe(false);
    });
  });
});
