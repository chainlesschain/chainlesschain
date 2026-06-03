"use strict";

import { describe, it, expect } from "vitest";

const {
  deriveEventTriples,
  derivePersonTriples,
  derivePlaceTriples,
  deriveItemTriples,
  deriveTopicTriples,
  deriveBatchTriples,
  deriveEntityTriples,
  triple,
} = require("../lib/kg-derive");

const { newId } = require("../lib/ids");

const sourceOk = (adapter = "test") => ({
  adapter,
  adapterVersion: "0.1.0",
  capturedAt: Date.now(),
  capturedBy: "api",
});

describe("triple()", () => {
  it("makes an object triple with subject + predicate + object", () => {
    const t = triple("a", "knows", { object: "b" });
    expect(t).toEqual({ subject: "a", predicate: "knows", object: "b" });
  });
  it("makes a literal triple", () => {
    const t = triple("a", "name", { literal: "Alice" });
    expect(t).toEqual({ subject: "a", predicate: "name", literal: "Alice" });
  });
  it("skips object/literal when null/undefined", () => {
    const t = triple("a", "p", {});
    expect(t).toEqual({ subject: "a", predicate: "p" });
  });
});

describe("deriveEventTriples", () => {
  it("emits the minimal set: rdf:type / subtype / occurred-at / source", () => {
    const id = newId();
    const e = {
      id,
      type: "event",
      subtype: "message",
      occurredAt: 1700000000000,
      ingestedAt: 1700000000001,
      content: { text: "hi" },
      source: sourceOk("wechat"),
    };
    const ts = deriveEventTriples(e);
    expect(ts).toContainEqual({ subject: id, predicate: "rdf:type", literal: "event" });
    expect(ts).toContainEqual({ subject: id, predicate: "subtype", literal: "message" });
    expect(ts).toContainEqual({ subject: id, predicate: "occurred-at", literal: 1700000000000 });
    expect(ts).toContainEqual({ subject: id, predicate: "source", literal: "wechat" });
  });

  it("emits 'by' for actor and 'involves' for each participant", () => {
    const id = newId();
    const e = {
      id,
      type: "event",
      subtype: "payment",
      occurredAt: 1,
      ingestedAt: 1,
      actor: "person-self",
      participants: ["person-self", "person-mom"],
      content: { text: "transfer" },
      source: sourceOk(),
    };
    const ts = deriveEventTriples(e);
    expect(ts).toContainEqual({ subject: id, predicate: "by", object: "person-self" });
    expect(ts).toContainEqual({ subject: id, predicate: "involves", object: "person-self" });
    expect(ts).toContainEqual({ subject: id, predicate: "involves", object: "person-mom" });
  });

  it("emits amount components when content.amount present", () => {
    const id = newId();
    const e = {
      id,
      type: "event",
      subtype: "order",
      occurredAt: 1,
      ingestedAt: 1,
      content: { amount: { value: 288.5, currency: "CNY", direction: "out" } },
      source: sourceOk(),
    };
    const ts = deriveEventTriples(e);
    expect(ts).toContainEqual({ subject: id, predicate: "amount-value", literal: 288.5 });
    expect(ts).toContainEqual({ subject: id, predicate: "amount-currency", literal: "CNY" });
    expect(ts).toContainEqual({ subject: id, predicate: "amount-direction", literal: "out" });
  });
});

describe("derivePersonTriples", () => {
  it("emits rdf:type + subtype + every name + identifier", () => {
    const id = newId();
    const p = {
      id,
      type: "person",
      subtype: "contact",
      names: ["妈妈", "陈某某"],
      identifiers: { phone: ["13800001111", "13900002222"], wechatId: "wxid_xyz" },
      ingestedAt: 1,
      source: sourceOk(),
    };
    const ts = derivePersonTriples(p);
    expect(ts).toContainEqual({ subject: id, predicate: "rdf:type", literal: "person" });
    expect(ts).toContainEqual({ subject: id, predicate: "subtype", literal: "contact" });
    expect(ts).toContainEqual({ subject: id, predicate: "has-name", literal: "妈妈" });
    expect(ts).toContainEqual({ subject: id, predicate: "has-name", literal: "陈某某" });
    expect(ts).toContainEqual({ subject: id, predicate: "id:phone", literal: "13800001111" });
    expect(ts).toContainEqual({ subject: id, predicate: "id:phone", literal: "13900002222" });
    expect(ts).toContainEqual({ subject: id, predicate: "id:wechatId", literal: "wxid_xyz" });
  });
});

