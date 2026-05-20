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

  it("rejects missing account.uid", () => {
    expect(() => new BilibiliAdapter({})).toThrow();
    expect(() => new BilibiliAdapter({ account: {} })).toThrow(/uid/);
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

  it("idle when DB path missing", async () => {
    const a = new BilibiliAdapter({ account: { uid: "1234" } });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  it("normalize captures bvid/avid/uploader into extra", async () => {
    const a = new BilibiliAdapter({ account: { uid: "1234" } });
    const raw = {
      adapter: "social-bilibili",
      originalId: "history-1",
      capturedAt: 1700000000000,
      payload: {
        kind: "history",
        row: {
          id: 1, bvid: "BV1abc", avid: "1234",
          title: "Test", view_at: 1700000000,
          uploader: "UpA", duration: 300,
        },
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].extra.bvid).toBe("BV1abc");
    expect(batch.events[0].extra.avid).toBe("1234");
    expect(batch.events[0].extra.uploader).toBe("UpA");
    expect(batch.events[0].extra.duration).toBe(300);
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
