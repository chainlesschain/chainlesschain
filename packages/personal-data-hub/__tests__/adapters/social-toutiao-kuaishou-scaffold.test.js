/**
 * §A8 v0.2 — Toutiao 今日头条 + Kuaishou 快手 sqlite-mode tests.
 *
 * Originally Phase 13.8+13.9 v0.1 scaffold tests; promoted in §A8 v0.2 to
 * cover the dual-mode (snapshot + sqlite) adapter. Snapshot-mode coverage
 * lives in `../social-{toutiao,kuaishou}-snapshot.test.js`; this file
 * focuses on the legacy sqlite/device-pull path that desktop wiring still
 * uses for PCs running AndroidExtractor.
 *
 *   - Adapter contract conformance (assertAdapter ok)
 *   - sync() yields raw rows per `kind` from mocked SQLite driver
 *   - normalize() produces valid UnifiedSchema events with correct subtype
 *   - Account validation lazy-checked at sync() time (v0.2 changed:
 *     account.uid is now OPTIONAL at construction so snapshot-mode-only
 *     callers can omit it).
 */

"use strict";

import { describe, it, expect } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { ToutiaoAdapter, KuaishouAdapter } = require("../../lib");
const { assertAdapter } = require("../../lib/adapter-spec");
const { validateBatch } = require("../../lib/batch");

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

function withFakeDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-scaffold-"));
  const dbPath = path.join(dir, "fake.db");
  fs.writeFileSync(dbPath, "fake");
  return fn(dbPath);
}

// ─── ToutiaoAdapter ─────────────────────────────────────────────────────

