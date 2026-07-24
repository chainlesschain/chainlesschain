"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  CtripAdapter,
  parseRecords,
  orderToRecord,
  extractOrders,
  TYPE_MAP,
  NAME,
  VERSION,
} = require("../../lib/adapters/travel-ctrip");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-ctrip-test-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const FLIGHT_ORDER = {
  orderId: "CT1",
  type: "flight",
  fromCity: "上海",
  toCity: "北京",
  departureTime: 1716383021000,
  arrivalTime: 1716390000000,
  airline: "国航",
  flightNumber: "CA1234",
  price: "1280.00",
  passengerName: "张三",
  pnr: "ABC123",
};

describe("constants + TYPE_MAP", () => {
  it("exposes name/version", () => {
    expect(NAME).toBe("travel-ctrip");
    expect(VERSION).toBe("0.7.0");
  });

  it("maps ctrip order types to vehicleType", () => {
    expect(TYPE_MAP.flight).toBe("flight");
    expect(TYPE_MAP.airline).toBe("flight");
    expect(TYPE_MAP.hotel).toBe("hotel");
    expect(TYPE_MAP.train).toBe("train");
    expect(TYPE_MAP.cruise).toBe("cruise");
  });
});

describe("parseRecords", () => {
  it("parses flight order with aliases (airline → carrier, pnr → confirmation)", () => {
    const recs = parseRecords(JSON.stringify([FLIGHT_ORDER]));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      vendorId: "ctrip",
      recordId: "CT1",
      vehicleType: "flight",
      from: { city: "上海" },
      to: { city: "北京" },
      departureMs: 1716383021000,
      carrier: "国航",
      vehicleNumber: "CA1234",
      traveler: "张三",
      confirmationCode: "ABC123",
    });
    expect(recs[0].totalCost).toEqual({ value: 1280, currency: "CNY" });
  });

  it("hotel order: hotelCity → to, hotelName → carrier, checkIn/Out → times", () => {
    const recs = parseRecords(
      JSON.stringify([
        {
          id: "H1",
          type: "hotel",
          hotelCity: "杭州",
          hotelName: "西湖宾馆",
          checkIn: "2026年4月15日",
          checkOut: "2026年4月17日",
          guestName: "李四",
          nights: 2,
        },
      ]),
    );
    expect(recs[0]).toMatchObject({
      recordId: "H1",
      vehicleType: "hotel",
      to: { city: "杭州" },
      carrier: "西湖宾馆",
      traveler: "李四",
    });
    expect(recs[0].from).toBe(null);
    expect(recs[0].departureMs).toBe(new Date(2026, 3, 15).getTime());
    expect(recs[0].extras.nights).toBe(2);
  });

  it("unknown type falls back to trip + default carrier 携程", () => {
    const recs = parseRecords(JSON.stringify([{ order_no: "X1" }]));
    expect(recs[0].vehicleType).toBe("trip");
    expect(recs[0].carrier).toBe("携程");
  });

  it("accepts {orders:[...]} envelope + JSONL fallback, drops id-less rows", () => {
    expect(
      parseRecords(JSON.stringify({ orders: [FLIGHT_ORDER] })),
    ).toHaveLength(1);
    const jsonl = `${JSON.stringify(FLIGHT_ORDER)}\ngarbage line\n${JSON.stringify({ ...FLIGHT_ORDER, orderId: "CT2" })}`;
    expect(parseRecords(jsonl).map((r) => r.recordId)).toEqual(["CT1", "CT2"]);
    expect(parseRecords(JSON.stringify([{ type: "flight" }]))).toHaveLength(0);
  });
});

