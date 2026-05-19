"use strict";

import { describe, it, expect } from "vitest";

const {
  validate,
  validatePerson,
  validateEvent,
  validatePlace,
  validateItem,
  validateTopic,
} = require("../lib/schemas");
const { newId } = require("../lib/ids");

// ─── Fixtures ─────────────────────────────────────────────────────────────

const sourceOk = () => ({
  adapter: "email-imap",
  adapterVersion: "0.1.0",
  capturedAt: Date.now(),
  capturedBy: "api",
});

const personOk = (overrides = {}) => ({
  id: newId(),
  type: "person",
  subtype: "contact",
  names: ["妈妈", "陈某某"],
  ingestedAt: Date.now(),
  source: sourceOk(),
  ...overrides,
});

const eventOk = (overrides = {}) => ({
  id: newId(),
  type: "event",
  subtype: "message",
  occurredAt: Date.now() - 1000,
  ingestedAt: Date.now(),
  content: { text: "Hello" },
  source: sourceOk(),
  ...overrides,
});

const placeOk = (overrides = {}) => ({
  id: newId(),
  type: "place",
  name: "家",
  aliases: ["home"],
  ingestedAt: Date.now(),
  source: sourceOk(),
  ...overrides,
});

const itemOk = (overrides = {}) => ({
  id: newId(),
  type: "item",
  subtype: "product",
  name: "蛋白粉",
  ingestedAt: Date.now(),
  source: sourceOk(),
  ...overrides,
});

const topicOk = (overrides = {}) => ({
  id: newId(),
  type: "topic",
  name: "母亲健康",
  ingestedAt: Date.now(),
  source: sourceOk(),
  ...overrides,
});

// ─── Person ───────────────────────────────────────────────────────────────

describe("validatePerson", () => {
  it("accepts a minimal valid contact", () => {
    const r = validatePerson(personOk());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts ai-agent subtype (for AI vendors)", () => {
    const r = validatePerson(
      personOk({ subtype: "ai-agent", names: ["DeepSeek"], identifiers: { vendor: "deepseek" } })
    );
    expect(r.valid).toBe(true);
  });

  it("rejects empty names array", () => {
    const r = validatePerson(personOk({ names: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("names"))).toBe(true);
  });

  it("rejects unknown subtype", () => {
    const r = validatePerson(personOk({ subtype: "alien" }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("subtype"))).toBe(true);
  });

  it("rejects wrong type field", () => {
    const r = validatePerson(personOk({ type: "event" }));
    expect(r.valid).toBe(false);
  });

  it("accepts identifiers with string or string[] values", () => {
    const r = validatePerson(
      personOk({
        identifiers: { phone: ["138-0000-1111"], email: "mom@example.com", wechatId: "wxid_xyz" },
      })
    );
    expect(r.valid).toBe(true);
  });

  it("rejects identifiers value of wrong type", () => {
    const r = validatePerson(personOk({ identifiers: { phone: 13800001111 } }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("identifiers.phone"))).toBe(true);
  });
});

// ─── Event ────────────────────────────────────────────────────────────────

describe("validateEvent", () => {
  it("accepts a minimal valid message event", () => {
    const r = validateEvent(eventOk());
    expect(r.valid).toBe(true);
  });

  it("accepts an order event with amount", () => {
    const r = validateEvent(
      eventOk({
        subtype: "order",
        content: {
          title: "蛋白粉",
          amount: { value: 288.5, currency: "CNY", direction: "out" },
        },
      })
    );
    expect(r.valid).toBe(true);
  });

  it("rejects amount missing direction", () => {
    const r = validateEvent(
      eventOk({ content: { amount: { value: 100, currency: "CNY" } } })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("direction"))).toBe(true);
  });

  it("rejects amount with non-number value", () => {
    const r = validateEvent(
      eventOk({ content: { amount: { value: "100", currency: "CNY", direction: "out" } } })
    );
    expect(r.valid).toBe(false);
  });

  it("rejects negative occurredAt", () => {
    const r = validateEvent(eventOk({ occurredAt: -1 }));
    expect(r.valid).toBe(false);
  });

  it("rejects unknown subtype", () => {
    const r = validateEvent(eventOk({ subtype: "frobnicate" }));
    expect(r.valid).toBe(false);
  });

  it("accepts ai-message subtype with vendor extra", () => {
    const r = validateEvent(
      eventOk({
        subtype: "ai-message",
        extra: { vendor: "deepseek", role: "assistant", modelName: "deepseek-r1" },
      })
    );
    expect(r.valid).toBe(true);
  });

  it("accepts ai-image-generation subtype (Dreamina)", () => {
    const r = validateEvent(eventOk({ subtype: "ai-image-generation" }));
    expect(r.valid).toBe(true);
  });

  it("rejects participants of wrong type", () => {
    const r = validateEvent(eventOk({ participants: ["valid-id", 42] }));
    expect(r.valid).toBe(false);
  });

  it("accepts media event with mediaRefs", () => {
    const r = validateEvent(
      eventOk({ subtype: "media", content: { mediaRefs: ["/var/data/img1.jpg"] } })
    );
    expect(r.valid).toBe(true);
  });
});

