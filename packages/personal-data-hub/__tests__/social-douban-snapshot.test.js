"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  DoubanAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  extractData,
} = require("../lib/adapters/social-douban");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// 豆瓣 (Douban / Frodo) — 书影音 interest graph. Mirrors social-zhihu's two-mode
// custom-normalize shape + video-base MEDIA event+item for marks. Frodo signing
// is injected (signProvider) so the adapter stays pure-Node.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-douban.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("DoubanAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "douban-snap-"));
  });

  it("exports schema constants", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["interest", "review", "follow"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: Date.now(), events: [] });
    const a = new DoubanAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate() no input → NO_INPUT", async () => {
    const a = new DoubanAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("sync() without input throws with signProvider hint", async () => {
    const a = new DoubanAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/signProvider/);
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 99, snapshottedAt: Date.now(), events: [] });
    const a = new DoubanAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("interest (看过电影) → MEDIA event + MEDIA item, normalizes cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: { userId: "12345", name: "alice" },
      events: [
        {
          kind: "interest", id: "interest-m1", subjectId: "26266893",
          subjectType: "movie", title: "瞬息全宇宙", status: "done",
          myRating: 5, comment: "好看", createdTime: 1700000000, url: "https://movie.douban.com/subject/26266893/",
        },
      ],
    });
    const a = new DoubanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("interest");
    expect(raws[0].originalId).toBe("douban:interest:interest-m1");

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events.length).toBe(1);
    expect(batch.items.length).toBe(1);
    expect(batch.events[0].subtype).toBe("media");
    expect(batch.events[0].content.title).toContain("看过电影: 瞬息全宇宙");
    expect(batch.events[0].extra.myRating).toBe(5);
    expect(batch.items[0].name).toBe("瞬息全宇宙");
    expect(JSON.stringify(batch)).toContain("好看");
  });

  it("interest status maps to verb (mark=想看, doing=在看, done=看过)", async () => {
    const now = Date.now();
    const cases = [
      { status: "mark", verb: "想看" },
      { status: "doing", verb: "在看" },
      { status: "done", verb: "看过" },
    ];
    for (const c of cases) {
      const p = writeSnapshot(tmpDir, {
        schemaVersion: 1, snapshottedAt: now,
        events: [
          { kind: "interest", id: `i-${c.status}`, subjectId: "1", subjectType: "book",
            title: "三体", status: c.status, createdTime: now },
        ],
      });
      const a = new DoubanAdapter();
      const raws = [];
      for await (const r of a.sync({ inputPath: p })) raws.push(r);
      const batch = a.normalize(raws[0]);
      expect(batch.events[0].content.title).toContain(`${c.verb}图书: 三体`);
    }
  });

  it("review → POST event", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [
        { kind: "review", id: "review-1", reviewId: "9001", title: "一篇影评",
          abstract: "<p>写得不错</p>", subjectTitle: "瞬息全宇宙", rating: 4, createdTime: now },
      ],
    });
    const a = new DoubanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("post");
    expect(batch.events[0].content.title).toBe("一篇影评");
    expect(batch.events[0].content.text).toBe("写得不错"); // html stripped
    expect(batch.events[0].extra.rating).toBe(4);
  });

  it("follow → CONTACT person with douban-id identifier", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [
        { kind: "follow", id: "follow-u1", memberId: "67890", name: "豆友小张",
          url: "https://www.douban.com/people/67890/", capturedAt: now },
      ],
    });
    const a = new DoubanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.persons.length).toBe(1);
    expect(batch.persons[0].id).toBe("person-douban-67890");
    expect(batch.persons[0].names).toEqual(["豆友小张"]);
    expect(batch.persons[0].identifiers["douban-id"]).toEqual(["67890"]);
  });

  it("respects per-kind include opt-out + limit", async () => {
    const now = Date.now();
    const events = [
      { kind: "interest", id: "i1", subjectId: "1", subjectType: "movie", title: "a", status: "done", createdTime: now },
      { kind: "review", id: "r1", reviewId: "2", title: "b", createdTime: now },
      { kind: "follow", id: "f1", memberId: "3", name: "c", capturedAt: now },
    ];
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new DoubanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { review: false, follow: false } })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("interest");
  });

  it("filters unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [
        { kind: "interest", id: "i1", subjectId: "1", subjectType: "movie", title: "a", status: "done", createdTime: now },
        { kind: "status", id: "s1" },
      ],
    });
    const a = new DoubanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
  });

  it("advertises snapshot + cookie-api capabilities; passes assertAdapter", () => {
    const a = new DoubanAdapter();
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:cookie-api");
    expect(assertAdapter(a).ok).toBe(true);
  });
});

