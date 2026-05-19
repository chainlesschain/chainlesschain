/**
 * AdapterRegistry — runtime registry + sync orchestrator for adapters.
 *
 * Responsibilities:
 *   1. Hold registered adapters by .name; reject double-register.
 *   2. Run `syncAdapter(name, options)` end-to-end:
 *        adapter.healthCheck()
 *        → adapter.sync({ sinceWatermark }) AsyncIterable<RawEvent>
 *        → vault.putRawEvent(...) (archive verbatim payload)
 *        → adapter.normalize(raw) → NormalizedBatch
 *        → partitionBatch (valid vs invalid)
 *        → vault.putBatch(valid)
 *        → kgSink(triples) / ragSink(docs) (pluggable)
 *        → audit invalidReasons + sync stats
 *        → vault.setWatermark(...)
 *   3. `syncAll()` runs every registered adapter sequentially (concurrency:
 *      one at a time; v1 is fine, parallel sync needs careful rate-limit
 *      coordination per architecture doc §10).
 *
 * Sinks (kgSink, ragSink) are intentionally PUSH callbacks rather than the
 * registry pulling from existing engines. This keeps the hub package free
 * of dependencies on KG / RAG / Ollama / IPC layers — desktop main wires
 * them up. Tests inject in-memory collectors.
 *
 * Concurrency policy: one sync at a time per registry instance. Multiple
 * registries with separate vaults can run in parallel (different processes).
 */

"use strict";

const { assertAdapter, toError } = require("./adapter-spec");
const { partitionBatch } = require("./batch");
const { deriveBatchTriples } = require("./kg-derive");
const { deriveBatchDocs } = require("./rag-derive");

const DEFAULT_BATCH_SIZE = 100;

class AdapterRegistry {
  /**
   * @param {object} opts
   * @param {import("./vault").LocalVault} opts.vault       open LocalVault to write into
   * @param {(triples: object[]) => void|Promise<void>} [opts.kgSink]
   * @param {(docs: object[]) => void|Promise<void>} [opts.ragSink]
   * @param {number} [opts.batchSize=100]   raw events per ingest batch (commit size)
   * @param {(msg: object) => void} [opts.onSyncEvent]   optional progress callback
   */
  constructor(opts) {
    if (!opts || typeof opts !== "object") throw new Error("AdapterRegistry: opts required");
    if (!opts.vault) throw new Error("AdapterRegistry: opts.vault required");
    this.vault = opts.vault;
    this.kgSink = typeof opts.kgSink === "function" ? opts.kgSink : null;
    this.ragSink = typeof opts.ragSink === "function" ? opts.ragSink : null;
    this.onSyncEvent = typeof opts.onSyncEvent === "function" ? opts.onSyncEvent : null;
    this.batchSize =
      Number.isInteger(opts.batchSize) && opts.batchSize > 0 ? opts.batchSize : DEFAULT_BATCH_SIZE;

    this._adapters = new Map();
    this._activeSync = null; // name of currently-running adapter, or null
  }

  // ─── Registration ────────────────────────────────────────────────────

  register(adapter) {
    const r = assertAdapter(adapter);
    if (!r.ok) {
      throw new Error(`AdapterRegistry.register: invalid adapter — ${r.errors.join("; ")}`);
    }
    if (this._adapters.has(adapter.name)) {
      throw new Error(`AdapterRegistry.register: adapter "${adapter.name}" already registered`);
    }
    this._adapters.set(adapter.name, adapter);
    this._emit({ kind: "registered", adapter: adapter.name });
  }

  unregister(name) {
    if (!this._adapters.has(name)) return false;
    if (this._activeSync === name) {
      throw new Error(`AdapterRegistry.unregister: cannot unregister "${name}" mid-sync`);
    }
    this._adapters.delete(name);
    this._emit({ kind: "unregistered", adapter: name });
    return true;
  }

  get(name) {
    return this._adapters.get(name) || null;
  }

  list() {
    return Array.from(this._adapters.values()).map((a) => ({
      name: a.name,
      version: a.version,
      capabilities: [...a.capabilities],
      sensitivity: a.dataDisclosure.sensitivity,
      legalGate: !!a.dataDisclosure.legalGate,
    }));
  }

  has(name) {
    return this._adapters.has(name);
  }

  // ─── Sync orchestration ──────────────────────────────────────────────

