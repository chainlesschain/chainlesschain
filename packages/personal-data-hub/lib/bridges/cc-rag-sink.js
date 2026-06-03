/**
 * CcRagSink — feeds hub RagDocs into ChainlessChain's existing BM25 + (later)
 * Qdrant vector store.
 *
 * Hub RagDoc shape: { id, type, text, metadata: { ... } }
 * cc BM25.addDocument(doc) expects: { id, title?, content? } — concatenates
 * title + " " + content for tokenization.
 *
 * We map:
 *   doc.id       → doc.id
 *   doc.metadata.title || doc.type → doc.title (short, BM25-prioritized via tokenization)
 *   doc.text     → doc.content
 *
 * Metadata is also serialized into a `meta` property the BM25 originalDoc
 * field preserves verbatim — that's how the downstream Q&A flow filters
 * hits by adapter / time-window / subtype.
 *
 * Vector store wiring (Qdrant) is intentionally LEFT OUT of this v0 sink:
 * the existing cc embed/qdrant integration is async and IPC-shaped; adding
 * it here would couple us to its lifecycle. v1 sink: BM25 only. The hub
 * caller can add a second sink in parallel for vector indexing once that
 * surface stabilizes.
 *
 * Like the other bridges this is dependency-injected — caller passes
 * the BM25 instance (or any object with .addDocument(doc)).
 */

"use strict";

class CcRagSink {
  /**
   * @param {object} deps
   * @param {{ addDocument: (doc: object) => void }} deps.bm25  cc BM25Search instance
   * @param {{ index: (docs: Array) => Promise<void> }} [deps.vector]   future Qdrant adapter (not yet used)
   * @param {(label: string, ...args: any[]) => void} [deps.logger]
   * @param {(doc: object) => object} [deps.transformDoc]       optional pre-write hook
   */
  constructor(deps) {
    if (!deps || typeof deps !== "object") {
      throw new Error("CcRagSink: deps required");
    }
    if (!deps.bm25 || typeof deps.bm25.addDocument !== "function") {
      throw new Error("CcRagSink: deps.bm25 with .addDocument(doc) required");
    }
    this._bm25 = deps.bm25;
    this._vector = deps.vector && typeof deps.vector.index === "function" ? deps.vector : null;
    this._log = typeof deps.logger === "function" ? deps.logger : null;
    this._transform = typeof deps.transformDoc === "function" ? deps.transformDoc : null;
    this._writtenIds = new Set();
  }

  /**
   * Bound to .write(docs) for use as the registry's ragSink callback.
   */
  async write(docs) {
    if (!Array.isArray(docs) || docs.length === 0) {
      return { indexed: 0, skipped: 0, errors: [] };
    }
    let indexed = 0;
    let skipped = 0;
    const errors = [];
    const forVector = [];

    for (const d of docs) {
      if (!d || !d.id || typeof d.text !== "string" || d.text.length === 0) {
        skipped += 1;
        continue;
      }
      // De-dup within process lifetime — BM25.addDocument doesn't dedup
      // internally; a re-ingest would otherwise double-count term frequencies.
      if (this._writtenIds.has(d.id)) {
        skipped += 1;
        continue;
      }

      const doc = this._transform ? this._transform(d) : this._toBm25Doc(d);
      try {
        this._bm25.addDocument(doc);
        this._writtenIds.add(d.id);
        indexed += 1;
        if (this._vector) forVector.push(d);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        errors.push({ id: d.id, error: msg });
        if (this._log) this._log("CcRagSink.addDocument failed", d.id, msg);
      }
    }

    if (this._vector && forVector.length > 0) {
      try {
        await this._vector.index(forVector);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        errors.push({ phase: "vector", error: msg });
        if (this._log) this._log("CcRagSink.vector.index failed", msg);
      }
    }

    return { indexed, skipped, errors };
  }

  _toBm25Doc(d) {
    const title =
      (d.metadata && (d.metadata.title || d.metadata.subtype)) ||
      d.type ||
      "";
    return {
      id: d.id,
      title: String(title),
      content: d.text,
      // BM25 preserves the original doc in `originalDoc`; metadata lives there.
      meta: d.metadata || {},
      hubType: d.type,
    };
  }
}

module.exports = { CcRagSink };
