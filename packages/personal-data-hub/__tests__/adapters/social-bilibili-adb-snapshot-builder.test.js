"use strict";

/**
 * Phase 1b — unit cover for snapshot-builder (API responses → snapshot JSON).
 *
 * What we cover:
 *  - schemaVersion + snapshottedAt + account shape match adapter.js
 *    snapshot mode contract
 *  - 4 kinds (history/favourite/dynamic/follow) all populate correct fields
 *  - capturedAt comes from the kind-specific field (viewAt / savedAt /
 *    publishedAt / followedAt)
 *  - id derivation: stable for items with bvid/rid/mid, fallback to index
 *  - displayName defaults to empty string when omitted
 *  - Edge cases: empty arrays / null items / missing fields don't crash
 *  - writeSnapshotJson / cleanupSnapshotJson disk lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/social-bilibili-adb/snapshot-builder");

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-snapshot-test-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

// ─── buildSnapshot ──────────────────────────────────────────────────────

describe("buildSnapshot — schema contract", () => {
  it("returns the documented schema shape", () => {
    const snap = buildSnapshot({
      uid: 12345,
      displayName: "alice",
      history: [],
      favourites: [],
      dynamics: [],
      follows: [],
      snapshottedAt: 1716383021000,
    });
    expect(snap.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshottedAt).toBe(1716383021000);
    expect(snap.account).toEqual({ uid: "12345", displayName: "alice" });
    expect(Array.isArray(snap.events)).toBe(true);
  });

  it("converts uid to string in account", () => {
    const snap = buildSnapshot({ uid: 42 });
    expect(snap.account.uid).toBe("42");
    expect(typeof snap.account.uid).toBe("string");
  });

  it("defaults displayName to empty string", () => {
    const snap = buildSnapshot({ uid: 1 });
    expect(snap.account.displayName).toBe("");
  });

  it("defaults snapshottedAt to Date.now() when omitted", () => {
    const before = Date.now();
    const snap = buildSnapshot({ uid: 1 });
    const after = Date.now();
    expect(snap.snapshottedAt).toBeGreaterThanOrEqual(before);
    expect(snap.snapshottedAt).toBeLessThanOrEqual(after);
  });

  it("rejects non-positive uid", () => {
    expect(() => buildSnapshot({ uid: 0 })).toThrow(TypeError);
    expect(() => buildSnapshot({ uid: -1 })).toThrow(TypeError);
    expect(() => buildSnapshot({ uid: "string" })).toThrow(TypeError);
  });

  it("rejects null / non-object input", () => {
    expect(() => buildSnapshot(null)).toThrow(TypeError);
    expect(() => buildSnapshot("string")).toThrow(TypeError);
  });
});

describe("buildSnapshot — events", () => {
  it("maps history items → kind=history events", () => {
    const snap = buildSnapshot({
      uid: 1,
      history: [
        {
          bvid: "BV1xx",
          avid: 100,
          title: "Test",
          viewAt: 1716383021,
          duration: 300,
          uploader: "u1",
          uploaderMid: 999,
          part: "Part1",
        },
      ],
    });
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]).toMatchObject({
      kind: "history",
      id: "BV1xx",
      capturedAt: 1716383021,
      title: "Test",
      bvid: "BV1xx",
      avid: 100,
      duration: 300,
      uploader: "u1",
      uploaderMid: 999,
      part: "Part1",
    });
  });

  it("maps favourite items → kind=favourite + id prefix", () => {
    const snap = buildSnapshot({
      uid: 1,
      favourites: [
        {
          bvid: "BVfav1",
          title: "F1",
          savedAt: 1716383021000,
          folderName: "MyFolder",
          uploader: "u1",
        },
      ],
    });
    expect(snap.events[0].kind).toBe("favourite");
    expect(snap.events[0].id).toBe("fav-BVfav1");
    expect(snap.events[0].capturedAt).toBe(1716383021000);
    expect(snap.events[0].folderName).toBe("MyFolder");
  });

  it("maps dynamic items → kind=dynamic + id prefix", () => {
    const snap = buildSnapshot({
      uid: 1,
      dynamics: [
        {
          rid: "dyn-rid-1",
          summary: "hi",
          dynamicType: "av",
          publishedAt: 1716383021000,
          authorMid: 999,
          authorName: "x",
        },
      ],
    });
    expect(snap.events[0].kind).toBe("dynamic");
    expect(snap.events[0].id).toBe("dyn-dyn-rid-1");
    expect(snap.events[0].capturedAt).toBe(1716383021000);
    expect(snap.events[0].dynamicType).toBe("av");
  });

  it("maps follow items → kind=follow + id prefix + mid as string", () => {
    const snap = buildSnapshot({
      uid: 1,
      follows: [
        {
          mid: 42,
          uname: "Friend",
          face: "https://x.png",
          sign: "hi",
          followedAt: 1716383021000,
        },
      ],
    });
    expect(snap.events[0].kind).toBe("follow");
    expect(snap.events[0].id).toBe("follow-42");
    expect(snap.events[0].mid).toBe("42");
    expect(typeof snap.events[0].mid).toBe("string");
  });

  it("preserves event order: history → favourite → dynamic → follow", () => {
    const snap = buildSnapshot({
      uid: 1,
      history: [{ bvid: "BV1", title: "h", viewAt: 1 }],
      favourites: [{ bvid: "BV2", title: "f", savedAt: 2 }],
      dynamics: [{ rid: "r1", summary: "d", dynamicType: "av", publishedAt: 3 }],
      follows: [{ mid: 1, uname: "x", followedAt: 4 }],
    });
    const kinds = snap.events.map((e) => e.kind);
    expect(kinds).toEqual(["history", "favourite", "dynamic", "follow"]);
  });

  it("uses snapshottedAt as fallback when capturedAt source is missing", () => {
    const snap = buildSnapshot({
      uid: 1,
      snapshottedAt: 999,
      history: [{ bvid: "BV1", title: "h" /* no viewAt */ }],
    });
    expect(snap.events[0].capturedAt).toBe(999);
  });

  it("uses index-based fallback id when key field missing", () => {
    const snap = buildSnapshot({
      uid: 1,
      history: [{ title: "no bvid", viewAt: 1 }],
      favourites: [{ title: "no bvid", savedAt: 1 }],
      dynamics: [{ summary: "no rid", dynamicType: "av", publishedAt: 1 }],
      follows: [{ uname: "no mid", followedAt: 1 }],
    });
    const ids = snap.events.map((e) => e.id);
    expect(ids).toEqual(["history-0", "fav-0", "dyn-0", "follow-0"]);
  });

  it("skips null / non-object items", () => {
    const snap = buildSnapshot({
      uid: 1,
      history: [null, { bvid: "BV1", title: "ok", viewAt: 1 }, undefined, "not an object"],
    });
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0].id).toBe("BV1");
  });

  it("handles empty / missing arrays", () => {
    const snap = buildSnapshot({ uid: 1 });
    expect(snap.events).toEqual([]);
  });

  it("handles non-array input fields gracefully", () => {
    const snap = buildSnapshot({
      uid: 1,
      history: "not an array",
      favourites: null,
      dynamics: 42,
      follows: { x: 1 },
    });
    expect(snap.events).toEqual([]);
  });
});

