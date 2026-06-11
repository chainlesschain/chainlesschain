/**
 * Douyin aweme-detail title resolver tests (real-device-driven 2026-06-11:
 * web detail endpoint returns aweme_detail{desc,author,duration} with no signing).
 * fetch injected — no network.
 */
"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  AwemeDetailClient,
} = require("../../lib/adapters/social-douyin-adb/aweme-detail-client");
const {
  collectWatchHistory,
} = require("../../lib/adapters/social-douyin-adb/collector");
const { DouyinAdapter } = require("../../lib/adapters/social-douyin");
const { partitionBatch } = require("../../lib/batch");

function makeFetch(byAid) {
  return async (url) => {
    const m = /aweme_id=(\d+)/.exec(url);
    const aid = m && m[1];
    const payload = byAid[aid];
    if (payload === undefined) return { ok: false, status: 404, text: async () => "nf" };
    return {
      ok: payload.status ? payload.status >= 200 && payload.status < 300 : true,
      status: payload.status || 200,
      text: async () => (typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body)),
    };
  };
}
const noSleep = () => Promise.resolve();

describe("AwemeDetailClient.fetchDetail", () => {
  it("parses aweme_detail → {desc, author, durationMs, createTime}; sends aweme_id + webapp params", async () => {
    let seenUrl;
    const fetch = async (url) => {
      seenUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({
        status_code: 0,
        aweme_detail: { desc: "洋气婆婆和她的土狗儿媳", author: { nickname: "任集" }, duration: 9200, create_time: 1780112750 },
      }) };
    };
    const c = new AwemeDetailClient({ fetch, sleep: noSleep });
    const d = await c.fetchDetail("7645526043227334246");
    expect(d).toEqual({ awemeId: "7645526043227334246", desc: "洋气婆婆和她的土狗儿媳", author: "任集", durationMs: 9200, createTime: 1780112750 });
    expect(seenUrl).toContain("aweme_id=7645526043227334246");
    expect(seenUrl).toContain("device_platform=webapp");
    expect(seenUrl).toContain("aid=6383");
  });

  it("status_code != 0 → null + lastError", async () => {
    const fetch = makeFetch({ 1: { body: { status_code: 8, status_msg: "risk" } } });
    const c = new AwemeDetailClient({ fetch, sleep: noSleep });
    expect(await c.fetchDetail("1")).toBe(null);
    expect(c.lastErrorCode).toBe(8);
  });

  it("missing aweme_detail (deleted/private) → null -5", async () => {
    const fetch = makeFetch({ 1: { body: { status_code: 0 } } });
    const c = new AwemeDetailClient({ fetch, sleep: noSleep });
    expect(await c.fetchDetail("1")).toBe(null);
    expect(c.lastErrorCode).toBe(-5);
  });

  it("HTTP non-2xx → null with status", async () => {
    const fetch = makeFetch({ 1: { status: 444, body: "blocked" } });
    const c = new AwemeDetailClient({ fetch, sleep: noSleep });
    expect(await c.fetchDetail("1")).toBe(null);
    expect(c.lastErrorCode).toBe(444);
  });
});

describe("AwemeDetailClient.resolveMany", () => {
  it("dedups ids, caps at limit, skips per-id failures", async () => {
    const calls = [];
    const fetch = async (url) => {
      const aid = /aweme_id=(\d+)/.exec(url)[1];
      calls.push(aid);
      const ok = { 11: true, 22: true }[aid];
      return { ok: true, status: 200, text: async () => JSON.stringify(
        ok ? { status_code: 0, aweme_detail: { desc: "d" + aid, author: { nickname: "a" } } }
           : { status_code: 0 }, // 33 → no aweme_detail → skipped
      ) };
    };
    const c = new AwemeDetailClient({ fetch, sleep: noSleep });
    const map = await c.resolveMany(["11", "11", "22", "33"], { limit: 10 });
    expect(calls).toEqual(["11", "22", "33"]); // deduped (one 11)
    expect([...map.keys()].sort()).toEqual(["11", "22"]); // 33 skipped
    expect(map.get("11").desc).toBe("d11");
  });

  it("respects limit (stops early)", async () => {
    const calls = [];
    const fetch = async (url) => {
      calls.push(/aweme_id=(\d+)/.exec(url)[1]);
      return { ok: true, status: 200, text: async () => JSON.stringify({ status_code: 0, aweme_detail: { desc: "x" } }) };
    };
    const c = new AwemeDetailClient({ fetch, sleep: noSleep });
    await c.resolveMany(["1", "2", "3", "4", "5"], { limit: 2 });
    expect(calls).toEqual(["1", "2"]);
  });
});

describe("collectWatchHistory --resolve-titles integration", () => {
  it("attaches title/author/duration → normalizeHistory shows real content", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const bridge = {
      invoke: vi.fn(async (m) =>
        m === "douyin.watch-history"
          ? {
              uid: "92585448288",
              records: [
                { awemeId: "7645526043227334246", capturedAt: 1780112750000, enterFrom: "homepage_hot" },
              ],
            }
          : (() => { throw new Error("unknown " + m); })(),
      ),
    };
    const detailClient = new AwemeDetailClient({
      sleep: () => Promise.resolve(),
      fetch: makeFetch({
        "7645526043227334246": { body: { status_code: 0, aweme_detail: { desc: "洋气婆婆和她的土狗儿媳", author: { nickname: "任集" }, duration: 9200 } } },
      }),
    });
    const r = await collectWatchHistory(bridge, {
      stagingDir: os.tmpdir(),
      now: () => 1781000000000,
      resolveTitles: true,
      _detailClient: detailClient,
    });
    expect(r.titlesResolved).toBe(1);
    const snap = JSON.parse(fs.readFileSync(r.snapshotPath, "utf-8"));
    try {
      expect(snap.events[0].title).toBe("洋气婆婆和她的土狗儿媳");
      const a = new DouyinAdapter();
      const batch = a.normalize({
        adapter: "social-douyin",
        kind: "history",
        originalId: "douyin:history:1",
        capturedAt: 1780112750000,
        payload: { ...snap.events[0], account: snap.account },
      });
      expect(partitionBatch(batch).invalidReasons).toHaveLength(0);
      expect(batch.events[0].content.title).toBe("洋气婆婆和她的土狗儿媳");
      expect(batch.events[0].extra.author).toBe("任集");
      expect(batch.events[0].extra.duration).toBe(9200);
      expect(batch.events[0].extra.enterFrom).toBe("homepage_hot");
    } finally {
      fs.unlinkSync(r.snapshotPath);
    }
  });

  it("without resolveTitles, no network + title stays unresolved", async () => {
    const os = require("node:os");
    const fs = require("node:fs");
    const bridge = { invoke: vi.fn(async () => ({ uid: "1", records: [{ awemeId: "999", capturedAt: 1, enterFrom: "x" }] })) };
    const r = await collectWatchHistory(bridge, { stagingDir: os.tmpdir(), now: () => 1, resolveTitles: false });
    expect(r.titlesResolved).toBe(0);
    const snap = JSON.parse(fs.readFileSync(r.snapshotPath, "utf-8"));
    fs.unlinkSync(r.snapshotPath);
    expect(snap.events[0].title).toBeUndefined();
  });
});
