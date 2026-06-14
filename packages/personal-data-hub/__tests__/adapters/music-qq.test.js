"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const qm = require("../../lib/adapters/music-qq");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-qqm-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "qqmusic_key=abc; uin=123";

describe("music-qq mappers", () => {
  it("name/version", () => {
    expect(qm.NAME).toBe("music-qq");
    expect(qm.VERSION).toBe("0.1.0");
  });
  it("flattenSinger handles array / string / object", () => {
    expect(qm.flattenSinger([{ name: "周杰伦" }, { name: "费玉清" }])).toBe("周杰伦/费玉清");
    expect(qm.flattenSinger("林俊杰")).toBe("林俊杰");
    expect(qm.flattenSinger({ name: "邓紫棋" })).toBe("邓紫棋");
    expect(qm.flattenSinger(null)).toBe("");
  });
  it("songItemToRecord (QQ fields: songmid, singer array, album.name)", () => {
    const r = qm.songItemToRecord({ songmid: "S1", songname: "晴天", singer: [{ name: "周杰伦" }], album: { name: "叶惠美" }, time: 1716383000 });
    expect(r).toMatchObject({ songId: "S1", song: "晴天", artist: "周杰伦", album: "叶惠美" });
    expect(r.occurredAt).toBe(1716383000000);
    expect(qm.songItemToRecord({ songname: "x" })).toBe(null);
  });
  it("playlistItemToRecord (dissid/dissname/songnum)", () => {
    const r = qm.playlistItemToRecord({ dissid: "P1", dissname: "我喜欢", songnum: 42, creator: { name: "我" } });
    expect(r).toMatchObject({ playlistId: "P1", name: "我喜欢", trackCount: 42, creator: "我" });
    expect(qm.playlistItemToRecord({ dissname: "x" })).toBe(null);
  });
  it("extractList tolerant (list / data.songlist)", () => {
    expect(qm.extractList({ list: [{ songmid: 1 }] })).toHaveLength(1);
    expect(qm.extractList({ data: { songlist: [{ songmid: 1 }] } })).toHaveLength(1);
    expect(qm.extractList({})).toEqual([]);
  });
});

describe("QQMusicAdapter (snapshot + cookie-api)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      { kind: "play", id: "play-S1", songId: "S1", song: "晴天", artist: "周杰伦", album: "叶惠美" },
      { kind: "favorite", id: "fav-S2", songId: "S2", song: "稻香", artist: "周杰伦" },
      { kind: "playlist", id: "pl-P1", playlistId: "P1", name: "我喜欢", trackCount: 42 },
    ],
  });

  it("snapshot → play(MEDIA)/favorite(LIKE) events + playlist topic", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new qm.QQMusicAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(3);
      const play = a.normalize(items[0]);
      expect(play.events[0].subtype).toBe("media");
      expect(play.events[0].content.title).toContain("听了: 晴天");
      expect(play.items[0].subtype).toBe("media");
      expect(play.items[0].extra.platform).toBe("qqmusic");
      expect(items[0].originalId).toBe("qqmusic:play:play-S1"); // snapshot uses ev.id (mirrors kugou)
      const fav = a.normalize(items[1]);
      expect(fav.events[0].subtype).toBe("like");
      const pl = a.normalize(items[2]);
      expect(pl.topics[0].name).toBe("我喜欢");
      expect(pl.topics[0].id).toBe("topic-qqmusic-playlist-P1");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: fetch 3 kinds + sign seam", async () => {
    let signed = 0;
    const a = new qm.QQMusicAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      signProvider: async () => { signed += 1; return "sig"; },
      fetchFn: async ({ url, query }) => {
        if (query.page > 1) return { list: [] };
        if (url.includes("/listen")) return { list: [{ songmid: "A", songname: "歌1", singer: [{ name: "歌手" }], time: 1716383000 }] };
        if (url.includes("/favorite")) return { data: { songlist: [{ songmid: "B", songname: "歌2", singer: "歌手2" }] } };
        return { data: { list: [{ dissid: "C", dissname: "歌单", songnum: 5 }] } };
      },
    });
    expect(await a.authenticate()).toEqual({ ok: true, account: "u1", mode: "cookie" });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.originalId).sort()).toEqual(["qqmusic:favorite:B", "qqmusic:play:A", "qqmusic:playlist:C"]);
    expect(signed).toBeGreaterThan(0);
  });

  it("low sensitivity (consumer music); default fetch / no input throw", async () => {
    expect(new qm.QQMusicAdapter().dataDisclosure.sensitivity).toBe("low");
    expect(new qm.QQMusicAdapter().dataDisclosure.legalGate).toBe(false);
    await expect(collect(new qm.QQMusicAdapter({ account: { cookies: COOKIES } }).sync({}))).rejects.toThrow(/no fetchFn/);
    await expect(collect(new qm.QQMusicAdapter().sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
