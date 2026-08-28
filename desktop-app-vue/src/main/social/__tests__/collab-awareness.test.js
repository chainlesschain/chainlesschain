import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import mod from "../collab-awareness.js";
const { CollabAwareness } = mod;

describe("CollabAwareness", () => {
  let aw;
  beforeEach(() => {
    aw = new CollabAwareness();
  });
  afterEach(() => {
    void aw.destroy();
    vi.useRealTimers();
  });

  describe("_assignColor", () => {
    it("is deterministic for the same DID", () => {
      expect(aw._assignColor("did:key:alice")).toBe(
        aw._assignColor("did:key:alice"),
      );
    });
    it("always returns a valid color (incl. empty/null DID)", () => {
      const HEX = /^#[0-9A-F]{6}$/i;
      expect(aw._assignColor("")).toMatch(HEX);
      expect(aw._assignColor(null)).toMatch(HEX);
      for (let i = 0; i < 500; i++) {
        expect(aw._assignColor(`did:${i}:${i * 7}`)).toMatch(HEX);
      }
    });
    it("distributes across more than one color", () => {
      const seen = new Set();
      for (let i = 0; i < 50; i++) {
        seen.add(aw._assignColor(`did:${i}`));
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  describe("profiles", () => {
    it("setLocalProfile marks the profile local and assigns a color", () => {
      aw.setLocalProfile("did:me", "Me");
      const p = aw._getLocalProfile();
      expect(p).toMatchObject({ did: "did:me", name: "Me", isLocal: true });
      expect(p.color).toMatch(/^#/);
    });
    it("derives a name from the DID when none is given", () => {
      aw.setLocalProfile("did:key:z6Mabcdefghijklmnop", null);
      expect(aw._getLocalProfile().name).toContain("...");
    });
    it("_getLocalProfile returns null when no profile is set", () => {
      expect(aw._getLocalProfile()).toBeNull();
    });
  });

  describe("setLocalCursor", () => {
    beforeEach(() => aw.setLocalProfile("did:me", "Me"));

    it("requires docId + position", () => {
      expect(aw.setLocalCursor("", { line: 1 }).success).toBe(false);
      expect(aw.setLocalCursor("doc", null).success).toBe(false);
    });

    it("fails cleanly when no local profile is set", () => {
      const fresh = new CollabAwareness();
      const r = fresh.setLocalCursor("doc", { line: 1 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Local user profile/);
    });

    it("stores a normalized cursor and emits cursor:updated", () => {
      const spy = vi.fn();
      aw.on("cursor:updated", spy);
      const r = aw.setLocalCursor("doc", { line: 5, column: 2 });
      expect(r.success).toBe(true);
      expect(r.cursor.position).toEqual({ line: 5, column: 2, offset: 0 });
      expect(r.cursor.isLocal).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it("normalizes a selection's missing fields to 0", () => {
      const r = aw.setLocalCursor(
        "doc",
        { line: 1 },
        { start: { line: 1 }, end: { line: 2, column: 4 } },
      );
      expect(r.cursor.selection.start).toEqual({
        line: 1,
        column: 0,
        offset: 0,
      });
      expect(r.cursor.selection.end).toEqual({ line: 2, column: 4, offset: 0 });
    });
  });

  describe("updateRemoteCursor", () => {
    it("ignores cursor data without a did", () => {
      aw.updateRemoteCursor("doc", { position: { line: 1 } });
      expect(aw.getActiveUserCount("doc")).toBe(0);
    });

    it("adds a remote cursor, auto-creating a profile, and emits user:joined once", () => {
      const joined = vi.fn();
      aw.on("user:joined", joined);
      aw.updateRemoteCursor("doc", {
        did: "did:bob",
        name: "Bob",
        position: { line: 3 },
      });
      aw.updateRemoteCursor("doc", { did: "did:bob", position: { line: 4 } });
      expect(joined).toHaveBeenCalledOnce(); // only the first time
      expect(aw.getActiveUserCount("doc")).toBe(1);
      // profile/color was auto-assigned
      expect(aw._ensureProfile("did:bob").color).toMatch(/^#/);
    });
  });

  describe("getActiveUserCount", () => {
    it("returns 0 for an unknown doc", () => {
      expect(aw.getActiveUserCount("nope")).toBe(0);
    });
    it("counts only cursors within the presence timeout", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      aw.updateRemoteCursor("doc", { did: "fresh", position: { line: 1 } });
      vi.setSystemTime(120_000); // 2 min later, past the 60s timeout
      aw.updateRemoteCursor("doc", { did: "recent", position: { line: 1 } });
      // 'fresh' is now stale (120s old); 'recent' is current.
      expect(aw.getActiveUserCount("doc")).toBe(1);
    });
  });

  describe("_cleanupStaleCursors", () => {
    it("removes stale remote cursors, keeps local, and emits user:left", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      aw.setLocalProfile("did:me", "Me");
      aw.setLocalCursor("doc", { line: 1 }); // local
      aw.updateRemoteCursor("doc", { did: "remote", position: { line: 2 } });
      const left = vi.fn();
      aw.on("user:left", left);

      vi.setSystemTime(120_000); // past PRESENCE_TIMEOUT
      aw._cleanupStaleCursors();

      // remote dropped, local survives
      expect(left).toHaveBeenCalledOnce();
      const cursors = aw.cursors.get("doc");
      expect(cursors.has("remote")).toBe(false);
      expect(cursors.has("did:me")).toBe(true);
    });

    it("drops the doc map entirely once it is empty", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      aw.updateRemoteCursor("doc", { did: "remote", position: { line: 1 } });
      vi.setSystemTime(120_000);
      aw._cleanupStaleCursors();
      expect(aw.cursors.has("doc")).toBe(false);
    });
  });

  describe("clearDocument / removeUser", () => {
    it("clearDocument wipes a doc's cursors", () => {
      aw.updateRemoteCursor("doc", { did: "a", position: { line: 1 } });
      aw.clearDocument("doc");
      expect(aw.getActiveUserCount("doc")).toBe(0);
    });
  });

  describe("retention and input boundaries", () => {
    it("rejects new documents at capacity without retaining an empty map", () => {
      aw = new CollabAwareness(null, {
        boundaries: { maxActiveDocuments: 1, maxProfiles: 2 },
      });
      aw.setLocalProfile("did:me", "Me");
      expect(aw.setLocalCursor("doc-1", { line: 1 }).success).toBe(true);

      const rejected = aw.setLocalCursor("doc-2", { line: 2 });

      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/document capacity/i);
      expect([...aw.cursors.keys()]).toEqual(["doc-1"]);
    });

    it("rejects excess peers transactionally without retaining a profile", () => {
      aw = new CollabAwareness(null, {
        boundaries: { maxPeersPerDocument: 1, maxProfiles: 3 },
      });
      aw.updateRemoteCursor("doc", {
        did: "did:alice",
        position: { line: 1 },
      });

      aw.updateRemoteCursor("doc", {
        did: "did:bob",
        position: { line: 2 },
      });

      expect([...aw.cursors.get("doc").keys()]).toEqual(["did:alice"]);
      expect(aw.userProfiles.has("did:bob")).toBe(false);
    });

    it("bounds retained profiles", () => {
      aw = new CollabAwareness(null, {
        boundaries: { maxProfiles: 1 },
      });
      aw.setUserProfile("did:alice", "Alice");

      expect(() => aw.setUserProfile("did:bob", "Bob")).toThrow(
        /profile capacity/i,
      );
      expect(aw.userProfiles.size).toBe(1);
    });

    it("stores only normalized cursor fields and rejects invalid coordinates", () => {
      aw.updateRemoteCursor("doc", {
        did: "did:alice",
        name: "Alice",
        position: { line: 3, ignored: "x".repeat(10_000) },
      });

      expect(aw.cursors.get("doc").get("did:alice").position).toEqual({
        line: 3,
        column: 0,
        offset: 0,
      });
      aw.updateRemoteCursor("invalid", {
        did: "did:bob",
        position: { line: -1 },
      });
      expect(aw.cursors.has("invalid")).toBe(false);
      expect(aw.userProfiles.has("did:bob")).toBe(false);
    });

    it("rejects oversized names before retaining state", () => {
      aw = new CollabAwareness(null, {
        boundaries: { maxDisplayNameBytes: 4 },
      });

      expect(() => aw.setUserProfile("did:alice", "Alice")).toThrow(
        /display name exceeds/i,
      );
      expect(aw.userProfiles.size).toBe(0);
    });

    it("reclaims stale unreferenced remote profiles", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      aw.updateRemoteCursor("doc", {
        did: "did:alice",
        position: { line: 1 },
      });

      vi.setSystemTime(120_000);
      aw._cleanupStaleCursors();

      expect(aw.cursors.has("doc")).toBe(false);
      expect(aw.userProfiles.has("did:alice")).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("initializes once, releases its timer, and fences later mutations", async () => {
      vi.useFakeTimers();
      await aw.initialize();
      await aw.initialize();
      expect(vi.getTimerCount()).toBe(1);

      await aw.destroy();

      expect(vi.getTimerCount()).toBe(0);
      expect(() => aw.setLocalProfile("did:me", "Me")).toThrow(
        /has been destroyed/i,
      );
      expect(await aw.destroy()).toBeUndefined();
    });

    it("keeps application shutdown wired to the production instance", () => {
      const testDirectory = path.dirname(fileURLToPath(import.meta.url));
      const mainSource = readFileSync(
        path.resolve(testDirectory, "..", "..", "index.js"),
        "utf8",
      );
      expect(mainSource).toContain(
        "this.collabAwareness = instances.collabAwareness",
      );
      expect(mainSource).toContain("await this.collabAwareness.destroy?.()");
    });
  });
});
