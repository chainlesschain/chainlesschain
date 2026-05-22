"use strict";

import { describe, it, expect } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { BilibiliAdapter, WeiboAdapter } = require("../lib");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

function makeMockDriver(scriptedRows) {
  return function () {
    return {
      prepare(sql) {
        return {
          all() {
            for (const [matchSubstr, rows] of scriptedRows) {
              if (sql.includes(matchSubstr)) return rows;
            }
            throw new Error("no such table");
          },
        };
      },
      close() {},
    };
  };
}

// ─── BilibiliAdapter ────────────────────────────────────────────────────

describe("BilibiliAdapter", () => {
  it("contract conformance", () => {
    const a = new BilibiliAdapter({ account: { uid: "1234" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.extractMode).toBe("device-pull");
  });

  it("accepts stateless construction (snapshot mode added in A8)", () => {
    // Before A8: constructor required opts.account.uid. After A8 the adapter
    // is stateless when running snapshot mode (in-APK Android cc reads a JSON
    // produced by the phone). Sqlite mode still needs account.uid but the
    // check moved into _syncViaSqlite where it actually matters.
    expect(() => new BilibiliAdapter({})).not.toThrow();
    expect(() => new BilibiliAdapter({ account: {} })).not.toThrow();
    expect(() => new BilibiliAdapter()).not.toThrow();
  });

  it("sqlite mode rejects missing account.uid at sync time", async () => {
    const a = new BilibiliAdapter({ dbPath: "/tmp/bili.db" });
    // Path-existence check happens before account.uid validation, so we
    // exercise the guard via dbPath=null + account=null which falls to
    // "sync needs inputPath OR dbPath" first. Use a real-looking dbPath
    // with no account to surface the account.uid throw deterministically.
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili-no-acct-"));
    const dbPath = path.join(dir, "bili.db");
    fs.writeFileSync(dbPath, "fake");
    try {
      const b = new BilibiliAdapter({
        dbPath,
        dbDriverFactory: () => () => ({
          prepare: () => ({ all: () => [] }),
          close() {},
        }),
      });
      let threw = null;
      try {
        for await (const _r of b.sync()) { /* drain */ }
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeTruthy();
      expect(String(threw.message)).toMatch(/account\.uid/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sync yields history + favourite records via mocked driver", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili-"));
    const dbPath = path.join(dir, "bili.db");
    fs.writeFileSync(dbPath, "fake");
    try {
      const mockDriver = makeMockDriver([
        ["FROM history", [
          { id: 1, bvid: "BV1abc", title: "趣味视频", view_at: 1700000000, uploader: "UpA" },
          { id: 2, bvid: "BV1xyz", title: "教程", view_at: 1700000010, uploader: "UpB", duration: 300 },
        ]],
        ["FROM bili_favourite", [
          { id: 1, bvid: "BV1fav", title: "收藏A", save_time: 1700001000, folder_name: "学习" },
        ]],
      ]);
      const a = new BilibiliAdapter({
        account: { uid: "1234" },
        dbPath,
        dbDriverFactory: () => mockDriver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(3); // 2 history + 1 favourite
      const histories = raws.filter((r) => r.payload.kind === "history");
      const favs = raws.filter((r) => r.payload.kind === "favourite");
      expect(histories).toHaveLength(2);
      expect(favs).toHaveLength(1);

      // Normalize each
      for (const raw of raws) {
        const batch = a.normalize(raw);
        const v = validateBatch(batch);
        expect(v.valid).toBe(true);
        const subtype = batch.events[0].subtype;
        if (raw.payload.kind === "history") expect(subtype).toBe("browse");
        if (raw.payload.kind === "favourite") expect(subtype).toBe("like");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when neither inputPath nor dbPath provided (A8: surface config errors)", async () => {
    // Before A8: sync silently yielded 0 if dbPath missing — masked typos and
    // misconfigured callers. After A8 we throw so callers see the problem.
    const a = new BilibiliAdapter({ account: { uid: "1234" } });
    let threw = null;
    try {
      for await (const _r of a.sync()) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/inputPath|dbPath/);
  });

  it("normalize captures bvid/avid/uploader into extra (flat payload, A8 shape)", async () => {
    const a = new BilibiliAdapter({ account: { uid: "1234" } });
    const raw = {
      adapter: "social-bilibili",
      kind: "history",
      originalId: "bilibili:history:BV1abc",
      capturedAt: 1700000000000,
      payload: {
        kind: "history",
        title: "Test",
        bvid: "BV1abc",
        avid: "1234",
        uploader: "UpA",
        duration: 300,
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].extra.bvid).toBe("BV1abc");
    expect(batch.events[0].extra.avid).toBe("1234");
    expect(batch.events[0].extra.uploader).toBe("UpA");
    expect(batch.events[0].extra.duration).toBe(300);
    // A8: history also yields an item entity (video) for KG linkage
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].extra.bvid).toBe("BV1abc");
  });
});

// ─── WeiboAdapter ───────────────────────────────────────────────────────

describe("WeiboAdapter", () => {
  it("contract conformance", () => {
    const a = new WeiboAdapter({ account: { uid: "1234" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.extractMode).toBe("device-pull");
  });

  it("rejects missing account.uid", () => {
    expect(() => new WeiboAdapter({})).toThrow();
    expect(() => new WeiboAdapter({ account: {} })).toThrow(/uid/);
  });

  it("sync yields posts + search records via mocked driver", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weibo-"));
    const dbPath = path.join(dir, "weibo.db");
    fs.writeFileSync(dbPath, "fake");
    try {
      const mockDriver = makeMockDriver([
        ["FROM post", [
          { id: 1, mid: "M1", text: "今天天气真好", created_at: 1700000000, reposts_count: 5, comments_count: 3 },
        ]],
        ["FROM status", []],
        ["FROM search_history", [
          { id: 1, keyword: "iPhone", time: 1700001000 },
          { id: 2, keyword: "音乐", time: 1700001100 },
        ]],
      ]);
      const a = new WeiboAdapter({
        account: { uid: "1234" },
        dbPath,
        dbDriverFactory: () => mockDriver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(3); // 1 post + 2 searches

      for (const raw of raws) {
        const batch = a.normalize(raw);
        const v = validateBatch(batch);
        expect(v.valid).toBe(true);
        const subtype = batch.events[0].subtype;
        if (raw.payload.kind === "post") expect(subtype).toBe("post");
        if (raw.payload.kind === "search") expect(subtype).toBe("interaction");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalize captures post metrics", async () => {
    const a = new WeiboAdapter({ account: { uid: "1234" } });
    const raw = {
      adapter: "social-weibo",
      originalId: "post-M1",
      capturedAt: 1700000000000,
      payload: {
        kind: "post",
        row: {
          id: 1, mid: "M1", text: "测试",
          created_at: 1700000000,
          reposts_count: 5, comments_count: 3, attitudes_count: 10,
          location: "上海",
        },
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].extra.weiboMid).toBe("M1");
    expect(batch.events[0].extra.repostsCount).toBe(5);
    expect(batch.events[0].extra.commentsCount).toBe(3);
    expect(batch.events[0].extra.likesCount).toBe(10);
    expect(batch.events[0].extra.location).toBe("上海");
  });

  it("normalize falls back when text is empty", async () => {
    const a = new WeiboAdapter({ account: { uid: "1234" } });
    const raw = {
      adapter: "social-weibo",
      originalId: "post-x",
      capturedAt: Date.now(),
      payload: {
        kind: "post",
        row: { id: 1, mid: "X", text: "", created_at: Math.floor(Date.now() / 1000) },
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].content.title).toBe("(空)");
    expect(validateBatch(batch).valid).toBe(true);
  });
});
