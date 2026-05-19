"use strict";

import { describe, it, expect } from "vitest";

const { CcKgSink, HUB_TO_CC_TYPE } = require("../lib/bridges/cc-kg-sink");

// ─── Fake cc KG (mirrors the real addEntity/addRelation signature) ──────

function makeFakeKg() {
  const entities = new Map();
  const relations = [];
  return {
    addEntity(_db, cfg) {
      if (!cfg || !cfg.id || !cfg.name || !cfg.type) {
        throw new Error("missing required fields");
      }
      if (entities.has(cfg.id)) {
        throw new Error(`Entity already exists: ${cfg.id}`);
      }
      entities.set(cfg.id, { ...cfg });
      return cfg;
    },
    addRelation(_db, cfg) {
      if (!entities.has(cfg.sourceId)) throw new Error(`source not found: ${cfg.sourceId}`);
      if (!entities.has(cfg.targetId)) throw new Error(`target not found: ${cfg.targetId}`);
      relations.push({ ...cfg });
      return cfg;
    },
    entities,
    relations,
  };
}

const t = (subject, predicate, opts) => {
  const out = { subject, predicate };
  if (opts && opts.object) out.object = opts.object;
  else if (opts && opts.literal !== undefined) out.literal = opts.literal;
  return out;
};

// ─── Tests ──────────────────────────────────────────────────────────────

describe("CcKgSink construction", () => {
  it("requires addEntity + addRelation", () => {
    expect(() => new CcKgSink()).toThrow();
    expect(() => new CcKgSink({ addRelation: () => {} })).toThrow(/addEntity/);
    expect(() => new CcKgSink({ addEntity: () => {} })).toThrow(/addRelation/);
  });
});

describe("CcKgSink.write entity creation", () => {
  it("creates entities from rdf:type + has-name triples", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    const r = await sink.write([
      t("p1", "rdf:type", { literal: "person" }),
      t("p1", "subtype", { literal: "contact" }),
      t("p1", "has-name", { literal: "妈妈" }),
      t("p1", "has-name", { literal: "陈某某" }),
      t("p1", "id:phone", { literal: "13800001111" }),
    ]);
    expect(r.entitiesUpserted).toBe(1);
    const e = cc.entities.get("p1");
    expect(e.type).toBe("Person");
    expect(e.name).toBe("妈妈"); // first name wins
    expect(e.properties.subtype).toBe("contact");
    expect(e.properties.hubKind).toBe("person");
    expect(e.properties.aliases).toEqual(["陈某某"]);
    expect(e.properties["id:phone"]).toBe("13800001111");
  });

  it("maps hub place → cc Concept with hubKind", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    await sink.write([
      t("pl1", "rdf:type", { literal: "place" }),
      t("pl1", "has-name", { literal: "妈妈家" }),
      t("pl1", "located-at", { literal: "24.5,118.1" }),
    ]);
    const e = cc.entities.get("pl1");
    expect(e.type).toBe("Concept");
    expect(e.properties.hubKind).toBe("place");
    expect(e.properties["located-at"]).toBe("24.5,118.1");
  });

  it("maps hub item / topic → cc Concept", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    await sink.write([
      t("i1", "rdf:type", { literal: "item" }),
      t("i1", "has-name", { literal: "蛋白粉" }),
      t("t1", "rdf:type", { literal: "topic" }),
      t("t1", "has-name", { literal: "母亲健康" }),
    ]);
    expect(cc.entities.get("i1").type).toBe("Concept");
    expect(cc.entities.get("i1").properties.hubKind).toBe("item");
    expect(cc.entities.get("t1").type).toBe("Concept");
    expect(cc.entities.get("t1").properties.hubKind).toBe("topic");
  });

  it("falls back to subject id when no has-name (uses Event subject as name)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    await sink.write([
      t("evt-x", "rdf:type", { literal: "event" }),
      t("evt-x", "subtype", { literal: "order" }),
    ]);
    expect(cc.entities.get("evt-x").name).toBe("evt-x");
    expect(cc.entities.get("evt-x").type).toBe("Event");
  });

  it("treats 'already exists' as upsert success (no error)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    await sink.write([
      t("p1", "rdf:type", { literal: "person" }),
      t("p1", "has-name", { literal: "alice" }),
    ]);
    // Second write of same subject — cc throws "already exists"
    const r = await sink.write([
      t("p1", "rdf:type", { literal: "person" }),
      t("p1", "has-name", { literal: "alice" }),
    ]);
    expect(r.entitiesUpserted).toBe(0);
    expect(r.errors.length).toBe(0); // already-exists treated as upsert hit
  });

  it("captures unknown predicates under __extra", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    await sink.write([
      t("evt-x", "rdf:type", { literal: "event" }),
      t("evt-x", "weird-predicate", { literal: "foo" }),
    ]);
    expect(cc.entities.get("evt-x").properties.__extra).toEqual({ "weird-predicate": "foo" });
  });

  it("collects upstream errors (e.g. missing required field)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      addEntity: () => { throw new Error("upstream DB exploded"); },
      addRelation: cc.addRelation,
    });
    const r = await sink.write([t("p1", "rdf:type", { literal: "person" })]);
    expect(r.entitiesUpserted).toBe(0);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].error).toContain("upstream DB exploded");
  });
});

