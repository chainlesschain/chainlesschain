/**
 * CcRagSink — feeds hub RagDocs into ChainlessChain's existing BM25 and an
 * optional vector store.
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
 * Each destination acknowledges a content fingerprint independently, so a
 * failed vector batch can be retried without duplicating BM25 documents.
 * BM25 replacements use removeDocument before addDocument. Vector adapters
 * must implement idempotent upsert by document ID, including after a batch
 * partially writes and then rejects. A rejected batch is never acknowledged.
 *
 * Like the other bridges this is dependency-injected — caller passes
 * the BM25 instance (or any object with .addDocument(doc)).
 */

"use strict";

const { createHash } = require("node:crypto");

// RagDocs contain JSON data. Sort object keys so metadata insertion order
// does not turn an unchanged record into a new version. JSON errors (cycles,
// BigInt, etc.) are reported per document rather than aborting the batch.
function fingerprint(value) {
  const serialized = JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, item[key]]),
      );
    }
    return item;
  });
  return createHash("sha256").update(serialized).digest("hex");
}

class CcRagSink {
  /**
   * @param {object} deps
   * @param {{ addDocument: (doc: object) => void, removeDocument?: (id: string) => void }} deps.bm25 cc BM25Search instance; removal is required for updates
   * @param {{ index: (docs: Array) => Promise<void> }} [deps.vector] idempotent vector upsert adapter
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
    this._vector =
      deps.vector && typeof deps.vector.index === "function"
        ? deps.vector
        : null;
    this._log = typeof deps.logger === "function" ? deps.logger : null;
    this._transform =
      typeof deps.transformDoc === "function" ? deps.transformDoc : null;
    this._bm25Versions = new Map();
    this._vectorVersions = new Map();
    this._pending = Promise.resolve();
  }

  /**
   * Bound to .write(docs) for use as the registry's ragSink callback.
   * `indexed` counts successful BM25 inserts/replacements; `skipped` counts
   * invalid or fully unchanged documents. A vector-only retry has neither.
   * Inspect `errors` for either destination's failures. A retry must supply
   * the latest documents; this in-memory bridge does not schedule retries.
   */
  write(docs) {
    // Serialize the whole batch, including asynchronous vector writes: an
    // older in-flight vector upsert must not finish after a newer revision.
    const pending = this._pending.then(() => this._write(docs));
    this._pending = pending.catch(() => {});
    return pending;
  }

  async _write(docs) {
    if (!Array.isArray(docs) || docs.length === 0) {
      return { indexed: 0, skipped: 0, errors: [] };
    }
    let indexed = 0;
    let skipped = 0;
    const errors = [];
    const forVector = new Map();

    for (const d of docs) {
      if (!d || !d.id || typeof d.text !== "string" || d.text.length === 0) {
        skipped += 1;
        continue;
      }
      try {
        const doc = this._transform ? this._transform(d) : this._toBm25Doc(d);
        if (!doc || doc.id !== d.id) {
          throw new Error(
            "CcRagSink: transformDoc must preserve the document ID",
          );
        }
        const bm25Version = fingerprint(doc);
        const vectorVersion = this._vector ? fingerprint(d) : null;
        const bm25Changed = this._bm25Versions.get(d.id) !== bm25Version;
        const vectorChanged =
          this._vector && this._vectorVersions.get(d.id) !== vectorVersion;
        // Keep only the last revision for each ID in a batch. This also
        // supersedes an earlier queued revision when the last is unchanged.
        if (this._vector) {
          forVector.delete(d.id);
          if (vectorChanged)
            forVector.set(d.id, { doc: d, version: vectorVersion });
        }
        if (!bm25Changed && !vectorChanged) {
          skipped += 1;
          continue;
        }
        if (bm25Changed) {
          if (typeof this._bm25.removeDocument === "function") {
            // Remove even on the first write: the injected index may already
            // contain the ID, or a previous add may have mutated then thrown.
            this._bm25Versions.delete(d.id);
            await this._bm25.removeDocument(d.id);
          } else if (this._bm25Versions.has(d.id)) {
            throw new Error(
              "CcRagSink: BM25 updates and retries require removeDocument(id)",
            );
          } else {
            // Without removal, a thrown add may already have mutated the
            // index. Remember that unknown outcome and refuse unsafe re-adds.
            this._bm25Versions.set(d.id, null);
          }
          await this._bm25.addDocument(doc);
          this._bm25Versions.set(d.id, bm25Version);
          indexed += 1;
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        errors.push({ id: d.id, phase: "bm25", error: msg });
        if (this._log) this._log("CcRagSink.BM25 write failed", d.id, msg);
      }
    }

    if (this._vector && forVector.size > 0) {
      try {
        // A rejected upsert may have partially written. Its previous version
        // is no longer confirmed either, including when a caller retries it.
        for (const id of forVector.keys()) this._vectorVersions.delete(id);
        await this._vector.index(
          [...forVector.values()].map((entry) => entry.doc),
        );
        for (const [id, entry] of forVector) {
          this._vectorVersions.set(id, entry.version);
        }
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
      (d.metadata && (d.metadata.title || d.metadata.subtype)) || d.type || "";
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
