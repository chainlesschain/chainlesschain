"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  TongchengAdapter,
  parseRecords,
  orderToRecord,
  extractOrders,
  TYPE_MAP,
  NAME,
  VERSION,
} = require("../../lib/adapters/travel-tongcheng");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-tc-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const FLIGHT_ORDER = {
  orderId: "TC1",
  projectType: "flight",
  departureCity: "上海",
  arrivalCity: "北京",
  departureDate: 1716383021000,
  airlineName: "东方航空",
  flightNumber: "MU5101",
  amount: "1180.00",
  passengerName: "张三",
};

const COOKIES = "clientId=abc; tc_token=xyz; memberId=m1";

describe("constants + TYPE_MAP", () => {
  it("exposes name/version", () => {
    expect(NAME).toBe("travel-tongcheng");
    expect(VERSION).toBe("0.1.0");
  });

  it("maps tongcheng order types (incl. Chinese + scenery→attraction)", () => {
    expect(TYPE_MAP.flight).toBe("flight");
    expect(TYPE_MAP["机票"]).toBe("flight");
    expect(TYPE_MAP["酒店"]).toBe("hotel");
    expect(TYPE_MAP["火车票"]).toBe("train");
    expect(TYPE_MAP["门票"]).toBe("attraction");
    expect(TYPE_MAP["汽车票"]).toBe("bus");
  });
});

describe("parseRecords / orderToRecord", () => {
  it("parses flight order (projectType/amount/departureCity aliases)", () => {
    const recs = parseRecords(JSON.stringify([FLIGHT_ORDER]));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      vendorId: "tongcheng",
      recordId: "TC1",
      vehicleType: "flight",
      from: { city: "上海" },
      to: { city: "北京" },
      departureMs: 1716383021000,
      carrier: "东方航空",
      vehicleNumber: "MU5101",
      traveler: "张三",
    });
    expect(recs[0].totalCost).toEqual({ value: 1180, currency: "CNY" });
  });

  it("hotel order: hotelCity→to, hotelName→carrier, checkIn→time", () => {
    const recs = parseRecords(
      JSON.stringify([
        {
          orderId: "H1",
          projectType: "hotel",
          hotelCity: "杭州",
          hotelName: "西湖国宾馆",
          checkIn: "2026年5月1日",
          linkName: "李四",
          nights: 2,
        },
      ]),
    );
    expect(recs[0]).toMatchObject({
      recordId: "H1",
      vehicleType: "hotel",
      to: { city: "杭州" },
      carrier: "西湖国宾馆",
      traveler: "李四",
    });
    expect(recs[0].from).toBe(null);
    expect(recs[0].extras.nights).toBe(2);
  });

  it("scenery/门票 order maps to attraction; sceneryName→carrier/to", () => {
    const rec = orderToRecord({ orderId: "S1", projectType: "门票", sceneryName: "黄山风景区", amount: 230 });
    expect(rec.vehicleType).toBe("attraction");
    expect(rec.carrier).toBe("黄山风景区");
    expect(rec.totalCost.value).toBe(230);
  });

  it("unknown type → trip + default carrier 同程; drops id-less rows", () => {
    expect(orderToRecord({ order_no: "X1" }).vehicleType).toBe("trip");
    expect(orderToRecord({ order_no: "X1" }).carrier).toBe("同程");
    expect(orderToRecord({ projectType: "flight" })).toBe(null);
  });

  it("accepts {orders:[...]} envelope + JSONL fallback", () => {
    expect(parseRecords(JSON.stringify({ orders: [FLIGHT_ORDER] }))).toHaveLength(1);
    const jsonl = `${JSON.stringify(FLIGHT_ORDER)}\ngarbage\n${JSON.stringify({ ...FLIGHT_ORDER, orderId: "TC2" })}`;
    expect(parseRecords(jsonl).map((r) => r.recordId)).toEqual(["TC1", "TC2"]);
  });
});

describe("extractOrders", () => {
  it("pulls list from common shapes", () => {
    expect(extractOrders({ orders: [{ orderId: "A" }] })).toHaveLength(1);
    expect(extractOrders({ data: { orderList: [{ orderId: "B" }] } })).toHaveLength(1);
    expect(extractOrders({ data: { records: [{ orderId: "C" }] } })).toHaveLength(1);
    expect(extractOrders({})).toEqual([]);
    expect(extractOrders(null)).toEqual([]);
  });
});

