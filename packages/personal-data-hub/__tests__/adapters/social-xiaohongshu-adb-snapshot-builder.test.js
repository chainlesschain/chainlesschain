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
} = require("../../lib/adapters/social-xiaohongshu-adb/snapshot-builder");

describe("SNAPSHOT_SCHEMA_VERSION", () => {
  it("is 1 (matches existing social-xiaohongshu adapter)", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

describe("buildSnapshot", () => {
  it("throws on missing / empty userId", () => {
    expect(() => buildSnapshot({})).toThrow(/userId must be a non-empty string/);
    expect(() => buildSnapshot({ userId: "" })).toThrow(
      /userId must be a non-empty string/,
    );
    expect(() => buildSnapshot(null)).toThrow(TypeError);
  });

  it("keeps account.userId as string passthrough (xhs uid is NOT numeric)", () => {
    const snap = buildSnapshot({
      userId: "5e8c8f7e000000000100abcd",
      nickname: "Alice",
      snapshottedAt: 1716383021000,
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshottedAt).toBe(1716383021000);
    expect(snap.account).toEqual({
      userId: "5e8c8f7e000000000100abcd",
      nickname: "Alice",
    });
    expect(snap.events).toEqual([]);
  });

  it("defaults nickname to empty string", () => {
    const snap = buildSnapshot({ userId: "U1" });
    expect(snap.account.nickname).toBe("");
  });

  it("emits note events with metadata + createdAt", () => {
    const snap = buildSnapshot({
      userId: "U1",
      snapshottedAt: 1716000000000,
      notes: [
        {
          noteId: "N1",
          title: "Note one",
          desc: "d",
          type: "video",
          createdAt: 1700000000000,
          likedCount: 12000,
          collectedCount: 100000,
          commentCount: 234,
        },
      ],
    });
    const n = snap.events.filter((e) => e.kind === "note");
    expect(n).toHaveLength(1);
    expect(n[0]).toEqual({
      kind: "note",
      id: "note-N1",
      capturedAt: 1700000000000,
      noteId: "N1",
      title: "Note one",
      desc: "d",
      type: "video",
      likedCount: 12000,
      collectedCount: 100000,
      commentCount: 234,
    });
  });

  it("falls back to index id + snapshottedAt when note lacks noteId/createdAt", () => {
    const snap = buildSnapshot({
      userId: "U1",
      snapshottedAt: 1716000000000,
      notes: [{ title: "no id" }],
    });
    const n = snap.events[0];
    expect(n.id).toBe("note-0");
    expect(n.noteId).toBe(null);
    expect(n.capturedAt).toBe(1716000000000);
    expect(n.type).toBe("normal");
    expect(n.likedCount).toBe(0);
  });

  it("emits liked events pinned to snapshottedAt (xhs has no liked_at)", () => {
    const snap = buildSnapshot({
      userId: "U1",
      snapshottedAt: 1716100000000,
      liked: [
        { noteId: "L1", title: "Liked one", authorNickname: "AuthorX" },
      ],
    });
    const l = snap.events.filter((e) => e.kind === "liked");
    expect(l).toHaveLength(1);
    expect(l[0]).toEqual({
      kind: "liked",
      id: "liked-L1",
      capturedAt: 1716100000000,
      noteId: "L1",
      title: "Liked one",
      authorNickname: "AuthorX",
    });
  });

  it("emits follow events keyed by followed userId", () => {
    const snap = buildSnapshot({
      userId: "U1",
      snapshottedAt: 1716200000000,
      follows: [
        { userId: "F1", nickname: "FollowOne", image: "https://a/f1.jpg" },
      ],
    });
    const f = snap.events.filter((e) => e.kind === "follow");
    expect(f).toHaveLength(1);
    expect(f[0]).toEqual({
      kind: "follow",
      id: "follow-F1",
      capturedAt: 1716200000000,
      userId: "F1",
      nickname: "FollowOne",
      image: "https://a/f1.jpg",
    });
  });

  it("skips non-object entries but keeps the rest", () => {
    const snap = buildSnapshot({
      userId: "U1",
      notes: [null, "junk", { noteId: "OK" }],
      liked: [undefined],
      follows: [42],
    });
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0].id).toBe("note-OK");
  });

  it("emits all 3 kinds at once", () => {
    const snap = buildSnapshot({
      userId: "U1",
      notes: [{ noteId: "N1" }],
      liked: [{ noteId: "L1" }],
      follows: [{ userId: "F1" }],
    });
    expect(snap.events.map((e) => e.kind).sort()).toEqual([
      "follow",
      "liked",
      "note",
    ]);
  });

  it("defaults snapshottedAt to now when invalid", () => {
    const before = Date.now();
    const snap = buildSnapshot({ userId: "U1", snapshottedAt: -5 });
    expect(snap.snapshottedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("writeSnapshotJson + cleanupSnapshotJson", () => {
  it("writes valid JSON roundtrip", () => {
    const snap = buildSnapshot({ userId: "U1", nickname: "A" });
    const full = writeSnapshotJson(snap);
    try {
      expect(fs.existsSync(full)).toBe(true);
      const round = JSON.parse(fs.readFileSync(full, "utf-8"));
      expect(round.account.userId).toBe("U1");
      expect(round.schemaVersion).toBe(1);
    } finally {
      cleanupSnapshotJson(full);
      expect(fs.existsSync(full)).toBe(false);
    }
  });

  it("rejects fileName with path separator", () => {
    const snap = buildSnapshot({ userId: "U1" });
    expect(() =>
      writeSnapshotJson(snap, { fileName: "../escape.json" }),
    ).toThrow(/basename, not a path/);
    expect(() =>
      writeSnapshotJson(snap, { fileName: "sub\\escape.json" }),
    ).toThrow(/basename, not a path/);
  });

  it("cleanup tolerates null / missing file", () => {
    expect(() => cleanupSnapshotJson(null)).not.toThrow();
    expect(() =>
      cleanupSnapshotJson(path.join(os.tmpdir(), "nonexistent-xhs.json")),
    ).not.toThrow();
  });
});
