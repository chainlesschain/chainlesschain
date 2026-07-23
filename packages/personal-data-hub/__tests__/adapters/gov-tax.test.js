"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const tx = require("../../lib/adapters/gov-tax");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-tax-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "ETAX_SSO=abc; sid=xyz";

describe("gov-tax mappers", () => {
  it("name/version", () => {
    expect(tx.NAME).toBe("gov-tax");
    expect(tx.VERSION).toBe("0.2.0");
  });
  it("periodToMs / toAmount", () => {
    expect(tx.periodToMs("2025-03")).toBe(Date.parse("2025-03-01T00:00:00Z"));
    expect(tx.periodToMs("202503")).toBe(Date.parse("2025-03-01T00:00:00Z"));
    expect(tx.toAmount("¥1,234.56")).toBeCloseTo(1234.56, 2);
    expect(tx.toAmount(2000)).toBe(2000);
    expect(tx.toAmount("abc")).toBe(null);
  });
  it("mapIncome / mapDeclaration field aliases; no id → null", () => {
    const inc = tx.mapIncome({ record_id: "I1", tax_period: "2025-03", income_type: "工资薪金", amount: "20,000", withheldTax: 1234.56, company: "某某公司", companyId: "9144" });
    expect(inc).toMatchObject({ recordId: "I1", incomeType: "工资薪金", payerName: "某某公司", payerId: "9144" });
    expect(inc.amount).toBe(20000);
    expect(inc.withheld).toBeCloseTo(1234.56, 2);
    expect(tx.mapIncome({ amount: 1 })).toBe(null);
    const dec = tx.mapDeclaration({ id: "D1", tax_year: 2024, type: "综合所得年度汇算", status: "已退税", amount: -800 });
    expect(dec).toMatchObject({ recordId: "D1", year: 2024, declType: "综合所得年度汇算", status: "已退税", settleAmount: -800 });
    expect(tx.mapDeclaration({ year: 2024 })).toBe(null);
  });
  it("extractList tolerant", () => {
    expect(tx.extractList({ list: [{ id: 1 }] })).toHaveLength(1);
    expect(tx.extractList({ data: { records: [{ id: 1 }] } })).toHaveLength(1);
    expect(tx.extractList({})).toEqual([]);
  });
});

describe("TaxAdapter (snapshot + cookie-api)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      { kind: "income", id: "inc-I1", recordId: "I1", period: "2025-03", incomeType: "工资薪金", amount: 20000, withheld: 1234.56, payerName: "某某科技有限公司", payerId: "9144ABC" },
      { kind: "declaration", id: "dec-D1", recordId: "D1", year: 2024, declType: "综合所得年度汇算", status: "已退税", settleAmount: -800, declaredAt: 1716383000 },
    ],
  });

  it("income → INCOME event + employer Person(MERCHANT)", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new tx.TaxAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(2);
      const inc = a.normalize(items[0]);
      expect(inc.events[0].subtype).toBe("income");
      expect(inc.events[0].extra.incomeType).toBe("工资薪金");
      expect(inc.events[0].extra.amount).toBe(20000);
      expect(inc.persons).toHaveLength(1);
      expect(inc.persons[0].subtype).toBe("merchant");
      expect(inc.persons[0].names[0]).toBe("某某科技有限公司");
      expect(inc.events[0].extra.payerRef).toBe(inc.persons[0].id);
      expect(items[0].originalId).toBe("tax:income:I1");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("declaration → OTHER event with settleAmount", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new tx.TaxAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      const dec = a.normalize(items[1]);
      expect(dec.events[0].subtype).toBe("other");
      expect(dec.events[0].content.title).toContain("个税申报");
      expect(dec.events[0].extra.settleAmount).toBe(-800);
      expect(dec.events[0].extra.year).toBe(2024);
      expect(items[1].originalId).toBe("tax:declaration:D1");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("dataDisclosure: high sensitivity + legalGate (financial/tax)", () => {
    const a = new tx.TaxAdapter();
    expect(a.dataDisclosure.sensitivity).toBe("high");
    expect(a.dataDisclosure.legalGate).toBe(true);
  });

  it("cookie-api: best-effort both kinds + unverified flag + sign seam", async () => {
    let signed = 0;
    const a = new tx.TaxAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      incomeUrl: "https://captured.example/income",
      declarationUrl: "https://captured.example/declaration",
      signProvider: async () => {
        signed += 1;
        return "sig";
      },
      fetchFn: async ({ url, query }) => {
        if (query.page > 1) return { list: [] };
        if (url.includes("/income")) return { list: [{ recordId: "I9", period: "2025-01", incomeType: "劳务报酬", amount: 5000 }] };
        return { list: [{ recordId: "D9", year: 2024, declType: "年度汇算", settleAmount: 300 }] };
      },
    });
    const auth = await a.authenticate();
    expect(auth).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.originalId).sort()).toEqual(["tax:declaration:D9", "tax:income:I9"]);
    expect(signed).toBeGreaterThan(0);
  });

  it("unverified live endpoints are rejected; no input throws", async () => {
    const a = new tx.TaxAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toMatchObject({ ok: false, reason: "EXPLICIT_ENDPOINT_REQUIRED" });
    await expect(collect(a.sync({}))).rejects.toThrow(/explicit incomeUrl/);
    const b = new tx.TaxAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
