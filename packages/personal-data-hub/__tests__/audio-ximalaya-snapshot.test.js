"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  XimalayaAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
  extractList,
  trackItemToRecord,
  albumItemToRecord,
} = require("../lib/adapters/audio-ximalaya");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// 喜马拉雅 (Ximalaya) — 听书/播客; mirrors music-kugou's play/favorite/subscribe
// shape. signing injected (signProvider). pure-Node.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "audio-ximalaya.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("XimalayaAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xmly-snap-"));
  });

  it("exports schema constants", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_KINDS).toEqual(["play", "favorite", "subscribe"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: Date.now(), events: [] });
    const a = new XimalayaAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate() no input → NO_INPUT", async () => {
    const a = new XimalayaAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("sync() without input throws with signProvider hint", async () => {
    const a = new XimalayaAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(String(threw.message)).toMatch(/signProvider/);
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 9, snapshottedAt: Date.now(), events: [] });
    const a = new XimalayaAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("play (收听节目) → MEDIA event + MEDIA item", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      account: { userId: "u1", name: "alice" },
      events: [
        { kind: "play", id: "t1", trackId: "98765", title: "第1集 三体广播剧",
          anchor: "729声工场", album: "三体", durationSec: 1800, capturedAt: now - 1000 },
      ],
    });
    const a = new XimalayaAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].originalId).toBe("ximalaya:play:t1");
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("media");
    expect(batch.events[0].content.title).toContain("收听: 第1集 三体广播剧 - 729声工场");
    expect(batch.items[0].subtype).toBe("media");
    expect(batch.items[0].name).toBe("第1集 三体广播剧 - 729声工场");
    expect(batch.events[0].extra.album).toBe("三体");
  });

  it("favorite → LIKE event", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [{ kind: "favorite", id: "f1", trackId: "555", title: "收藏的播客", anchor: "主播X" }],
    });
    const a = new XimalayaAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("like");
    expect(batch.events[0].content.title).toContain("收藏: 收藏的播客");
  });

  it("subscribe → TOPIC (album)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [{ kind: "subscribe", id: "s1", albumId: "30001", album: "得到·精英日课",
        trackCount: 365, anchor: "罗振宇" }],
    });
    const a = new XimalayaAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events.length).toBe(0);
    expect(batch.topics.length).toBe(1);
    expect(batch.topics[0].id).toBe("topic-ximalaya-album-30001");
    expect(batch.topics[0].name).toBe("得到·精英日课");
    expect(batch.topics[0].extra.trackCount).toBe(365);
  });

  it("respects include opt-out + limit", async () => {
    const now = Date.now();
    const events = [
      { kind: "play", id: "p1", trackId: "1", title: "a", capturedAt: now },
      { kind: "favorite", id: "f1", trackId: "2", title: "b" },
      { kind: "subscribe", id: "s1", albumId: "3", album: "c" },
    ];
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new XimalayaAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { favorite: false, subscribe: false } })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("play");
  });

  it("filters unknown kinds", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [
        { kind: "play", id: "p1", trackId: "1", title: "a", capturedAt: now },
        { kind: "comment", id: "c1" },
      ],
    });
    const a = new XimalayaAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
  });

  it("advertises capabilities + passes assertAdapter", () => {
    const a = new XimalayaAdapter();
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:cookie-api");
    expect(assertAdapter(a).ok).toBe(true);
  });
});