  /**
   * Sync one adapter end-to-end.
   *
   * @param {string} name
   * @param {object} [options]
   * @param {string} [options.scope=""]
   * @param {number} [options.maxEvents]
   * @param {string} [options.sinceWatermark] override stored watermark
   * @returns {Promise<SyncReport>}
   *
   * @typedef {object} SyncReport
   * @property {string} adapter
   * @property {string} status         "ok" | "auth_expired" | "unhealthy" | "error"
   * @property {number} rawCount
   * @property {object} entityCounts   { events, persons, places, items, topics }
   * @property {number} invalidCount
   * @property {number} kgTripleCount
   * @property {number} ragDocCount
   * @property {number} durationMs
   * @property {string|null} error
   * @property {string|null} watermark
   */
  async syncAdapter(name, options = {}) {
    const adapter = this._adapters.get(name);
    if (!adapter) throw new Error(`AdapterRegistry.syncAdapter: no adapter "${name}"`);
    if (this._activeSync) {
      throw new Error(
        `AdapterRegistry.syncAdapter: already syncing "${this._activeSync}"; one at a time`
      );
    }
    this._activeSync = name;

    const startedAt = Date.now();
    const report = {
      adapter: name,
      status: "ok",
      rawCount: 0,
      entityCounts: { events: 0, persons: 0, places: 0, items: 0, topics: 0 },
      invalidCount: 0,
      kgTripleCount: 0,
      ragDocCount: 0,
      durationMs: 0,
      error: null,
      watermark: null,
    };
    const scope = typeof options.scope === "string" ? options.scope : "";

    try {
      // 1. Health check (gate)
      const health = await adapter.healthCheck();
      if (!health || !health.ok) {
        report.status = "unhealthy";
        report.error = (health && health.reason) || "healthCheck returned not ok";
        this.vault.audit("adapter.sync.unhealthy", name, {
          scope,
          reason: report.error,
        });
        return this._finish(report, startedAt);
      }

      // 2. Resolve watermark
      let sinceWatermark = options.sinceWatermark;
      if (sinceWatermark === undefined) {
        const stored = this.vault.getWatermark(name, scope);
        sinceWatermark = stored && stored.watermark != null
          ? this._parseStoredWatermark(stored.watermark)
          : undefined;
      }

      this._emit({ kind: "sync.start", adapter: name, scope, sinceWatermark });

      // 3. Iterate raw events, batch them, ingest each batch
      let buffer = [];
      const flush = async () => {
        if (buffer.length === 0) return;
        await this._ingestRawBatch(adapter, buffer, report);
        buffer = [];
      };

      // Phase 5.7: forward adapter progress events through onSyncEvent so
      // the WS / IPC layer can stream them to the UI. Adapter-specific
      // payload is passed through opaque (each adapter defines its own
      // phases); the registry only stamps `kind: "adapter-progress"` so
      // listeners can filter.
      const adapterOnProgress = (msg) => {
        this._emit({ kind: "adapter-progress", adapter: name, ...msg });
      };

      // Phase 6: forward all options opaquely so adapter-specific opts
      // (Alipay: zipPath/csvPath/zipPassword; future adapters: ...) reach
      // sync() without the registry needing to know about them. Explicit
      // standard keys come last so they always win.
      const iter = adapter.sync({
        ...options,
        sinceWatermark,
        maxEvents: options.maxEvents,
        scope,
        onProgress: adapterOnProgress,
      });

      for await (const raw of iter) {
        if (!raw || typeof raw !== "object") {
          report.invalidCount += 1;
          continue;
        }
        buffer.push(raw);
        report.rawCount += 1;
        if (buffer.length >= this.batchSize) {
          await flush();
        }
      }
      await flush();

      // 4. Persist final watermark
      const newWatermark = report.rawCount + (this._parseStoredWatermark(sinceWatermark) || 0);
      report.watermark = String(newWatermark);
      this.vault.setWatermark(name, scope, {
        watermark: report.watermark,
        lastSyncedAt: Date.now(),
        lastStatus: "ok",
        lastError: null,
      });

      this.vault.audit("adapter.sync.ok", name, {
        scope,
        rawCount: report.rawCount,
        invalidCount: report.invalidCount,
        watermark: report.watermark,
      });
      this._emit({ kind: "sync.ok", adapter: name, ...report });
    } catch (err) {
      const error = toError(err, `sync ${name}`);
      report.status = "error";
      report.error = error.message;
      this.vault.audit("adapter.sync.error", name, {
        scope,
        message: error.message,
      });
      this._emit({ kind: "sync.error", adapter: name, error: error.message });
      // Update watermark with error status (preserve last successful watermark value)
      try {
        const prev = this.vault.getWatermark(name, scope);
        this.vault.setWatermark(name, scope, {
          watermark: prev ? prev.watermark : null,
          lastSyncedAt: Date.now(),
          lastStatus: "error",
          lastError: error.message,
        });
      } catch (_e) {
        // Watermark write failure is non-fatal in the error path.
      }
    } finally {
      this._activeSync = null;
    }

    return this._finish(report, startedAt);
  }

