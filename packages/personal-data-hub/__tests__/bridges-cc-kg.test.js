"use strict";

import { describe, it, expect, vi } from "vitest";
import * as realKg from "../../cli/src/lib/knowledge-graph.js";

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
      if (!entities.has(cfg.sourceId))
        throw new Error(`source not found: ${cfg.sourceId}`);
      if (!entities.has(cfg.targetId))
        throw new Error(`target not found: ${cfg.targetId}`);
      const index = relations.findIndex((r) => r.id === cfg.id);
      if (index >= 0) relations[index] = { ...cfg };
      else relations.push({ ...cfg });
      return cfg;
    },
    updateEntity(_db, id, cfg) {
      if (!entities.has(id)) throw new Error("Entity not found");
      entities.set(id, { ...cfg });
    },
    getEntity(id) {
      return entities.get(id);
    },
    listRelations({ sourceId }) {
      return relations.filter((r) => r.sourceId === sourceId);
    },
    removeRelation(_db, id) {
      const index = relations.findIndex((r) => r.id === id);
      if (index >= 0) relations.splice(index, 1);
    },
    removeEntity(_db, id) {
      entities.delete(id);
      for (let i = relations.length - 1; i >= 0; i -= 1) {
        if (relations[i].sourceId === id || relations[i].targetId === id)
          relations.splice(i, 1);
      }
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
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
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
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
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
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
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
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
    await sink.write([
      t("evt-x", "rdf:type", { literal: "event" }),
      t("evt-x", "subtype", { literal: "order" }),
    ]);
    expect(cc.entities.get("evt-x").name).toBe("evt-x");
    expect(cc.entities.get("evt-x").type).toBe("Event");
  });

  it("reports unsupported updates instead of treating existing IDs as success", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
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
    expect(r.errors).toEqual([
      expect.objectContaining({
        subject: "p1",
        error: expect.stringContaining("update unsupported"),
      }),
    ]);
  });

  it("captures unknown predicates under __extra", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
    await sink.write([
      t("evt-x", "rdf:type", { literal: "event" }),
      t("evt-x", "weird-predicate", { literal: "foo" }),
    ]);
    expect(cc.entities.get("evt-x").properties.__extra).toEqual({
      "weird-predicate": "foo",
    });
  });

  it("collects upstream errors (e.g. missing required field)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      addEntity: () => {
        throw new Error("upstream DB exploded");
      },
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
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
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
    expect(cc.relations).toContainEqual(
      expect.objectContaining({
        sourceId: "evt-1",
        targetId: "p1",
        relationType: "by",
      }),
    );
    expect(cc.relations).toContainEqual(
      expect.objectContaining({
        sourceId: "evt-1",
        targetId: "p1",
        relationType: "involves",
      }),
    );
  });

  it("skips relation when endpoint not in KG (no dangling refs)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
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
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
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
      addRelation: () => {
        throw new Error("Relation already exists");
      },
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
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
    const r = await sink.write([]);
    expect(r).toEqual({ entitiesUpserted: 0, relationsAdded: 0, errors: [] });
  });

  it("ignores malformed triples (missing subject/predicate)", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      addEntity: cc.addEntity,
      addRelation: cc.addRelation,
    });
    const r = await sink.write([
      { predicate: "rdf:type", literal: "person" },
      null,
      undefined,
    ]);
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