describe("XimalayaAdapter cookie-api mode", () => {
  it("authenticate(cookie) ok with cookies (userId optional)", async () => {
    const a = new XimalayaAdapter({ account: { cookies: "1&_token=ok" } });
    const res = await a.authenticate();
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("cookie");
  });

  it("fetches plays/favorites/subscribes and normalizes", async () => {
    const byUrl = (url) => {
      if (url.includes("/history")) {
        return { data: { list: [{ trackId: 98765, title: "第1集", nickname: "声工场", albumTitle: "三体", duration: 1800, startedAt: 1700000000000 }] } };
      }
      if (url.includes("/favorite")) {
        return { data: { tracks: [{ track_id: 555, track_title: "播客A", anchor_name: "主播X" }] } };
      }
      if (url.includes("/subscribe")) {
        return { data: { albums: [{ albumId: 30001, albumTitle: "精英日课", includeTrackCount: 365, nickname: "罗振宇" }] } };
      }
      return {};
    };
    const fetchFn = async (opts) => byUrl(opts.url);
    const a = new XimalayaAdapter({ account: { userId: "u1", cookies: "1&_token=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({})) raws.push(r);
    expect(raws.map((r) => r.kind).sort()).toEqual(["favorite", "play", "subscribe"]);

    const play = raws.find((r) => r.kind === "play");
    const pb = a.normalize(play);
    expect(validateBatch(pb).valid).toBe(true);
    expect(pb.events[0].content.title).toContain("收听: 第1集 - 声工场");
    expect(pb.items[0].name).toBe("第1集 - 声工场");

    const sub = raws.find((r) => r.kind === "subscribe");
    const sb = a.normalize(sub);
    expect(sb.topics[0].name).toBe("精英日课");
    expect(sb.topics[0].extra.trackCount).toBe(365);
  });

  it("invokes signProvider, passes sign to fetchFn", async () => {
    let seen = null;
    const signProvider = async () => "SIG";
    const fetchFn = async (opts) => {
      seen = opts.sign;
      return {};
    };
    const a = new XimalayaAdapter({ account: { cookies: "x=1" }, fetchFn, signProvider });
    for await (const _r of a.sync({ include: { favorite: false, subscribe: false } })) { /* drain */ }
    expect(seen).toBe("SIG");
  });

  it("paginates plays until short page", async () => {
    const all = Array.from({ length: 45 }, (_, i) => ({ trackId: i + 1, title: `t${i}`, startedAt: 1700000000000 }));
    const seenPages = [];
    const fetchFn = async (opts) => {
      if (!opts.url.includes("/history")) return {};
      const page = opts.query.page;
      seenPages.push(page);
      return { list: all.slice((page - 1) * 30, page * 30) };
    };
    const a = new XimalayaAdapter({ account: { cookies: "x=1" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ include: { favorite: false, subscribe: false } })) raws.push(r);
    expect(raws.length).toBe(45);
    expect(seenPages).toEqual([1, 2]);
  });

  it("extractList + item mappers tolerate shapes", () => {
    expect(extractList({ list: [1] })).toEqual([1]);
    expect(extractList({ data: { tracks: [2] } })).toEqual([2]);
    expect(extractList({ data: { albums: [3] } })).toEqual([3]);
    expect(extractList(null)).toEqual([]);
    expect(trackItemToRecord({ trackId: 7, title: "x" }).trackId).toBe("7");
    expect(trackItemToRecord({})).toBe(null);
    expect(albumItemToRecord({ albumId: 9, albumTitle: "A" }).album).toBe("A");
    expect(albumItemToRecord({})).toBe(null);
  });

  it("uses opts.*Url overrides", async () => {
    const seen = [];
    const fetchFn = async (opts) => {
      seen.push(opts.url);
      return {};
    };
    const a = new XimalayaAdapter({
      account: { cookies: "x=1" },
      fetchFn,
      playsUrl: "https://x/p",
      favoritesUrl: "https://x/f",
      subscribesUrl: "https://x/s",
    });
    for await (const _r of a.sync({})) { /* drain */ }
    expect(seen).toEqual(["https://x/p", "https://x/f", "https://x/s"]);
  });

  it("default fetchFn throws legible error", async () => {
    const a = new XimalayaAdapter({ account: { cookies: "x=1" } });
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(String(threw.message)).toMatch(/no fetchFn configured/);
  });
});
