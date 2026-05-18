import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureActivityPubTables,
  createActor,
  listActors,
  getActor,
  publishNote,
  follow,
  acceptFollow,
  undoFollow,
  like,
  announce,
  deliverToInbox,
  getOutbox,
  getInbox,
  listFollowers,
  listFollowing,
  searchActors,
  searchNotes,
  _resetState,
  _constants,
} from "../../src/lib/activitypub-bridge.js";

describe("activitypub-bridge", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureActivityPubTables(db);
  });

  // ── Schema ─────────────────────────────────────────────────────

  describe("ensureActivityPubTables", () => {
    it("creates ap_actors, ap_activities, ap_follows", () => {
      expect(db.tables.has("ap_actors")).toBe(true);
      expect(db.tables.has("ap_activities")).toBe(true);
      expect(db.tables.has("ap_follows")).toBe(true);
    });

    it("is idempotent", () => {
      ensureActivityPubTables(db);
      expect(db.tables.has("ap_actors")).toBe(true);
    });
  });

  // ── Actor management ───────────────────────────────────────────

  describe("createActor", () => {
    it("creates a local Person actor", () => {
      const r = createActor(db, { username: "alice" });
      expect(r.success).toBe(true);
      expect(r.actor.type).toBe("Person");
      expect(r.actor.username).toBe("alice");
      expect(r.actor.isLocal).toBe(true);
      expect(r.actor.id).toMatch(/\/users\/alice$/);
      expect(r.actor.inbox).toMatch(/\/users\/alice\/inbox$/);
      expect(r.actor.outbox).toMatch(/\/users\/alice\/outbox$/);
    });

    it("honors custom origin", () => {
      const r = createActor(db, {
        username: "bob",
        origin: "https://example.org",
      });
      expect(r.actor.id).toBe("https://example.org/users/bob");
    });

    it("returns existing actor when called twice", () => {
      createActor(db, { username: "alice" });
      const r = createActor(db, { username: "alice" });
      expect(r.existed).toBe(true);
      expect(listActors().length).toBe(1);
    });

    it("creates remote actor when remoteId is given", () => {
      const r = createActor(db, {
        remoteId: "https://mastodon.social/users/eve",
        name: "Eve",
      });
      expect(r.actor.isLocal).toBe(false);
      expect(r.actor.id).toBe("https://mastodon.social/users/eve");
    });

    it("throws when neither username nor remoteId is provided", () => {
      expect(() => createActor(db, {})).toThrow("username is required");
    });

    it("persists to ap_actors", () => {
      createActor(db, { username: "alice" });
      const rows = db.data.get("ap_actors") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("listActors / getActor", () => {
    it("lists all actors by default", () => {
      createActor(db, { username: "a" });
      createActor(db, { username: "b" });
      createActor(db, { remoteId: "https://m.example/users/r" });
      expect(listActors().length).toBe(3);
    });

    it("filters by local", () => {
      createActor(db, { username: "a" });
      createActor(db, { remoteId: "https://m.example/users/r" });
      expect(listActors({ local: true }).length).toBe(1);
      expect(listActors({ local: false }).length).toBe(1);
    });

    it("getActor resolves by bare username", () => {
      createActor(db, { username: "alice" });
      const a = getActor("alice");
      expect(a).toBeTruthy();
      expect(a.username).toBe("alice");
    });

    it("getActor resolves by full URL", () => {
      const { actor } = createActor(db, {
        remoteId: "https://m.example/users/r",
      });
      const a = getActor("https://m.example/users/r");
      expect(a.id).toBe(actor.id);
    });

    it("getActor returns null for unknown refs", () => {
      expect(getActor("nope")).toBeNull();
    });
  });

  // ── Publishing ─────────────────────────────────────────────────

  describe("publishNote", () => {
    beforeEach(() => {
      createActor(db, { username: "alice" });
    });

    it("publishes a Create(Note) with public audience by default", () => {
      const r = publishNote(db, { actor: "alice", content: "hello" });
      expect(r.success).toBe(true);
      expect(r.activity.type).toBe("Create");
      expect(r.activity["@context"]).toBe(_constants.CONTEXT);
      expect(r.activity.to).toEqual([_constants.PUBLIC_AUDIENCE]);
      expect(r.activity.cc[0]).toMatch(/\/followers$/);
      expect(r.activity.object.type).toBe("Note");
      expect(r.activity.object.content).toBe("hello");
      expect(r.activity.object.attributedTo).toBe(r.activity.actor);
    });

    it("honors custom to/cc audiences", () => {
      const r = publishNote(db, {
        actor: "alice",
        content: "hi",
        to: ["https://m.example/users/bob"],
        cc: ["https://m.example/users/eve"],
      });
      expect(r.activity.to).toEqual(["https://m.example/users/bob"]);
      expect(r.activity.cc).toEqual(["https://m.example/users/eve"]);
    });

    it("honors inReplyTo", () => {
      const r = publishNote(db, {
        actor: "alice",
        content: "re:",
        inReplyTo: "https://m.example/notes/1",
      });
      expect(r.activity.object.inReplyTo).toBe("https://m.example/notes/1");
    });

    it("throws when content is empty", () => {
      expect(() => publishNote(db, { actor: "alice", content: "" })).toThrow(
        "content is required",
      );
    });

    it("throws when actor is unknown", () => {
      expect(() => publishNote(db, { actor: "nobody", content: "x" })).toThrow(
        "Actor not found",
      );
    });

    it("persists to ap_activities in outbox direction", () => {
      publishNote(db, { actor: "alice", content: "x" });
      const rows = db.data.get("ap_activities") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].direction).toBe("outbox");
      expect(rows[0].type).toBe("Create");
    });
  });

  // ── Follow / Accept / Undo ─────────────────────────────────────

  describe("follow / acceptFollow / undoFollow", () => {
    beforeEach(() => {
      createActor(db, { username: "alice" });
      createActor(db, { username: "bob" });
    });

    it("Follow publishes a Follow activity and creates a pending edge", () => {
      const r = follow(db, { actor: "alice", target: "bob" });
      expect(r.activity.type).toBe("Follow");
      const alice = getActor("alice").id;
      const bob = getActor("bob").id;
      expect(r.activity.actor).toBe(alice);
      expect(r.activity.object).toBe(bob);
      const edges = listFollowing("alice");
      expect(edges).toEqual([
        expect.objectContaining({ id: bob, state: "pending" }),
      ]);
    });

    it("accepts a remote URL as target", () => {
      const r = follow(db, {
        actor: "alice",
        target: "https://m.example/users/eve",
      });
      expect(r.activity.object).toBe("https://m.example/users/eve");
    });

    it("acceptFollow marks edge as accepted", () => {
      const fr = follow(db, { actor: "alice", target: "bob" });
      const r = acceptFollow(db, {
        actor: "bob",
        followActivityId: fr.activity.id,
      });
      expect(r.activity.type).toBe("Accept");
      const edges = listFollowing("alice", { state: "accepted" });
      expect(edges.length).toBe(1);
    });

    it("acceptFollow rejects when actor is not the Follow target", () => {
      const fr = follow(db, { actor: "alice", target: "bob" });
      createActor(db, { username: "eve" });
      expect(() =>
        acceptFollow(db, {
          actor: "eve",
          followActivityId: fr.activity.id,
        }),
      ).toThrow("Accept can only be issued by the Follow target");
    });

    it("undoFollow removes the edge and publishes Undo(Follow)", () => {
      follow(db, { actor: "alice", target: "bob" });
      const r = undoFollow(db, { actor: "alice", target: "bob" });
      expect(r.activity.type).toBe("Undo");
      expect(r.activity.object.type).toBe("Follow");
      expect(listFollowing("alice").length).toBe(0);
    });

    it("undoFollow throws when no prior Follow exists", () => {
      expect(() => undoFollow(db, { actor: "alice", target: "bob" })).toThrow(
        "No Follow activity found",
      );
    });

    it("follow/target validation", () => {
      expect(() => follow(db, { target: "bob" })).toThrow("actor is required");
      expect(() => follow(db, { actor: "alice" })).toThrow(
        "target is required",
      );
      expect(() => follow(db, { actor: "alice", target: "ghost" })).toThrow(
        "Target actor not found",
      );
    });
  });

  // ── Like / Announce ────────────────────────────────────────────

  describe("like / announce", () => {
    beforeEach(() => {
      createActor(db, { username: "alice" });
    });

    it("like publishes a Like activity", () => {
      const r = like(db, {
        actor: "alice",
        object: "https://m.example/notes/1",
      });
      expect(r.activity.type).toBe("Like");
      expect(r.activity.object).toBe("https://m.example/notes/1");
    });

    it("announce publishes a public Announce with followers cc", () => {
      const r = announce(db, {
        actor: "alice",
        object: "https://m.example/notes/1",
      });
      expect(r.activity.type).toBe("Announce");
      expect(r.activity.to).toEqual([_constants.PUBLIC_AUDIENCE]);
      expect(r.activity.cc[0]).toMatch(/\/followers$/);
    });

    it("validation", () => {
      expect(() => like(db, { actor: "alice" })).toThrow("object is required");
      expect(() => announce(db, { actor: "alice" })).toThrow(
        "object is required",
      );
    });
  });

  // ── Inbox delivery (C2S simulation) ────────────────────────────

  describe("deliverToInbox", () => {
    beforeEach(() => {
      createActor(db, { username: "alice" });
      createActor(db, { username: "bob" });
    });

    it("records a delivered activity in the inbox", () => {
      const alice = getActor("alice").id;
      const bob = getActor("bob").id;
      const activity = {
        id: "https://m.example/activities/1",
        type: "Create",
        actor: "https://m.example/users/remote",
        object: {
          type: "Note",
          content: "greetings",
          attributedTo: "https://m.example/users/remote",
        },
      };
      const r = deliverToInbox(db, { actor: "bob", activity });
      expect(r.success).toBe(true);
      const inbox = getInbox("bob");
      expect(inbox.length).toBe(1);
      expect(inbox[0].object.content).toBe("greetings");
      // Alice's inbox is untouched
      expect(getInbox("alice").length).toBe(0);
      expect(alice).not.toBe(bob);
    });

    it("Follow delivery creates a pending follower edge", () => {
      const bob = getActor("bob").id;
      deliverToInbox(db, {
        actor: "bob",
        activity: {
          type: "Follow",
          actor: "https://m.example/users/eve",
          object: bob,
        },
      });
      const followers = listFollowers("bob");
      expect(followers).toEqual([
        expect.objectContaining({
          id: "https://m.example/users/eve",
          state: "pending",
        }),
      ]);
    });

    it("Accept(Follow) delivery upgrades our outgoing Follow to accepted", () => {
      // Alice follows a remote actor
      follow(db, {
        actor: "alice",
        target: "https://m.example/users/eve",
      });
      expect(listFollowing("alice", { state: "pending" }).length).toBe(1);

      // Eve sends Accept(Follow) back — delivered to alice's inbox
      const alice = getActor("alice").id;
      const followActivity = getOutbox("alice", { types: ["Follow"] })[0];
      deliverToInbox(db, {
        actor: "alice",
        activity: {
          type: "Accept",
          actor: "https://m.example/users/eve",
          object: followActivity,
        },
      });
      expect(listFollowing("alice", { state: "accepted" }).length).toBe(1);
      expect(alice).toBeTruthy();
    });

    it("Undo(Follow) delivery removes the follower edge", () => {
      const bob = getActor("bob").id;
      deliverToInbox(db, {
        actor: "bob",
        activity: {
          type: "Follow",
          actor: "https://m.example/users/eve",
          object: bob,
        },
      });
      expect(listFollowers("bob").length).toBe(1);
      deliverToInbox(db, {
        actor: "bob",
        activity: {
          type: "Undo",
          actor: "https://m.example/users/eve",
          object: {
            type: "Follow",
            actor: "https://m.example/users/eve",
            object: bob,
          },
        },
      });
      expect(listFollowers("bob").length).toBe(0);
    });

    it("rejects malformed activities", () => {
      expect(() => deliverToInbox(db, { actor: "bob" })).toThrow(
        "activity with type and actor is required",
      );
      expect(() =>
        deliverToInbox(db, { actor: "bob", activity: { type: "Create" } }),
      ).toThrow();
    });

    it("rejects unknown recipient", () => {
      expect(() =>
        deliverToInbox(db, {
          actor: "ghost",
          activity: { type: "Create", actor: "https://x", object: {} },
        }),
      ).toThrow("Actor not found");
    });
  });

  // ── Outbox / Inbox reads ───────────────────────────────────────

  describe("getOutbox / getInbox", () => {
    beforeEach(() => {
      createActor(db, { username: "alice" });
    });

    it("getOutbox scopes to the requested actor", () => {
      publishNote(db, { actor: "alice", content: "a" });
      publishNote(db, { actor: "alice", content: "b" });
      expect(getOutbox("alice").length).toBe(2);
    });

    it("getOutbox filters by type", () => {
      createActor(db, { username: "bob" });
      publishNote(db, { actor: "alice", content: "a" });
      follow(db, { actor: "alice", target: "bob" });
      expect(getOutbox("alice", { types: ["Create"] }).length).toBe(1);
      expect(getOutbox("alice", { types: ["Follow"] }).length).toBe(1);
    });

    it("getOutbox respects limit", () => {
      for (let i = 0; i < 5; i++) {
        publishNote(db, { actor: "alice", content: `n${i}` });
      }
      expect(getOutbox("alice", { limit: 3 }).length).toBe(3);
    });

    it("getInbox returns empty for actor with no deliveries", () => {
      expect(getInbox("alice")).toEqual([]);
    });
  });

  // ── Fediverse search ───────────────────────────────────────────

  describe("searchActors", () => {
    beforeEach(() => {
      createActor(db, {
        username: "alice",
        name: "Alice Wonder",
        summary: "Tea enthusiast",
      });
      createActor(db, {
        username: "bob",
        name: "Bob Builder",
        summary: "Builds things",
      });
      createActor(db, {
        remoteId: "https://m.example/users/eve",
        name: "Eve Remote",
        summary: "Remote user",
      });
    });

    it("returns empty array for empty query", () => {
      expect(searchActors("")).toEqual([]);
      expect(searchActors("   ")).toEqual([]);
    });

    it("matches by preferredUsername", () => {
      const r = searchActors("alice");
      expect(r.length).toBe(1);
      expect(r[0].username).toBe("alice");
      expect(r[0].score).toBeGreaterThan(0);
    });

    it("matches by name (case insensitive)", () => {
      const r = searchActors("WONDER");
      expect(r.length).toBe(1);
      expect(r[0].username).toBe("alice");
    });

    it("matches by summary", () => {
      const r = searchActors("enthusiast");
      expect(r[0].username).toBe("alice");
    });

    it("scores username matches higher than summary", () => {
      createActor(db, { username: "wonder", summary: "nothing" });
      const r = searchActors("wonder");
      expect(r[0].username).toBe("wonder");
    });

    it("respects scope=local", () => {
      const r = searchActors("eve", { scope: "local" });
      expect(r.length).toBe(0);
    });

    it("respects scope=remote", () => {
      const r = searchActors("eve", { scope: "remote" });
      expect(r.length).toBe(1);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createActor(db, { username: `test${i}`, name: "test user" });
      }
      const r = searchActors("test", { limit: 3 });
      expect(r.length).toBe(3);
    });
  });

  describe("searchNotes", () => {
    beforeEach(() => {
      createActor(db, { username: "alice" });
      createActor(db, { username: "bob" });
      createActor(db, { remoteId: "https://m.example/users/eve" });
    });

    it("returns empty array for empty query", () => {
      publishNote(db, { actor: "alice", content: "anything" });
      expect(searchNotes("")).toEqual([]);
    });

    it("matches by substring in content", () => {
      publishNote(db, { actor: "alice", content: "hello world" });
      publishNote(db, { actor: "bob", content: "goodbye sky" });
      const r = searchNotes("world");
      expect(r.length).toBe(1);
      expect(r[0].content).toBe("hello world");
    });

    it("is case-insensitive", () => {
      publishNote(db, { actor: "alice", content: "HELLO World" });
      expect(searchNotes("hello").length).toBe(1);
    });

    it("scores multiple keyword hits higher", () => {
      publishNote(db, { actor: "alice", content: "tea tea tea about tea" });
      publishNote(db, { actor: "bob", content: "tea once" });
      const r = searchNotes("tea");
      expect(r[0].content).toMatch(/tea tea tea/);
    });

    it("filters by author (username)", () => {
      publishNote(db, { actor: "alice", content: "shared word" });
      publishNote(db, { actor: "bob", content: "shared word too" });
      const r = searchNotes("shared", { author: "alice" });
      expect(r.length).toBe(1);
      expect(r[0].actor).toMatch(/alice$/);
    });

    it("filters by since/until timestamps", () => {
      const pastIso = new Date(Date.now() - 10_000).toISOString();
      const futureIso = new Date(Date.now() + 10_000).toISOString();
      publishNote(db, { actor: "alice", content: "recent note" });
      expect(
        searchNotes("recent", { since: pastIso, until: futureIso }).length,
      ).toBe(1);
      expect(searchNotes("recent", { since: futureIso }).length).toBe(0);
    });

    it("scope=local excludes remote-delivered notes", () => {
      deliverToInbox(db, {
        actor: "alice",
        activity: {
          type: "Create",
          actor: "https://m.example/users/eve",
          object: {
            type: "Note",
            content: "remote note",
            attributedTo: "https://m.example/users/eve",
          },
        },
      });
      publishNote(db, { actor: "alice", content: "local note" });
      const localOnly = searchNotes("note", { scope: "local" });
      expect(localOnly.some((n) => n.content === "remote note")).toBe(false);
      expect(localOnly.some((n) => n.content === "local note")).toBe(true);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        publishNote(db, { actor: "alice", content: `unique${i} hit` });
      }
      const r = searchNotes("hit", { limit: 3 });
      expect(r.length).toBe(3);
    });

    it("skips non-Create / non-Note activities", () => {
      publishNote(db, { actor: "alice", content: "visible" });
      follow(db, { actor: "alice", target: "bob" });
      like(db, { actor: "alice", object: "https://m.example/notes/1" });
      expect(searchNotes("visible").length).toBe(1);
    });
  });

  describe("listFollowers / listFollowing", () => {
    beforeEach(() => {
      createActor(db, { username: "alice" });
      createActor(db, { username: "bob" });
      createActor(db, { username: "carol" });
    });

    it("tracks following and followers symmetrically", () => {
      follow(db, { actor: "alice", target: "bob" });
      follow(db, { actor: "carol", target: "bob" });
      expect(listFollowing("alice").length).toBe(1);
      expect(listFollowers("bob").length).toBe(2);
    });

    it("filters by state", () => {
      const fr = follow(db, { actor: "alice", target: "bob" });
      follow(db, { actor: "carol", target: "bob" });
      acceptFollow(db, {
        actor: "bob",
        followActivityId: fr.activity.id,
      });
      expect(listFollowers("bob", { state: "accepted" }).length).toBe(1);
      expect(listFollowers("bob", { state: "pending" }).length).toBe(1);
    });
  });
});
