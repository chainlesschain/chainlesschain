"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const g = require("../../lib/adapters/gov-12123");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-12123-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "GAB_SSO=abc";

describe("gov-12123", () => {
  it("name + mappers (chinese-field aliases)", () => {
    expect(g.NAME).toBe("gov-12123");
    const v = g.mapViolation({ wzbh: "V1", wfsj: 1716383000, wfdz: "环岛路", wfxw: "超速50%以下", fkje: "200", wfjfs: "3" });
    expect(v).toMatchObject({ violationId: "V1", location: "环岛路", reason: "超速50%以下" });
    expect(v.fine).toBe(200);
    expect(v.points).toBe(3);
    expect(g.mapViolation({ wfxw: "x" })).toBe(null);
    const l = g.mapLicense({ dabh: "L1", zt: "正常", ljjf: 3, yxqz: 1900000000 });
    expect(l).toMatchObject({ licenseId: "L1", status: "正常", cumulativePoints: 3 });
    expect(g.mapLicense({ zt: "x" })).toBe(null);
  });
  it("extractLicense wraps single object", () => {
    expect(g.extractLicense({ data: { dabh: "L1" } })).toHaveLength(1);
    expect(g.extractLicense({ licenseId: "L2" })).toHaveLength(1);
    expect(g.extractLicense({ list: [{ dabh: "L3" }] })).toHaveLength(1);
  });

  it("snapshot → violation + license OTHER events", async () => {
    const SNAP = JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1716383000000,
      account: { userId: "u1" },
      events: [
        { kind: "violation", id: "v-V1", violationId: "V1", time: 1716383000, location: "环岛路", reason: "超速", fine: 200, points: 3 },
        { kind: "license", id: "l-L1", licenseId: "L1", status: "正常", cumulativePoints: 3, validUntil: 1900000000 },
      ],
    });
    const p = writeTmp(SNAP);
    try {
      const a = new g.Tmri12123Adapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(2);
      const v = a.normalize(items[0]);
      expect(v.events[0].subtype).toBe("other");
      expect(v.events[0].content.title).toContain("交通违章");
      expect(v.events[0].extra.fine).toBe(200);
      expect(v.events[0].extra.points).toBe(3);
      expect(items[0].originalId).toBe("12123:violation:V1");
      const l = a.normalize(items[1]);
      expect(l.events[0].content.title).toContain("驾驶证状态");
      expect(l.events[0].extra.cumulativePoints).toBe(3);
      expect(items[1].originalId).toBe("12123:license:L1");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: paginated violations + single license + unverified", async () => {
    const a = new g.Tmri12123Adapter({
      account: { cookies: COOKIES, userId: "u1" },
      violationUrl: "https://fj.122.gov.cn/app/captured/violation",
      licenseUrl: "https://fj.122.gov.cn/app/captured/license",
      fetchFn: async ({ url, query }) => {
        if (url.includes("/violation")) return query.page > 1 ? { list: [] } : { list: [{ wzbh: "V9", wfsj: 1716383000, wfxw: "闯红灯", fkje: 200, wfjfs: 6 }] };
        return { data: { dabh: "L9", zt: "正常", ljjf: 6 } };
      },
    });
    expect(await a.authenticate()).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.originalId).sort()).toEqual(["12123:license:L9", "12123:violation:V9"]);
  });

  it("province base host (verified .122.gov.cn/app); override + default", () => {
    // default province bj
    const a = new g.Tmri12123Adapter({ province: "fj" });
    expect(a.province).toBe("fj");
    expect(a._urls.violation).toBe(null);
    expect(a._urls.license).toBe(null);
    // bad province → default bj
    expect(new g.Tmri12123Adapter({ province: "XX" }).province).toBe("bj");
    // explicit url override still wins
    expect(new g.Tmri12123Adapter({ violationUrl: "https://x/y" })._urls.violation).toBe("https://x/y");
  });

  it("high sensitivity + legalGate; default fetch / no input throw", async () => {
    expect(new g.Tmri12123Adapter().dataDisclosure.sensitivity).toBe("high");
    expect(new g.Tmri12123Adapter().dataDisclosure.legalGate).toBe(true);
    const unverified = new g.Tmri12123Adapter({ account: { cookies: COOKIES } });
    expect(await unverified.authenticate()).toMatchObject({ ok: false, reason: "EXPLICIT_ENDPOINT_REQUIRED" });
    await expect(collect(unverified.sync({}))).rejects.toThrow(/explicit violationUrl/);
    await expect(collect(new g.Tmri12123Adapter().sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
