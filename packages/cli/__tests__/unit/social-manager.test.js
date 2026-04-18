import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureSocialTables,
  addContact,
  listContacts,
  deleteContact,
  showContact,
  addFriend,
  listFriends,
  removeFriend,
  pendingRequests,
  acceptFriend,
  publishPost,
  listPosts,
  likePost,
  sendChatMessage,
  getChatMessages,
  getChatThreads,
  getSocialStats,
  _resetState,
} from "../../src/lib/social-manager.js";

describe("social-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureSocialTables(db);
  });

  // ─── Tables ─────────────────────────────────────────────────

  describe("ensureSocialTables", () => {
    it("creates all social tables", () => {
      expect(db.tables.has("social_contacts")).toBe(true);
      expect(db.tables.has("social_friends")).toBe(true);
      expect(db.tables.has("social_posts")).toBe(true);
      expect(db.tables.has("social_messages")).toBe(true);
    });

    it("is idempotent", () => {
      ensureSocialTables(db);
      expect(db.tables.has("social_contacts")).toBe(true);
    });
  });

  // ─── Contacts ───────────────────────────────────────────────

  describe("addContact", () => {
    it("adds a contact", () => {
      const c = addContact(
        db,
        "Alice",
        "did:example:alice",
        "alice@example.com",
        "A friend",
      );
      expect(c.id).toBeDefined();
      expect(c.name).toBe("Alice");
      expect(c.did).toBe("did:example:alice");
      expect(c.email).toBe("alice@example.com");
    });

    it("throws on missing name", () => {
      expect(() => addContact(db, "")).toThrow("Contact name is required");
    });

    it("persists to database", () => {
      addContact(db, "Bob");
      const rows = db.data.get("social_contacts") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("listContacts", () => {
    it("returns empty initially", () => {
      expect(listContacts()).toEqual([]);
    });

    it("lists all contacts", () => {
      addContact(db, "A");
      addContact(db, "B");
      expect(listContacts().length).toBe(2);
    });
  });

  describe("deleteContact", () => {
    it("deletes a contact", () => {
      const c = addContact(db, "Alice");
      deleteContact(db, c.id);
      expect(listContacts().length).toBe(0);
    });

    it("throws on unknown contact", () => {
      expect(() => deleteContact(db, "nonexistent")).toThrow(
        "Contact not found",
      );
    });
  });

  describe("showContact", () => {
    it("shows contact details", () => {
      const c = addContact(db, "Alice");
      const shown = showContact(c.id);
      expect(shown.name).toBe("Alice");
    });

    it("throws on unknown contact", () => {
      expect(() => showContact("nonexistent")).toThrow("Contact not found");
    });
  });

  // ─── Friends ────────────────────────────────────────────────

  describe("addFriend", () => {
    it("sends a friend request", () => {
      const c = addContact(db, "Alice");
      const f = addFriend(db, c.id);
      expect(f.status).toBe("pending");
      expect(f.contactId).toBe(c.id);
    });

    it("throws on unknown contact", () => {
      expect(() => addFriend(db, "nonexistent")).toThrow("Contact not found");
    });
  });

  describe("listFriends", () => {
    it("returns empty initially", () => {
      expect(listFriends()).toEqual([]);
    });

    it("lists friends", () => {
      const c = addContact(db, "Alice");
      addFriend(db, c.id);
      expect(listFriends().length).toBe(1);
    });
  });

  describe("removeFriend", () => {
    it("removes a friend", () => {
      const c = addContact(db, "Alice");
      addFriend(db, c.id);
      removeFriend(db, c.id);
      expect(listFriends().length).toBe(0);
    });

    it("throws on unknown friend", () => {
      expect(() => removeFriend(db, "nonexistent")).toThrow("Friend not found");
    });
  });

  describe("pendingRequests", () => {
    it("returns pending requests", () => {
      const c = addContact(db, "Alice");
      addFriend(db, c.id);
      expect(pendingRequests().length).toBe(1);
    });

    it("excludes accepted friends", () => {
      const c = addContact(db, "Alice");
      addFriend(db, c.id);
      acceptFriend(c.id);
      expect(pendingRequests().length).toBe(0);
    });
  });

  describe("acceptFriend", () => {
    it("accepts a friend request", () => {
      const c = addContact(db, "Alice");
      addFriend(db, c.id);
      const f = acceptFriend(c.id);
      expect(f.status).toBe("accepted");
    });

    it("throws on unknown request", () => {
      expect(() => acceptFriend("nonexistent")).toThrow(
        "Friend request not found",
      );
    });
  });

  // ─── Posts ──────────────────────────────────────────────────

  describe("publishPost", () => {
    it("publishes a post", () => {
      const p = publishPost(db, "Hello world", "alice");
      expect(p.id).toBeDefined();
      expect(p.content).toBe("Hello world");
      expect(p.author).toBe("alice");
      expect(p.likes).toBe(0);
    });

    it("throws on empty content", () => {
      expect(() => publishPost(db, "")).toThrow("Post content is required");
    });

    it("persists to database", () => {
      publishPost(db, "Test");
      const rows = db.data.get("social_posts") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("listPosts", () => {
    it("returns empty initially", () => {
      expect(listPosts()).toEqual([]);
    });

    it("lists all posts", () => {
      publishPost(db, "A");
      publishPost(db, "B");
      expect(listPosts().length).toBe(2);
    });

    it("filters by author", () => {
      publishPost(db, "A", "alice");
      publishPost(db, "B", "bob");
      expect(listPosts({ author: "alice" }).length).toBe(1);
    });
  });

  describe("likePost", () => {
    it("increments likes", () => {
      const p = publishPost(db, "Test");
      likePost(db, p.id);
      likePost(db, p.id);
      const posts = listPosts();
      expect(posts[0].likes).toBe(2);
    });

    it("throws on unknown post", () => {
      expect(() => likePost(db, "nonexistent")).toThrow("Post not found");
    });
  });

  // ─── Chat ──────────────────────────────────────────────────

  describe("sendChatMessage", () => {
    it("sends a message", () => {
      const m = sendChatMessage(db, "bob", "Hello!", "alice");
      expect(m.id).toBeDefined();
      expect(m.sender).toBe("alice");
      expect(m.recipient).toBe("bob");
      expect(m.content).toBe("Hello!");
      expect(m.threadId).toBe("alice:bob");
    });

    it("throws on missing recipient", () => {
      expect(() => sendChatMessage(db, "", "msg")).toThrow(
        "Recipient is required",
      );
    });

    it("throws on missing content", () => {
      expect(() => sendChatMessage(db, "bob", "")).toThrow(
        "Message content is required",
      );
    });

    it("generates consistent thread IDs", () => {
      const m1 = sendChatMessage(db, "bob", "Hi", "alice");
      const m2 = sendChatMessage(db, "alice", "Hey", "bob");
      expect(m1.threadId).toBe(m2.threadId);
    });

    it("persists to database", () => {
      sendChatMessage(db, "bob", "Test");
      const rows = db.data.get("social_messages") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getChatMessages", () => {
    it("throws on missing thread ID", () => {
      expect(() => getChatMessages("")).toThrow("Thread ID is required");
    });

    it("returns messages for a thread", () => {
      sendChatMessage(db, "bob", "A", "alice");
      sendChatMessage(db, "alice", "B", "bob");
      const msgs = getChatMessages("alice:bob");
      expect(msgs.length).toBe(2);
    });
  });

  describe("getChatThreads", () => {
    it("returns empty initially", () => {
      expect(getChatThreads()).toEqual([]);
    });

    it("returns thread summaries", () => {
      sendChatMessage(db, "bob", "A", "alice");
      sendChatMessage(db, "carol", "B", "alice");
      const threads = getChatThreads();
      expect(threads.length).toBe(2);
    });

    it("counts messages per thread", () => {
      sendChatMessage(db, "bob", "A", "alice");
      sendChatMessage(db, "alice", "B", "bob");
      sendChatMessage(db, "alice", "C", "bob");
      const threads = getChatThreads();
      expect(threads[0].messageCount).toBe(3);
    });
  });

  // ─── Stats ─────────────────────────────────────────────────

  describe("getSocialStats", () => {
    it("returns zeros initially", () => {
      const s = getSocialStats();
      expect(s.contacts).toBe(0);
      expect(s.friends).toBe(0);
      expect(s.posts).toBe(0);
      expect(s.messages).toBe(0);
    });

    it("reflects current state", () => {
      const c = addContact(db, "Alice");
      addFriend(db, c.id);
      publishPost(db, "Hello");
      sendChatMessage(db, "bob", "Hi");
      const s = getSocialStats();
      expect(s.contacts).toBe(1);
      expect(s.friends).toBe(1);
      expect(s.posts).toBe(1);
      expect(s.messages).toBe(1);
      expect(s.pendingRequests).toBe(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// V2 Surface tests — Social governance layer
// ═══════════════════════════════════════════════════════════════

import {
  RELATIONSHIP_MATURITY_V2,
  THREAD_LIFECYCLE_V2,
  SOCIAL_DEFAULT_MAX_CONNECTED_PER_USER,
  SOCIAL_DEFAULT_MAX_OPEN_THREADS_PER_USER,
  SOCIAL_DEFAULT_RELATIONSHIP_IDLE_MS,
  SOCIAL_DEFAULT_THREAD_STUCK_MS,
  getMaxConnectedPerUserV2,
  setMaxConnectedPerUserV2,
  getMaxOpenThreadsPerUserV2,
  setMaxOpenThreadsPerUserV2,
  getRelationshipIdleMsV2,
  setRelationshipIdleMsV2,
  getThreadStuckMsV2,
  setThreadStuckMsV2,
  getConnectedCountV2,
  getOpenThreadCountV2,
  registerRelationshipV2,
  getRelationshipV2,
  listRelationshipsV2,
  setRelationshipStatusV2,
  connectRelationshipV2,
  muteRelationshipV2,
  blockRelationshipV2,
  touchRelationshipV2,
  createThreadV2,
  getThreadV2,
  listThreadsV2,
  setThreadStatusV2,
  engageThreadV2,
  resolveThreadV2,
  abandonThreadV2,
  reportThreadV2,
  autoMuteIdleRelationshipsV2,
  autoAbandonStuckThreadsV2,
  getSocialManagerStatsV2,
  _resetStateSocialManagerV2,
} from "../../src/lib/social-manager.js";

describe("Social Manager V2", () => {
  beforeEach(() => _resetStateSocialManagerV2());

  describe("enums + defaults", () => {
    it("RELATIONSHIP_MATURITY_V2 frozen 4 states", () => {
      expect(Object.values(RELATIONSHIP_MATURITY_V2).sort()).toEqual([
        "blocked",
        "connected",
        "muted",
        "pending",
      ]);
      expect(Object.isFrozen(RELATIONSHIP_MATURITY_V2)).toBe(true);
    });
    it("THREAD_LIFECYCLE_V2 frozen 5 states", () => {
      expect(Object.values(THREAD_LIFECYCLE_V2).sort()).toEqual([
        "abandoned",
        "engaged",
        "open",
        "reported",
        "resolved",
      ]);
      expect(Object.isFrozen(THREAD_LIFECYCLE_V2)).toBe(true);
    });
    it("default config", () => {
      expect(SOCIAL_DEFAULT_MAX_CONNECTED_PER_USER).toBe(500);
      expect(SOCIAL_DEFAULT_MAX_OPEN_THREADS_PER_USER).toBe(50);
      expect(SOCIAL_DEFAULT_RELATIONSHIP_IDLE_MS).toBe(
        1000 * 60 * 60 * 24 * 180,
      );
      expect(SOCIAL_DEFAULT_THREAD_STUCK_MS).toBe(1000 * 60 * 60 * 24 * 7);
    });
  });

  describe("config setters", () => {
    it("rejects non-positive + floors", () => {
      expect(() => setMaxConnectedPerUserV2(0)).toThrow();
      setMaxConnectedPerUserV2(2.9);
      expect(getMaxConnectedPerUserV2()).toBe(2);
    });
    it("max-open-threads + idle/stuck setters", () => {
      setMaxOpenThreadsPerUserV2(3);
      setRelationshipIdleMsV2(1000);
      setThreadStuckMsV2(500);
      expect(getMaxOpenThreadsPerUserV2()).toBe(3);
      expect(getRelationshipIdleMsV2()).toBe(1000);
      expect(getThreadStuckMsV2()).toBe(500);
    });
  });

  describe("registerRelationshipV2", () => {
    it("creates pending relationship", () => {
      const r = registerRelationshipV2("r1", {
        userId: "alice",
        peerId: "bob",
        now: 100,
      });
      expect(r.status).toBe("pending");
      expect(r.userId).toBe("alice");
      expect(r.peerId).toBe("bob");
      expect(r.connectedAt).toBeNull();
    });
    it("rejects bad inputs / duplicates", () => {
      expect(() => registerRelationshipV2("")).toThrow();
      expect(() => registerRelationshipV2("r1", { peerId: "x" })).toThrow();
      expect(() => registerRelationshipV2("r1", { userId: "u" })).toThrow();
      registerRelationshipV2("r1", { userId: "u", peerId: "p" });
      expect(() =>
        registerRelationshipV2("r1", { userId: "u", peerId: "p" }),
      ).toThrow();
    });
    it("returns defensive copy", () => {
      const r = registerRelationshipV2("r1", {
        userId: "u",
        peerId: "p",
        metadata: { tag: "x" },
      });
      r.metadata.tag = "MUTATED";
      expect(getRelationshipV2("r1").metadata.tag).toBe("x");
    });
  });

  describe("relationship lifecycle", () => {
    beforeEach(() =>
      registerRelationshipV2("r1", { userId: "u", peerId: "p", now: 0 }),
    );
    it("pending → connected stamps connectedAt", () => {
      const r = connectRelationshipV2("r1", { now: 50 });
      expect(r.status).toBe("connected");
      expect(r.connectedAt).toBe(50);
    });
    it("connectedAt stamp-once across muted→connected recovery", () => {
      connectRelationshipV2("r1", { now: 50 });
      muteRelationshipV2("r1", { now: 60 });
      const r = connectRelationshipV2("r1", { now: 70 });
      expect(r.connectedAt).toBe(50);
    });
    it("blocked terminal sticks", () => {
      blockRelationshipV2("r1", { now: 100 });
      expect(() => connectRelationshipV2("r1")).toThrow(/terminal/);
    });
    it("rejects illegal transitions", () => {
      expect(() => setRelationshipStatusV2("r1", "muted")).toThrow(/cannot/);
      expect(() => setRelationshipStatusV2("r1", "bogus")).toThrow(/unknown/);
    });
  });

  describe("per-user connected cap", () => {
    it("enforces on pending→connected only", () => {
      setMaxConnectedPerUserV2(2);
      registerRelationshipV2("r1", { userId: "u", peerId: "p1" });
      registerRelationshipV2("r2", { userId: "u", peerId: "p2" });
      registerRelationshipV2("r3", { userId: "u", peerId: "p3" });
      connectRelationshipV2("r1");
      connectRelationshipV2("r2");
      expect(() => connectRelationshipV2("r3")).toThrow(/connected cap/);
    });
    it("recovery (muted→connected) exempt", () => {
      setMaxConnectedPerUserV2(2);
      registerRelationshipV2("r1", { userId: "u", peerId: "p1" });
      registerRelationshipV2("r2", { userId: "u", peerId: "p2" });
      connectRelationshipV2("r1");
      connectRelationshipV2("r2");
      muteRelationshipV2("r1");
      connectRelationshipV2("r1");
      expect(getConnectedCountV2("u")).toBe(2);
    });
  });

  describe("touchRelationshipV2", () => {
    it("updates lastSeenAt", () => {
      registerRelationshipV2("r1", { userId: "u", peerId: "p", now: 0 });
      const r = touchRelationshipV2("r1", { now: 999 });
      expect(r.lastSeenAt).toBe(999);
    });
    it("throws if not found", () => {
      expect(() => touchRelationshipV2("nope")).toThrow(/not found/);
    });
  });

  describe("createThreadV2", () => {
    it("creates open thread", () => {
      const t = createThreadV2("t1", {
        userId: "u",
        topic: "hello",
        now: 50,
      });
      expect(t.status).toBe("open");
      expect(t.userId).toBe("u");
      expect(t.topic).toBe("hello");
      expect(t.engagedAt).toBeNull();
    });
    it("rejects bad inputs / duplicates", () => {
      expect(() => createThreadV2("")).toThrow();
      expect(() => createThreadV2("t1", {})).toThrow();
      createThreadV2("t1", { userId: "u", topic: "x" });
      expect(() => createThreadV2("t1", { userId: "u", topic: "x" })).toThrow();
    });
    it("enforces per-user open-thread cap at create", () => {
      setMaxOpenThreadsPerUserV2(2);
      createThreadV2("t1", { userId: "u", topic: "x" });
      createThreadV2("t2", { userId: "u", topic: "x" });
      expect(() => createThreadV2("t3", { userId: "u", topic: "x" })).toThrow(
        /open-thread cap/,
      );
    });
    it("open + engaged both count toward cap", () => {
      setMaxOpenThreadsPerUserV2(2);
      createThreadV2("t1", { userId: "u", topic: "x" });
      createThreadV2("t2", { userId: "u", topic: "x" });
      engageThreadV2("t1");
      expect(() => createThreadV2("t3", { userId: "u", topic: "x" })).toThrow(
        /open-thread cap/,
      );
      // resolving t1 frees a slot
      resolveThreadV2("t1");
      const t3 = createThreadV2("t3", { userId: "u", topic: "x" });
      expect(t3.status).toBe("open");
    });
  });

  describe("thread lifecycle", () => {
    beforeEach(() => createThreadV2("t1", { userId: "u", topic: "x", now: 0 }));
    it("open → engaged stamps engagedAt", () => {
      const t = engageThreadV2("t1", { now: 50 });
      expect(t.status).toBe("engaged");
      expect(t.engagedAt).toBe(50);
    });
    it("terminal stamps settledAt", () => {
      engageThreadV2("t1", { now: 50 });
      const t = resolveThreadV2("t1", { now: 100 });
      expect(t.settledAt).toBe(100);
    });
    it("abandon from open allowed (no engaged)", () => {
      const t = abandonThreadV2("t1", { now: 30 });
      expect(t.status).toBe("abandoned");
      expect(t.settledAt).toBe(30);
      expect(t.engagedAt).toBeNull();
    });
    it("report from any non-terminal", () => {
      const t = reportThreadV2("t1", { now: 30 });
      expect(t.status).toBe("reported");
      expect(t.settledAt).toBe(30);
    });
    it("terminal sticks", () => {
      engageThreadV2("t1");
      resolveThreadV2("t1");
      expect(() => engageThreadV2("t1")).toThrow(/terminal/);
    });
    it("rejects illegal transitions", () => {
      expect(() => resolveThreadV2("t1")).toThrow(/cannot/);
      expect(() => setThreadStatusV2("t1", "bogus")).toThrow(/unknown/);
    });
  });

  describe("listRelationshipsV2 / listThreadsV2", () => {
    it("filters", () => {
      registerRelationshipV2("r1", { userId: "a", peerId: "p" });
      registerRelationshipV2("r2", { userId: "b", peerId: "p" });
      connectRelationshipV2("r1");
      expect(listRelationshipsV2({ userId: "a" })).toHaveLength(1);
      expect(listRelationshipsV2({ status: "connected" })).toHaveLength(1);
      createThreadV2("t1", { userId: "a", topic: "x" });
      engageThreadV2("t1");
      expect(listThreadsV2({ userId: "a" })).toHaveLength(1);
      expect(listThreadsV2({ status: "engaged" })).toHaveLength(1);
    });
  });

  describe("autoMuteIdleRelationshipsV2", () => {
    it("mutes idle connected relationships", () => {
      setRelationshipIdleMsV2(100);
      registerRelationshipV2("r1", { userId: "u", peerId: "p", now: 0 });
      connectRelationshipV2("r1", { now: 0 });
      const flipped = autoMuteIdleRelationshipsV2({ now: 200 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("muted");
    });
    it("skips pending/muted/blocked", () => {
      setRelationshipIdleMsV2(100);
      registerRelationshipV2("r1", { userId: "u", peerId: "p", now: 0 });
      // r1 stays pending
      const flipped = autoMuteIdleRelationshipsV2({ now: 1000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoAbandonStuckThreadsV2", () => {
    it("abandons open/engaged past stuck threshold", () => {
      setThreadStuckMsV2(100);
      createThreadV2("t1", { userId: "u", topic: "x", now: 0 });
      createThreadV2("t2", { userId: "u", topic: "x", now: 0 });
      engageThreadV2("t2", { now: 0 });
      const flipped = autoAbandonStuckThreadsV2({ now: 200 });
      expect(flipped).toHaveLength(2);
      expect(flipped.every((t) => t.status === "abandoned")).toBe(true);
    });
    it("skips terminal threads", () => {
      setThreadStuckMsV2(100);
      createThreadV2("t1", { userId: "u", topic: "x", now: 0 });
      engageThreadV2("t1", { now: 0 });
      resolveThreadV2("t1", { now: 0 });
      const flipped = autoAbandonStuckThreadsV2({ now: 1000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getSocialManagerStatsV2", () => {
    it("zero-init all enum keys", () => {
      const s = getSocialManagerStatsV2();
      expect(s.totalRelationshipsV2).toBe(0);
      expect(s.totalThreadsV2).toBe(0);
      expect(s.relationshipsByStatus.pending).toBe(0);
      expect(s.relationshipsByStatus.connected).toBe(0);
      expect(s.relationshipsByStatus.muted).toBe(0);
      expect(s.relationshipsByStatus.blocked).toBe(0);
      expect(s.threadsByStatus.open).toBe(0);
      expect(s.threadsByStatus.engaged).toBe(0);
      expect(s.threadsByStatus.resolved).toBe(0);
      expect(s.threadsByStatus.abandoned).toBe(0);
      expect(s.threadsByStatus.reported).toBe(0);
    });
    it("reflects live state", () => {
      registerRelationshipV2("r1", { userId: "u", peerId: "p" });
      connectRelationshipV2("r1");
      createThreadV2("t1", { userId: "u", topic: "x" });
      engageThreadV2("t1");
      const s = getSocialManagerStatsV2();
      expect(s.relationshipsByStatus.connected).toBe(1);
      expect(s.threadsByStatus.engaged).toBe(1);
    });
  });

  describe("_resetStateSocialManagerV2", () => {
    it("clears state and restores defaults", () => {
      setMaxConnectedPerUserV2(1);
      registerRelationshipV2("r1", { userId: "u", peerId: "p" });
      _resetStateSocialManagerV2();
      expect(getMaxConnectedPerUserV2()).toBe(
        SOCIAL_DEFAULT_MAX_CONNECTED_PER_USER,
      );
      expect(getRelationshipV2("r1")).toBeNull();
    });
  });
});