describe("TongchengAdapter file/snapshot mode", () => {
  it("authenticate ready mode without account", async () => {
    const a = new TongchengAdapter();
    expect(await a.authenticate({})).toEqual({ ok: true, account: null, mode: "ready" });
  });

  it("authenticate validates inputPath readability", async () => {
    const p = writeTmp("[]");
    try {
      const a = new TongchengAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const bad = await a.authenticate({ inputPath: path.join(os.tmpdir(), "nope-tc.json") });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync yields orders from file + normalize end-to-end", async () => {
    const p = writeTmp(JSON.stringify([FLIGHT_ORDER]));
    try {
      const a = new TongchengAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ adapter: NAME, originalId: "TC1" });
      const batch = a.normalize(items[0]);
      expect(batch.events[0].content.title).toBe("flight: 上海 → 北京");
      expect(batch.events[0].content.amount).toEqual({ value: 1180, currency: "CNY", direction: "out" });
      expect(batch.persons.find((x) => x.subtype === "merchant").names).toEqual(["东方航空"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync returns silently when no path / missing file", async () => {
    const a = new TongchengAdapter();
    expect(await collect(a.sync({}))).toEqual([]);
    expect(await collect(a.sync({ inputPath: path.join(os.tmpdir(), "nope-tc2.json") }))).toEqual([]);
  });

  it("normalize throws on missing record", () => {
    const a = new TongchengAdapter();
    expect(() => a.normalize({ payload: {} })).toThrow(/payload\.record missing/);
  });
});

describe("TongchengAdapter cookie-api mode", () => {
  it("authenticate cookie mode (account OPTIONAL)", async () => {
    const a = new TongchengAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
  });

  it("empty cookies → ready (not cookie mode)", async () => {
    const a = new TongchengAdapter({ account: { cookies: "" } });
    expect((await a.authenticate()).mode).toBe("ready");
  });

  it("sync fetches, paginates, maps + normalizes", async () => {
    const pages = [
      {
        orderList: [
          { orderId: "CK1", projectType: "train", departureCity: "广州", arrivalCity: "深圳", amount: "75", orderDate: 1716383021000, trainNo: "G6501" },
        ],
      },
      { orderList: [] },
    ];
    const calls = [];
    const fetchFn = async ({ url, cookies, query, sign }) => {
      calls.push({ url, cookies, pageIndex: query.pageIndex, sign });
      return pages[query.pageIndex - 1] || { orderList: [] };
    };
    const a = new TongchengAdapter({ account: { cookies: COOKIES }, fetchFn });
    const items = await collect(a.sync({ sinceWatermark: 0 }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ adapter: NAME, originalId: "CK1" });
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    const batch = a.normalize(items[0]);
    expect(batch.events[0].content.title).toBe("train: 广州 → 深圳");
  });

  it("invokes signProvider when configured", async () => {
    const signCalls = [];
    const a = new TongchengAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) =>
        query.pageIndex === 1 ? { orders: [{ orderId: "S1", projectType: "hotel" }] } : { orders: [] },
      signProvider: async (ctx) => {
        signCalls.push(ctx);
        return "TC-SIGN";
      },
    });
    const items = await collect(a.sync({ sinceWatermark: 0 }));
    expect(items).toHaveLength(1);
    expect(signCalls).toHaveLength(1);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("stops at sinceWatermark", async () => {
    const a = new TongchengAdapter({
      account: { cookies: COOKIES },
      fetchFn: async () => ({
        orderList: [
          { orderId: "NEW", projectType: "flight", orderDate: 2_000_000_000_000 },
          { orderId: "OLD", projectType: "flight", orderDate: 1_000_000_000_000 },
        ],
      }),
    });
    const items = await collect(a.sync({ sinceWatermark: 1_500_000_000_000, maxPages: 1 }));
    expect(items.map((x) => x.originalId)).toEqual(["NEW"]);
  });

  it("respects opts.limit", async () => {
    const a = new TongchengAdapter({
      account: { cookies: COOKIES },
      fetchFn: async () => ({
        orderList: [
          { orderId: "L1", projectType: "flight", orderDate: 2_000_000_000_000 },
          { orderId: "L2", projectType: "flight", orderDate: 2_000_000_000_001 },
        ],
      }),
    });
    const items = await collect(a.sync({ sinceWatermark: 0, limit: 1, maxPages: 1 }));
    expect(items).toHaveLength(1);
  });

  it("empty/login-redirect response yields zero (no crash)", async () => {
    const a = new TongchengAdapter({
      account: { cookies: COOKIES },
      fetchFn: async () => "<html>login</html>",
    });
    expect(await collect(a.sync({ sinceWatermark: 0 }))).toEqual([]);
  });

  it("default fetch throws when no fetchFn", async () => {
    const a = new TongchengAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a.sync({ sinceWatermark: 0 }))).rejects.toThrow(/no fetchFn configured/);
  });

  it("file path takes priority over cookie mode", async () => {
    const p = writeTmp(JSON.stringify([FLIGHT_ORDER]));
    try {
      const a = new TongchengAdapter({
        account: { cookies: COOKIES },
        fetchFn: async () => {
          throw new Error("fetchFn should NOT be called in file mode");
        },
      });
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.originalId)).toEqual(["TC1"]);
    } finally {
      fs.unlinkSync(p);
    }
  });
});
