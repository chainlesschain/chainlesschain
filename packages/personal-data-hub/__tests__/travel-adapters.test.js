"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  normalizeTravelRecord,
  parseChineseDateTime,
  Train12306Adapter,
  CtripAdapter,
  AmapAdapter,
  BaiduMapAdapter,
} = require("../lib");
const { parseRecords: parse12306 } = require("../lib/adapters/travel-12306");
const { parseRecords: parseCtripRecords, TYPE_MAP: CTRIP_TYPE_MAP } = require("../lib/adapters/travel-ctrip");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// ─── travel-base ────────────────────────────────────────────────────────

describe("parseChineseDateTime", () => {
  it("YYYY-MM-DD HH:MM:SS", () => {
    const ms = parseChineseDateTime("2026-04-15 14:30:00");
    expect(new Date(ms).getFullYear()).toBe(2026);
    expect(new Date(ms).getMonth()).toBe(3);
    expect(new Date(ms).getDate()).toBe(15);
    expect(new Date(ms).getHours()).toBe(14);
  });

  it("YYYY/MM/DD HH:MM", () => {
    const ms = parseChineseDateTime("2026/04/15 09:00");
    expect(new Date(ms).getMonth()).toBe(3);
  });

  it("YYYY年M月D日 HH:MM", () => {
    const ms = parseChineseDateTime("2026年4月15日 14:30");
    expect(new Date(ms).getMonth()).toBe(3);
    expect(new Date(ms).getDate()).toBe(15);
  });

  it("YYYY年M月D日 (no time)", () => {
    const ms = parseChineseDateTime("2026年4月15日");
    expect(new Date(ms).getMonth()).toBe(3);
  });

  it("invalid input → null", () => {
    expect(parseChineseDateTime("")).toBeNull();
    expect(parseChineseDateTime(null)).toBeNull();
    expect(parseChineseDateTime("notadate")).toBeNull();
  });
});

describe("normalizeTravelRecord", () => {
  it("produces Event + Places + carrier Person", () => {
    const rec = {
      vendorId: "12306",
      recordId: "ORDER-1",
      vehicleType: "train",
      from: { station: "上海虹桥", city: "上海" },
      to: { station: "北京南", city: "北京" },
      departureMs: new Date(2026, 3, 15, 9).getTime(),
      arrivalMs: new Date(2026, 3, 15, 14).getTime(),
      carrier: "12306",
      vehicleNumber: "G2",
      totalCost: { value: 553.5, currency: "CNY" },
      traveler: "张三",
      confirmationCode: "E123456789",
    };
    const b = normalizeTravelRecord(rec, { adapterName: "travel-12306", adapterVersion: "0.5.0" });
    expect(b.events).toHaveLength(1);
    expect(b.events[0].subtype).toBe("trip");
    expect(b.events[0].content.title).toContain("train:");
    expect(b.events[0].content.amount.value).toBe(553.5);
    expect(b.events[0].extra.vehicleNumber).toBe("G2");
    expect(b.events[0].extra.arrivalMs).toBe(rec.arrivalMs);
    expect(b.places).toHaveLength(2);
    expect(b.persons.some((p) => p.subtype === "merchant")).toBe(true);
    const v = validateBatch(b);
    expect(v.valid).toBe(true);
  });

  it("missing record id throws", () => {
    expect(() => normalizeTravelRecord({})).toThrow();
  });

  it("traveler that matches selfName not added as Person", () => {
    const b = normalizeTravelRecord(
      { vendorId: "12306", recordId: "X", vehicleType: "train", traveler: "自己" },
      { adapterName: "travel-12306", selfName: "自己" },
    );
    expect(b.persons.find((p) => p.extra && p.extra.role === "traveler")).toBeUndefined();
  });
});

// ─── 12306 adapter ──────────────────────────────────────────────────────

describe("Train12306Adapter", () => {
  it("adapter contract conformance", () => {
    const a = new Train12306Adapter({ account: { username: "test" } });
    const r = assertAdapter(a);
    expect(r.ok).toBe(true);
    if (!r.ok) console.log(r.errors);
    expect(a.extractMode).toBe("file-import");
  });

  it("parseRecords parses JSON array", () => {
    const json = JSON.stringify([
      {
        orderId: "ORD-1", trainNumber: "G2",
        fromStation: "上海虹桥", toStation: "北京南",
        departureTime: "2026-04-15 09:00:00",
        arrivalTime: "2026-04-15 14:00:00",
        passengerName: "张三", price: "553.5",
        ticketNumber: "T-1",
        seatNumber: "01车05A号", seat: "二等座",
      },
    ]);
    const recs = parse12306(json);
    expect(recs).toHaveLength(1);
    expect(recs[0].vehicleType).toBe("train");
    expect(recs[0].vehicleNumber).toBe("G2");
    expect(recs[0].departureMs).toBeGreaterThan(0);
  });

  it("parseRecords handles JSONL format", () => {
    const jsonl = '{"orderId":"a","trainNumber":"G1","fromStation":"X","toStation":"Y","passengerName":"p","ticketNumber":"t1"}\n{"orderId":"b","trainNumber":"G2","fromStation":"X","toStation":"Y","passengerName":"p","ticketNumber":"t2"}';
    const recs = parse12306(jsonl);
    expect(recs).toHaveLength(2);
  });

  it("sync yields raw events from a file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "12306-"));
    const dataPath = path.join(dir, "12306.json");
    fs.writeFileSync(dataPath, JSON.stringify([
      { orderId: "x", trainNumber: "G3", fromStation: "上海虹桥", toStation: "北京南", passengerName: "张三", ticketNumber: "tx" },
    ]));
    try {
      const a = new Train12306Adapter({ account: { username: "test" }, dataPath });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws).toHaveLength(1);
      expect(raws[0].adapter).toBe("travel-12306");
      const batch = a.normalize(raws[0]);
      const v = validateBatch(batch);
      expect(v.valid).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing account.username", () => {
    expect(() => new Train12306Adapter({})).toThrow();
    expect(() => new Train12306Adapter({ account: {} })).toThrow(/username/);
  });
});

