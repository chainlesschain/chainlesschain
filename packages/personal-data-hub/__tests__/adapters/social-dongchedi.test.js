"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  DongchediAdapter,
  extractData,
  isEnd,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/social-dongchedi");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-dcd-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "tt_webid=abc; sessionid=xyz";

const SNAP = JSON.stringify({
  schemaVersion: 1,
  snapshottedAt: 1716383000000,
  account: { userId: "u1" },
  events: [
    { kind: "favourite", id: "fav-1", itemId: "G1", title: "2026 新能源车横评", contentType: "article", url: "https://x/G1", capturedAt: 1716300000000 },
    { kind: "follow", id: "follow-S1", followId: "S1", name: "理想 L 系列", followType: "series", capturedAt: 1716320000000 },
  ],
});

describe("constants + helpers", () => {
  it("name/version/schema", () => {
    expect(NAME).toBe("social-dongchedi");
    expect(VERSION).toBe("0.1.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
  it("extractData tolerant", () => {
    expect(extractData({ data: [{ id: 1 }] })).toHaveLength(1);
    expect(extractData({ data: { favorite_list: [{ id: 1 }] } })).toHaveLength(1);
    expect(extractData({ data: { follow_list: [{ id: 1 }] } })).toHaveLength(1);
    expect(extractData({})).toEqual([]);
  });
  it("isEnd reads has_more", () => {
    expect(isEnd({ data: { has_more: false } })).toBe(true);
    expect(isEnd({ has_more: 0 })).toBe(true);
    expect(isEnd({ data: { has_more: true } })).toBe(false);
  });
});

describe("DongchediAdapter snapshot mode", () => {
  it("authenticate validates inputPath", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new DongchediAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      expect((await a.authenticate({ inputPath: path.join(os.tmpdir(), "no-dcd.json") })).reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync 2 kinds + normalize favourite→like / follow→person", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new DongchediAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["favourite", "follow"]);

      const fav = a.normalize(items[0]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toBe("收藏: 2026 新能源车横评");
      expect(fav.events[0].extra.contentType).toBe("article");

      const fol = a.normalize(items[1]);
      expect(fol.persons[0].subtype).toBe("contact");
      expect(fol.persons[0].names).toEqual(["理想 L 系列"]);
      expect(fol.persons[0].identifiers["dongchedi-id"]).toEqual(["S1"]);
      expect(fol.persons[0].extra.followType).toBe("series");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("include + limit + schema mismatch + unknown kind", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new DongchediAdapter();
      expect((await collect(a.sync({ inputPath: p, include: { favourite: false } }))).map((x) => x.kind)).toEqual(["follow"]);
      expect(await collect(a.sync({ inputPath: p, limit: 1 }))).toHaveLength(1);
      expect(() => a.normalize({ kind: "bogus", payload: {} })).toThrow(/unknown kind/);
    } finally {
      fs.unlinkSync(p);
    }
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new DongchediAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(bad);
    }
  });
});

describe("DongchediAdapter cookie-api mode", () => {
  it("authenticate cookie (userId optional)", async () => {
    const a = new DongchediAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
  });

  it("sync fetches favourites + follows, normalizes", async () => {
    const byUrl = (u) => (u.includes("favorite") ? "favourite" : "follow");
    const data = {
      favourite: [{ group_id: "G1", title: "试驾视频", content_type: "video", create_time: 1716300000 }],
      follow: [{ series_id: "S9", series_name: "比亚迪汉", follow_time: 1716320000 }],
    };
    const calls = [];
    const a = new DongchediAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        const k = byUrl(url);
        calls.push({ k, cookies, offset: query.offset, sign });
        return { data: { list: query.offset === 0 ? data[k] : [], has_more: false } };
      },
    });
    const items = await collect(a.sync({}));
    expect(items.map((x) => x.kind).sort()).toEqual(["favourite", "follow"]);
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(true);
    const fav = a.normalize(items.find((x) => x.kind === "favourite"));
    expect(fav.events[0].content.title).toBe("收藏: 试驾视频");
    const fol = a.normalize(items.find((x) => x.kind === "follow"));
    expect(fol.persons[0].names).toEqual(["比亚迪汉"]);
    expect(fol.persons[0].extra.followType).toBe("series");
  });

  it("invokes signProvider + limit + empty + default fetch + no input", async () => {
    const signCalls = [];
    const a = new DongchediAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({ data: { list: query.offset === 0 ? [{ group_id: "G1", title: "x" }, { group_id: "G2", title: "y" }] : [], has_more: false } }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "x-bogus"; },
    });
    expect(await collect(a.sync({ limit: 1, include: { follow: false } }))).toHaveLength(1);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);

    const a2 = new DongchediAdapter({ account: { cookies: COOKIES }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({}))).toEqual([]);

    const a3 = new DongchediAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a3.sync({}))).rejects.toThrow(/no fetchFn configured/);

    const a4 = new DongchediAdapter();
    await expect(collect(a4.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
