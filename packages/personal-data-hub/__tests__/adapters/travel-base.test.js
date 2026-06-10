"use strict";

import { describe, it, expect } from "vitest";

const {
  normalizeTravelRecord,
  parseChineseDateTime,
  placeIdFor,
  slug,
} = require("../../lib/adapters/travel-base");

describe("normalizeTravelRecord", () => {
  const fullRecord = {
    vendorId: "12306",
    recordId: "E123456789",
    vehicleType: "train",
    from: { station: "上海虹桥", city: "上海" },
    to: { station: "北京南", city: "北京" },
    departureMs: 1716383021000,
    arrivalMs: 1716401021000,
    carrier: "12306",
    vehicleNumber: "G35",
    totalCost: { value: 553.5, currency: "CNY" },
    traveler: "张三",
    confirmationCode: "E123456789",
    bookedAt: 1716000000000,
    extras: { seat: "二等座" },
  };

  it("throws without rec / recordId", () => {
    expect(() => normalizeTravelRecord(null)).toThrow(/rec required/);
    expect(() => normalizeTravelRecord({})).toThrow(/recordId required/);
  });

  it("emits 1 trip event with title, amount, vehicle metadata", () => {
    const batch = normalizeTravelRecord(fullRecord, {
      adapterName: "travel-12306",
      adapterVersion: "0.6.0",
    });
    expect(batch.events).toHaveLength(1);
    const ev = batch.events[0];
    expect(ev.type).toBe("event");
    expect(ev.subtype).toBe("trip");
    expect(ev.occurredAt).toBe(1716383021000); // departureMs wins
    expect(ev.content.title).toBe("train: 上海虹桥 → 北京南");
    expect(ev.content.amount).toEqual({
      value: 553.5,
      currency: "CNY",
      direction: "out",
    });
    expect(ev.source).toMatchObject({
      adapter: "travel-12306",
      adapterVersion: "0.6.0",
      originalId: "E123456789",
    });
    expect(ev.extra).toMatchObject({
      vehicleType: "train",
      vendorId: "12306",
      from: "上海虹桥",
      to: "北京南",
      vehicleNumber: "G35",
      confirmationCode: "E123456789",
      arrivalMs: 1716401021000,
      bookedAt: 1716000000000,
    });
  });

  it("emits from/to places with stable dedup-able ids", () => {
    const batch = normalizeTravelRecord(fullRecord, {
      adapterName: "travel-12306",
    });
    expect(batch.places).toHaveLength(2);
    expect(batch.places[0].name).toBe("上海虹桥");
    expect(batch.places[0].type).toBe("place");
    // same station on another trip → same place id (cross-trip dedup)
    const again = normalizeTravelRecord(
      { ...fullRecord, recordId: "OTHER" },
      { adapterName: "travel-12306" },
    );
    expect(again.places[0].id).toBe(batch.places[0].id);
  });

  it("emits carrier as merchant person + traveler as contact person", () => {
    const batch = normalizeTravelRecord(fullRecord, {
      adapterName: "travel-12306",
    });
    const merchant = batch.persons.find((p) => p.subtype === "merchant");
    const contact = batch.persons.find((p) => p.subtype === "contact");
    expect(merchant.names).toEqual(["12306"]);
    expect(contact.names).toEqual(["张三"]);
    // traveler becomes the actor; self + traveler + carrier participate
    const ev = batch.events[0];
    expect(ev.actor).toBe(contact.id);
    expect(ev.participants).toEqual(["person-self", contact.id, merchant.id]);
  });

  it("suppresses traveler person when traveler is self", () => {
    const batch = normalizeTravelRecord(fullRecord, {
      adapterName: "travel-12306",
      selfName: "张三",
    });
    expect(batch.persons.find((p) => p.subtype === "contact")).toBeUndefined();
    expect(batch.events[0].actor).toBe("person-self");
  });

  it("falls back occurredAt: departureMs → bookedAt → now", () => {
    const noDeparture = normalizeTravelRecord({
      recordId: "R1",
      bookedAt: 1716000000000,
    });
    expect(noDeparture.events[0].occurredAt).toBe(1716000000000);
    const before = Date.now();
    const bare = normalizeTravelRecord({ recordId: "R2" });
    expect(bare.events[0].occurredAt).toBeGreaterThanOrEqual(before);
  });

  it("builds partial titles when from/to missing", () => {
    const toOnly = normalizeTravelRecord({
      recordId: "R1",
      vehicleType: "visit",
      to: { name: "咖啡店" },
    });
    expect(toOnly.events[0].content.title).toBe("visit: → 咖啡店");
    const neither = normalizeTravelRecord({
      recordId: "R2",
      carrier: "高德地图",
    });
    expect(neither.events[0].content.title).toBe("trip: 高德地图");
  });

  it("omits amount when totalCost.value not finite", () => {
    const batch = normalizeTravelRecord({
      recordId: "R1",
      totalCost: { value: NaN },
    });
    expect(batch.events[0].content.amount).toBeUndefined();
  });
});

describe("parseChineseDateTime", () => {
  it("parses YYYY-MM-DD HH:MM:SS (local time)", () => {
    expect(parseChineseDateTime("2026-04-15 14:30:00")).toBe(
      new Date(2026, 3, 15, 14, 30, 0).getTime(),
    );
  });

  it("parses YYYY/MM/DD HH:MM", () => {
    expect(parseChineseDateTime("2026/4/15 14:30")).toBe(
      new Date(2026, 3, 15, 14, 30).getTime(),
    );
  });

  it("parses 2026年4月15日 14:30", () => {
    expect(parseChineseDateTime("2026年4月15日 14:30")).toBe(
      new Date(2026, 3, 15, 14, 30).getTime(),
    );
  });

  it("parses 2026年4月15日 (date only)", () => {
    expect(parseChineseDateTime("2026年4月15日")).toBe(
      new Date(2026, 3, 15).getTime(),
    );
  });

  it("parses ISO-with-Z via the first regex AS LOCAL TIME (documented quirk)", () => {
    // The YYYY-MM-DD[T ]HH:MM regex matches before the Date.parse fallback
    // and ignores the Z suffix — Chinese app dumps are local-time anyway.
    expect(parseChineseDateTime("2026-04-15T06:30:00.000Z")).toBe(
      new Date(2026, 3, 15, 6, 30, 0).getTime(),
    );
  });

  it("falls back to Date.parse for formats no regex matches", () => {
    expect(parseChineseDateTime("Apr 15, 2026")).toBe(
      Date.parse("Apr 15, 2026"),
    );
  });

  it("returns null for garbage / empty / non-string", () => {
    expect(parseChineseDateTime("not a date")).toBe(null);
    expect(parseChineseDateTime("")).toBe(null);
    expect(parseChineseDateTime(42)).toBe(null);
  });
});

describe("placeIdFor + slug", () => {
  it("keys by station first, lowercased + slugged", () => {
    expect(placeIdFor({ station: "北京南", city: "北京" }, "travel-12306")).toBe(
      "place-travel-12306-北京南",
    );
    expect(placeIdFor({ city: "Shanghai HongQiao" }, "a")).toBe(
      "place-a-shanghai-hongqiao",
    );
  });

  it("returns null for empty place", () => {
    expect(placeIdFor(null, "a")).toBe(null);
  });

  it("slug strips punctuation, keeps CJK + word chars + dash", () => {
    expect(slug("高德地图")).toBe("高德地图");
    expect(slug("Air China! (CA)")).toBe("air-china-ca");
    expect(slug("")).toBe("");
  });
});
