"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const mb = require("../../lib/adapters/car-mercedesme");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-mb-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "mb_token=abc";

describe("car-mercedesme", () => {
  it("name + tripToRecord (km direct + meters fallback; no id → null)", () => {
    expect(mb.NAME).toBe("car-mercedesme");
    const r = mb.tripToRecord({ tripId: "T1", startTime: 1716383000, endTime: 1716385000, startAddress: "家", endAddress: "公司", distanceKm: 12.4, plate: "京A12345" });
    expect(r).toMatchObject({ vendorId: "mercedesme", recordId: "T1", vehicleType: "car", carrier: "Mercedes me", vehicleNumber: "京A12345" });
    expect(r.from.name).toBe("家");
    expect(r.to.name).toBe("公司");
    expect(r.extras.distanceKm).toBeCloseTo(12.4, 2);
    // meters fallback
    expect(mb.tripToRecord({ tripId: "T2", distanceMeters: 5230 }).extras.distanceKm).toBeCloseTo(5.23, 2);
    expect(mb.tripToRecord({ startAddress: "x" })).toBe(null);
  });
  it("extractTrips tolerant", () => {
    expect(mb.extractTrips({ trips: [{ tripId: 1 }] })).toHaveLength(1);
    expect(mb.extractTrips({ data: { list: [{ tripId: 1 }] } })).toHaveLength(1);
    expect(mb.extractTrips({})).toEqual([]);
  });

  it("snapshot trip → car travel event", async () => {
    const SNAP = JSON.stringify({ trips: [{ tripId: "T1", startTime: 1716383000, endTime: 1716385000, startAddress: "家", endAddress: "公司", distanceKm: 12.4 }] });
    const p = writeTmp(SNAP);
    try {
      const a = new mb.MercedesMeAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0].originalId).toBe("T1");
      const b = a.normalize(items[0]);
      expect(b.events[0].source.adapter).toBe("car-mercedesme");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: unverified + sign seam", async () => {
    let signed = 0;
    const a = new mb.MercedesMeAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      listUrl: "https://captured.example/trips",
      signProvider: async () => { signed += 1; return "sig"; },
      fetchFn: async ({ query }) => (query.page > 1 ? { trips: [] } : { trips: [{ tripId: "T9", startTime: 1716383000, distanceMeters: 8000 }] }),
    });
    expect(await a.authenticate()).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("T9");
    expect(signed).toBeGreaterThan(0);
  });

  it("medium sensitivity; default fetch throws", async () => {
    expect(new mb.MercedesMeAdapter().dataDisclosure.sensitivity).toBe("medium");
    const unverified = new mb.MercedesMeAdapter({ account: { cookies: COOKIES } });
    expect(await unverified.authenticate()).toMatchObject({ ok: false, reason: "EXPLICIT_ENDPOINT_REQUIRED" });
    await expect(collect(unverified.sync({}))).rejects.toThrow(/explicit listUrl/);
  });
});
