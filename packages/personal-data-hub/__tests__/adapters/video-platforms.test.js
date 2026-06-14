"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const iqiyi = require("../../lib/adapters/video-iqiyi");
const tv = require("../../lib/adapters/video-tencent");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-vid-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "P00001=abc; QC005=xyz";

describe("video-iqiyi mappers", () => {
  it("name/version + mapItem (channel code → category)", () => {
    expect(iqiyi.NAME).toBe("video-iqiyi");
    const rec = iqiyi.mapItem({ tvId: "100", albumName: "庆余年", channelId: 2, videoName: "庆余年", addtime: 1716300000, videoDuration: 2700 });
    expect(rec).toMatchObject({ videoId: "100", title: "庆余年", category: "tv", durationSec: 2700 });
    expect(rec.occurredAt).toBe(1716300000000);
    expect(rec.url).toContain("iqiyi.com");
    expect(iqiyi.mapItem({ albumName: "noid" })).toBe(null);
  });
  it("extractItems tolerant", () => {
    expect(iqiyi.extractItems({ data: [{ tvId: 1 }] })).toHaveLength(1);
    expect(iqiyi.extractItems({ data: { rc: [{ tvId: 1 }] } })).toHaveLength(1);
    expect(iqiyi.extractItems({})).toEqual([]);
  });
});

describe("video-tencent mappers", () => {
  it("name/version + mapItem (typeId → category)", () => {
    expect(tv.NAME).toBe("video-tencent");
    const rec = tv.mapItem({ cid: "C9", cTitle: "三体", cTypeId: 4, viewTime: 1716310000, duration: 3000 });
    expect(rec).toMatchObject({ videoId: "C9", title: "三体", category: "anime", durationSec: 3000 });
    expect(rec.url).toContain("v.qq.com");
    expect(tv.mapItem({ cTitle: "noid" })).toBe(null);
  });
});

describe("IqiyiVideoAdapter (via _video-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      { kind: "watch", id: "w1", videoId: "V1", title: "狂飙", category: "tv", episode: "第5集", durationSec: 2600, capturedAt: 1716300000000 },
      { kind: "favourite", id: "fa1", videoId: "V2", title: "流浪地球2", category: "movie" },
    ],
  });

  it("snapshot sync 2 kinds + normalize watch→media / favourite→like + media item", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new iqiyi.IqiyiVideoAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["watch", "favourite"]);

      const watch = a.normalize(items[0]);
      expect(watch.events[0].subtype).toBe("media");
      expect(watch.events[0].content.title).toBe("观看: 狂飙 第5集");
      expect(watch.items[0].subtype).toBe("media");
      expect(watch.items[0].extra.platform).toBe("iqiyi");
      expect(watch.events[0].extra.itemRef).toBe(watch.items[0].id);

      const fav = a.normalize(items[1]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toBe("收藏: 流浪地球2");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("schema mismatch + unknown kind + include + limit", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new iqiyi.IqiyiVideoAdapter();
      expect((await collect(a.sync({ inputPath: p, include: { watch: false } }))).map((x) => x.kind)).toEqual(["favourite"]);
      expect(await collect(a.sync({ inputPath: p, limit: 1 }))).toHaveLength(1);
      expect(() => a.normalize({ payload: {} })).toThrow(/payload.record missing/);
    } finally {
      fs.unlinkSync(p);
    }
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new iqiyi.IqiyiVideoAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(bad);
    }
  });
});

describe("TencentVideoAdapter cookie-api mode", () => {
  it("authenticate cookie (userId optional)", async () => {
    const a = new tv.TencentVideoAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
  });

  it("sync fetches watch+favourite, paginates, normalizes", async () => {
    const byUrl = (u) => (u.includes("History") ? "watch" : "favourite");
    const data = {
      watch: [{ cid: "C1", cTitle: "漫长的季节", cTypeId: 1, viewTime: 1716300000 }],
      favourite: [{ cid: "C2", cTitle: "繁花", cTypeId: 1 }],
    };
    const calls = [];
    const a = new tv.TencentVideoAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        const k = byUrl(url);
        calls.push({ k, cookies, page: query.page, sign });
        return { data: { list: query.page === 1 ? data[k] : [] } };
      },
    });
    const items = await collect(a.sync({}));
    expect(items.map((x) => x.kind).sort()).toEqual(["favourite", "watch"]);
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(true);
    const watch = a.normalize(items.find((x) => x.kind === "watch"));
    expect(watch.events[0].content.title).toBe("观看: 漫长的季节");
    expect(watch.items[0].extra.platform).toBe("tencent-video");
  });

  it("invokes signProvider + limit + empty + default fetch + no input", async () => {
    const signCalls = [];
    const a = new tv.TencentVideoAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({ list: query.page === 1 ? [{ cid: "C1", cTitle: "x" }, { cid: "C2", cTitle: "y" }] : [] }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "sig"; },
    });
    expect(await collect(a.sync({ limit: 1, include: { favourite: false } }))).toHaveLength(1);
    expect(signCalls.length).toBeGreaterThan(0);

    const a2 = new tv.TencentVideoAdapter({ account: { cookies: COOKIES }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({}))).toEqual([]);

    const a3 = new tv.TencentVideoAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a3.sync({}))).rejects.toThrow(/no fetchFn configured/);

    const a4 = new tv.TencentVideoAdapter();
    await expect(collect(a4.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
