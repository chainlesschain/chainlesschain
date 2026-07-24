"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const fanqie = require("../../lib/adapters/reading-fanqie");
const qimao = require("../../lib/adapters/reading-qimao");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-read-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "novel_sid=abc; uid=1";

describe("reading wrappers identity + mappers", () => {
  it("names", () => {
    expect(fanqie.NAME).toBe("reading-fanqie");
    expect(qimao.NAME).toBe("reading-qimao");
    expect(new fanqie.FanqieReadingAdapter().name).toBe("reading-fanqie");
    expect(new qimao.QimaoReadingAdapter().name).toBe("reading-qimao");
    for (const adapter of [
      new fanqie.FanqieReadingAdapter(),
      new qimao.QimaoReadingAdapter(),
    ]) {
      expect(adapter.watermarkStrategy).toBe("max-captured-at");
      expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    }
  });
  it("low sensitivity, no legalGate", () => {
    for (const A of [
      new fanqie.FanqieReadingAdapter(),
      new qimao.QimaoReadingAdapter(),
    ]) {
      expect(A.dataDisclosure.sensitivity).toBe("low");
      expect(A.dataDisclosure.legalGate).toBe(false);
    }
  });
  it("fanqie mapItem (book_id / book_name / read_progress)", () => {
    const r = fanqie.mapItem({
      book_id: "B1",
      book_name: "诡秘之主",
      author: "爱潜水的乌贼",
      category: "玄幻",
      read_progress: "0.42",
      last_chapter_title: "第100章",
      read_time: 1716383000,
    });
    expect(r).toMatchObject({
      bookId: "B1",
      title: "诡秘之主",
      author: "爱潜水的乌贼",
      category: "玄幻",
      chapter: "第100章",
    });
    expect(r.progress).toBeCloseTo(0.42, 2);
    expect(r.occurredAt).toBe(1716383000000);
    expect(r.url).toContain("fanqienovel.com/page/B1");
    expect(fanqie.mapItem({ book_name: "x" })).toBe(null);
  });
  it("qimao mapItem (book_id / title / read_proportion)", () => {
    const r = qimao.mapItem({
      book_id: "Q1",
      title: "大奉打更人",
      author: "卖报小郎君",
      read_proportion: 0.8,
    });
    expect(r).toMatchObject({
      bookId: "Q1",
      title: "大奉打更人",
      author: "卖报小郎君",
    });
    expect(r.progress).toBeCloseTo(0.8, 2);
    expect(qimao.mapItem({ title: "x" })).toBe(null);
  });
});

describe("FanqieReadingAdapter (snapshot + cookie-api via _reading-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      {
        kind: "read",
        id: "read-B1",
        bookId: "B1",
        title: "诡秘之主",
        author: "乌贼",
        category: "玄幻",
        progress: 0.42,
      },
      {
        kind: "favourite",
        id: "fav-B2",
        bookId: "B2",
        title: "全职高手",
        author: "蝴蝶蓝",
      },
    ],
  });

  it("read → MEDIA event + DOCUMENT item; favourite → LIKE event", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new fanqie.FanqieReadingAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(2);
      const read = a.normalize(items[0]);
      expect(read.events[0].subtype).toBe("media");
      expect(read.events[0].content.title).toContain("读了: 诡秘之主");
      expect(read.items[0].subtype).toBe("document");
      expect(read.items[0].extra.platform).toBe("fanqie");
      expect(read.events[0].extra.progress).toBeCloseTo(0.42, 2);
      expect(items[0].originalId).toBe("fanqie:read:read-B1");
      const fav = a.normalize(items[1]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toContain("收藏: 全职高手");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: read + favourite fetch + sign seam", async () => {
    let signed = 0;
    let watermarkComplete = false;
    const a = new fanqie.FanqieReadingAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      readUrl: "https://captured.example/history",
      favouriteUrl: "https://captured.example/bookshelf",
      signProvider: async () => {
        signed += 1;
        return "sig";
      },
      fetchFn: async ({ url, query }) => {
        if (query.page > 1) return { list: [] };
        if (url.includes("/history"))
          return {
            data: {
              list: [
                { book_id: "B9", book_name: "斗破", read_time: 1716383000 },
              ],
            },
          };
        return { data: { books: [{ book_id: "B8", book_name: "遮天" }] } };
      },
    });
    expect(await a.authenticate()).toEqual({
      ok: true,
      account: "u1",
      mode: "cookie",
    });
    const items = await collect(
      a.sync({
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.originalId).sort()).toEqual([
      "fanqie:favourite:B8",
      "fanqie:read:B9",
    ]);
    expect(signed).toBeGreaterThan(0);
    expect(watermarkComplete).toBe(true);
  });

  it("cookie-api: stops reading history after reaching the prior timestamp", async () => {
    let watermarkComplete = false;
    const a = new fanqie.FanqieReadingAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      readUrl: "https://captured.example/history",
      favouriteUrl: "https://captured.example/bookshelf",
      fetchFn: async () => ({
        data: {
          list: [
            {
              book_id: "OLD",
              book_name: "old book",
              read_time: 1716383000,
            },
          ],
        },
      }),
    });
    const items = await collect(
      a.sync({
        sinceWatermark: 1716383000001,
        include: { favourite: false },
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items).toEqual([]);
    expect(watermarkComplete).toBe(true);
  });

  it("unverified live endpoints / no input throw", async () => {
    const unverified = new fanqie.FanqieReadingAdapter({
      account: { cookies: COOKIES },
    });
    expect(await unverified.authenticate()).toMatchObject({
      ok: false,
      reason: "EXPLICIT_ENDPOINT_REQUIRED",
    });
    await expect(collect(unverified.sync({}))).rejects.toThrow(
      /explicit readUrl/,
    );
    await expect(
      collect(new fanqie.FanqieReadingAdapter().sync({})),
    ).rejects.toThrow(/needs opts.inputPath/);
  });
});
