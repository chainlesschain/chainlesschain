"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const { XiguaVideoAdapter, extractItems, mapItem, NAME, VERSION } = require("../../lib/adapters/video-xigua");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-xig-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "sid_tt=abc; ttwid=xyz";

describe("video-xigua mappers", () => {
  it("name/version", () => {
    expect(NAME).toBe("video-xigua");
    expect(VERSION).toBe("0.1.0");
  });
  it("mapItem reads nested article + bytedance fields", () => {
    const rec = mapItem({ behot_time: 1716300000, article: { group_id: "G1", title: "城市骑行 vlog", video_duration: 620, user_name: "骑行小王" } });
    expect(rec).toMatchObject({ videoId: "G1", title: "城市骑行 vlog", durationSec: 620, channel: "骑行小王" });
    expect(rec.occurredAt).toBe(1716300000000);
    expect(rec.url).toContain("ixigua.com");
    expect(mapItem({ article: { title: "noid" } })).toBe(null);
  });
  it("mapItem reads flat item too", () => {
    const rec = mapItem({ group_id: "G2", title: "测评", duration: 300, create_time: 1716310000 });
    expect(rec).toMatchObject({ videoId: "G2", title: "测评", durationSec: 300 });
  });
  it("extractItems tolerant", () => {
    expect(extractItems({ data: { history: [{ group_id: 1 }] } })).toHaveLength(1);
    expect(extractItems({ data: { favorites: [{ group_id: 1 }] } })).toHaveLength(1);
    expect(extractItems({})).toEqual([]);
  });
});

describe("XiguaVideoAdapter (via _video-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      { kind: "watch", id: "w1", videoId: "V1", title: "纪录片：长江", category: "documentary", durationSec: 3600, capturedAt: 1716300000000 },
      { kind: "favourite", id: "fa1", videoId: "V2", title: "搞笑合集" },
    ],
  });

  it("snapshot sync 2 kinds + normalize watch→media / favourite→like", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new XiguaVideoAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["watch", "favourite"]);
      const w = a.normalize(items[0]);
      expect(w.events[0].subtype).toBe("media");
      expect(w.events[0].content.title).toBe("观看: 纪录片：长江");
      expect(w.items[0].subtype).toBe("media");
      expect(w.items[0].extra.platform).toBe("xigua");
      const fav = a.normalize(items[1]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toBe("收藏: 搞笑合集");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api fetch + normalize", async () => {
    const byUrl = (u) => (u.includes("history") ? "watch" : "favourite");
    const data = {
      watch: [{ behot_time: 1716300000, article: { group_id: "C1", title: "汽车评测", video_duration: 500 } }],
      favourite: [{ group_id: "C2", title: "美食教程" }],
    };
    const calls = [];
    const a = new XiguaVideoAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        const k = byUrl(url);
        calls.push({ k, cookies, page: query.page, sign });
        return { data: { list: query.page === 1 ? data[k] : [] } };
      },
    });
    expect(await a.authenticate()).toEqual({ ok: true, account: "u1", mode: "cookie" });
    const items = await collect(a.sync({}));
    expect(items.map((x) => x.kind).sort()).toEqual(["favourite", "watch"]);
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(true);
    const w = a.normalize(items.find((x) => x.kind === "watch"));
    expect(w.events[0].content.title).toBe("观看: 汽车评测");
  });

  it("default fetch throws; no input throws", async () => {
    const a = new XiguaVideoAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a.sync({}))).rejects.toThrow(/no fetchFn configured/);
    const b = new XiguaVideoAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