describe("CtripAdapter", () => {
  it("authenticate ok in ready mode without account (v0.6 optional)", async () => {
    const a = new CtripAdapter();
    expect(await a.authenticate({})).toEqual({
      ok: true,
      account: null,
      mode: "ready",
    });
  });

  it("authenticate validates inputPath readability", async () => {
    const p = writeTmp("[]");
    try {
      const a = new CtripAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
      const bad = await a.authenticate({
        inputPath: path.join(os.tmpdir(), "nonexistent-ctrip.json"),
      });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync yields orders from file (inputPath alias) + normalize end-to-end", async () => {
    const p = writeTmp(JSON.stringify([FLIGHT_ORDER]));
    try {
      const a = new CtripAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ adapter: NAME, originalId: "CT1" });
      const batch = a.normalize(items[0]);
      const ev = batch.events[0];
      expect(ev.subtype).toBe("trip");
      expect(ev.content.title).toBe("flight: 上海 → 北京");
      expect(ev.content.amount).toEqual({
        value: 1280,
        currency: "CNY",
        direction: "out",
      });
      expect(batch.persons.find((x) => x.subtype === "merchant").names).toEqual(
        ["国航"],
      );
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync returns silently when no path / missing file", async () => {
    const a = new CtripAdapter();
    expect(await collect(a.sync({}))).toEqual([]);
    expect(
      await collect(
        a.sync({ inputPath: path.join(os.tmpdir(), "nope-ctrip.json") }),
      ),
    ).toEqual([]);
  });

  it("sync throws on broken {-line; pure garbage degrades to empty (JSONL filter)", async () => {
    const broken = writeTmp("{broken json line");
    const garbage = writeTmp("not json at all");
    try {
      const a = new CtripAdapter();
      await expect(collect(a.sync({ inputPath: broken }))).rejects.toThrow(
        /parse failed/,
      );
      // no line starts with "{" → JSONL filter yields [] rather than throwing
      expect(await collect(a.sync({ inputPath: garbage }))).toEqual([]);
    } finally {
      fs.unlinkSync(broken);
      fs.unlinkSync(garbage);
    }
  });

  it("normalize throws on missing record", () => {
    const a = new CtripAdapter();
    expect(() => a.normalize({ payload: {} })).toThrow(
      /payload\.record missing/,
    );
  });
});

describe("orderToRecord web-API aliases (cookie-api mode)", () => {
  it("maps web order field names (bizType / amount / orderDate / departCity)", () => {
    const rec = orderToRecord(
      {
        orderId: "W1",
        bizType: "Flight",
        departCity: "广州",
        arriveCity: "成都",
        amount: "899.5",
        departureDate: 1716383021000,
        contactName: "王五",
        orderDate: "2026-04-01",
      },
      { capturedVia: "cookie-api" },
    );
    expect(rec).toMatchObject({
      vendorId: "ctrip",
      recordId: "W1",
      vehicleType: "flight",
      from: { city: "广州" },
      to: { city: "成都" },
      departureMs: 1716383021000,
      traveler: "王五",
    });
    expect(rec.totalCost).toEqual({ value: 899.5, currency: "CNY" });
    expect(rec.extras.capturedVia).toBe("cookie-api");
  });

  it("file-import rows keep priority + no capturedVia by default", () => {
    const rec = orderToRecord({ orderId: "F1", type: "hotel", price: "300" });
    expect(rec.vehicleType).toBe("hotel");
    expect(rec.totalCost).toEqual({ value: 300, currency: "CNY" });
    expect(rec.extras.capturedVia).toBeUndefined();
  });
});

describe("extractOrders", () => {
  it("pulls the list from common Ctrip response shapes", () => {
    expect(extractOrders({ orders: [{ orderId: "A" }] })).toHaveLength(1);
    expect(
      extractOrders({ data: { orderList: [{ orderId: "B" }] } }),
    ).toHaveLength(1);
    expect(
      extractOrders({ result: { list: [{ orderId: "C" }] } }),
    ).toHaveLength(1);
    expect(extractOrders({})).toEqual([]);
    expect(extractOrders(null)).toEqual([]);
  });
});

