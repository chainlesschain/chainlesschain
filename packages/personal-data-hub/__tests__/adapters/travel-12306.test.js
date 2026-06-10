"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  Train12306Adapter,
  parseRecords,
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
    expect(VERSION).toBe("0.6.0");
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