// ─── Place ────────────────────────────────────────────────────────────────

describe("validatePlace", () => {
  it("accepts a minimal place", () => {
    const r = validatePlace(placeOk());
    expect(r.valid).toBe(true);
  });

  it("accepts place with coordinates", () => {
    const r = validatePlace(placeOk({ coordinates: { lat: 24.4798, lng: 118.0894 } }));
    expect(r.valid).toBe(true);
  });

  it("rejects coordinates out of range", () => {
    const r = validatePlace(placeOk({ coordinates: { lat: 91, lng: 0 } }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("lat"))).toBe(true);
  });

  it("rejects place missing aliases (required, possibly empty array)", () => {
    const r = validatePlace(placeOk({ aliases: undefined }));
    expect(r.valid).toBe(false);
  });

  it("accepts place with empty aliases array", () => {
    const r = validatePlace(placeOk({ aliases: [] }));
    expect(r.valid).toBe(true);
  });
});

// ─── Item ─────────────────────────────────────────────────────────────────

describe("validateItem", () => {
  it("accepts a minimal product item", () => {
    const r = validateItem(itemOk());
    expect(r.valid).toBe(true);
  });

  it("accepts item with price", () => {
    const r = validateItem(itemOk({ price: { value: 99.9, currency: "CNY" } }));
    expect(r.valid).toBe(true);
  });

  it("rejects price with missing currency", () => {
    const r = validateItem(itemOk({ price: { value: 99 } }));
    expect(r.valid).toBe(false);
  });

  it("rejects empty name", () => {
    const r = validateItem(itemOk({ name: "" }));
    expect(r.valid).toBe(false);
  });

  it("accepts link subtype", () => {
    const r = validateItem(
      itemOk({ subtype: "link", name: "Some article", externalUrl: "https://example.com/x" })
    );
    expect(r.valid).toBe(true);
  });
});

// ─── Topic ────────────────────────────────────────────────────────────────

describe("validateTopic", () => {
  it("accepts a minimal topic", () => {
    const r = validateTopic(topicOk());
    expect(r.valid).toBe(true);
  });

  it("accepts topic with derivedFromEvents", () => {
    const r = validateTopic(
      topicOk({ derivedFromEvents: [newId(), newId(), newId()] })
    );
    expect(r.valid).toBe(true);
  });

  it("rejects derivedFromEvents of wrong type", () => {
    const r = validateTopic(topicOk({ derivedFromEvents: "not-array" }));
    expect(r.valid).toBe(false);
  });
});

// ─── Base / source / generic dispatch ─────────────────────────────────────

describe("validateBase + generic validate()", () => {
  it("rejects entity missing source", () => {
    const e = eventOk();
    delete e.source;
    const r = validateEvent(e);
    expect(r.valid).toBe(false);
    expect(r.errors.some((x) => x.includes("source"))).toBe(true);
  });

  it("rejects source.capturedBy outside enum", () => {
    const e = eventOk({ source: { ...sourceOk(), capturedBy: "telepathy" } });
    const r = validateEvent(e);
    expect(r.valid).toBe(false);
  });

  it("rejects negative ingestedAt", () => {
    const r = validatePerson(personOk({ ingestedAt: -5 }));
    expect(r.valid).toBe(false);
  });

  it("accepts confidence in [0,1]", () => {
    const r = validateEvent(eventOk({ confidence: 0.5 }));
    expect(r.valid).toBe(true);
  });

  it("rejects confidence outside [0,1]", () => {
    expect(validateEvent(eventOk({ confidence: 1.5 })).valid).toBe(false);
    expect(validateEvent(eventOk({ confidence: -0.1 })).valid).toBe(false);
  });

  it("generic validate() dispatches by type", () => {
    expect(validate(personOk()).valid).toBe(true);
    expect(validate(eventOk()).valid).toBe(true);
    expect(validate(placeOk()).valid).toBe(true);
    expect(validate(itemOk()).valid).toBe(true);
    expect(validate(topicOk()).valid).toBe(true);
  });

  it("generic validate() rejects unknown type", () => {
    const r = validate({ ...personOk(), type: "unknown-type" });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/unknown entity type/);
  });

  it("rejects null / non-object input", () => {
    expect(validate(null).valid).toBe(false);
    expect(validate(undefined).valid).toBe(false);
    expect(validate("string").valid).toBe(false);
    expect(validate([]).valid).toBe(false);
  });
});