// ─── writeSnapshotJson / cleanupSnapshotJson ────────────────────────────

describe("writeSnapshotJson + cleanupSnapshotJson", () => {
  it("writes JSON to default tmpdir path", () => {
    const snap = buildSnapshot({ uid: 1 });
    const filePath = writeSnapshotJson(snap);
    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toContain("cc-bilibili-snapshot-");
    expect(filePath).toMatch(/\.json$/);
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(parsed.schemaVersion).toBe(1);
    cleanupSnapshotJson(filePath);
    expect(existsSync(filePath)).toBe(false);
  });

  it("respects custom dir", () => {
    const snap = buildSnapshot({ uid: 1 });
    const filePath = writeSnapshotJson(snap, { dir: tmpDir });
    expect(filePath.startsWith(tmpDir)).toBe(true);
    expect(existsSync(filePath)).toBe(true);
  });

  it("respects custom fileName", () => {
    const snap = buildSnapshot({ uid: 1 });
    const filePath = writeSnapshotJson(snap, {
      dir: tmpDir,
      fileName: "custom.json",
    });
    expect(filePath).toBe(join(tmpDir, "custom.json"));
  });

  it("rejects fileName with path separators", () => {
    const snap = buildSnapshot({ uid: 1 });
    expect(() =>
      writeSnapshotJson(snap, { dir: tmpDir, fileName: "../escape.json" }),
    ).toThrow(/must be a basename/);
    expect(() =>
      writeSnapshotJson(snap, { dir: tmpDir, fileName: "sub/path.json" }),
    ).toThrow(/must be a basename/);
  });

  it("cleanupSnapshotJson is no-op on missing file", () => {
    cleanupSnapshotJson(join(tmpDir, "nonexistent.json"));
    // Should not throw
  });

  it("cleanupSnapshotJson tolerates null / empty", () => {
    cleanupSnapshotJson(null);
    cleanupSnapshotJson("");
    cleanupSnapshotJson(undefined);
    // Should not throw
  });
});
