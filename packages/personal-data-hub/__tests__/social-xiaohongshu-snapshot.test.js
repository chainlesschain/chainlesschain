"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  XiaohongshuAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
} = require("../lib/adapters/social-xiaohongshu");
const { validateBatch } = require("../lib/batch");

// §A8 v0.2 — snapshot-mode tests, mirror of social-weibo-snapshot.test.js.
//
// Snapshot mode is in-APK Android cc reading JSON written by XhsLocalCollector
// (WebView + OkHttp + X-S signed requests). Sqlite/device-pull tests stay in
// longtail-adapters.test.js (legacy Phase 13.4 path).

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-xiaohongshu.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("XiaohongshuAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 + 3 VALID_SNAPSHOT_KINDS", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["note", "liked", "follow"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new XiaohongshuAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new XiaohongshuAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new XiaohongshuAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new XiaohongshuAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("empty events array yields nothing (no crash)", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new XiaohongshuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("note + liked + follow round-trip normalize cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: { uid: "5e8c8f7e000000000abcdef0", numericUid: "12345", displayName: "alice" },
      events: [
        {
          kind: "note",
          id: "note-N1",
          capturedAt: now - 1000,
          title: "今日穿搭",
          noteId: "N1",
          desc: "夏日清凉",
          type: "normal",
          likedCount: 100,
          collectedCount: 30,
          commentCount: 15,
        },
        {
          kind: "liked",
          id: "liked-N2",
          capturedAt: now - 2000,
          title: "好喜欢的菜谱",
          noteId: "N2",
          authorNickname: "美食家",
        },
        {
          kind: "follow",
          id: "follow-USR99",
          capturedAt: now - 3000,
          userId: "USR99",
          nickname: "carol",
          image: "https://example.com/c.jpg",
        },
      ],
    });
    const a = new XiaohongshuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(3);

    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["note", "liked", "follow"]);

    expect(raws[0].originalId).toMatch(/^xiaohongshu:note:/);
    expect(raws[1].originalId).toMatch(/^xiaohongshu:liked:/);
    expect(raws[2].originalId).toMatch(/^xiaohongshu:follow:/);

    for (const raw of raws) {
      const batch = a.normalize(raw);
      expect(validateBatch(batch).valid).toBe(true);
    }

    const noteBatch = a.normalize(raws[0]);
    expect(noteBatch.events[0].subtype).toBe("post");
    expect(noteBatch.events[0].extra.noteId).toBe("N1");
    expect(noteBatch.events[0].extra.likedCount).toBe(100);
    expect(noteBatch.events[0].extra.collectedCount).toBe(30);
    expect(noteBatch.events[0].extra.commentCount).toBe(15);
    expect(noteBatch.events[0].extra.type).toBe("normal");
    expect(noteBatch.events[0].source.capturedBy).toBe("api");

    const likedBatch = a.normalize(raws[1]);
    expect(likedBatch.events[0].subtype).toBe("like");
    expect(likedBatch.events[0].extra.authorNickname).toBe("美食家");

    const followBatch = a.normalize(raws[2]);
    expect(followBatch.events.length).toBe(0);
    expect(followBatch.persons.length).toBe(1);
    expect(followBatch.persons[0].names).toEqual(["carol"]);
    expect(followBatch.persons[0].identifiers["xiaohongshu-uid"]).toEqual(["USR99"]);
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "note", id: "n1", capturedAt: now, title: "t", noteId: "N1" },
        { kind: "liked", id: "l1", capturedAt: now, title: "l", noteId: "N2" },
        { kind: "follow", id: "fl1", capturedAt: now, userId: "U1", nickname: "x" },
      ],
    });
    const a = new XiaohongshuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { liked: false } })) {
      raws.push(r);
    }
    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["note", "follow"]);
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "note", id: `n${i}`, capturedAt: now - i * 100, title: `t${i}`, noteId: `N${i}`,
    }));
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new XiaohongshuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws.length).toBe(2);
  });

  it("filters out unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "note", id: "n1", capturedAt: now, title: "ok", noteId: "N1" },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "history", id: "h", capturedAt: now }, // sqlite-only
      ],
    });
    const a = new XiaohongshuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("note");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "note", id: "n1", title: "no time", noteId: "N1" },
      ],
    });
    const a = new XiaohongshuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });
});
