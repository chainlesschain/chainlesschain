"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  Train12306Adapter,
  parseRecords,
  ticketsFromOrder,
  extractCompletedOrders,
  extractPendingOrders,
  parse12306DateTime,
  parseYyyymmdd,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
} = require("../../lib/adapters/travel-12306");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-12306-test-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const TICKET_EVENT = {
  kind: "ticket",
  id: "ticket-SEQ1:0",
  capturedAt: 1716383021000,
  orderSequenceNo: "SEQ1",
  ticketNumber: "E123456789",
  passengerName: "张三",
  passengerIdLast6: "123456",
  trainNumber: "G35",
  fromStation: "上海虹桥",
  toStation: "北京南",
  departureMs: 1716383021000,
  arrivalMs: 1716401021000,
  seatTypeName: "二等座",
  coachNo: "05",
  seatNo: "12A",
  ticketPrice: 553.5,
  orderDateMs: 1716000000000,
  orderTotalPrice: 553.5,
  isCompleted: true,
};

function makeSnapshot(events, extra = {}) {
  return JSON.stringify({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshottedAt: 1716383021000,
    vendor: "12306",
    events,
    ...extra,
  });
}

describe("constants", () => {
  it("exposes name/version/schema", () => {
    expect(NAME).toBe("travel-12306");
    expect(VERSION).toBe("0.7.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect([...VALID_SNAPSHOT_KINDS]).toEqual(["ticket"]);
  });
});

describe("authenticate", () => {
  it("snapshot mode ok when inputPath readable", async () => {
    const p = writeTmp(makeSnapshot([]));
    try {
      const a = new Train12306Adapter();
      expect(await a.authenticate({ inputPath: p })).toEqual({
        ok: true,
        mode: "snapshot-file",
      });
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("snapshot mode fails INPUT_PATH_UNREADABLE on missing file", async () => {
    const a = new Train12306Adapter();
    const r = await a.authenticate({
      inputPath: path.join(os.tmpdir(), "nonexistent-12306.json"),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("file-import mode requires account.username", async () => {
    const noAccount = new Train12306Adapter({ dataPath: "x.json" });
    expect((await noAccount.authenticate({})).reason).toBe(
      "NO_ACCOUNT_USERNAME",
    );
    const withAccount = new Train12306Adapter({
      dataPath: "x.json",
      account: { username: "alice" },
    });
    expect(await withAccount.authenticate({})).toEqual({
      ok: true,
      account: "alice",
      mode: "file-import",
    });
  });

  it("fails NO_INPUT when neither path given", async () => {
    const a = new Train12306Adapter();
    expect((await a.authenticate({})).reason).toBe("NO_INPUT");
  });
});

describe("sync — snapshot mode", () => {
  it("yields ticket events with stable originalId", async () => {
    const p = writeTmp(makeSnapshot([TICKET_EVENT]));
    try {
      const a = new Train12306Adapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        adapter: NAME,
        kind: "ticket",
        originalId: "12306:ticket:ticket-SEQ1:0",
        capturedAt: 1716383021000,
      });
      expect(items[0].payload.snapshot).toBe(true);
      expect(items[0].payload.trainNumber).toBe("G35");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("throws on schemaVersion mismatch", async () => {
    const p = writeTmp(JSON.stringify({ schemaVersion: 99, events: [] }));
    try {
      const a = new Train12306Adapter();
      await expect(collect(a.sync({ inputPath: p }))).rejects.toThrow(
        /schemaVersion mismatch/,
      );
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("skips unknown kinds + honors include gate + limit", async () => {
    const p = writeTmp(
      makeSnapshot([
        { kind: "alien", id: "x" },
        TICKET_EVENT,
        { ...TICKET_EVENT, id: "ticket-SEQ1:1" },
      ]),
    );
    try {
      const a = new Train12306Adapter();
      const all = await collect(a.sync({ inputPath: p }));
      expect(all).toHaveLength(2);
      const limited = await collect(a.sync({ inputPath: p, limit: 1 }));
      expect(limited).toHaveLength(1);
      const gated = await collect(
        a.sync({ inputPath: p, include: { ticket: false } }),
      );
      expect(gated).toHaveLength(0);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("falls back capturedAt to departureMs then snapshottedAt", async () => {
    const noCaptured = { ...TICKET_EVENT, capturedAt: undefined };
    const noTimes = {
      ...TICKET_EVENT,
      capturedAt: undefined,
      departureMs: undefined,
    };
    const p = writeTmp(makeSnapshot([noCaptured, noTimes]));
    try {
      const a = new Train12306Adapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items[0].capturedAt).toBe(TICKET_EVENT.departureMs);
      expect(items[1].capturedAt).toBe(1716383021000); // snapshottedAt
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("normalize — snapshot payload", () => {
  it("maps ticket event to trip with traveler/cost/seat extras", () => {
    const a = new Train12306Adapter();
    const batch = a.normalize({
      payload: { ...TICKET_EVENT, snapshot: true },
    });
    const ev = batch.events[0];
    expect(ev.subtype).toBe("trip");
    expect(ev.content.title).toBe("train: 上海虹桥 → 北京南");
    expect(ev.content.amount).toEqual({
      value: 553.5,
      currency: "CNY",
      direction: "out",
    });
    expect(ev.extra.vehicleNumber).toBe("G35");
    expect(ev.extra.confirmationCode).toBe("E123456789");
    expect(ev.extra.vendorExtras).toMatchObject({
      seat: "二等座",
      coachNo: "05",
      seatNumber: "12A",
      isCompleted: true,
      idLast6: "123456",
    });
    const traveler = batch.persons.find((p) => p.subtype === "contact");
    expect(traveler.names).toEqual(["张三"]);
  });

  it("throws on missing payload / record", () => {
    const a = new Train12306Adapter();
    expect(() => a.normalize(null)).toThrow(/payload missing/);
    expect(() => a.normalize({ payload: {} })).toThrow(
      /payload\.record missing/,
    );
  });
});

describe("sync + parseRecords — file-import mode", () => {
  const ORDER = {
    orderId: "O1",
    fromStation: "上海虹桥",
    toStation: "北京南",
    departureTime: 1716383021000,
    trainNumber: "G35",
    price: "553.5",
    passengerName: "张三",
  };

  it("requires account.username at sync time", async () => {
    const a = new Train12306Adapter({ dataPath: "whatever.json" });
    await expect(collect(a.sync({}))).rejects.toThrow(
      /account\.username required/,
    );
  });

  it("parses JSON array / {orders} / JSONL shapes", () => {
    expect(parseRecords(JSON.stringify([ORDER]))).toHaveLength(1);
    expect(parseRecords(JSON.stringify({ orders: [ORDER] }))).toHaveLength(1);
    const jsonl = `${JSON.stringify(ORDER)}\n# comment\n${JSON.stringify({ ...ORDER, orderId: "O2" })}`;
    const recs = parseRecords(jsonl);
    expect(recs.map((r) => r.recordId)).toEqual(["O1", "O2"]);
    expect(recs[0].vehicleType).toBe("train");
    expect(recs[0].totalCost).toEqual({ value: 553.5, currency: "CNY" });
  });

  it("drops orders without any id", () => {
    expect(parseRecords(JSON.stringify([{ price: "1" }]))).toHaveLength(0);
  });

  it("yields from a real dump file end-to-end", async () => {
    const p = writeTmp(JSON.stringify([ORDER]));
    try {
      const a = new Train12306Adapter({
        dataPath: p,
        account: { username: "alice" },
      });
      const items = await collect(a.sync({}));
      expect(items).toHaveLength(1);
      expect(items[0].originalId).toBe("O1");
      const batch = a.normalize(items[0]);
      expect(batch.events[0].content.title).toBe("train: 上海虹桥 → 北京南");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync throws when neither inputPath nor dataPath", async () => {
    const a = new Train12306Adapter();
    await expect(collect(a.sync({}))).rejects.toThrow(/needs opts\.inputPath/);
  });
});

// ─── §2.5 v0.3 cookie-api live fetch ────────────────────────────────────────

// One raw 12306 order object (queryMyOrder shape) carrying a single ticket.
function rawOrder(seq, overrides = {}) {
  return {
    sequence_no: seq,
    order_date: "20240315",
    ticket_total_price: "553.5",
    tickets: [
      {
        ticket_no: "E123456789",
        passenger_name: "张三",
        passenger_id_no: "310101199001011234", // last6 = 011234
        train_code: "G35",
        from_station_name: "上海虹桥",
        to_station_name: "北京南",
        start_train_date_page: "2024-03-20 09:00",
        arrive_train_date_page: "2024-03-20 14:00",
        seat_type_name: "二等座",
        coach_no: "05",
        seat_no: "12A",
        ticket_price: "553.5",
        ...overrides,
      },
    ],
  };
}

const COOKIE = "tk=abc; JSESSIONID=xyz; RAIL_DEVICEID=dev";

describe("cookie-api helpers", () => {
  it("extractCompletedOrders tolerates shape variants + junk", () => {
    expect(extractCompletedOrders({ data: { OrderDTODataList: [1, 2] } })).toEqual([1, 2]);
    expect(extractCompletedOrders({ data: { orderDTODataList: [3] } })).toEqual([3]);
    expect(extractCompletedOrders(null)).toEqual([]);
    expect(extractCompletedOrders({ data: {} })).toEqual([]);
    expect(extractCompletedOrders("nope")).toEqual([]);
  });

  it("extractPendingOrders tolerates shape variants + junk", () => {
    expect(extractPendingOrders({ data: { orderDBList: [1] } })).toEqual([1]);
    expect(extractPendingOrders({ data: { orderDbList: [2] } })).toEqual([2]);
    expect(extractPendingOrders({})).toEqual([]);
  });

  it("ticketsFromOrder flattens tickets with snake/camel fallbacks", () => {
    const evs = ticketsFromOrder(rawOrder("SEQ1"), true);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      kind: "ticket",
      id: "ticket-SEQ1:0",
      orderSequenceNo: "SEQ1",
      ticketNumber: "E123456789",
      passengerName: "张三",
      passengerIdLast6: "011234",
      trainNumber: "G35",
      fromStation: "上海虹桥",
      toStation: "北京南",
      seatTypeName: "二等座",
      coachNo: "05",
      seatNo: "12A",
      ticketPrice: 553.5,
      isCompleted: true,
      capturedVia: "cookie-api",
    });
    // camelCase + *_page fallbacks
    const camel = ticketsFromOrder(
      {
        sequenceNo: "SEQ2",
        tickets: [
          {
            stationTrainCode: "D7",
            passengerName: "李四",
            from_station_name_page: "杭州东",
            to_station_name_page: "南京南",
            ticketPrice: "100",
          },
        ],
      },
      false,
    );
    expect(camel[0]).toMatchObject({
      trainNumber: "D7",
      fromStation: "杭州东",
      toStation: "南京南",
      ticketPrice: 100,
      isCompleted: false,
    });
  });

  it("ticketsFromOrder drops incomplete tickets + bad orders", () => {
    expect(ticketsFromOrder(null, true)).toEqual([]);
    expect(ticketsFromOrder({ tickets: [] }, true)).toEqual([]); // no sequence_no
    // ticket missing passenger / train / stations → dropped
    const evs = ticketsFromOrder(
      { sequence_no: "S", tickets: [{ passenger_name: "x" }] },
      true,
    );
    expect(evs).toEqual([]);
  });

  it("parse12306DateTime handles date / date-time / Chinese / blank", () => {
    // 2024-03-20 09:00 Shanghai = 2024-03-20 01:00 UTC
    expect(parse12306DateTime("2024-03-20 09:00")).toBe(Date.UTC(2024, 2, 20, 1, 0));
    expect(parse12306DateTime("2024-03-20")).toBe(Date.UTC(2024, 2, 19, 16, 0));
    expect(parse12306DateTime("")).toBeNull();
    expect(parse12306DateTime(null)).toBeNull();
    expect(parse12306DateTime("garbage")).toBeNull();
  });

  it("parseYyyymmdd parses compact dates", () => {
    expect(parseYyyymmdd("20240315")).toBe(Date.UTC(2024, 2, 14, 16, 0));
    expect(parseYyyymmdd("2024-03-15")).toBeNull();
    expect(parseYyyymmdd(null)).toBeNull();
  });
});

describe("authenticate — cookie-api mode", () => {
  it("ok when account.cookies present (username optional)", async () => {
    const a = new Train12306Adapter({ account: { cookies: COOKIE } });
    expect(await a.authenticate({})).toEqual({
      ok: true,
      account: null,
      mode: "cookie",
    });
  });

  it("carries username when supplied alongside cookies", async () => {
    const a = new Train12306Adapter({
      account: { cookies: COOKIE, username: "alice" },
    });
    expect((await a.authenticate({})).account).toBe("alice");
  });

  it("cookie mode takes precedence over file-import", async () => {
    const a = new Train12306Adapter({
      account: { cookies: COOKIE },
      dataPath: "x.json",
    });
    expect((await a.authenticate({})).mode).toBe("cookie");
  });
});

describe("sync — cookie-api mode", () => {
  it("yields flattened ticket events from completed + pending", async () => {
    const calls = [];
    const fetchFn = async ({ url, cookies, form }) => {
      calls.push({ url, cookies, form });
      if (url.includes("NoComplete")) {
        return { data: { orderDBList: [rawOrder("PEND1")] } };
      }
      // single completed page (< PAGE_SIZE → stops)
      return { data: { OrderDTODataList: [rawOrder("SEQ1")] } };
    };
    const a = new Train12306Adapter({ account: { cookies: COOKIE }, fetchFn });
    const items = await collect(a.sync({}));
    expect(items.map((i) => i.originalId)).toEqual([
      "12306:ticket:ticket-SEQ1:0",
      "12306:ticket:ticket-PEND1:0",
    ]);
    expect(items[0].payload.snapshot).toBe(true);
    expect(items[0].payload.capturedVia).toBe("cookie-api");
    expect(items[1].payload.isCompleted).toBe(false);
    // cookie header forwarded + completed form carries pagination params
    expect(calls[0].cookies).toBe(COOKIE);
    expect(calls[0].form).toMatchObject({
      come_from_flag: "my_order",
      pageSize: "50",
      pageIndex: "1",
    });
  });

  it("paginates completed orders until a short page", async () => {
    const fetchFn = async ({ url, form }) => {
      if (url.includes("NoComplete")) return { data: { orderDBList: [] } };
      const page = parseInt(form.pageIndex, 10);
      if (page === 1) {
        // exactly PAGE_SIZE (50) → triggers page 2
        const orders = Array.from({ length: 50 }, (_, i) => rawOrder(`P1-${i}`));
        return { data: { OrderDTODataList: orders } };
      }
      if (page === 2) return { data: { OrderDTODataList: [rawOrder("P2-0")] } };
      return { data: { OrderDTODataList: [] } };
    };
    const a = new Train12306Adapter({ account: { cookies: COOKIE }, fetchFn });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(51); // 50 + 1, then short page stops
  });

  it("honors limit + include gate", async () => {
    const fetchFn = async ({ url }) =>
      url.includes("NoComplete")
        ? { data: { orderDBList: [] } }
        : { data: { OrderDTODataList: [rawOrder("A"), rawOrder("B")] } };
    const a = new Train12306Adapter({ account: { cookies: COOKIE }, fetchFn });
    expect(await collect(a.sync({ limit: 1 }))).toHaveLength(1);
    expect(await collect(a.sync({ include: { ticket: false } }))).toHaveLength(0);
  });

  it("empty responses yield nothing (expired cookie / no orders)", async () => {
    const fetchFn = async () => ({});
    const a = new Train12306Adapter({ account: { cookies: COOKIE }, fetchFn });
    expect(await collect(a.sync({}))).toHaveLength(0);
  });

  it("throws when cookie mode active but no fetchFn injected", async () => {
    const a = new Train12306Adapter({ account: { cookies: COOKIE } });
    await expect(collect(a.sync({}))).rejects.toThrow(/no fetchFn configured/);
  });

  it("normalize maps a cookie ticket event → trip with capturedVia", async () => {
    const fetchFn = async ({ url }) =>
      url.includes("NoComplete")
        ? { data: { orderDBList: [] } }
        : { data: { OrderDTODataList: [rawOrder("SEQ1")] } };
    const a = new Train12306Adapter({ account: { cookies: COOKIE }, fetchFn });
    const [item] = await collect(a.sync({}));
    const batch = a.normalize(item);
    const ev = batch.events[0];
    expect(ev.subtype).toBe("trip");
    expect(ev.content.title).toBe("train: 上海虹桥 → 北京南");
    expect(ev.extra.vendorExtras).toMatchObject({
      capturedVia: "cookie-api",
      idLast6: "011234",
    });
  });
});
