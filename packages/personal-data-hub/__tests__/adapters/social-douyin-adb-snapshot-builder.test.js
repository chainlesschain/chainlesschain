"use strict";

/**
 * Phase 2a — Douyin snapshot-builder unit cover.
 *
 * Mirrors social-bilibili-adb-snapshot-builder.test.js but with the
 * Douyin event shapes (kind=message / kind=contact).
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
} = require("../../lib/adapters/social-douyin-adb/snapshot-builder");

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-douyin-snap-test-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

describe("buildSnapshot — schema contract", () => {
  it("returns documented schema shape", () => {
    const snap = buildSnapshot({
      uid: "1234567890123456789",
      displayName: "alice",
      messages: [],
      contacts: [],
      snapshottedAt: 1716383021000,
    });
    expect(snap.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshottedAt).toBe(1716383021000);
    expect(snap.account).toEqual({
      secUid: null, // unknown via pure-db extraction
      shortId: "1234567890123456789",
      displayName: "alice",
    });
    expect(Array.isArray(snap.events)).toBe(true);
  });

  it("rejects non-string / empty uid", () => {
    expect(() => buildSnapshot({ uid: 123 })).toThrow(TypeError);
    expect(() => buildSnapshot({ uid: "" })).toThrow(TypeError);
    expect(() => buildSnapshot({})).toThrow(TypeError);
  });

  it("defaults snapshottedAt to Date.now() when omitted", () => {
    const before = Date.now();
    const snap = buildSnapshot({ uid: "1" });
    const after = Date.now();
    expect(snap.snapshottedAt).toBeGreaterThanOrEqual(before);
    expect(snap.snapshottedAt).toBeLessThanOrEqual(after);
  });

  it("defaults displayName to empty string", () => {
    const snap = buildSnapshot({ uid: "1" });
    expect(snap.account.displayName).toBe("");
  });
});

describe("buildSnapshot — events", () => {
  it("maps messages → kind=message events with composite id", () => {
    const snap = buildSnapshot({
      uid: "1",
      messages: [
        {
          senderUid: "10001",
          conversationId: "conv-A",
          createdTimeMs: 1716383021000,
          text: "hi",
          readStatus: 1,
          contentBlob: '{"text":"hi"}',
        },
      ],
    });
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]).toMatchObject({
      kind: "message",
      id: "msg-conv-A-1716383021000",
      capturedAt: 1716383021000,
      senderUid: "10001",
      conversationId: "conv-A",
      text: "hi",
      readStatus: 1,
      contentBlob: '{"text":"hi"}',
    });
  });

  it("falls back to senderUid+time when conversationId absent", () => {
    const snap = buildSnapshot({
      uid: "1",
      messages: [
        {
          senderUid: "10001",
          conversationId: null,
          createdTimeMs: 1716383021000,
          text: "hi",
        },
      ],
    });
    expect(snap.events[0].id).toBe("msg-10001-1716383021000");
  });

  it("falls back to index when both conversationId + senderUid absent", () => {
    const snap = buildSnapshot({
      uid: "1",
      messages: [{ text: "stray" }],
    });
    expect(snap.events[0].id).toBe("msg-msg-0");
  });

  it("maps contacts → kind=contact events with uid-based id", () => {
    const snap = buildSnapshot({
      uid: "1",
      contacts: [
        { uid: "111", shortId: "222", name: "Alice", avatarUrl: "https://a.png", followStatus: 1 },
      ],
    });
    expect(snap.events[0]).toMatchObject({
      kind: "contact",
      id: "contact-111",
      uid: "111",
      shortId: "222",
      name: "Alice",
      followStatus: 1,
    });
  });

  it("preserves message → contact ordering", () => {
    const snap = buildSnapshot({
      uid: "1",
      messages: [{ senderUid: "a", createdTimeMs: 1 }],
      contacts: [{ uid: "b" }],
    });
    expect(snap.events.map((e) => e.kind)).toEqual(["message", "contact"]);
  });

  it("uses snapshottedAt fallback when message has no createdTimeMs", () => {
    const snap = buildSnapshot({
      uid: "1",
      snapshottedAt: 999,
      messages: [{ senderUid: "x", text: "no time" }],
    });
    expect(snap.events[0].capturedAt).toBe(999);
  });

  it("skips null / non-object items", () => {
    const snap = buildSnapshot({
      uid: "1",
      messages: [null, { senderUid: "a", createdTimeMs: 1 }, "junk"],
      contacts: [undefined, { uid: "b" }],
    });
    expect(snap.events).toHaveLength(2);
  });

  it("handles non-array fields gracefully", () => {
    const snap = buildSnapshot({
      uid: "1",
      messages: "not an array",
      contacts: null,
    });
    expect(snap.events).toEqual([]);
  });
});

describe("writeSnapshotJson + cleanupSnapshotJson", () => {
  it("writes JSON to default tmpdir", () => {
    const snap = buildSnapshot({ uid: "1" });
    const filePath = writeSnapshotJson(snap);
    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toContain("cc-douyin-snapshot-");
    expect(filePath).toMatch(/\.json$/);
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(parsed.schemaVersion).toBe(1);
    cleanupSnapshotJson(filePath);
    expect(existsSync(filePath)).toBe(false);
  });

  it("respects custom dir + fileName", () => {
    const snap = buildSnapshot({ uid: "1" });
    const filePath = writeSnapshotJson(snap, {
      dir: tmpDir,
      fileName: "custom.json",
    });
    expect(filePath).toBe(join(tmpDir, "custom.json"));
  });

  it("rejects path separators in fileName", () => {
    const snap = buildSnapshot({ uid: "1" });
    expect(() => writeSnapshotJson(snap, { fileName: "../evil.json" })).toThrow(
      /must be a basename/,
    );
  });

  it("cleanupSnapshotJson tolerates missing / null", () => {
    cleanupSnapshotJson(null);
    cleanupSnapshotJson(undefined);
    cleanupSnapshotJson(join(tmpDir, "nonexistent.json"));
    // does not throw
  });
});
