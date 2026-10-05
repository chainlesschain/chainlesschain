"use strict";

import { describe, it, expect, vi } from "vitest";
import { BM25Search } from "../../cli/src/lib/bm25-search.js";

const { CcRagSink } = require("../lib/bridges/cc-rag-sink");

// Mirror BM25.addDocument shape — captures everything for assertion
function makeFakeBm25() {
  const docs = [];
  return {
    docs,
    addDocument(doc) {
      docs.push({ ...doc });
    },
    removeDocument(id) {
      const index = docs.findIndex((entry) => entry.id === id);
      if (index !== -1) docs.splice(index, 1);
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
      doc("evt-1", "妈妈生日蛋白粉 +288.50 CNY", "event", {
        subtype: "order",
        adapter: "taobao",
      }),
      doc("evt-2", "按摩仪 给妈妈", "event", {
        subtype: "order",
        adapter: "taobao",
      }),
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
    await sink.write([
      doc("x", "body", "event", { title: "custom title", subtype: "order" }),
    ]);
    expect(bm25.docs[0].title).toBe("custom title");
  });

  it("replaces changed content for the same ID without duplicating the document", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    await sink.write([doc("evt-1", "text v1")]);
    const r = await sink.write([doc("evt-1", "text v2")]);
    expect(r.indexed).toBe(1);
    expect(r.skipped).toBe(0);
    expect(bm25.docs.length).toBe(1);
    expect(bm25.docs[0].content).toBe("text v2");
  });

  it("deduplicates unchanged content regardless of metadata key order", async () => {
    const bm25 = makeFakeBm25();
    const add = vi.spyOn(bm25, "addDocument");
    const index = vi.fn(async () => {});
    const sink = new CcRagSink({ bm25, vector: { index } });
    await sink.write([
      doc("a", "body", "event", { title: "title", adapter: "mail" }),
    ]);
    const result = await sink.write([
      doc("a", "body", "event", { adapter: "mail", title: "title" }),
    ]);
    expect(result).toEqual({ indexed: 0, skipped: 1, errors: [] });
    expect(add).toHaveBeenCalledTimes(1);
    expect(index).toHaveBeenCalledTimes(1);
  });

  it("updates metadata-only revisions and both search indexes", async () => {
    const bm25 = makeFakeBm25();
    const index = vi.fn(async () => {});
    const sink = new CcRagSink({ bm25, vector: { index } });
    await sink.write([doc("a", "body", "event", { title: "old title" })]);
    await sink.write([doc("a", "body", "event", { title: "new title" })]);
    expect(bm25.docs).toHaveLength(1);
    expect(bm25.docs[0].title).toBe("new title");
    expect(index).toHaveBeenLastCalledWith([
      doc("a", "body", "event", { title: "new title" }),
    ]);
  });

  it("removes obsolete terms and keeps real BM25 document frequencies correct", async () => {
    const bm25 = new BM25Search({ language: "en" });
    bm25.addDocument({ id: "a", content: "obsolete" });
    const sink = new CcRagSink({ bm25 });
    await sink.write([doc("a", "original")]);
    await sink.write([doc("a", "replacement")]);
    expect(bm25.totalDocs).toBe(1);
    expect(bm25.df.has("obsolete")).toBe(false);
    expect(bm25.df.has("original")).toBe(false);
    expect(bm25.df.get("replacement")).toBe(1);
    expect(bm25.search("original")).toEqual([]);
    expect(bm25.search("replacement")[0].id).toBe("a");
  });

  it("reports unsupported updates for add-only BM25 adapters", async () => {
    const addDocument = vi.fn();
    const sink = new CcRagSink({ bm25: { addDocument } });
    await sink.write([doc("a", "old")]);
    const result = await sink.write([doc("a", "new")]);
    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors[0].error).toContain("removeDocument");
    expect(addDocument).toHaveBeenCalledTimes(1);
  });

  it("refuses an unsafe retry after an add-only adapter throws with unknown outcome", async () => {
    const addDocument = vi.fn(() => {
      throw new Error("unknown outcome");
    });
    const sink = new CcRagSink({ bm25: { addDocument } });
    await sink.write([doc("a", "body")]);
    const retry = await sink.write([doc("a", "body")]);
    expect(retry.errors[0].error).toContain("retries require removeDocument");
    expect(addDocument).toHaveBeenCalledTimes(1);
  });

  it("skips empty / malformed docs", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25 });
    const r = await sink.write([
      doc("a", ""), // empty text
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
    const r = await sink.write([
      doc("evt-1", "a"),
      doc("evt-2", "b"),
      doc("evt-3", "c"),
    ]);
    expect(r.indexed).toBe(2);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].id).toBe("evt-2");
  });

  it("forwards to vector store when wired", async () => {
    const bm25 = makeFakeBm25();
    const vectorCalls = [];
    const sink = new CcRagSink({
      bm25,
      vector: {
        index: async (docs) => {
          vectorCalls.push(docs);
        },
      },
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
      vector: {
        index: async () => {
          throw new Error("qdrant down");
        },
      },
    });
    const r = await sink.write([doc("a", "alpha")]);
    expect(r.indexed).toBe(1);
    expect(bm25.docs.length).toBe(1);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].phase).toBe("vector");
  });

  it("retries a failed vector batch without repeating successful BM25 writes", async () => {
    const bm25 = makeFakeBm25();
    const add = vi.spyOn(bm25, "addDocument");
    const index = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(undefined);
    const sink = new CcRagSink({ bm25, vector: { index } });
    const batch = [doc("a", "alpha"), doc("b", "beta")];
    await sink.write(batch);
    expect(await sink.write(batch)).toEqual({
      indexed: 0,
      skipped: 0,
      errors: [],
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(index).toHaveBeenCalledTimes(2);
    expect(await sink.write(batch)).toEqual({
      indexed: 0,
      skipped: 2,
      errors: [],
    });
  });

  it("retries BM25 independently after a partial mutation without duplicating vector writes", async () => {
    const bm25 = makeFakeBm25();
    const originalAdd = bm25.addDocument;
    bm25.addDocument = vi
      .fn()
      .mockImplementationOnce((entry) => {
        originalAdd(entry);
        throw new Error("failed after mutation");
      })
      .mockImplementation(originalAdd);
    const index = vi.fn(async () => {});
    const sink = new CcRagSink({ bm25, vector: { index } });
    expect((await sink.write([doc("a", "alpha")])).errors[0].phase).toBe(
      "bm25",
    );
    expect(await sink.write([doc("a", "alpha")])).toEqual({
      indexed: 1,
      skipped: 0,
      errors: [],
    });
    expect(bm25.docs).toHaveLength(1);
    expect(index).toHaveBeenCalledTimes(1);
  });

  it("invalidates the last vector acknowledgement when an update partially writes then rejects", async () => {
    const index = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("uncertain outcome"))
      .mockResolvedValue(undefined);
    const sink = new CcRagSink({ bm25: makeFakeBm25(), vector: { index } });
    await sink.write([doc("a", "original")]);
    await sink.write([doc("a", "changed")]);
    await sink.write([doc("a", "original")]);
    expect(index).toHaveBeenCalledTimes(3);
    expect(index).toHaveBeenLastCalledWith([doc("a", "original")]);
  });

  it("writes only the final revision for duplicate IDs in a vector batch", async () => {
    const bm25 = makeFakeBm25();
    const index = vi.fn(async () => {});
    const sink = new CcRagSink({ bm25, vector: { index } });
    await sink.write([doc("a", "old"), doc("a", "new")]);
    expect(bm25.docs).toHaveLength(1);
    expect(bm25.docs[0].content).toBe("new");
    expect(index).toHaveBeenCalledExactlyOnceWith([doc("a", "new")]);
    await sink.write([doc("a", "other"), doc("a", "new")]);
    expect(index).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent writes through vector completion so the latest content wins", async () => {
    let release;
    let notifyStarted;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const vectorDocs = new Map();
    const index = vi.fn(async (batch) => {
      if (batch[0].text === "old") {
        notifyStarted();
        await blocked;
      }
      for (const entry of batch) vectorDocs.set(entry.id, entry.text);
    });
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({ bm25, vector: { index } });
    const first = sink.write([doc("a", "old")]);
    await started;
    const second = sink.write([doc("a", "new")]);
    const duplicate = sink.write([doc("a", "new")]);
    release();
    const results = await Promise.all([first, second, duplicate]);
    expect(results[2]).toEqual({ indexed: 0, skipped: 1, errors: [] });
    expect(bm25.docs).toHaveLength(1);
    expect(bm25.docs[0].content).toBe("new");
    expect(vectorDocs.get("a")).toBe("new");
    expect(index).toHaveBeenCalledTimes(2);
  });

  it("isolates transform failures and rejects an identity-changing transform", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({
      bm25,
      transformDoc: (entry) => {
        if (entry.id === "bad") throw new Error("invalid transformation");
        return {
          id: entry.id === "renamed" ? "wrong" : entry.id,
          content: entry.text,
        };
      },
    });
    const result = await sink.write([
      doc("bad", "bad"),
      doc("renamed", "bad"),
      doc("good", "good"),
    ]);
    expect(result.indexed).toBe(1);
    expect(result.errors.map((error) => error.id)).toEqual(["bad", "renamed"]);
    expect(bm25.docs[0].id).toBe("good");
  });

  it("transformDoc hook lets caller rewrite the doc shape", async () => {
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({
      bm25,
      transformDoc: (d) => ({
        id: d.id,
        title: "OVERRIDE",
        content: d.text.toUpperCase(),
      }),
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

describe("CcRagSink.remove", () => {
  it("removes real BM25 terms and allows unchanged same-ID reimport", async () => {
    const bm25 = new BM25Search({ language: "en" });
    const remove = vi.spyOn(bm25, "removeDocument");
    const sink = new CcRagSink({ bm25 });
    await sink.write([doc("a", "obsolete"), doc("b", "retained")]);
    remove.mockClear();

    expect(await sink.remove(["a"])).toEqual({
      removed: 1,
      skipped: 0,
      errors: [],
    });
    expect(bm25.totalDocs).toBe(1);
    expect(bm25.df.has("obsolete")).toBe(false);
    expect(bm25.search("obsolete")).toEqual([]);
    expect(bm25.search("retained")[0].id).toBe("b");
    expect(await sink.remove(["a"])).toEqual({
      removed: 0,
      skipped: 1,
      errors: [],
    });
    expect(remove).toHaveBeenCalledTimes(1);

    expect(await sink.write([doc("a", "obsolete")])).toEqual({
      indexed: 1,
      skipped: 0,
      errors: [],
    });
    expect(bm25.search("obsolete")[0].id).toBe("a");
    expect((await sink.remove(["a"])).removed).toBe(1);
  });

  it("removes unknown IDs from persisted destinations and deduplicates retries", async () => {
    const bm25 = makeFakeBm25();
    bm25.addDocument({ id: "persisted", content: "old" });
    const vectorDocs = new Map([["persisted", "old"]]);
    const remove = vi.fn(async (ids) => {
      for (const id of ids) vectorDocs.delete(id);
    });
    const sink = new CcRagSink({
      bm25,
      vector: { index: vi.fn(), remove },
    });
    expect(await sink.remove(["persisted", "absent"])).toEqual({
      removed: 2,
      skipped: 0,
      errors: [],
    });
    expect(bm25.docs).toEqual([]);
    expect(vectorDocs.size).toBe(0);
    expect(remove).toHaveBeenCalledExactlyOnceWith(["persisted", "absent"]);
    expect(await sink.remove(["persisted", "absent"])).toEqual({
      removed: 0,
      skipped: 2,
      errors: [],
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("skips malformed and duplicate IDs and accepts empty input", async () => {
    const bm25 = makeFakeBm25();
    const remove = vi.spyOn(bm25, "removeDocument");
    const sink = new CcRagSink({ bm25 });
    expect(await sink.remove([null, {}, 42, "", " ", "a", "a"])).toEqual({
      removed: 1,
      skipped: 6,
      errors: [],
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith("a");
    for (const empty of [[], undefined, null, "a"]) {
      expect(await sink.remove(empty)).toEqual({
        removed: 0,
        skipped: 0,
        errors: [],
      });
    }
  });

  it("reports unsupported BM25 deletion while independently removing vectors", async () => {
    const addDocument = vi.fn();
    const remove = vi.fn(async () => {});
    const sink = new CcRagSink({
      bm25: { addDocument },
      vector: { index: vi.fn(), remove },
    });
    await sink.write([doc("a", "body")]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await sink.remove(["a"]);
      expect(result.removed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([
        {
          id: "a",
          phase: "bm25",
          error: expect.stringContaining("deletion requires removeDocument"),
        },
      ]);
    }
    expect(remove).toHaveBeenCalledTimes(1);
    expect(addDocument).toHaveBeenCalledTimes(1);
  });

  it("reports unsupported vector deletion on every retry without repeating BM25 removal", async () => {
    const bm25 = makeFakeBm25();
    const remove = vi.spyOn(bm25, "removeDocument");
    const sink = new CcRagSink({ bm25, vector: { index: vi.fn() } });
    await sink.write([doc("a", "body")]);
    remove.mockClear();
    const first = await sink.remove(["a"]);
    const retry = await sink.remove(["a"]);
    expect(first.removed).toBe(1);
    expect(retry.removed).toBe(0);
    expect(retry.skipped).toBe(0);
    expect(first.errors).toEqual(retry.errors);
    expect(retry.errors).toEqual([
      {
        ids: ["a"],
        phase: "vector",
        error: expect.stringContaining("deletion requires remove(ids)"),
      },
    ]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("retries partial BM25 removal independently from successful vector removal", async () => {
    const bm25 = makeFakeBm25();
    const vectorRemove = vi.fn(async () => {});
    const sink = new CcRagSink({
      bm25,
      vector: { index: vi.fn(), remove: vectorRemove },
    });
    await sink.write([doc("a", "alpha"), doc("b", "beta")]);
    const originalRemove = bm25.removeDocument;
    bm25.removeDocument = vi.fn((id) => {
      originalRemove(id);
      if (id === "a" && bm25.removeDocument.mock.calls.length === 1) {
        throw new Error("failed after mutation");
      }
    });
    const first = await sink.remove(["a", "b"]);
    expect(first.removed).toBe(1);
    expect(first.errors).toEqual([
      { id: "a", phase: "bm25", error: "failed after mutation" },
    ]);
    expect(bm25.docs).toEqual([]);
    expect(await sink.remove(["a", "b"])).toEqual({
      removed: 1,
      skipped: 1,
      errors: [],
    });
    expect(bm25.removeDocument.mock.calls).toEqual([["a"], ["b"], ["a"]]);
    expect(vectorRemove).toHaveBeenCalledTimes(1);
  });

  it("retries a partially applied vector batch without repeating BM25 removal", async () => {
    const bm25 = makeFakeBm25();
    const bm25Remove = vi.spyOn(bm25, "removeDocument");
    const vectorDocs = new Map();
    const remove = vi.fn(async (ids) => {
      vectorDocs.delete(ids[0]);
      if (remove.mock.calls.length === 1) throw new Error("partial batch");
      for (const id of ids) vectorDocs.delete(id);
    });
    const sink = new CcRagSink({
      bm25,
      vector: {
        index: async (batch) => {
          for (const entry of batch) vectorDocs.set(entry.id, entry.text);
        },
        remove,
      },
    });
    await sink.write([doc("a", "alpha"), doc("b", "beta")]);
    bm25Remove.mockClear();
    const first = await sink.remove(["a", "b"]);
    expect(first.removed).toBe(2);
    expect(first.errors).toEqual([
      { ids: ["a", "b"], phase: "vector", error: "partial batch" },
    ]);
    expect(vectorDocs.has("b")).toBe(true);
    expect(await sink.remove(["a", "b"])).toEqual({
      removed: 0,
      skipped: 0,
      errors: [],
    });
    expect(vectorDocs.size).toBe(0);
    expect(bm25Remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("reindexes unchanged content after uncertain deletion outcomes", async () => {
    const bm25 = makeFakeBm25();
    const vectorDocs = new Map();
    const index = vi.fn(async (batch) => {
      for (const entry of batch) vectorDocs.set(entry.id, entry.text);
    });
    const sink = new CcRagSink({
      bm25,
      vector: {
        index,
        remove: async (ids) => {
          for (const id of ids) vectorDocs.delete(id);
          throw new Error("unknown vector deletion outcome");
        },
      },
    });
    await sink.write([doc("a", "body")]);
    const originalRemove = bm25.removeDocument;
    bm25.removeDocument = vi
      .fn()
      .mockImplementationOnce((id) => {
        originalRemove(id);
        throw new Error("unknown BM25 deletion outcome");
      })
      .mockImplementation(originalRemove);
    expect((await sink.remove(["a"])).errors).toHaveLength(2);
    expect(bm25.docs).toEqual([]);
    expect(vectorDocs.size).toBe(0);
    expect(await sink.write([doc("a", "body")])).toEqual({
      indexed: 1,
      skipped: 0,
      errors: [],
    });
    expect(bm25.docs).toHaveLength(1);
    expect(vectorDocs.get("a")).toBe("body");
    expect(index).toHaveBeenCalledTimes(2);
  });

  it("invalidates deletion acknowledgements before a reimport with uncertain outcome", async () => {
    const bm25 = makeFakeBm25();
    const vectorRemove = vi.fn(async () => {});
    const index = vi.fn(async () => {});
    const sink = new CcRagSink({
      bm25,
      vector: { index, remove: vectorRemove },
    });
    await sink.remove(["a"]);
    bm25.addDocument = vi.fn(() => {
      throw new Error("uncertain insert");
    });
    index.mockRejectedValueOnce(new Error("uncertain upsert"));
    expect((await sink.write([doc("a", "body")])).errors).toHaveLength(2);
    expect(await sink.remove(["a"])).toEqual({
      removed: 1,
      skipped: 0,
      errors: [],
    });
    expect(vectorRemove).toHaveBeenCalledTimes(2);
  });

  it("serializes write, delete, and reimport until vector operations complete", async () => {
    let releaseWrite;
    let notifyWriteStarted;
    const writeStarted = new Promise((resolve) => {
      notifyWriteStarted = resolve;
    });
    const writeBlocked = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    let releaseDelete;
    let notifyDeleteStarted;
    const deleteStarted = new Promise((resolve) => {
      notifyDeleteStarted = resolve;
    });
    const deleteBlocked = new Promise((resolve) => {
      releaseDelete = resolve;
    });
    const vectorDocs = new Map();
    const calls = [];
    const bm25 = makeFakeBm25();
    const sink = new CcRagSink({
      bm25,
      vector: {
        index: async (batch) => {
          calls.push(`index:${batch[0].text}`);
          if (batch[0].text === "old") {
            notifyWriteStarted();
            await writeBlocked;
          }
          for (const entry of batch) vectorDocs.set(entry.id, entry.text);
        },
        remove: async (ids) => {
          calls.push("remove");
          notifyDeleteStarted();
          await deleteBlocked;
          for (const id of ids) vectorDocs.delete(id);
        },
      },
    });
    const write = sink.write([doc("a", "old")]);
    await writeStarted;
    const deletion = sink.remove(["a"]);
    const reimport = sink.write([doc("a", "new")]);
    expect(calls).toEqual(["index:old"]);
    releaseWrite();
    await deleteStarted;
    expect(calls).toEqual(["index:old", "remove"]);
    expect(bm25.docs).toEqual([]);
    releaseDelete();
    const results = await Promise.all([write, deletion, reimport]);
    expect(results.every((result) => result.errors.length === 0)).toBe(true);
    expect(calls).toEqual(["index:old", "remove", "index:new"]);
    expect(bm25.docs).toHaveLength(1);
    expect(bm25.docs[0].content).toBe("new");
    expect(vectorDocs.get("a")).toBe("new");
  });
});
