"use strict";

import { describe, it, expect } from "vitest";

const { WeReadAdapter } = require("../../lib/adapters/weread");
const { WeReadApiClient } = require("../../lib/adapters/weread/api-client");
const { partitionBatch } = require("../../lib/batch");

// ── stub fetch returning canned WeRead JSON by URL ──────────────────────
function makeFetch(routes) {
  return async (url) => {
    for (const [pat, body] of routes) {
      if (url.includes(pat)) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => body,
        };
      }
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
  };
}

const ROUTES = [
  ["/user/notebooks", { books: [{ bookId: "b1", book: { title: "人类简史", author: "赫拉利", cover: "c" }, noteCount: 2, reviewCount: 1 }] }],
  ["/book/bookmarklist", { updated: [{ bookmarkId: "m1", bookId: "b1", markText: "认知革命", chapterTitle: "第一章", createTime: 1700000000 }] }],
  ["/review/list", { reviews: [{ review: { reviewId: "r1", bookId: "b1", content: "很有启发", chapterTitle: "第一章", createTime: 1700000100 } }] }],
];

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("WeReadApiClient (cookie HTTP, stub fetch)", () => {
  it("parses notebooks / bookmarks / reviews defensively", async () => {
    const c = new WeReadApiClient({ cookie: "wr_skey=x", fetch: makeFetch(ROUTES) });
    const books = await c.getNotebooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("人类简史");
    const marks = await c.getBookmarks("b1");
    expect(marks[0].markText).toBe("认知革命");
    const reviews = await c.getReviews("b1");
    expect(reviews[0].content).toBe("很有启发");
  });

  it("requires a cookie", () => {
    expect(() => new WeReadApiClient({})).toThrow(/cookie/);
  });

  it("degrades a failing endpoint to empty (no throw)", async () => {
    const c = new WeReadApiClient({
      cookie: "x",
      fetch: async () => { throw new Error("network down"); },
    });
    expect(await c.getNotebooks()).toEqual([]);
    expect(c.lastErrorCode).toBeTruthy();
  });
});

describe("WeReadAdapter — cookie mode", () => {
  it("readinessOnly without cookie → INVALID_COOKIE (credential)", async () => {
    const r = await new WeReadAdapter().authenticate({ readinessOnly: true });
    expect(r.reason).toBe("INVALID_COOKIE");
  });

  it("readinessOnly with cookie → configured", async () => {
    const r = await new WeReadAdapter({ cookie: "x" }).authenticate({ readinessOnly: true });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("configured");
  });

  it("fetches book + highlight + review and normalizes to a valid batch", async () => {
    const a = new WeReadAdapter();
    const raws = await collect(a.sync({ cookie: "wr_skey=x", fetch: makeFetch(ROUTES) }));
    expect(raws.map((r) => r.kind)).toEqual(["book", "highlight", "review"]);
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(3); // book(browse) + highlight(other) + review(post)
    expect(valid.items).toHaveLength(1); // the book
    expect(valid.events.find((e) => e.subtype === "browse").content.title).toContain("人类简史");
    expect(valid.events.find((e) => e.subtype === "post").content.text).toBe("很有启发");
  });

  it("includeNotes:false yields only book events", async () => {
    const a = new WeReadAdapter();
    const raws = await collect(a.sync({ cookie: "x", fetch: makeFetch(ROUTES), includeNotes: false }));
    expect(raws.map((r) => r.kind)).toEqual(["book"]);
  });
});

describe("WeReadAdapter — snapshot mode", () => {
  const SNAP = {
    schemaVersion: 1,
    snapshottedAt: 1700000000000,
    events: [
      { kind: "book", id: "b1", bookId: "b1", title: "三体", author: "刘慈欣" },
      { kind: "highlight", id: "m1", bookId: "b1", bookTitle: "三体", markText: "不要回答", createTime: 1700000001 },
    ],
  };
  function snapAdapter(snap = SNAP, { exists = true } = {}) {
    const a = new WeReadAdapter();
    a._deps.fs = { existsSync: () => exists, readFileSync: () => JSON.stringify(snap), accessSync: () => {}, constants: { R_OK: 4 } };
    return a;
  }

  it("ingests snapshot events", async () => {
    const raws = await collect(snapAdapter().sync({ inputPath: "/x" }));
    expect(raws.map((r) => r.kind)).toEqual(["book", "highlight"]);
  });

  it("schemaVersion mismatch throws", async () => {
    await expect(collect(snapAdapter({ schemaVersion: 9, events: [] }).sync({ inputPath: "/x" }))).rejects.toThrow(/schemaVersion/);
  });
});