describe("derivePlaceTriples", () => {
  it("emits has-name + has-alias (deduped) + located-at + address", () => {
    const id = newId();
    const pl = {
      id,
      type: "place",
      name: "妈妈家",
      aliases: ["妈妈家", "妈家", "home"],
      coordinates: { lat: 24.5, lng: 118.1 },
      address: "厦门思明区",
      category: "home",
      ingestedAt: 1,
      source: sourceOk(),
    };
    const ts = derivePlaceTriples(pl);
    expect(ts).toContainEqual({ subject: id, predicate: "has-name", literal: "妈妈家" });
    // The primary name shouldn't duplicate as alias
    expect(ts.filter((t) => t.predicate === "has-name").length).toBe(1);
    expect(ts.some((t) => t.predicate === "has-alias" && t.literal === "妈家")).toBe(true);
    expect(ts).toContainEqual({ subject: id, predicate: "located-at", literal: "24.5,118.1" });
    expect(ts).toContainEqual({ subject: id, predicate: "address", literal: "厦门思明区" });
  });
});

describe("deriveItemTriples", () => {
  it("emits price + merchant", () => {
    const id = newId();
    const i = {
      id,
      type: "item",
      subtype: "product",
      name: "蛋白粉",
      price: { value: 288, currency: "CNY" },
      merchant: "person-xy-store",
      ingestedAt: 1,
      source: sourceOk(),
    };
    const ts = deriveItemTriples(i);
    expect(ts).toContainEqual({ subject: id, predicate: "priced-at", literal: "288 CNY" });
    expect(ts).toContainEqual({ subject: id, predicate: "sold-by", object: "person-xy-store" });
  });
});

describe("deriveTopicTriples", () => {
  it("emits parent + derived-from for each event", () => {
    const id = newId();
    const e1 = newId();
    const e2 = newId();
    const t = {
      id,
      type: "topic",
      name: "母亲健康",
      parentTopic: "topic-family",
      derivedFromEvents: [e1, e2],
      ingestedAt: 1,
      source: sourceOk(),
    };
    const ts = deriveTopicTriples(t);
    expect(ts).toContainEqual({ subject: id, predicate: "parent", object: "topic-family" });
    expect(ts).toContainEqual({ subject: id, predicate: "derived-from", object: e1 });
    expect(ts).toContainEqual({ subject: id, predicate: "derived-from", object: e2 });
  });
});

describe("deriveBatchTriples + deriveEntityTriples", () => {
  it("walks all 5 entity kinds in a batch", () => {
    const batch = {
      events: [{ id: "e", type: "event", subtype: "message", occurredAt: 1, ingestedAt: 1, content: {}, source: sourceOk() }],
      persons: [{ id: "p", type: "person", subtype: "contact", names: ["x"], ingestedAt: 1, source: sourceOk() }],
      places: [{ id: "pl", type: "place", name: "home", aliases: [], ingestedAt: 1, source: sourceOk() }],
      items: [{ id: "i", type: "item", subtype: "product", name: "thing", ingestedAt: 1, source: sourceOk() }],
      topics: [{ id: "t", type: "topic", name: "x", ingestedAt: 1, source: sourceOk() }],
    };
    const ts = deriveBatchTriples(batch);
    expect(ts.length).toBeGreaterThan(5); // at least the 5 rdf:type rows
    expect(ts.some((x) => x.subject === "e" && x.predicate === "rdf:type")).toBe(true);
    expect(ts.some((x) => x.subject === "p" && x.predicate === "rdf:type")).toBe(true);
    expect(ts.some((x) => x.subject === "pl" && x.predicate === "rdf:type")).toBe(true);
    expect(ts.some((x) => x.subject === "i" && x.predicate === "rdf:type")).toBe(true);
    expect(ts.some((x) => x.subject === "t" && x.predicate === "rdf:type")).toBe(true);
  });

  it("deriveEntityTriples dispatches by .type and returns [] for unknown", () => {
    expect(deriveEntityTriples(null)).toEqual([]);
    expect(deriveEntityTriples({ type: "frobnicate" })).toEqual([]);
    const ts = deriveEntityTriples({
      id: "p",
      type: "person",
      subtype: "contact",
      names: ["x"],
      ingestedAt: 1,
      source: sourceOk(),
    });
    expect(ts.length).toBeGreaterThan(0);
  });

  it("returns [] for non-object batch input", () => {
    expect(deriveBatchTriples(null)).toEqual([]);
    expect(deriveBatchTriples("oops")).toEqual([]);
  });
});