// ─── Ctrip adapter ───────────────────────────────────────────────────────

describe("CtripAdapter", () => {
  it("adapter contract", () => {
    const a = new CtripAdapter({ account: { email: "test@example.com" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.extractMode).toBe("file-import");
  });

  it("parseRecords maps Ctrip flight type", () => {
    const json = JSON.stringify([
      {
        orderId: "C-1", type: "flight",
        depCity: "上海", arrCity: "北京",
        flightNumber: "CA1234",
        airline: "中国国际航空",
        departureTime: "2026-04-15 09:00:00",
        arrivalTime: "2026-04-15 11:30:00",
        passengerName: "张三",
        price: 1234.5,
        pnr: "ABC123",
      },
    ]);
    const recs = parseCtripRecords(json);
    expect(recs[0].vehicleType).toBe("flight");
    expect(recs[0].vehicleNumber).toBe("CA1234");
    expect(recs[0].carrier).toBe("中国国际航空");
  });

  it("parseRecords maps Ctrip hotel type", () => {
    const json = JSON.stringify([
      {
        orderId: "H-1", type: "hotel",
        hotelCity: "上海", hotelName: "外滩英迪格酒店",
        checkIn: "2026-04-15", checkOut: "2026-04-17",
        guestName: "张三", price: 1980, nights: 2,
      },
    ]);
    const recs = parseCtripRecords(json);
    expect(recs[0].vehicleType).toBe("hotel");
    expect(recs[0].carrier).toBe("外滩英迪格酒店");
    expect(recs[0].extras.nights).toBe(2);
  });

  it("TYPE_MAP covers expected types", () => {
    expect(CTRIP_TYPE_MAP.flight).toBe("flight");
    expect(CTRIP_TYPE_MAP.hotel).toBe("hotel");
    expect(CTRIP_TYPE_MAP.train).toBe("train");
    expect(CTRIP_TYPE_MAP.cruise).toBe("cruise");
  });
});

// ─── Amap adapter (mocked SQLite) ───────────────────────────────────────

describe("AmapAdapter", () => {
  it("adapter contract", () => {
    const a = new AmapAdapter({ account: { deviceId: "dev-1" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.extractMode).toBe("device-pull");
  });

  it("sync yields route + search records via mocked driver", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amap-"));
    const dbPath = path.join(dir, "amap.db");
    fs.writeFileSync(dbPath, "fake");

    const mockDriver = function (path, opts) {
      return {
        prepare(sql) {
          return {
            all() {
              if (sql.includes("history_route")) {
                return [
                  { id: "r1", from_name: "上海", to_name: "北京", time: 1700000000000, mode: "drive" },
                ];
              }
              if (sql.includes("history_search")) {
                return [
                  { id: "s1", keyword: "外滩", time: 1700000001000, lat: 31.23, lng: 121.49 },
                ];
              }
              throw new Error("no such table");
            },
          };
        },
        close() {},
      };
    };

    try {
      const a = new AmapAdapter({
        account: { deviceId: "dev-1" },
        dbPath,
        dbDriverFactory: () => mockDriver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBeGreaterThan(0);
      const route = raws.find((r) => r.payload.kind === "route");
      const search = raws.find((r) => r.payload.kind === "search");
      expect(route).toBeDefined();
      expect(search).toBeDefined();
      // Normalize succeeds + validates
      const batch = a.normalize(route);
      const v = validateBatch(batch);
      expect(v.valid).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── BaiduMap adapter (mocked SQLite) ────────────────────────────────────

describe("BaiduMapAdapter", () => {
  it("adapter contract", () => {
    const a = new BaiduMapAdapter({ account: { deviceId: "dev-1" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.extractMode).toBe("device-pull");
  });

  it("sync yields route from mocked driver", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-"));
    const dbPath = path.join(dir, "baidu.db");
    fs.writeFileSync(dbPath, "fake");

    const mockDriver = function () {
      return {
        prepare(sql) {
          return {
            all() {
              if (sql.includes("route_history")) {
                return [
                  { _id: 1, start_name: "上海", end_name: "杭州", time: 1700000000, type: "drive" },
                ];
              }
              if (sql.includes("search_history")) {
                return [
                  { _id: 2, key: "西湖", time: 1700000001 },
                ];
              }
              throw new Error("no such table");
            },
          };
        },
        close() {},
      };
    };

    try {
      const a = new BaiduMapAdapter({
        account: { deviceId: "dev-1" },
        dbPath,
        dbDriverFactory: () => mockDriver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBeGreaterThan(0);
      const batch = a.normalize(raws[0]);
      const v = validateBatch(batch);
      expect(v.valid).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