describe("ToutiaoAdapter — §A8 v0.2 sqlite mode", () => {
  it("contract conformance + sensitivity high (news reading reveals political/medical interest)", () => {
    const a = new ToutiaoAdapter({ account: { uid: "u-1" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.name).toBe("social-toutiao");
    expect(a.extractMode).toBe("device-pull");
    expect(a.dataDisclosure.sensitivity).toBe("high");
    // v0.2 dual-mode capabilities — adapter accepts both snapshot and sqlite.
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:sqlite");
  });

  it("v0.2: account OPTIONAL at construction (snapshot mode is stateless)", () => {
    // Used to throw in v0.1 — now legal. Sqlite-mode sync() will lazy-throw.
    expect(() => new ToutiaoAdapter()).not.toThrow();
    expect(() => new ToutiaoAdapter({})).not.toThrow();
    expect(() => new ToutiaoAdapter({ account: {} })).not.toThrow();
  });

  it("sqlite mode lazy-throws when account.uid missing at sync time", async () => {
    const a = new ToutiaoAdapter({ dbPath: "/no/such/path.db" });
    let threw = null;
    try {
      for await (const _r of a.sync()) {
        /* drain */
      }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/account\.uid required/);
  });

  it("sync yields read + collection + search raws via mocked driver", async () => {
    await withFakeDb(async (dbPath) => {
      const driver = makeMockDriver([
        [
          "FROM read_history",
          [
            { id: 1, item_id: "i-1", title: "新闻 A", read_time: 1700000000, category: "tech" },
            { id: 2, item_id: "i-2", title: "新闻 B", read_time: 1700000010, category: "finance" },
          ],
        ],
        [
          "FROM collection_article",
          [{ id: 1, item_id: "i-3", article_title: "深度长文", save_time: 1700001000 }],
        ],
        [
          "FROM search_history",
          [{ id: 1, keyword: "Rust 语言", search_time: 1700002000 }],
        ],
      ]);
      const a = new ToutiaoAdapter({
        account: { uid: "u-1" },
        dbPath,
        dbDriverFactory: () => driver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(4);
      expect(raws.filter((r) => r.payload.kind === "read")).toHaveLength(2);
      expect(raws.filter((r) => r.payload.kind === "collection")).toHaveLength(1);
      expect(raws.filter((r) => r.payload.kind === "search")).toHaveLength(1);
    });
  });

  it("normalize maps read → browse / collection → like / search → post (all subtypes valid)", async () => {
    const a = new ToutiaoAdapter({ account: { uid: "u-1" } });
    const samples = [
      {
        kind: "read",
        row: { id: 1, item_id: "i-1", title: "T1", read_time: 1700000000, category: "tech" },
        expectedSubtype: "browse",
      },
      {
        kind: "collection",
        row: { id: 1, item_id: "i-2", article_title: "T2", save_time: 1700001000 },
        expectedSubtype: "like",
      },
      {
        kind: "search",
        row: { id: 1, keyword: "Rust", search_time: 1700002000 },
        expectedSubtype: "post",
      },
    ];
    for (const s of samples) {
      const batch = a.normalize({
        adapter: "social-toutiao",
        originalId: `${s.kind}-${s.row.id}`,
        capturedAt: Date.now(),
        payload: { row: s.row, kind: s.kind },
      });
      const v = validateBatch(batch);
      expect(v.valid).toBe(true);
      expect(batch.events[0].subtype).toBe(s.expectedSubtype);
      expect(batch.events[0].source.adapter).toBe("social-toutiao");
    }
  });

  it("normalize throws on missing payload row + no snapshot fields (validator-friendly)", () => {
    const a = new ToutiaoAdapter({ account: { uid: "u-1" } });
    // v0.2: row-missing check moved into per-kind normalizers (snapshot
    // payloads have no `row` but carry fields directly).
    expect(() => a.normalize({ payload: { kind: "read" } })).toThrow(/row missing/);
  });

  it("search keyword preserved verbatim in content.title + extra.keyword", () => {
    const a = new ToutiaoAdapter({ account: { uid: "u-1" } });
    const batch = a.normalize({
      adapter: "social-toutiao",
      originalId: "search-1",
      capturedAt: 1700002000_000,
      payload: { row: { id: 1, keyword: "新冠 后遗症", search_time: 1700002000 }, kind: "search" },
    });
    expect(batch.events[0].content.title).toBe("新冠 后遗症");
    expect(batch.events[0].extra.kind).toBe("search");
    expect(batch.events[0].extra.keyword).toBe("新冠 后遗症");
  });

  it("sync gracefully exits when dbPath missing", async () => {
    const a = new ToutiaoAdapter({ account: { uid: "u-1" }, dbPath: "/no/such/path.db" });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toEqual([]);
  });
});

// ─── KuaishouAdapter ────────────────────────────────────────────────────

describe("KuaishouAdapter — §A8 v0.2 sqlite mode", () => {
  it("contract conformance + sensitivity medium (entertainment preference)", () => {
    const a = new KuaishouAdapter({ account: { uid: "u-2" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.name).toBe("social-kuaishou");
    expect(a.extractMode).toBe("device-pull");
    expect(a.dataDisclosure.sensitivity).toBe("medium");
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:sqlite");
  });

  it("v0.2: account OPTIONAL at construction (snapshot mode is stateless)", () => {
    expect(() => new KuaishouAdapter()).not.toThrow();
    expect(() => new KuaishouAdapter({})).not.toThrow();
    expect(() => new KuaishouAdapter({ account: {} })).not.toThrow();
  });

  it("sqlite mode lazy-throws when account.uid missing at sync time", async () => {
    const a = new KuaishouAdapter({ dbPath: "/no/such/path.db" });
    let threw = null;
    try {
      for await (const _r of a.sync()) {
        /* drain */
      }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/account\.uid required/);
  });

  it("sync yields watch + collect + search raws via mocked driver", async () => {
    await withFakeDb(async (dbPath) => {
      const driver = makeMockDriver([
        [
          "FROM photo_history",
          [
            {
              id: 1,
              photo_id: "p-1",
              caption: "搞笑视频",
              view_time: 1700000000,
              duration: 30,
              author_name: "UpA",
            },
          ],
        ],
        [
          "FROM user_collect",
          [{ id: 1, photo_id: "p-2", caption: "美食 vlog", collect_time: 1700001000 }],
        ],
        [
          "FROM search_record",
          [{ id: 1, keyword: "广场舞", search_time: 1700002000 }],
        ],
      ]);
      const a = new KuaishouAdapter({
        account: { uid: "u-2" },
        dbPath,
        dbDriverFactory: () => driver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(3);
      expect(raws.filter((r) => r.payload.kind === "watch")).toHaveLength(1);
      expect(raws.filter((r) => r.payload.kind === "collect")).toHaveLength(1);
      expect(raws.filter((r) => r.payload.kind === "search")).toHaveLength(1);
    });
  });

  it("normalize maps watch → browse / collect → like / search → post (all subtypes valid)", () => {
    const a = new KuaishouAdapter({ account: { uid: "u-2" } });
    const samples = [
      {
        kind: "watch",
        row: { id: 1, photo_id: "p-1", caption: "C1", view_time: 1700000000, duration: 30 },
        expectedSubtype: "browse",
      },
      {
        kind: "collect",
        row: { id: 1, photo_id: "p-2", caption: "C2", collect_time: 1700001000 },
        expectedSubtype: "like",
      },
      {
        kind: "search",
        row: { id: 1, keyword: "广场舞", search_time: 1700002000 },
        expectedSubtype: "post",
      },
    ];
    for (const s of samples) {
      const batch = a.normalize({
        adapter: "social-kuaishou",
        originalId: `${s.kind}-${s.row.id}`,
        capturedAt: Date.now(),
        payload: { row: s.row, kind: s.kind },
      });
      const v = validateBatch(batch);
      expect(v.valid).toBe(true);
      expect(batch.events[0].subtype).toBe(s.expectedSubtype);
      expect(batch.events[0].source.adapter).toBe("social-kuaishou");
    }
  });

  it("watch event extra carries photoId + duration + authorName", () => {
    const a = new KuaishouAdapter({ account: { uid: "u-2" } });
    const batch = a.normalize({
      adapter: "social-kuaishou",
      originalId: "watch-1",
      capturedAt: 1700000000_000,
      payload: {
        row: {
          id: 1,
          photo_id: "p-1",
          caption: "美食",
          view_time: 1700000000,
          duration: 60,
          author_name: "FoodVlogger",
        },
        kind: "watch",
      },
    });
    expect(batch.events[0].extra.photoId).toBe("p-1");
    expect(batch.events[0].extra.duration).toBe(60);
    expect(batch.events[0].extra.authorName).toBe("FoodVlogger");
  });
});