describe("CcKgSink projection recovery", () => {
  const person = (id, name) => [
    t(id, "rdf:type", { literal: "person" }),
    t(id, "has-name", { literal: name }),
  ];

  it("updates properties and removes stale owned edges while retaining manual and incoming edges", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink(cc);
    await sink.write([
      ...person("p1", "Alice"),
      ...person("p2", "Bob"),
      ...person("p3", "Carol"),
      t("p1", "by", { object: "p2" }),
      t("p3", "involves", { object: "p1" }),
      t("p1", "id:phone", { literal: "old" }),
    ]);
    cc.addRelation(null, {
      id: "manual-edge",
      sourceId: "p1",
      targetId: "p2",
      relationType: "knows",
    });
    const result = await sink.write([
      ...person("p1", "Alicia"),
      t("p1", "by", { object: "p3" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(cc.entities.get("p1")).toMatchObject({
      name: "Alicia",
      properties: { hubKind: "person" },
    });
    expect(cc.entities.get("p1").properties).not.toHaveProperty("id:phone");
    expect(cc.relations).toHaveLength(3);
    expect(cc.relations).toContainEqual(
      expect.objectContaining({ id: "manual-edge" }),
    );
    expect(cc.relations).not.toContainEqual(
      expect.objectContaining({
        sourceId: "p1",
        targetId: "p2",
        relationType: "by",
      }),
    );
  });

  it("replays against real KG with stable edge IDs and cross-instance endpoint lookup", async () => {
    realKg._resetState();
    const triples = [
      ...person("p1", "Alice"),
      ...person("p2", "Bob"),
      t("p1", "by", { object: "p2" }),
    ];
    const first = new CcKgSink(realKg);
    expect((await first.write(triples)).errors).toEqual([]);
    const firstEdge = realKg.listRelations()[0].id;
    const restarted = new CcKgSink(realKg);
    expect(
      (
        await restarted.write([
          ...person("p1", "Alicia"),
          t("p1", "by", { object: "p2" }),
        ])
      ).errors,
    ).toEqual([]);
    expect(realKg.listRelations()).toHaveLength(1);
    expect(realKg.listRelations()[0].id).toBe(firstEdge);
    expect(realKg.getEntity("p1").name).toBe("Alicia");
    expect(await restarted.remove(["p2"])).toEqual({ removed: 1, errors: [] });
    expect(realKg.getEntity("p2")).toBeNull();
    expect(realKg.listRelations()).toEqual([]);
    expect(await restarted.remove(["p2"])).toEqual({ removed: 1, errors: [] });
    realKg._resetState();
  });

  it("hydrates reference literals without clearing the reference's own outgoing edges", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink(cc);
    await sink.write([
      ...person("p", "Alice"),
      ...person("q", "Bob"),
      t("p", "involves", { object: "q" }),
    ]);
    const result = await sink.write(
      [
        t("e", "rdf:type", { literal: "event" }),
        t("e", "by", { object: "p" }),
        ...person("p", "Alice updated"),
        t("p", "id:phone", { literal: "latest" }),
      ],
      { referenceSubjects: ["p"] },
    );
    expect(result.errors).toEqual([]);
    expect(cc.relations).toHaveLength(2);
    expect(cc.entities.get("p").properties["id:phone"]).toBe("latest");
    expect(cc.relations).toContainEqual(
      expect.objectContaining({ sourceId: "p", targetId: "q" }),
    );
  });

  it("surfaces missing cleanup/removal capabilities and retryable asynchronous failures", async () => {
    const cc = makeFakeKg();
    const sink = new CcKgSink({
      ...cc,
      listRelations: undefined,
      removeEntity: undefined,
    });
    await sink.write(person("p1", "Alice"));
    expect((await sink.write(person("p1", "New"))).errors[0].error).toContain(
      "reconciliation unsupported",
    );
    expect((await sink.remove(["p1"])).errors[0].error).toContain(
      "removal unsupported",
    );
    const removeEntity = vi
      .fn()
      .mockRejectedValueOnce(new Error("database busy"))
      .mockImplementation(cc.removeEntity);
    const retrySink = new CcKgSink({ ...cc, removeEntity });
    expect((await retrySink.remove(["p1"])).errors[0].error).toBe(
      "database busy",
    );
    expect((await retrySink.remove(["p1"])).errors).toEqual([]);
    expect(cc.entities.has("p1")).toBe(false);
  });

  it("serializes deletion behind an in-flight write and allows re-creation afterward", async () => {
    const cc = makeFakeKg();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const sink = new CcKgSink({
      ...cc,
      addEntity: async (...args) => {
        await gate;
        return cc.addEntity(...args);
      },
    });
    const write = sink.write(person("p1", "Alice"));
    const remove = sink.remove(["p1"]);
    release();
    await Promise.all([write, remove]);
    expect(cc.entities.has("p1")).toBe(false);
    expect((await sink.write(person("p1", "New"))).errors).toEqual([]);
    expect(cc.entities.get("p1").name).toBe("New");
  });
});
