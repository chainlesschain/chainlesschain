"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const my = require("../../lib/adapters/health-meiyou");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-my-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "myclient_id=abc; sid=xyz";

describe("health-meiyou mappers", () => {
  it("name/version", () => {
    expect(my.NAME).toBe("health-meiyou");
    expect(my.VERSION).toBe("0.1.0");
  });
  it("mapPeriod / mapRecord field aliases; no id → null", () => {
    const p = my.mapPeriod({ record_id: "P1", start_date: 1716383000, end_date: 1716800000, cycle_length: 28, period_length: 5 });
    expect(p).toMatchObject({ recordId: "P1", cycleLength: 28, periodLength: 5 });
    expect(p.startMs).toBe(1716383000000);
    expect(my.mapPeriod({})).toBe(null);
    const r = my.mapRecord({ id: "R1", record_type: "mood", date: 1716383000, value: "开心", remark: "今天不错" });
    expect(r).toMatchObject({ recordId: "R1", recordType: "mood", value: "开心", note: "今天不错" });
    expect(my.mapRecord({ note: "noid" })).toBe(null);
  });
  it("extractList tolerant", () => {
    expect(my.extractList({ list: [{ id: 1 }] })).toHaveLength(1);
    expect(my.extractList({ data: { calendar: [{ id: 1 }] } })).toHaveLength(1);
    expect(my.extractList({})).toEqual([]);
  });
});

describe("MeiyouAdapter (snapshot + cookie-api)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      { kind: "period", id: "p-P1", recordId: "P1", startDate: 1716383000, endDate: 1716800000, cycleLength: 28, periodLength: 5 },
      { kind: "record", id: "r-R1", recordId: "R1", recordType: "mood", date: 1716383000, value: "开心" },
    ],
  });

  it("snapshot sync + normalize → period + record events", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new my.MeiyouAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(2);
      const period = a.normalize(items[0]);
      expect(period.events[0].subtype).toBe("other");
      expect(period.events[0].content.title).toBe("经期记录");
      expect(period.events[0].extra.cycleLength).toBe(28);
      expect(items[0].originalId).toBe("meiyou:period:P1");
      const record = a.normalize(items[1]);
      expect(record.events[0].extra.recordType).toBe("mood");
      expect(record.events[0].extra.value).toBe("开心");
      expect(items[1].originalId).toBe("meiyou:record:R1");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("dataDisclosure: high sensitivity + legalGate (reproductive health)", () => {
    const a = new my.MeiyouAdapter();
    expect(a.dataDisclosure.sensitivity).toBe("high");
    expect(a.dataDisclosure.legalGate).toBe(true);
  });

  it("include filter can exclude a kind", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new my.MeiyouAdapter();
      const items = await collect(a.sync({ inputPath: p, include: { record: false } }));
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe("period");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: best-effort fetch both kinds + unverified flag + sign seam", async () => {
    const calls = [];
    let signed = 0;
    const a = new my.MeiyouAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      signProvider: async () => {
        signed += 1;
        return "sig";
      },
      fetchFn: async ({ url, query }) => {
        calls.push({ url, page: query.page });
        if (query.page > 1) return { list: [] };
        if (url.includes("/period")) return { list: [{ recordId: "P9", startDate: 1716383000, cycleLength: 30 }] };
        return { list: [{ recordId: "R9", recordType: "weight", date: 1716383000, value: 55 }] };
      },
    });
    const auth = await a.authenticate();
    expect(auth).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.originalId).sort()).toEqual(["meiyou:period:P9", "meiyou:record:R9"]);
    expect(signed).toBeGreaterThan(0);
  });

  it("default fetch throws; no input throws", async () => {
    const a = new my.MeiyouAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a.sync({}))).rejects.toThrow(/no fetchFn configured/);
    const b = new my.MeiyouAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