describe("CcKgSink.write relation creation", () => {
  it("adds relations between created entities", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    const r = await sink.write([
      t("evt-1", "rdf:type", { literal: "event" }),
      t("evt-1", "subtype", { literal: "payment" }),
      t("p1", "rdf:type", { literal: "person" }),
      t("p1", "has-name", { literal: "mom" }),
      t("evt-1", "by", { object: "p1" }),
      t("evt-1", "involves", { object: "p1" }),
    ]);
    expect(r.entitiesUpserted).toBe(2);
    expect(r.relationsAdded).toBe(2);
    expect(cc.relations).toContainEqual({ sourceId: "evt-1", targetId: "p1", relationType: "by" });
    expect(cc.relations).toContainEqual({ sourceId: "evt-1", targetId: "p1", relationType: "involves" });
  });

  it("skips relation when endpoint not in KG (no dangling refs)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    const r = await sink.write([
      t("evt-1", "rdf:type", { literal: "event" }),
      // p-missing was never declared with rdf:type
      t("evt-1", "by", { object: "p-missing" }),
    ]);
    expect(r.relationsAdded).toBe(0);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].error).toContain("endpoint not in KG");
  });

  it("rejects unknown predicates (defensive — don't poison cc KG)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    await sink.write([t("e", "rdf:type", { literal: "event" })]);
    await sink.write([t("p", "rdf:type", { literal: "person" })]);
    const r = await sink.write([t("e", "frobnicate", { object: "p" })]);
    expect(r.relationsAdded).toBe(0);
    expect(r.errors[0].error).toBe("unknown predicate");
  });

  it("tolerates duplicate-relation errors as success", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: () => { throw new Error("Relation already exists"); },
    });
    await sink.write([
      t("e", "rdf:type", { literal: "event" }),
      t("p", "rdf:type", { literal: "person" }),
    ]);
    const r = await sink.write([t("e", "by", { object: "p" })]);
    // Even though addRelation throws "already exists", sink treats as success.
    expect(r.errors.length).toBe(0);
  });
});

describe("CcKgSink edge cases", () => {
  it("returns zeros for empty input", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    const r = await sink.write([]);
    expect(r).toEqual({ entitiesUpserted: 0, relationsAdded: 0, errors: [] });
  });

  it("ignores malformed triples (missing subject/predicate)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({ addEntity: cc.addEntity, addRelation: cc.addRelation });
    const r = await sink.write([{ predicate: "rdf:type", literal: "person" }, null, undefined]);
    expect(r.entitiesUpserted).toBe(0);
    expect(cc.entities.size).toBe(0);
  });

  it("HUB_TO_CC_TYPE exposes the documented mapping", () => {
    expect(HUB_TO_CC_TYPE.person).toBe("Person");
    expect(HUB_TO_CC_TYPE.event).toBe("Event");
    expect(HUB_TO_CC_TYPE.place).toBe("Concept");
    expect(HUB_TO_CC_TYPE.item).toBe("Concept");
    expect(HUB_TO_CC_TYPE.topic).toBe("Concept");
  });
});