describe("CtripAdapter cookie-api mode", () => {
  const COOKIES = "_bfa=abc; cticket=xyz; UUID=u1";

  it("authenticate returns cookie mode (account OPTIONAL)", async () => {
    const a = new CtripAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({
      ok: true,
      account: null,
      mode: "cookie",
    });
  });

  it("authenticate fails on empty cookies", async () => {
    const a = new CtripAdapter({ account: { cookies: "" } });
    // empty cookies → no cookieAuth → falls through to ready (not cookie mode)
    expect((await a.authenticate()).mode).toBe("ready");
  });

  it("sync fetches, paginates, maps + normalizes end-to-end", async () => {
    const pages = [
      {
        orderList: [
          {
            orderId: "CK1",
            bizType: "flight",
            departCity: "上海",
            arriveCity: "北京",
            amount: "1200",
            orderDate: 1716383021000,
            flightNumber: "MU500",
          },
        ],
      },
      { orderList: [] }, // page 2 empty → stop
    ];
    const calls = [];
    const fetchFn = async ({ url, cookies, query, sign }) => {
      calls.push({ url, cookies, pageIndex: query.pageIndex, sign });
      return pages[query.pageIndex - 1] || { orderList: [] };
    };
    const a = new CtripAdapter({
      account: { cookies: COOKIES },
      fetchFn,
      // no signProvider → sign should be null (best-effort unsigned)
    });
    let watermarkComplete = false;
    const items = await collect(
      a.sync({
        sinceWatermark: 0,
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ adapter: NAME, originalId: "CK1" });
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    expect(watermarkComplete).toBe(true);
    const batch = a.normalize(items[0]);
    expect(batch.events[0].content.title).toBe("flight: 上海 → 北京");
    expect(batch.events[0].content.amount).toMatchObject({ value: 1200 });
  });

  it("invokes signProvider when configured", async () => {
    const fetchFn = async ({ query }) =>
      query.pageIndex === 1
        ? { orders: [{ orderId: "S1", type: "hotel" }] }
        : { orders: [] };
    const signCalls = [];
    const signProvider = async (ctx) => {
      signCalls.push(ctx);
      return "SIGNED-TOKEN";
    };
    const a = new CtripAdapter({
      account: { cookies: COOKIES },
      fetchFn,
      signProvider,
    });
    const items = await collect(a.sync({ sinceWatermark: 0 }));
    expect(items).toHaveLength(1);
    expect(signCalls).toHaveLength(1);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("stops at sinceWatermark (older orders dropped)", async () => {
    const fetchFn = async () => ({
      orderList: [
        { orderId: "NEW", type: "flight", orderDate: 2_000_000_000_000 },
        { orderId: "OLD", type: "flight", orderDate: 1_000_000_000_000 },
      ],
    });
    const a = new CtripAdapter({ account: { cookies: COOKIES }, fetchFn });
    const items = await collect(
      a.sync({ sinceWatermark: 1_500_000_000_000, maxPages: 1 }),
    );
    expect(items.map((x) => x.originalId)).toEqual(["NEW"]);
  });

  it("respects opts.limit", async () => {
    const fetchFn = async () => ({
      orderList: [
        { orderId: "L1", type: "flight", orderDate: 2_000_000_000_000 },
        { orderId: "L2", type: "flight", orderDate: 2_000_000_000_001 },
      ],
    });
    const a = new CtripAdapter({ account: { cookies: COOKIES }, fetchFn });
    let watermarkComplete = false;
    const items = await collect(
      a.sync({
        sinceWatermark: 0,
        limit: 1,
        maxPages: 1,
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items).toHaveLength(1);
    expect(watermarkComplete).toBe(false);
  });

  it("does not complete the watermark when maxPages truncates a full page", async () => {
    const fetchFn = async () => ({
      orderList: [
        { orderId: "P1", type: "flight", orderDate: 2_000_000_000_000 },
        { orderId: "P2", type: "flight", orderDate: 1_900_000_000_000 },
      ],
    });
    const a = new CtripAdapter({ account: { cookies: COOKIES }, fetchFn });
    let watermarkComplete = false;
    const items = await collect(
      a.sync({
        sinceWatermark: 0,
        pageSize: 2,
        maxPages: 1,
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items).toHaveLength(2);
    expect(watermarkComplete).toBe(false);
  });

  it("empty/login-redirect response yields zero (no crash)", async () => {
    const a = new CtripAdapter({
      account: { cookies: COOKIES },
      fetchFn: async () => "<html>login</html>",
    });
    expect(await collect(a.sync({ sinceWatermark: 0 }))).toEqual([]);
  });

  it("default fetch throws when no fetchFn (wiring bug)", async () => {
    const a = new CtripAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a.sync({ sinceWatermark: 0 }))).rejects.toThrow(
      /no fetchFn configured/,
    );
  });

  it("snapshot/file path takes priority over cookie mode", async () => {
    const p = writeTmp(JSON.stringify([FLIGHT_ORDER]));
    try {
      const a = new CtripAdapter({
        account: { cookies: COOKIES },
        fetchFn: async () => {
          throw new Error("fetchFn should NOT be called in file mode");
        },
      });
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.originalId)).toEqual(["CT1"]);
    } finally {
      fs.unlinkSync(p);
    }
  });
});
