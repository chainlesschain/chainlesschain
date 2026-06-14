"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  DidiAdapter,
  parseRecords,
  orderToRecord,
  extractOrders,
  parseFareYuan,
  NAME,
  VERSION,
} = require("../../lib/adapters/travel-didi");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-didi-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "es_token=abc; ticket=xyz";

const RIDE = {
  orderId: "DD1",
  fromAddress: "公司",
  toAddress: "机场",
  departTime: 1716383021000,
  arriveTime: 1716386021000,
  fare: "58.50",
  productName: "专车",
  passengerName: "张三",
};

describe("constants + parseFareYuan", () => {
  it("exposes name/version", () => {
    expect(NAME).toBe("travel-didi");
    expect(VERSION).toBe("0.1.0");
  });
  it("parseFareYuan: 元 decimal kept; large integer treated as 分", () => {
    expect(parseFareYuan("58.50")).toBe(58.5);
    expect(parseFareYuan(58.5)).toBe(58.5);
    expect(parseFareYuan(5850)).toBe(58.5); // 分
    expect(parseFareYuan(58)).toBe(58); // small int → 元
    expect(parseFareYuan("x")).toBe(0);
  });
});

describe("orderToRecord", () => {
  it("maps a ride → car TravelRecord (from/to name, fare, product)", () => {
    const rec = orderToRecord(RIDE, { capturedVia: "cookie-api" });
    expect(rec).toMatchObject({
      vendorId: "didi",
      recordId: "DD1",
      vehicleType: "car",
      from: { name: "公司" },
      to: { name: "机场" },
      departureMs: 1716383021000,
      arrivalMs: 1716386021000,
      carrier: "滴滴",
      traveler: "张三",
    });
    expect(rec.totalCost).toEqual({ value: 58.5, currency: "CNY" });
    expect(rec.extras.productType).toBe("专车");
    expect(rec.extras.capturedVia).toBe("cookie-api");
  });
  it("snake_case + seconds-epoch aliases; drops id-less", () => {
    const rec = orderToRecord({ oid: "DD2", from_address: "A", to_address: "B", depart_time: 1716383021, total_fee: 5850 });
    expect(rec.recordId).toBe("DD2");
    expect(rec.departureMs).toBe(1716383021000); // seconds → ms
    expect(rec.totalCost.value).toBe(58.5);
    expect(orderToRecord({ from_address: "A" })).toBe(null);
  });
  it("extractOrders tolerant of shapes", () => {
    expect(extractOrders({ orders: [{ orderId: 1 }] })).toHaveLength(1);
    expect(extractOrders({ data: { list: [{ orderId: 1 }] } })).toHaveLength(1);
    expect(extractOrders({})).toEqual([]);
  });
});

describe("DidiAdapter file/snapshot mode", () => {
  it("authenticate ready without account; validates inputPath", async () => {
    const a = new DidiAdapter();
    expect(await a.authenticate({})).toEqual({ ok: true, account: null, mode: "ready" });
    const p = writeTmp("[]");
    try {
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      expect((await a.authenticate({ inputPath: path.join(os.tmpdir(), "nope-dd.json") })).reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync yields ride + normalize end-to-end (car trip)", async () => {
    const p = writeTmp(JSON.stringify([RIDE]));
    try {
      const a = new DidiAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ adapter: NAME, originalId: "DD1" });
      const batch = a.normalize(items[0]);
      expect(batch.events[0].content.title).toBe("car: 公司 → 机场");
      expect(batch.events[0].content.amount).toEqual({ value: 58.5, currency: "CNY", direction: "out" });
      expect(batch.persons.find((x) => x.subtype === "merchant").names).toEqual(["滴滴"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("parseRecords JSONL + {orders} envelope; sync silent when no path", async () => {
    expect(parseRecords(JSON.stringify({ orders: [RIDE] }))).toHaveLength(1);
    const jsonl = `${JSON.stringify(RIDE)}\njunk\n${JSON.stringify({ ...RIDE, orderId: "DD9" })}`;
    expect(parseRecords(jsonl).map((r) => r.recordId)).toEqual(["DD1", "DD9"]);
    const a = new DidiAdapter();
    expect(await collect(a.sync({}))).toEqual([]);
  });

  it("normalize throws on missing record", () => {
    const a = new DidiAdapter();
    expect(() => a.normalize({ payload: {} })).toThrow(/payload\.record missing/);
  });
});

describe("DidiAdapter cookie-api mode", () => {
  it("authenticate cookie mode (account optional)", async () => {
    const a = new DidiAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
    const ready = new DidiAdapter({ account: { cookies: "" } });
    expect((await ready.authenticate()).mode).toBe("ready");
  });

  it("sync fetches, paginates, maps + normalizes", async () => {
    const pages = [
      { data: { list: [{ orderId: "CK1", fromAddress: "家", toAddress: "公司", departTime: 1716383021, fare: 2300 }] } },
      { data: { list: [] } },
    ];
    const calls = [];
    const fetchFn = async ({ url, cookies, query, sign }) => {
      calls.push({ url, cookies, pageIndex: query.pageIndex, sign });
      return pages[query.pageIndex - 1] || { data: { list: [] } };
    };
    const a = new DidiAdapter({ account: { cookies: COOKIES }, fetchFn });
    const items = await collect(a.sync({ sinceWatermark: 0 }));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("CK1");
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    const batch = a.normalize(items[0]);
    expect(batch.events[0].content.title).toBe("car: 家 → 公司");
    expect(batch.events[0].content.amount.value).toBe(23); // 2300 分 → 23 元
  });

  it("invokes signProvider when configured", async () => {
    const signCalls = [];
    const a = new DidiAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => (query.pageIndex === 1 ? { orders: [{ orderId: "S1" }] } : { orders: [] }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "DD-SIG"; },
    });
    const items = await collect(a.sync({ sinceWatermark: 0 }));
    expect(items).toHaveLength(1);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("sinceWatermark + limit + empty/login response + default fetch throws", async () => {
    const a1 = new DidiAdapter({
      account: { cookies: COOKIES },
      fetchFn: async () => ({ orders: [
        { orderId: "NEW", departTime: 2_000_000_000_000 },
        { orderId: "OLD", departTime: 1_000_000_000_000 },
      ] }),
    });
    expect((await collect(a1.sync({ sinceWatermark: 1_500_000_000_000, maxPages: 1 }))).map((x) => x.originalId)).toEqual(["NEW"]);

    const a2 = new DidiAdapter({ account: { cookies: COOKIES }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({ sinceWatermark: 0 }))).toEqual([]);

    const a3 = new DidiAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a3.sync({ sinceWatermark: 0 }))).rejects.toThrow(/no fetchFn configured/);
  });

  it("file path takes priority over cookie mode", async () => {
    const p = writeTmp(JSON.stringify([RIDE]));
    try {
      const a = new DidiAdapter({
        account: { cookies: COOKIES },
        fetchFn: async () => { throw new Error("must not fetch in file mode"); },
      });
      expect((await collect(a.sync({ inputPath: p }))).map((x) => x.originalId)).toEqual(["DD1"]);
    } finally {
      fs.unlinkSync(p);
    }
  });
});
