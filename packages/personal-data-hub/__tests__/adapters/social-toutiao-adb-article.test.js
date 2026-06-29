/**
 * Toutiao article reader tests (real-device-driven 2026-06-18: the user's
 * exported news_article.db `article` table = 48 feed-cache rows; title lives in
 * the share_info JSON blob, not a column).
 *
 * Two layers: pure parsing via injected fake Database, + a real better-sqlite3
 * db + real LocalVault round-trip proving the hand-built BROWSE events pass
 * schema validation, are searchable, and re-ingest dedups on the stable
 * originalId.
 */
"use strict";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { LocalVault } = require("../../lib/vault");
const { generateKeyHex } = require("../../lib/key-providers");
const {
  ARTICLE_TABLE,
  readToutiaoArticles,
  buildArticleEvents,
  articlesToVault,
  _internals,
} = require("../../lib/adapters/social-toutiao-adb/article-reader");

function makeFakeDb(rows, { table = ARTICLE_TABLE } = {}) {
  const cols = [
    "group_id", "item_id", "share_info", "ext_json", "share_url",
    "behot_time", "read_timestamp", "is_user_digg", "is_user_repin",
  ];
  return class FakeDb {
    constructor() {}
    prepare(sql) {
      return {
        get: (arg) => (/sqlite_master/.test(sql) ? (arg === table ? { name: table } : undefined) : undefined),
        all: () => {
          if (/table_info/.test(sql)) return cols.map((name) => ({ name }));
          if (/FROM "/.test(sql)) return rows;
          return [];
        },
      };
    }
    close() {}
  };
}

describe("readToutiaoArticles (injected fake db)", () => {
  it("parses title from share_info, strips the brand suffix, drops url tracking query", () => {
    const Db = makeFakeDb([
      {
        group_id: 100, behot_time: 1781700000, read_timestamp: 0, is_user_digg: 1, is_user_repin: 0,
        share_info: JSON.stringify({ title: "5月汽车出口延续快速增长态势 - 今日头条", share_url: "https://m.toutiao.com/g/100/?app=x&category_new=headline" }),
        share_url: "https://m.toutiao.com/g/100/?category_new=headline",
      },
    ]);
    const { articles } = readToutiaoArticles("x.db", { _databaseClass: Db });
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("5月汽车出口延续快速增长态势"); // suffix stripped
    expect(articles[0].url).toBe("https://m.toutiao.com/g/100/"); // query dropped
    expect(articles[0].category).toBe("headline");
    expect(articles[0].digg).toBe(true);
    expect(articles[0].behotTime).toBe(1781700000 * 1000);
  });

  it("falls back to ext_json.title when share_info has none, and skips untitled rows", () => {
    const Db = makeFakeDb([
      { group_id: 1, ext_json: JSON.stringify({ title: "来自 ext_json 的标题" }), share_info: "{}" },
      { group_id: 2, share_info: "{}", ext_json: "{}" }, // untitled → dropped
    ]);
    const { articles } = readToutiaoArticles("x.db", { _databaseClass: Db });
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("来自 ext_json 的标题");
  });

  it("returns no articles when the table is absent", () => {
    const Db = makeFakeDb([], { table: "other" });
    expect(readToutiaoArticles("x.db", { _databaseClass: Db }).articles).toEqual([]);
  });

  it("buildArticleEvents → BROWSE events, social-toutiao source, stable originalId, read flag", () => {
    const { events } = buildArticleEvents(
      [{ groupId: "55", title: "标题", url: "u", category: "headline", behotTime: 2, readTimestamp: 1781700000000, digg: true, repin: false }],
      { now: 1781800000000 },
    );
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.subtype).toBe("browse");
    expect(e.source.adapter).toBe("social-toutiao");
    expect(e.source.originalId).toBe("social-toutiao:article:55");
    expect(e.occurredAt).toBe(1781700000000); // read_timestamp wins over behot
    expect(e.extra.kind).toBe("article");
    expect(e.extra.read).toBe(true);
    expect(e.extra.digg).toBe(true);
  });

  it("extractCategory / extractUrl helpers", () => {
    expect(_internals.extractCategory({ share_url: "x?a=1&category_new=my_tabs_digg&b=2" })).toBe("my_tabs_digg");
    expect(_internals.extractUrl({ share_info: JSON.stringify({ share_url: "https://h/g/1/?t=1" }) })).toBe("https://h/g/1/");
  });

  it("extractCategory: malformed percent-sequence falls back to raw (no throw)", () => {
    // A bare/invalid `%` in a stored share_url must not throw URIError.
    expect(() =>
      _internals.extractCategory({ share_url: "x?category_new=100%off" }),
    ).not.toThrow();
    expect(
      _internals.extractCategory({ share_url: "x?category_new=100%off" }),
    ).toBe("100%off");
  });
});

describe("articlesToVault — real sqlite + real vault", () => {
  let dir, dbPath, vdir, vault;

  beforeAll(() => {
    const Database = require("better-sqlite3-multiple-ciphers");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-article-"));
    dbPath = path.join(dir, "news_article.db");
    const db = new Database(dbPath);
    db.exec(
      "CREATE TABLE article (group_id INTEGER, item_id INTEGER, share_info TEXT, ext_json TEXT, " +
        "share_url TEXT, behot_time INTEGER, read_timestamp INTEGER, is_user_digg INTEGER, is_user_repin INTEGER)",
    );
    const ins = db.prepare(
      "INSERT INTO article (group_id, share_info, share_url, behot_time, read_timestamp, is_user_digg, is_user_repin) VALUES (?,?,?,?,?,?,?)",
    );
    ins.run(101, JSON.stringify({ title: "新华视点丨三峡水运新通道 - 今日头条", share_url: "https://m.toutiao.com/g/101/?x=1&category_new=headline" }), "https://m.toutiao.com/g/101/?category_new=headline", 1781700000, 0, 0, 0);
    ins.run(102, JSON.stringify({ title: "5月汽车出口延续快速增长态势 - 今日头条", share_url: "https://m.toutiao.com/g/102/" }), "https://m.toutiao.com/g/102/?category_new=my_tabs_digg", 1781700100, 1781700200, 1, 0);
    ins.run(103, "{}", "https://m.toutiao.com/g/103/", 1781700300, 0, 0, 0); // untitled → not ingested
    db.close();

    vdir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-article-vault-"));
    vault = new LocalVault({ path: path.join(vdir, "v.db"), key: generateKeyHex() });
    vault.open();
  });

  afterAll(() => {
    try { vault.close(); } catch (_e) { /* best-effort */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  });

  it("reads titled articles and ingests valid BROWSE events", () => {
    const r = articlesToVault(vault, dbPath, { now: 1781900000000 });
    expect(r.articles).toBe(2); // the untitled row is skipped
    expect(r.ingested).toBe(2); // both passed schema validation
    expect(r.digg).toBe(1);
    expect(r.read).toBe(1);

    const events = vault.queryEvents({ limit: 100 }) || [];
    const mine = events.filter((e) => e.extra && e.extra.kind === "article");
    expect(mine.length).toBe(2);
    expect(mine.every((e) => e.source.adapter === "social-toutiao")).toBe(true);
  });

  it("re-ingest dedups on the stable per-article originalId", () => {
    articlesToVault(vault, dbPath, { now: 1781999999999 });
    const events = vault.queryEvents({ limit: 100 }) || [];
    const mine = events.filter((e) => e.extra && e.extra.kind === "article");
    expect(mine.length).toBe(2); // still two — updated, not duplicated
  });
});
