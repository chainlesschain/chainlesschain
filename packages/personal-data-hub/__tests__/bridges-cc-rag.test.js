"use strict";

import { describe, it, expect } from "vitest";

const { CcRagSink } = require("../lib/bridges/cc-rag-sink");

// Mirror BM25.addDocument shape — captures everything for assertion
function makeFakeBm25() {
  const docs = [];
  return {
    docs,
    addDocument(doc) {
      docs.push({ ...doc });
    },
  };
}

const doc = (id, text, type = "event", metadata = {}) => ({
  id,
  type,
  text,
  metadata,
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("CcRagSink construction", () => {
  it("requires bm25 with addDocument", () => {
    expect(() => new CcRagSink()).toThrow();
    expect(() => new CcRagSink({})).toThrow(/bm25/);
    expect(() => new CcRagSink({ bm25: {} })).toThrow(/addDocument/);
  });

  it("accepts bm25 with addDocument; optional vector + logger + transformDoc", () => {
    const bm25 = makeFakeBm25();
    const s = new CcRagSink({
      bm25,
      vector: { index: async () => {} },
      logger: () => {},
      transformDoc: (d) => d,
    });
    expect(s).toBeDefined();
  });
});

describe("CcRagSink.write", () => {
  it("indexes docs to BM25 in cc-expected shape", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    const r = await sink.write([
      doc("evt-1", "妈妈生日蛋白粉 +288.50 CNY", "event", { subtype: "order", adapter: "taobao" }),
      doc("evt-2", "按摩仪 给妈妈", "event", { subtype: "order", adapter: "taobao" }),
    ]);
    expect(r.indexed).toBe(2);
    expect(r.skipped).toBe(0);
    expect(bm25.docs.length).toBe(2);
    expect(bm25.docs[0].id).toBe("evt-1");
    expect(bm25.docs[0].content).toContain("妈妈生日蛋白粉");
    expect(bm25.docs[0].title).toBe("order"); // metadata.subtype used as title
    expect(bm25.docs[0].meta.adapter).toBe("taobao");
    expect(bm25.docs[0].hubType).toBe("event");
  });

  it("falls back to hub type as title when no metadata.title/.subtype", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    await sink.write([doc("p-1", "妈妈 陈某某", "person", {})]);
    expect(bm25.docs[0].title).toBe("person");
  });

  it("metadata.title overrides subtype/type", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    await sink.write([doc("x", "body", "event", { title: "custom title", subtype: "order" })]);
    expect(bm25.docs[0].title).toBe("custom title");
  });

  it("dedupes by id within the sink lifetime", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    await sink.write([doc("evt-1", "text v1")]);
    const r = await sink.write([doc("evt-1", "text v2")]);
    expect(r.indexed).toBe(0);
    expect(r.skipped).toBe(1);
    expect(bm25.docs.length).toBe(1);
    expect(bm25.docs[0].content).toBe("text v1"); // first write wins
  });

  it("skips empty / malformed docs", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    const r = await sink.write([
      doc("a", ""),                              // empty text
      doc("b", "real text"),
      { id: "c" /* missing text */ },
      null,
      { /* missing id */ text: "orphan" },
    ]);
    expect(r.indexed).toBe(1);
    expect(r.skipped).toBe(4);
    expect(bm25.docs.length).toBe(1);
  });

  it("collects upstream BM25 errors without aborting batch", async () => {
    let failOn = "evt-2";
    const sink = new CcRagSink({
      bm25: {
        addDocument(d) {
          if (d.id === failOn) throw new Error("BM25 backend full");
        },
      },
    });
    const r = await sink.write([doc("evt-1", "a"), doc("evt-2", "b"), doc("evt-3", "c")]);
    expect(r.indexed).toBe(2);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].id).toBe("evt-2");
  });

  it("forwards to vector store when wired", async () => {
    const bm25 = makeFakeBm25();
    const vectorCalls = [];
    const sink = new CcRagSink({
      bm25,
      vector: { index: async (docs) => { vectorCalls.push(docs); } },
    });
    const r = await sink.write([doc("a", "alpha"), doc("b", "beta")]);
    expect(r.indexed).toBe(2);
    expect(vectorCalls.length).toBe(1);
    expect(vectorCalls[0].length).toBe(2);
  });

  it("vector failure is captured but BM25 indexing still succeeds", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({
      bm25,
      vector: { index: async () => { throw new Error("qdrant down"); } },
    });
    const r = await sink.write([doc("a", "alpha")]);
    expect(r.indexed).toBe(1);
    expect(bm25.docs.length).toBe(1);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].phase).toBe("vector");
  });

  it("transformDoc hook lets caller rewrite the doc shape", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({
      bm25,
      transformDoc: (d) => ({ id: d.id, title: "OVERRIDE", content: d.text.toUpperCase() }),
    });
    await sink.write([doc("a", "hello")]);
    expect(bm25.docs[0].title).toBe("OVERRIDE");
    expect(bm25.docs[0].content).toBe("HELLO");
  });

  it("returns zeros for empty input", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    const r = await sink.write([]);
    expect(r).toEqual({ indexed: 0, skipped: 0, errors: [] });
  });
});
