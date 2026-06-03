"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/social-toutiao-adb/snapshot-builder");

describe("SNAPSHOT_SCHEMA_VERSION", () => {
  it("is 1 (matches existing social-toutiao adapter)", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

describe("buildSnapshot", () => {
  it("throws on missing uid", () => {
    expect(() => buildSnapshot({})).toThrow(/uid must be a non-empty string/);
  });

  it("emits profile event when input.profile given", () => {
    const snap = buildSnapshot({
      uid: "12345",
      profile: {
        nickname: "Alice",
        avatarUrl: "https://a/x.jpg",
        mobile: "138****",
        followingCount: 10,
        followerCount: 99,
        mediaId: "5678",
      },
      snapshottedAt: 1716383021000,
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.account).toEqual({ uid: "12345", displayName: "" });
    const profileEvents = snap.events.filter((e) => e.kind === "profile");
    expect(profileEvents).toHaveLength(1);
    expect(profileEvents[0]).toMatchObject({
      kind: "profile",
      id: "profile-12345",
      uid: "12345",
      nickname: "Alice",
      followingCount: 10,
      followerCount: 99,
      mediaId: "5678",
    });
  });

  it("skips profile event when input.profile missing", () => {
    const snap = buildSnapshot({ uid: "12345" });
    expect(snap.events.filter((e) => e.kind === "profile")).toHaveLength(0);
  });

  it("emits read events from feed input", () => {
    const snap = buildSnapshot({
      uid: "12345",
      feed: [
        {
          itemId: "G1",
          title: "Read 1",
          category: "tech",
          author: "AuthorA",
          publishedAt: 1716000000000,
          readDuration: 60,
          source: "source-a",
        },
      ],
    });
    const reads = snap.events.filter((e) => e.kind === "read");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      kind: "read",
      id: "read-G1",
      capturedAt: 1716000000000,
      itemId: "G1",
      title: "Read 1",
      category: "tech",
      author: "AuthorA",
      readDuration: 60,
      source: "source-a",
    });
  });

  it("emits collection events", () => {
    const snap = buildSnapshot({
      uid: "12345",
      collection: [
        {
          itemId: "C1",
          title: "Saved",
          category: "news",
          author: "AuthorB",
          savedAt: 1716100000000,
        },
      ],
    });
    const cols = snap.events.filter((e) => e.kind === "collection");
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({
      kind: "collection",
      id: "collect-C1",
      capturedAt: 1716100000000,
      itemId: "C1",
      title: "Saved",
      category: "news",
      author: "AuthorB",
    });
  });

  it("emits search events with keyword as id base", () => {
    const snap = buildSnapshot({
      uid: "12345",
      search: [{ keyword: "AI", searchedAt: 1716200000000 }],
    });
    const searches = snap.events.filter((e) => e.kind === "search");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      kind: "search",
      id: "search-AI:1716200000000",
      capturedAt: 1716200000000,
      keyword: "AI",
      searchAt: 1716200000000,
    });
  });

  it("ignores search entries with empty keyword", () => {
    const snap = buildSnapshot({
      uid: "1",
      search: [{ keyword: "", searchedAt: 1 }, { keyword: "ok", searchedAt: 2 }],
    });
    const searches = snap.events.filter((e) => e.kind === "search");
    expect(searches).toHaveLength(1);
    expect(searches[0].keyword).toBe("ok");
  });

  it("falls back to snapshottedAt when event lacks timestamp", () => {
    const snap = buildSnapshot({
      uid: "1",
      feed: [{ itemId: "G", title: "T" }],
      snapshottedAt: 1716000000000,
    });
    expect(snap.events[0].capturedAt).toBe(1716000000000);
  });

  it("emits multiple kinds at once with stable id formats", () => {
    const snap = buildSnapshot({
      uid: "12345",
      profile: { nickname: "Alice" },
      feed: [{ itemId: "G1", title: "T1" }],
      collection: [{ itemId: "C1", title: "T2" }],
      search: [{ keyword: "kw1", searchedAt: 1 }],
    });
    expect(snap.events).toHaveLength(4);
    const ids = snap.events.map((e) => e.id);
    expect(ids).toContain("profile-12345");
    expect(ids).toContain("read-G1");
    expect(ids).toContain("collect-C1");
    expect(ids).toContain("search-kw1:1");
  });
});

describe("writeSnapshotJson + cleanupSnapshotJson", () => {
  it("writes valid JSON to staging dir", () => {
    const snap = buildSnapshot({ uid: "1", profile: { nickname: "A" } });
    const fullPath = writeSnapshotJson(snap);
    try {
      expect(fs.existsSync(fullPath)).toBe(true);
      const round = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      expect(round.account.uid).toBe("1");
    } finally {
      cleanupSnapshotJson(fullPath);
    }
  });

  it("rejects fileName with path separator", () => {
    const snap = buildSnapshot({ uid: "1" });
    expect(() =>
      writeSnapshotJson(snap, { fileName: "../escape.json" }),
    ).toThrow(/basename, not a path/);
    expect(() =>
      writeSnapshotJson(snap, { fileName: "sub/dir.json" }),
    ).toThrow(/basename, not a path/);
  });

  it("cleanupSnapshotJson tolerates missing file", () => {
    expect(() => cleanupSnapshotJson(null)).not.toThrow();
    expect(() =>
      cleanupSnapshotJson(path.join(os.tmpdir(), "nonexistent-x-y-z.json")),
    ).not.toThrow();
  });
});
