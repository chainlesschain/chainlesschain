"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/social-weibo-adb/snapshot-builder");

let tmpDir;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-weibo-snap-test-"));
});
afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

describe("buildSnapshot — schema", () => {
  it("returns documented shape", () => {
    const s = buildSnapshot({
      uid: 1234567890,
      displayName: "alice",
      snapshottedAt: 1716383021000,
    });
    expect(s.schemaVersion).toBe(1);
    expect(s.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(s.snapshottedAt).toBe(1716383021000);
    expect(s.account).toEqual({ uid: "1234567890", displayName: "alice" });
    expect(s.events).toEqual([]);
  });

  it("rejects non-positive uid", () => {
    expect(() => buildSnapshot({ uid: 0 })).toThrow(TypeError);
    expect(() => buildSnapshot({ uid: -1 })).toThrow(TypeError);
    expect(() => buildSnapshot({})).toThrow(TypeError);
  });

  it("defaults displayName + snapshottedAt", () => {
    const before = Date.now();
    const s = buildSnapshot({ uid: 1 });
    const after = Date.now();
    expect(s.account.displayName).toBe("");
    expect(s.snapshottedAt).toBeGreaterThanOrEqual(before);
    expect(s.snapshottedAt).toBeLessThanOrEqual(after);
  });
});

describe("buildSnapshot — events", () => {
  it("maps posts → kind=post", () => {
    const s = buildSnapshot({
      uid: 1,
      posts: [
        {
          mid: "M1",
          text: "hi",
          createdAt: 1716383021000,
          source: "iPhone",
          repostsCount: 5,
          commentsCount: 10,
          likesCount: 100,
          picCount: 2,
        },
      ],
    });
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({
      kind: "post",
      id: "post-M1",
      capturedAt: 1716383021000,
      text: "hi",
      mid: "M1",
      source: "iPhone",
      repostsCount: 5,
      commentsCount: 10,
      likesCount: 100,
      picCount: 2,
    });
  });

  it("maps favourites → kind=favourite", () => {
    const s = buildSnapshot({
      uid: 1,
      favourites: [
        { mid: "F1", text: "fav text", favAt: 1716383022000, authorScreenName: "x" },
      ],
    });
    expect(s.events[0]).toMatchObject({
      kind: "favourite",
      id: "fav-F1",
      capturedAt: 1716383022000,
      mid: "F1",
      authorScreenName: "x",
    });
  });

  it("maps follows → kind=follow with snapshottedAt fallback", () => {
    const s = buildSnapshot({
      uid: 1,
      snapshottedAt: 999,
      follows: [
        {
          uid: 42,
          screenName: "Friend",
          description: "hi",
          avatarUrl: "https://x.png",
          followedAt: 0, // /api/friendships/friends doesn't return follow time
        },
      ],
    });
    expect(s.events[0]).toMatchObject({
      kind: "follow",
      id: "follow-42",
      uid: 42,
      screenName: "Friend",
      capturedAt: 999, // fallback to snapshottedAt
    });
  });

  it("uses index fallback id when mid/uid missing", () => {
    const s = buildSnapshot({
      uid: 1,
      posts: [{ text: "no mid" }],
      favourites: [{ text: "no mid" }],
      follows: [{ screenName: "no uid" }],
    });
    expect(s.events.map((e) => e.id)).toEqual(["post-0", "fav-0", "follow-0"]);
  });

  it("preserves order post → favourite → follow", () => {
    const s = buildSnapshot({
      uid: 1,
      posts: [{ mid: "P", createdAt: 1 }],
      favourites: [{ mid: "F", favAt: 2 }],
      follows: [{ uid: 1, followedAt: 3 }],
    });
    expect(s.events.map((e) => e.kind)).toEqual(["post", "favourite", "follow"]);
  });

  it("handles non-array fields", () => {
    const s = buildSnapshot({
      uid: 1,
      posts: "not array",
      favourites: null,
      follows: {},
    });
    expect(s.events).toEqual([]);
  });

  it("skips null/non-object items", () => {
    const s = buildSnapshot({
      uid: 1,
      posts: [null, { mid: "P", createdAt: 1 }, "junk"],
    });
    expect(s.events).toHaveLength(1);
  });
});

describe("writeSnapshotJson + cleanupSnapshotJson", () => {
  it("writes to default tmpdir", () => {
    const s = buildSnapshot({ uid: 1 });
    const p = writeSnapshotJson(s);
    expect(existsSync(p)).toBe(true);
    expect(p).toContain("cc-weibo-snapshot-");
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    expect(parsed.schemaVersion).toBe(1);
    cleanupSnapshotJson(p);
    expect(existsSync(p)).toBe(false);
  });

  it("rejects path separators in fileName", () => {
    expect(() => writeSnapshotJson({ schemaVersion: 1 }, { fileName: "../evil.json" })).toThrow(
      /must be a basename/,
    );
  });

  it("cleanupSnapshotJson tolerates missing / null", () => {
    cleanupSnapshotJson(null);
    cleanupSnapshotJson(join(tmpDir, "nonexistent.json"));
  });
});
