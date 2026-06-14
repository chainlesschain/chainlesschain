"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  KugouMusicAdapter,
  extractList,
  songItemToRecord,
  playlistItemToRecord,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/music-kugou");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-kg-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "KuGoo=abc; kg_mid=xyz";

const SNAP = JSON.stringify({
  schemaVersion: 1,
  snapshottedAt: 1716383000000,
  account: { userId: "u1" },
  events: [
    { kind: "play", id: "p1", songId: "S1", song: "晴天", artist: "周杰伦", album: "叶惠美", playCount: 12, capturedAt: 1716300000000 },
    { kind: "favorite", id: "f1", songId: "S2", song: "稻香", artist: "周杰伦" },
    { kind: "playlist", id: "pl1", playlistId: "L1", name: "华语经典", trackCount: 88, creator: "我" },
  ],
});

describe("constants + item mappers", () => {
  it("name/version", () => {
    expect(NAME).toBe("music-kugou");
    expect(VERSION).toBe("0.1.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
  it("songItemToRecord: discrete fields + filename split fallback", () => {
    const r1 = songItemToRecord({ hash: "H1", songname: "夜曲", singername: "周杰伦", album_name: "十一月的萧邦", addtime: 1716300000 });
    expect(r1).toMatchObject({ id: "H1", song: "夜曲", artist: "周杰伦", album: "十一月的萧邦" });
    expect(r1.occurredAt).toBe(1716300000000);
    const r2 = songItemToRecord({ mixsongid: 9, filename: "林俊杰 - 江南" });
    expect(r2).toMatchObject({ song: "江南", artist: "林俊杰" });
    expect(songItemToRecord({ songname: "noid" })).toBe(null);
  });
  it("playlistItemToRecord", () => {
    const r = playlistItemToRecord({ listid: "L9", name: "睡前", count: 30, nickname: "我" });
    expect(r).toMatchObject({ id: "L9", playlistId: "L9", name: "睡前", trackCount: 30, creator: "我" });
  });
  it("extractList tolerant", () => {
    expect(extractList({ list: [{ hash: 1 }] })).toHaveLength(1);
    expect(extractList({ data: { info: [{ hash: 1 }] } })).toHaveLength(1);
    expect(extractList({})).toEqual([]);
  });
});

describe("KugouMusicAdapter snapshot mode", () => {
  it("authenticate validates inputPath", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new KugouMusicAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      expect((await a.authenticate({ inputPath: path.join(os.tmpdir(), "no-kg.json") })).reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync 3 kinds + normalize play→media+item / favorite→like / playlist→topic", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new KugouMusicAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["play", "favorite", "playlist"]);

      const play = a.normalize(items[0]);
      expect(play.events[0].subtype).toBe("media");
      expect(play.events[0].content.title).toBe("听了: 晴天 - 周杰伦");
      expect(play.items[0].subtype).toBe("media");
      expect(play.items[0].extra.platform).toBe("kugou");
      expect(play.events[0].extra.itemRef).toBe(play.items[0].id);

      const fav = a.normalize(items[1]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toBe("收藏: 稻香 - 周杰伦");

      const pl = a.normalize(items[2]);
      expect(pl.topics[0].name).toBe("华语经典");
      expect(pl.topics[0].extra.trackCount).toBe(88);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("include + limit + schema mismatch + unknown kind", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new KugouMusicAdapter();
      expect((await collect(a.sync({ inputPath: p, include: { play: false, favorite: false } }))).map((x) => x.kind)).toEqual(["playlist"]);
      expect(await collect(a.sync({ inputPath: p, limit: 1 }))).toHaveLength(1);
      expect(() => a.normalize({ kind: "bogus", payload: {} })).toThrow(/unknown kind/);
    } finally {
      fs.unlinkSync(p);
    }
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new KugouMusicAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(bad);
    }
  });
});

describe("KugouMusicAdapter cookie-api mode", () => {
  it("authenticate cookie mode (userId optional)", async () => {
    const a = new KugouMusicAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
  });

  it("sync fetches plays/favorites/playlists, normalizes", async () => {
    const byUrl = (u) => (u.includes("listen") ? "play" : u.includes("favorite") ? "favorite" : "playlist");
    const data = {
      play: [{ hash: "H1", songname: "七里香", singername: "周杰伦", addtime: 1716300000 }],
      favorite: [{ hash: "H2", filename: "陈奕迅 - 浮夸" }],
      playlist: [{ listid: "L1", name: "粤语", count: 50 }],
    };
    const calls = [];
    const a = new KugouMusicAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        const k = byUrl(url);
        calls.push({ k, cookies, page: query.page, sign });
        return { data: { list: query.page === 1 ? data[k] : [] } };
      },
    });
    const items = await collect(a.sync({}));
    expect(items.map((x) => x.kind).sort()).toEqual(["favorite", "play", "playlist"]);
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(true);
    const play = a.normalize(items.find((x) => x.kind === "play"));
    expect(play.events[0].content.title).toBe("听了: 七里香 - 周杰伦");
    const fav = a.normalize(items.find((x) => x.kind === "favorite"));
    expect(fav.events[0].content.title).toBe("收藏: 浮夸 - 陈奕迅"); // filename split
    const pl = a.normalize(items.find((x) => x.kind === "playlist"));
    expect(pl.topics[0].name).toBe("粤语");
  });

  it("invokes signProvider", async () => {
    const signCalls = [];
    const a = new KugouMusicAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({ list: query.page === 1 ? [{ hash: "H1", songname: "x" }] : [] }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "sig"; },
    });
    const items = await collect(a.sync({ include: { favorite: false, playlist: false } }));
    expect(items.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("limit + empty/login + default fetch + no input", async () => {
    const a1 = new KugouMusicAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({ list: query.page === 1 ? [{ hash: "H1", songname: "a" }, { hash: "H2", songname: "b" }] : [] }),
    });
    expect(await collect(a1.sync({ limit: 1 }))).toHaveLength(1);

    const a2 = new KugouMusicAdapter({ account: { cookies: COOKIES }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({}))).toEqual([]);

    const a3 = new KugouMusicAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a3.sync({}))).rejects.toThrow(/no fetchFn configured/);

    const a4 = new KugouMusicAdapter();
    await expect(collect(a4.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
