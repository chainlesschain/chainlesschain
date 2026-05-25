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
} = require("../../lib/adapters/social-kuaishou-adb/snapshot-builder");

describe("SNAPSHOT_SCHEMA_VERSION", () => {
  it("is 1 (matches existing social-kuaishou adapter)", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

describe("buildSnapshot", () => {
  it("throws on missing uid", () => {
    expect(() => buildSnapshot({})).toThrow(/uid must be a non-empty string/);
  });

  it("emits profile event from input.profile", () => {
    const snap = buildSnapshot({
      uid: "12345",
      profile: {
        nickname: "Alice",
        kuaishouId: "alice_ks",
        avatarUrl: "https://a/x.jpg",
        sex: "F",
        city: "Beijing",
      },
      snapshottedAt: 1716383021000,
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.account).toEqual({ uid: "12345", displayName: "" });
    const prof = snap.events.find((e) => e.kind === "profile");
    expect(prof).toMatchObject({
      kind: "profile",
      id: "profile-12345",
      uid: "12345",
      nickname: "Alice",
      kuaishouId: "alice_ks",
      city: "Beijing",
    });
  });

  it("emits watch events with photo metadata", () => {
    const snap = buildSnapshot({
      uid: "1",
      watch: [
        {
          photoId: "P1",
          caption: "Funny vid",
          duration: 30,
          authorId: "A1",
          authorName: "Auth1",
          viewedAt: 1716000000000,
        },
      ],
    });
    const w = snap.events.filter((e) => e.kind === "watch");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      kind: "watch",
      id: "photo-P1",
      capturedAt: 1716000000000,
      photoId: "P1",
      caption: "Funny vid",
      duration: 30,
      authorId: "A1",
      authorName: "Auth1",
    });
  });

  it("emits collect events with self as author", () => {
    const snap = buildSnapshot({
      uid: "12345",
      displayName: "Alice",
      collect: [{ photoId: "C1", caption: "My vid", postedAt: 1716100000000 }],
    });
    const c = snap.events.filter((e) => e.kind === "collect");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      kind: "collect",
      id: "collect-C1",
      capturedAt: 1716100000000,
      photoId: "C1",
      caption: "My vid",
      authorId: "12345", // self
      authorName: "Alice",
    });
  });

  it("emits search events with keyword:ts id", () => {
    const snap = buildSnapshot({
      uid: "1",
      search: [{ keyword: "AI", searchedAt: 1716200000000 }],
    });
    const s = snap.events.find((e) => e.kind === "search");
    expect(s).toMatchObject({
      kind: "search",
      id: "search-AI:1716200000000",
      capturedAt: 1716200000000,
      keyword: "AI",
      searchAt: 1716200000000,
    });
  });

  it("ignores entries missing photoId / keyword", () => {
    const snap = buildSnapshot({
      uid: "1",
      watch: [{ caption: "no photoId" }, { photoId: "OK" }],
      collect: [{ caption: "no photoId" }],
      search: [{ keyword: "" }, { keyword: "good" }],
    });
    expect(snap.events.filter((e) => e.kind === "watch")).toHaveLength(1);
    expect(snap.events.filter((e) => e.kind === "collect")).toHaveLength(0);
    expect(snap.events.filter((e) => e.kind === "search")).toHaveLength(1);
  });

  it("falls back to snapshottedAt when event lacks timestamp", () => {
    const snap = buildSnapshot({
      uid: "1",
      watch: [{ photoId: "P" }],
      snapshottedAt: 1716000000000,
    });
    expect(snap.events[0].capturedAt).toBe(1716000000000);
  });

  it("emits all 4 kinds at once", () => {
    const snap = buildSnapshot({
      uid: "12345",
      profile: { nickname: "Alice" },
      watch: [{ photoId: "W1" }],
      collect: [{ photoId: "C1" }],
      search: [{ keyword: "kw1", searchedAt: 1 }],
    });
    expect(snap.events).toHaveLength(4);
    expect(snap.events.map((e) => e.kind).sort()).toEqual([
      "collect",
      "profile",
      "search",
      "watch",
    ]);
  });
});

describe("writeSnapshotJson + cleanupSnapshotJson", () => {
  it("writes valid JSON", () => {
    const snap = buildSnapshot({ uid: "1", profile: { nickname: "A" } });
    const full = writeSnapshotJson(snap);
    try {
      expect(fs.existsSync(full)).toBe(true);
      const round = JSON.parse(fs.readFileSync(full, "utf-8"));
      expect(round.account.uid).toBe("1");
    } finally {
      cleanupSnapshotJson(full);
    }
  });

  it("rejects fileName with path separator", () => {
    const snap = buildSnapshot({ uid: "1" });
    expect(() =>
      writeSnapshotJson(snap, { fileName: "../escape.json" }),
    ).toThrow(/basename, not a path/);
  });

  it("cleanup tolerates missing file", () => {
    expect(() => cleanupSnapshotJson(null)).not.toThrow();
    expect(() =>
      cleanupSnapshotJson(path.join(os.tmpdir(), "nonexistent-ks.json")),
    ).not.toThrow();
  });
});
