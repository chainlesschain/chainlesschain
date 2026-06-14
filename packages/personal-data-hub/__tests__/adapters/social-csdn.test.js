"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  CsdnAdapter,
  extractList,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/social-csdn");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-csdn-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "UserName=alice; UserToken=xyz";

const SNAP = JSON.stringify({
  schemaVersion: 1,
  snapshottedAt: 1716383000000,
  account: { username: "alice", name: "Alice" },
  events: [
    { kind: "article", id: "article-101", articleId: "101", title: "<p>Vue 源码解析</p>", viewCount: 999, collectCount: 50, createdTime: 1716300000, url: "https://blog.csdn.net/alice/article/details/101" },
    { kind: "favourite", id: "fav-202", itemId: "202", title: "Rust 入门", url: "https://x/202", source: "blog", capturedAt: 1716310000000 },
    { kind: "follow", id: "follow-bob", username: "bob", name: "Bob", capturedAt: 1716320000000 },
  ],
});

describe("constants + extractList", () => {
  it("name/version/schema", () => {
    expect(NAME).toBe("social-csdn");
    expect(VERSION).toBe("0.1.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
  it("extractList tolerant", () => {
    expect(extractList({ list: [{ id: 1 }] })).toHaveLength(1);
    expect(extractList({ data: { list: [{ id: 1 }] } })).toHaveLength(1);
    expect(extractList({ data: { records: [{ id: 1 }] } })).toHaveLength(1);
    expect(extractList({})).toEqual([]);
  });
});

describe("CsdnAdapter snapshot mode", () => {
  it("authenticate validates inputPath", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new CsdnAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      expect((await a.authenticate({ inputPath: path.join(os.tmpdir(), "no-csdn.json") })).reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync 3 kinds + normalize article→post(html-stripped)/favourite→like/follow→person", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new CsdnAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["article", "favourite", "follow"]);

      const art = a.normalize(items[0]);
      expect(art.events[0].subtype).toBe("post");
      expect(art.events[0].content.text).toBe("Vue 源码解析"); // html stripped
      expect(art.events[0].extra.viewCount).toBe(999);
      expect(art.events[0].extra.collectCount).toBe(50);

      const fav = a.normalize(items[1]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toBe("Rust 入门");

      const fol = a.normalize(items[2]);
      expect(fol.persons[0].subtype).toBe("contact");
      expect(fol.persons[0].names).toEqual(["Bob"]);
      expect(fol.persons[0].identifiers["csdn-username"]).toEqual(["bob"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("include filter + limit + schema mismatch + unknown kind", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new CsdnAdapter();
      expect((await collect(a.sync({ inputPath: p, include: { article: false, follow: false } }))).map((x) => x.kind)).toEqual(["favourite"]);
      expect(await collect(a.sync({ inputPath: p, limit: 2 }))).toHaveLength(2);
      expect(() => a.normalize({ kind: "bogus", payload: {} })).toThrow(/unknown kind/);
    } finally {
      fs.unlinkSync(p);
    }
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new CsdnAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(bad);
    }
  });
});

describe("CsdnAdapter cookie-api mode", () => {
  it("authenticate requires username", async () => {
    const noU = new CsdnAdapter({ account: { cookies: COOKIES } });
    expect((await noU.authenticate()).reason).toBe("NO_ACCOUNT_USERNAME");
    const ok = new CsdnAdapter({ account: { cookies: COOKIES, username: "alice" } });
    expect(await ok.authenticate()).toEqual({ ok: true, account: "alice", mode: "cookie" });
  });

  it("sync fetches articles/favourites/followees, normalizes", async () => {
    const byUrl = (u) => (u.includes("get-business-list") ? "articles" : u.includes("favorite") ? "favourites" : "followees");
    const data = {
      articles: [{ articleId: "A1", title: "Go 并发", viewCount: 10, createdTime: 1716300000 }],
      favourites: [{ id: "F1", title: "K8s 实践", source: "blog", created_at: 1716310000 }],
      followees: [{ username: "carol", name: "Carol" }],
    };
    const calls = [];
    const a = new CsdnAdapter({
      account: { cookies: COOKIES, username: "alice" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        const k = byUrl(url);
        calls.push({ k, cookies, page: query.page, sign });
        return { data: { list: query.page === 1 ? data[k] : [] } };
      },
    });
    const items = await collect(a.sync({}));
    expect(items.map((x) => x.kind).sort()).toEqual(["article", "favourite", "follow"]);
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(true);
    const art = a.normalize(items.find((x) => x.kind === "article"));
    expect(art.events[0].content.title).toBe("Go 并发");
    const fol = a.normalize(items.find((x) => x.kind === "follow"));
    expect(fol.persons[0].names).toEqual(["Carol"]);
  });

  it("invokes signProvider", async () => {
    const signCalls = [];
    const a = new CsdnAdapter({
      account: { cookies: COOKIES, username: "alice" },
      fetchFn: async ({ query }) => ({ list: query.page === 1 ? [{ articleId: "A1", title: "x" }] : [] }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "sig"; },
    });
    const items = await collect(a.sync({ include: { favourite: false, follow: false } }));
    expect(items.length).toBeGreaterThan(0);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("limit + empty/login + default fetch + no input", async () => {
    const a1 = new CsdnAdapter({
      account: { cookies: COOKIES, username: "alice" },
      fetchFn: async ({ query }) => ({ list: query.page === 1 ? [{ articleId: "A1", title: "a" }, { articleId: "A2", title: "b" }] : [] }),
    });
    expect(await collect(a1.sync({ limit: 1 }))).toHaveLength(1);

    const a2 = new CsdnAdapter({ account: { cookies: COOKIES, username: "alice" }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({}))).toEqual([]);

    const a3 = new CsdnAdapter({ account: { cookies: COOKIES, username: "alice" } });
    await expect(collect(a3.sync({}))).rejects.toThrow(/no fetchFn configured/);

    const a4 = new CsdnAdapter();
    await expect(collect(a4.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
