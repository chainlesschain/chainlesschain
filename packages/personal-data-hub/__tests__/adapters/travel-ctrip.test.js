"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  CtripAdapter,
  parseRecords,
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
    expect(VERSION).toBe("0.6.0");
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
      expect(
        batch.persons.find((x) => x.subtype === "merchant").names,
      ).toEqual(["国航"]);
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
