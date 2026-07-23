"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const jr = require("../../lib/adapters/fitness-joyrun");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-jr-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "joyrun_sid=abc";

describe("fitness-joyrun", () => {
  it("name + mapRun (meter wins; km*1000 fallback; no id → null)", () => {
    expect(jr.NAME).toBe("fitness-joyrun");
    const r = jr.mapRun({ fid: "R1", starttime: 1716383000, meter: 5230, second: 1800, pace: 344, dohas: 320, stepcount: 6400 });
    expect(r).toMatchObject({ runId: "R1", distanceMeters: 5230, durationSec: 1800, paceSecPerKm: 344, calories: 320, steps: 6400 });
    expect(r.timeMs).toBe(1716383000000);
    // distance given as km (5.23) with no meter field → *1000
    expect(jr.mapRun({ id: "R2", distance: 5.23 }).distanceMeters).toBeCloseTo(5230, 0);
    expect(jr.mapRun({ meter: 100 })).toBe(null);
  });
  it("extractList tolerant", () => {
    expect(jr.extractList({ data: { runs: [{ fid: 1 }] } })).toHaveLength(1);
    expect(jr.extractList({ list: [{ fid: 1 }] })).toHaveLength(1);
    expect(jr.extractList({})).toEqual([]);
  });

  it("snapshot → OTHER event with km title + run extras", async () => {
    const SNAP = JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1716383000000,
      account: { userId: "u1" },
      events: [{ kind: "run", id: "r-R1", runId: "R1", time: 1716383000, distanceMeters: 5230, durationSec: 1800, paceSecPerKm: 344, calories: 320 }],
    });
    const p = writeTmp(SNAP);
    try {
      const a = new jr.JoyrunAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      const b = a.normalize(items[0]);
      expect(b.events[0].subtype).toBe("other");
      expect(b.events[0].content.title).toBe("跑步 5.23 km");
      expect(b.events[0].extra.distanceMeters).toBe(5230);
      expect(b.events[0].extra.calories).toBe(320);
      expect(items[0].originalId).toBe("joyrun:run:R1");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: unverified flag + sign seam + paginate", async () => {
    let signed = 0;
    const a = new jr.JoyrunAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      listUrl: "https://captured.example/runs",
      signProvider: async () => { signed += 1; return "sig"; },
      fetchFn: async ({ query }) => (query.page > 1 ? { list: [] } : { data: { runs: [{ fid: "R9", starttime: 1716383000, meter: 10000, second: 3600 }] } }),
    });
    expect(await a.authenticate()).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("joyrun:run:R9");
    expect(signed).toBeGreaterThan(0);
  });

  it("medium sensitivity (GPS route); default fetch / no input throw", async () => {
    expect(new jr.JoyrunAdapter().dataDisclosure.sensitivity).toBe("medium");
    expect(new jr.JoyrunAdapter().dataDisclosure.legalGate).toBe(false);
    const unverified = new jr.JoyrunAdapter({ account: { cookies: COOKIES } });
    expect(await unverified.authenticate()).toMatchObject({ ok: false, reason: "EXPLICIT_ENDPOINT_REQUIRED" });
    await expect(collect(unverified.sync({}))).rejects.toThrow(/explicit listUrl/);
    await expect(collect(new jr.JoyrunAdapter().sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
