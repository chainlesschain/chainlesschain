"use strict";

import { describe, it, expect } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
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
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
    };
  };
}

const ROUTES = [
  [
    "/user/notebooks",
    {
      books: [
        {
          bookId: "b1",
          book: { title: "人类简史", author: "赫拉利", cover: "c" },
          noteCount: 2,
          reviewCount: 1,
        },
      ],
    },
  ],
  [
    "/book/bookmarklist",
    {
      updated: [
        {
          bookmarkId: "m1",
          bookId: "b1",
          markText: "认知革命",
          chapterTitle: "第一章",
          createTime: 1700000000,
        },
      ],
    },
  ],
  [
    "/review/list",
    {
      reviews: [
        {
          review: {
            reviewId: "r1",
            bookId: "b1",
            content: "很有启发",
            chapterTitle: "第一章",
            createTime: 1700000100,
          },
        },
      ],
    },
  ],
];

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("WeReadApiClient (cookie HTTP, stub fetch)", () => {
  it("parses notebooks / bookmarks / reviews defensively", async () => {
    const c = new WeReadApiClient({
      cookie: "wr_skey=x",
      fetch: makeFetch(ROUTES),
    });
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
      fetch: async () => {
        throw new Error("network down");
      },
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
    const r = await new WeReadAdapter({ cookie: "x" }).authenticate({
      readinessOnly: true,
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("configured");
  });

  it("fetches book + highlight + review and normalizes to a valid batch", async () => {
    const a = new WeReadAdapter();
    const raws = await collect(
      a.sync({ cookie: "wr_skey=x", fetch: makeFetch(ROUTES) }),
    );
    expect(raws.map((r) => r.kind)).toEqual(["book", "highlight", "review"]);
    const merged = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(3); // book(browse) + highlight(other) + review(post)
    expect(valid.items).toHaveLength(1); // the book
    expect(
      valid.events.find((e) => e.subtype === "browse").content.title,
    ).toContain("人类简史");
    expect(valid.events.find((e) => e.subtype === "post").content.text).toBe(
      "很有启发",
    );
  });

  it("includeNotes:false yields only book events", async () => {
    const a = new WeReadAdapter();
    const raws = await collect(
      a.sync({ cookie: "x", fetch: makeFetch(ROUTES), includeNotes: false }),
    );
    expect(raws.map((r) => r.kind)).toEqual(["book"]);
  });
});

describe("WeReadAdapter — snapshot mode", () => {
  const SNAP = {
    schemaVersion: 1,
    snapshottedAt: 1700000000000,
    events: [
      { kind: "book", id: "b1", bookId: "b1", title: "三体", author: "刘慈欣" },
      {
        kind: "highlight",
        id: "m1",
        bookId: "b1",
        bookTitle: "三体",
        markText: "不要回答",
        createTime: 1700000001,
      },
    ],
  };
  function writeSnapshot(snapshot) {
    const p = path.join(os.tmpdir(), `cc-weread-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      p,
      typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot),
      "utf8",
    );
    return p;
  }

  it("ingests snapshot events", async () => {
    const p = writeSnapshot(SNAP);
    try {
      const raws = await collect(new WeReadAdapter().sync({ inputPath: p }));
      expect(raws.map((r) => r.kind)).toEqual(["book", "highlight"]);
      expect(raws.map((r) => r.originalId)).toEqual([
        "weread:book:b1",
        "weread:highlight:m1",
      ]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("schemaVersion mismatch throws", async () => {
    const p = writeSnapshot({ schemaVersion: 9, events: [] });
    try {
      await expect(
        collect(new WeReadAdapter().sync({ inputPath: p })),
      ).rejects.toThrow(/schemaVersion/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("fails closed for malformed, invalid-shape, unknown-kind, oversized, and id-less snapshots", async () => {
    const paths = [
      writeSnapshot("{"),
      writeSnapshot({ schemaVersion: 1, events: {} }),
      writeSnapshot({
        schemaVersion: 1,
        events: [{ kind: "unknown", id: "x" }],
      }),
      writeSnapshot({ schemaVersion: 1, events: [] }),
      writeSnapshot({
        schemaVersion: 1,
        events: [{ kind: "book", title: "no stable source id" }],
      }),
    ];
    try {
      const a = new WeReadAdapter();
      expect(await a.authenticate({ inputPath: paths[0] })).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_JSON_INVALID",
      });
      await expect(
        collect(a.sync({ inputPath: paths[0] })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_JSON_INVALID" });

      expect(await a.authenticate({ inputPath: paths[1] })).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SHAPE_INVALID",
      });
      await expect(
        collect(a.sync({ inputPath: paths[2] })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_SHAPE_INVALID" });

      expect(
        await a.authenticate({
          inputPath: paths[3],
          maxSnapshotBytes: 8,
        }),
      ).toMatchObject({ ok: false, reason: "SNAPSHOT_TOO_LARGE" });
      await expect(
        collect(
          a.sync({
            inputPath: paths[3],
            maxSnapshotBytes: 8,
          }),
        ),
      ).rejects.toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });

      await expect(collect(a.sync({ inputPath: paths[4] }))).rejects.toThrow(
        /requires a stable id/,
      );
    } finally {
      for (const p of paths) fs.unlinkSync(p);
    }
  });
});