describe("DoubanAdapter cookie-api mode", () => {
  it("authenticate(cookie) requires account.userId", async () => {
    const a = new DoubanAdapter({ account: { cookies: "bid=ok" } });
    const res = await a.authenticate();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_ACCOUNT_USER_ID");
  });

  it("authenticate(cookie) ok when userId + cookies present", async () => {
    const a = new DoubanAdapter({ account: { userId: "12345", cookies: "bid=ok" } });
    const res = await a.authenticate();
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("cookie");
    expect(res.account).toBe("12345");
  });

  it("fetches interests/reviews/following across the plan and normalizes", async () => {
    const byUrl = (url) => {
      if (url.includes("/interests")) {
        return {
          interests: [
            { id: "int1", status: "done", create_time: "2024-01-02 10:00:00",
              rating: { value: 4 }, comment: "不错",
              subject: { id: "26266893", type: "movie", title: "瞬息全宇宙", url: "u" } },
          ],
          total: 1,
        };
      }
      if (url.includes("/reviews")) {
        return { reviews: [{ id: "rev1", title: "影评", abstract: "好", create_time: "2024-01-03 10:00:00", subject: { title: "瞬息全宇宙" } }], total: 1 };
      }
      if (url.includes("/following")) {
        return { users: [{ id: "u9", name: "豆友" }], total: 1 };
      }
      return { total: 0 };
    };
    const fetchFn = async (opts) => byUrl(opts.url);
    const a = new DoubanAdapter({ account: { userId: "12345", cookies: "bid=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({})) raws.push(r);
    expect(raws.map((r) => r.kind).sort()).toEqual(["follow", "interest", "review"]);

    const interest = raws.find((r) => r.kind === "interest");
    const ib = a.normalize(interest);
    expect(validateBatch(ib).valid).toBe(true);
    expect(ib.events[0].subtype).toBe("media");
    expect(ib.events[0].content.title).toContain("看过电影: 瞬息全宇宙");
    expect(ib.events[0].extra.myRating).toBe(4);
    expect(ib.items[0].name).toBe("瞬息全宇宙");

    const follow = raws.find((r) => r.kind === "follow");
    const fb = a.normalize(follow);
    expect(fb.persons[0].identifiers["douban-id"]).toEqual(["u9"]);
  });

  it("invokes signProvider and passes sign to fetchFn", async () => {
    let seenSign = null;
    const signProvider = async () => "SIG-1";
    const fetchFn = async (opts) => {
      seenSign = opts.sign;
      return { total: 0 };
    };
    const a = new DoubanAdapter({
      account: { userId: "12345", cookies: "bid=ok" },
      fetchFn,
      signProvider,
    });
    for await (const _r of a.sync({ include: { review: false, follow: false } })) { /* drain */ }
    expect(seenSign).toBe("SIG-1");
  });

  it("passes sign: null when no signProvider", async () => {
    let seen = "unset";
    const fetchFn = async (opts) => {
      seen = opts.sign;
      return { total: 0 };
    };
    const a = new DoubanAdapter({ account: { userId: "12345", cookies: "bid=ok" }, fetchFn });
    for await (const _r of a.sync({ include: { review: false, follow: false } })) { /* drain */ }
    expect(seen).toBe(null);
  });

  it("paginates interests with start cursor until total reached", async () => {
    const seenStarts = [];
    const all = Array.from({ length: 25 }, (_, i) => ({
      id: `int${i}`, status: "done", create_time: "2024-01-01 00:00:00",
      subject: { id: String(i), type: "book", title: `书${i}` },
    }));
    const fetchFn = async (opts) => {
      if (!opts.url.includes("/interests")) return { total: 0 };
      const start = opts.query.start;
      seenStarts.push(start);
      return { interests: all.slice(start, start + 20), total: all.length };
    };
    const a = new DoubanAdapter({ account: { userId: "12345", cookies: "bid=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ include: { review: false, follow: false } })) raws.push(r);
    expect(raws.length).toBe(25);
    expect(seenStarts).toEqual([0, 20]);
  });

  it("extractData tolerates Frodo response shapes", () => {
    expect(extractData({ interests: [1] }, "interest")).toEqual([1]);
    expect(extractData({ reviews: [2] }, "review")).toEqual([2]);
    expect(extractData({ users: [3] }, "follow")).toEqual([3]);
    expect(extractData({ items: [4] })).toEqual([4]);
    expect(extractData([5])).toEqual([5]);
    expect(extractData({})).toEqual([]);
    expect(extractData(null)).toEqual([]);
  });

  it("uses opts.*Url overrides", async () => {
    const seen = [];
    const fetchFn = async (opts) => {
      seen.push(opts.url);
      return { total: 0 };
    };
    const a = new DoubanAdapter({
      account: { userId: "12345", cookies: "bid=ok" },
      fetchFn,
      interestsUrl: "https://x/i/{id}",
      reviewsUrl: "https://x/r/{id}",
      followingUrl: "https://x/f/{id}",
    });
    for await (const _r of a.sync({})) { /* drain */ }
    expect(seen).toContain("https://x/i/12345");
    expect(seen).toContain("https://x/r/12345");
    expect(seen).toContain("https://x/f/12345");
  });

  it("default fetchFn throws legible error in cookie mode without injection", async () => {
    const a = new DoubanAdapter({ account: { userId: "12345", cookies: "bid=ok" } });
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(String(threw.message)).toMatch(/no fetchFn configured/);
  });
});