  /**
   * Sync every registered adapter sequentially.
   * Returns an array of SyncReports in registration order.
   */
  async syncAll(options = {}) {
    const reports = [];
    for (const adapter of this._adapters.values()) {
      try {
        reports.push(await this.syncAdapter(adapter.name, options));
      } catch (err) {
        // Should not happen — syncAdapter catches everything — but be paranoid.
        reports.push({
          adapter: adapter.name,
          status: "error",
          error: toError(err, "syncAll").message,
          rawCount: 0,
          entityCounts: { events: 0, persons: 0, places: 0, items: 0, topics: 0 },
          invalidCount: 0,
          kgTripleCount: 0,
          ragDocCount: 0,
          durationMs: 0,
          watermark: null,
        });
      }
    }
    return reports;
  }

  // ─── Internals ───────────────────────────────────────────────────────

  async _ingestRawBatch(adapter, rawBatch, report) {
    // 1. Archive raw payloads to vault.raw_events. Done first so even if
    //    normalize / KG / RAG fails, the raw is recoverable for re-derive.
    for (const raw of rawBatch) {
      try {
        this.vault.putRawEvent({
          adapter: adapter.name,
          originalId: raw.originalId,
          capturedAt: raw.capturedAt,
          payload: raw.payload,
        });
      } catch (err) {
        // Bad raw — record and skip.
        report.invalidCount += 1;
        this.vault.audit("adapter.sync.invalid_raw", adapter.name, {
          originalId: raw && raw.originalId,
          error: toError(err, "putRawEvent").message,
        });
      }
    }

    // 2. Normalize each raw → merge into one batch for transactional commit.
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const raw of rawBatch) {
      let normalized;
      try {
        normalized = adapter.normalize(raw);
      } catch (err) {
        report.invalidCount += 1;
        this.vault.audit("adapter.sync.normalize_failed", adapter.name, {
          originalId: raw.originalId,
          error: toError(err, "normalize").message,
        });
        continue;
      }
      if (!normalized || typeof normalized !== "object") continue;
      for (const key of ["events", "persons", "places", "items", "topics"]) {
        if (Array.isArray(normalized[key])) merged[key].push(...normalized[key]);
      }
    }

    // 3. Partition valid vs invalid (validators gate before vault write).
    const { valid, invalid, invalidReasons } = partitionBatch(merged);
    if (invalidReasons.length > 0) {
      report.invalidCount += invalidReasons.length;
      // Only audit a small sample — invalid rows can be high-cardinality.
      this.vault.audit("adapter.sync.invalid_entities", adapter.name, {
        count: invalidReasons.length,
        sample: invalidReasons.slice(0, 5),
      });
    }

    // 4. Transactional write to vault.
    const counts = this.vault.putBatch(valid);
    for (const k of Object.keys(counts)) {
      report.entityCounts[k] = (report.entityCounts[k] || 0) + counts[k];
    }

    // 5. KG sink (per-batch, not per-entity, so the sink can amortize work).
    if (this.kgSink) {
      const triples = deriveBatchTriples(valid);
      report.kgTripleCount += triples.length;
      try {
        await this.kgSink(triples);
      } catch (err) {
        this.vault.audit("adapter.sync.kg_sink_failed", adapter.name, {
          error: toError(err, "kgSink").message,
        });
      }
    }

    // 6. RAG sink.
    if (this.ragSink) {
      const docs = deriveBatchDocs(valid);
      report.ragDocCount += docs.length;
      try {
        await this.ragSink(docs);
      } catch (err) {
        this.vault.audit("adapter.sync.rag_sink_failed", adapter.name, {
          error: toError(err, "ragSink").message,
        });
      }
    }

    this._emit({
      kind: "sync.batch",
      adapter: adapter.name,
      rawCount: report.rawCount,
      invalidCount: report.invalidCount,
    });

    // Suppress unused-var lint
    void invalid;
  }

  _parseStoredWatermark(s) {
    if (s == null) return undefined;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  }

  _emit(msg) {
    if (this.onSyncEvent) {
      try {
        this.onSyncEvent(msg);
      } catch (_err) {
        // Listener errors must NOT abort the sync.
      }
    }
  }

  _finish(report, startedAt) {
    report.durationMs = Date.now() - startedAt;
    return report;
  }
}

module.exports = {
  AdapterRegistry,
  DEFAULT_BATCH_SIZE,
};
