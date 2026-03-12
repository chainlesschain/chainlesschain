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
