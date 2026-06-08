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
const { describeReadiness, categoryForMode } = require("./adapter-readiness");
const { getAdapterGuide } = require("./adapter-guide");

const DEFAULT_READINESS_TIMEOUT_MS = 4000;

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

    // Phase 8.6 — EntityResolver ingest hook. If supplied, every successful
    // putBatch triggers resolver.resolveOnIngest(persons) so cross-source
    // merges happen at sync time rather than during a separate later run.
    // Optional — registry works fine without it (Phase 5/6 adapters don't
    // depend on it).
    this.entityResolver = opts.entityResolver || null;

    // ADB one-click readiness (Phase: social platforms). When supplied by the
    // wiring, readiness() treats the named adapters as "collectable via a
    // rooted-phone USB one-click" — flipping their NO_INPUT / DB_NOT_PULLED
    // status to "ready (device connected)" or "ADB_DEVICE_NEEDED" depending on
    // whether a device is currently attached. Keeps the registry generic: the
    // platform list + the actual `adb devices` probe come from the host wiring.
    //   opts.adbReadiness = {
    //     probe: async () => ({ deviceConnected: boolean, serial?: string }),
    //     oneClickNames: Set<string>,  // adapter names with an *AdbSync path
    //   }
    this._adbReadiness =
      opts.adbReadiness && typeof opts.adbReadiness.probe === "function"
        ? {
            probe: opts.adbReadiness.probe,
            oneClickNames: opts.adbReadiness.oneClickNames instanceof Set
              ? opts.adbReadiness.oneClickNames
              : new Set(opts.adbReadiness.oneClickNames || []),
          }
        : null;

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

  // ─── Readiness ───────────────────────────────────────────────────────

  /**
   * Report, per registered adapter, whether it can actually collect right
   * now and — if not — a human-facing reason.
   *
   * This is DISTINCT from the pre-sync `healthCheck()` gate. healthCheck()
   * is intentionally lenient for snapshot-mode adapters (their inputPath
   * arrives at sync time, so a strict gate would block legitimate
   * `sync-adapter --input <path>` calls). That leniency made the UI show
   * "healthy" for adapters that can't collect a single row yet. readiness()
   * instead probes `adapter.authenticate({ readinessOnly: true })` — a cheap,
   * no-network check (adapters with expensive auth, e.g. email IMAP login /
   * WeChat frida key extraction, short-circuit on the `readinessOnly` flag)
   * — and maps the reason through adapter-readiness.describeReadiness().
   *
   * Each probe is wrapped in a timeout so one slow/hanging adapter can't
   * stall the whole report. Also folds in the last sync outcome from the
   * vault watermark (lastSyncedAt / lastStatus / lastError) so the UI can
   * show both "can I start" and "how did the last run go".
   *
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=4000] per-adapter probe timeout
   * @returns {Promise<Array<ReadinessReport>>} in registration order
   *
   * @typedef {object} ReadinessReport
   * @property {string}  name
   * @property {string}  version
   * @property {string}  extractMode
   * @property {string}  sensitivity
   * @property {boolean} legalGate
   * @property {boolean} ready            can collect right now?
   * @property {string}  status           ready | needs_setup | unavailable | error
   * @property {string}  category         local | snapshot | device | credential | platform
   * @property {string|null} reason       machine reason code (null when ready)
   * @property {string}  message          human (Chinese) explanation
   * @property {string|null} actionHint   what to do next
   * @property {string|null} mode         auth mode on success (snapshot-file / configured / ...)
   * @property {number|null} lastSyncedAt
   * @property {string|null} lastStatus
   * @property {string|null} lastError
   */
  async readiness(opts = {}) {
    const timeoutMs =
      Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : DEFAULT_READINESS_TIMEOUT_MS;
    // Probe the host's ADB device state ONCE (best-effort) so all ADB
    // one-click adapters share a single `adb devices` call this round.
    let adbState = null;
    if (this._adbReadiness) {
      try {
        adbState = await this._withTimeout(
          Promise.resolve().then(() => this._adbReadiness.probe()),
          timeoutMs,
          "adb-probe"
        );
      } catch (_e) {
        adbState = { deviceConnected: false };
      }
    }

    const reports = [];
    for (const adapter of this._adapters.values()) {
      const report = await this._probeReadiness(adapter, timeoutMs, adbState);
      // Attach the step-by-step import guide (how to get this source's data
      // into the vault) keyed off the resolved category. Single source of
      // truth in adapter-guide.js — reused by every shell.
      report.guide = getAdapterGuide(report.name, report.category);
      reports.push(report);
    }
    return reports;
  }

  async _probeReadiness(adapter, timeoutMs, adbState) {
    const dd = adapter.dataDisclosure || {};
    const extractMode = adapter.extractMode || "web-api";
    const base = {
      name: adapter.name,
      version: adapter.version,
      extractMode,
      sensitivity: dd.sensitivity || null,
      legalGate: !!dd.legalGate,
    };

    // Fold in last sync outcome from the watermark (best-effort).
    let lastSyncedAt = null;
    let lastStatus = null;
    let lastError = null;
    try {
      const wm = this.vault.getWatermark(adapter.name, "");
      if (wm) {
        lastSyncedAt = wm.last_synced_at != null ? wm.last_synced_at : null;
        lastStatus = wm.last_status != null ? wm.last_status : null;
        lastError = wm.last_error != null ? wm.last_error : null;
      }
    } catch (_e) {
      // watermark read is non-fatal — a fresh vault has no row yet
    }

    let auth;
    try {
      auth = await this._withTimeout(
        Promise.resolve().then(() => adapter.authenticate({ readinessOnly: true })),
        timeoutMs,
        adapter.name
      );
    } catch (err) {
      const msg = toError(err, "readiness.authenticate").message;
      const isTimeout = /readiness probe timed out/.test(msg);
      const code = isTimeout ? "PROBE_TIMEOUT" : "PROBE_ERROR";
      const desc = describeReadiness(code);
      return {
        ...base,
        ready: false,
        status: desc.status,
        category: desc.category,
        reason: code,
        message: isTimeout ? desc.message : `${desc.message}：${msg}`,
        actionHint: desc.actionHint,
        mode: null,
        lastSyncedAt,
        lastStatus,
        lastError,
      };
    }

    if (auth && auth.ok) {
      return {
        ...base,
        ready: true,
        status: "ready",
        category: categoryForMode(extractMode),
        reason: null,
        message: "可以采集",
        actionHint: null,
        mode: auth.mode || null,
        lastSyncedAt,
        lastStatus,
        lastError,
      };
    }

    const reason = (auth && auth.reason) || "UNKNOWN";

    // ADB one-click platforms (social): the adapter itself has no snapshot yet
    // (NO_INPUT / INPUT_PATH_REQUIRED / DB_NOT_PULLED), but the platform CAN be
    // collected in one click from a rooted phone over USB. Reflect the real
    // device state instead of the misleading "采集需先在手机 App 内…".
    if (
      this._adbReadiness &&
      this._adbReadiness.oneClickNames.has(adapter.name) &&
      (reason === "NO_INPUT" || reason === "INPUT_PATH_REQUIRED" || reason === "DB_NOT_PULLED")
    ) {
      if (adbState && adbState.deviceConnected) {
        return {
          ...base,
          ready: true,
          status: "ready",
          category: "device",
          reason: null,
          message: "已连接 root 手机，点「一键采集」即可拉取",
          actionHint: null,
          mode: "adb-oneclick",
          lastSyncedAt,
          lastStatus,
          lastError,
        };
      }
      const adbDesc = describeReadiness("ADB_DEVICE_NEEDED");
      return {
        ...base,
        ready: false,
        status: adbDesc.status,
        category: adbDesc.category,
        reason: "ADB_DEVICE_NEEDED",
        message: adbDesc.message,
        actionHint: adbDesc.actionHint,
        mode: null,
        lastSyncedAt,
        lastStatus,
        lastError,
      };
    }

    const desc = describeReadiness(reason);
    const detail = auth && (auth.message || auth.error);
    const message =
      desc.appendDetail && detail ? `${desc.message}（${detail}）` : desc.message;
    return {
      ...base,
      ready: false,
      status: desc.status,
      category: desc.category,
      reason,
      message,
      actionHint: desc.actionHint,
      mode: null,
      lastSyncedAt,
      lastStatus,
      lastError,
    };
  }

  _withTimeout(promise, ms, name) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`readiness probe timed out after ${ms}ms (${name})`));
      }, ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
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
   * 2026-05-24 — re-derive canonical events from raw_events archive.
   * Use case: a past sync wrote to raw_events (putRawEvent succeeded) but
   * putBatch failed silently (e.g. partial-index drift trap #25) → events
   * table stuck at 0 for those entities while raw piled up. After fixing
   * the underlying schema/code bug, call this to promote the orphan raws
   * to canonical events without re-fetching from the source.
   *
   * Behaviour:
   *   - Iterates raw_events filtered by [opts.adapter] (or all)
   *   - For each row: lookup registered adapter → normalize(raw) →
   *     partition valid/invalid → putBatch
   *   - Skips raws whose adapter is not currently registered (logs
   *     `adapter.rederive.adapter_missing` audit)
   *   - On adapter.normalize() throw, increments invalidCount + audit
   *
   * Does NOT re-fetch from the source, does NOT update watermarks (raw
   * archive timestamp is what it was), does NOT run KG/RAG sinks (those
   * are sync-time concerns — call them via syncAll if needed).
   *
   * @param {object} [opts]
   * @param {string} [opts.adapter]  Filter by adapter name; default = all
   * @param {number} [opts.batchSize=100] Raws per partitionBatch+putBatch tx
   * @returns {Promise<RederiveReport>}
   *
   * @typedef {object} RederiveReport
   * @property {number} rawSeen        Total raw_events iterated
   * @property {number} invalidCount   Normalize threw or partition rejected
   * @property {number} adapterMissing Raws whose adapter not registered
   * @property {object} entityCounts   { events, persons, places, items, topics }
   * @property {number} durationMs
   * @property {Array<{adapter,error,sample?}>} errors  Adapter-level errors
   */
  async rederive(opts = {}) {
    const startedAt = Date.now();
    const report = {
      rawSeen: 0,
      invalidCount: 0,
      adapterMissing: 0,
      entityCounts: { events: 0, persons: 0, places: 0, items: 0, topics: 0 },
      durationMs: 0,
      errors: [],
    };
    const batchSize = Number.isInteger(opts.batchSize) && opts.batchSize > 0
      ? opts.batchSize
      : 100;

    // Page through raw_events in batches to avoid loading the whole table
    // for large vaults (1000+ rows is normal). Group raws by adapter so a
    // single putBatch tx commits per-adapter (mirrors syncAdapter shape).
    let offset = 0;
    let totalProcessed = 0;
    /** @type {Map<string, Array<object>>} */
    const buffersByAdapter = new Map();

    const flushAdapter = async (adapterName) => {
      const buffer = buffersByAdapter.get(adapterName);
      if (!buffer || buffer.length === 0) return;
      const adapter = this._adapters.get(adapterName);
      if (!adapter) {
        report.adapterMissing += buffer.length;
        try {
          this.vault.audit("adapter.rederive.adapter_missing", adapterName, {
            droppedCount: buffer.length,
          });
        } catch (_e) { /* audit failure is non-fatal */ }
        buffersByAdapter.set(adapterName, []);
        return;
      }
      // normalize + collect into one merged batch (per adapter buffer)
      const merged = { events: [], persons: [], places: [], items: [], topics: [] };
      for (const raw of buffer) {
        let normalized;
        try {
          normalized = adapter.normalize(raw);
        } catch (err) {
          report.invalidCount += 1;
          try {
            this.vault.audit("adapter.rederive.normalize_failed", adapterName, {
              originalId: raw.originalId,
              error: toError(err, "normalize").message,
            });
          } catch (_e) { /* audit non-fatal */ }
          continue;
        }
        if (!normalized || typeof normalized !== "object") continue;
        for (const k of ["events", "persons", "places", "items", "topics"]) {
          if (Array.isArray(normalized[k])) merged[k].push(...normalized[k]);
        }
      }
      const { valid, invalidReasons } = partitionBatch(merged);
      if (invalidReasons.length > 0) {
        report.invalidCount += invalidReasons.length;
        try {
          this.vault.audit("adapter.rederive.invalid_entities", adapterName, {
            count: invalidReasons.length,
            sample: invalidReasons.slice(0, 5),
          });
        } catch (_e) { /* audit non-fatal */ }
      }
      try {
        const counts = this.vault.putBatch(valid);
        for (const k of Object.keys(counts)) {
          report.entityCounts[k] = (report.entityCounts[k] || 0) + counts[k];
        }
      } catch (err) {
        report.errors.push({
          adapter: adapterName,
          error: toError(err, "putBatch").message,
          sample: buffer.slice(0, 3).map((r) => r.originalId),
        });
        try {
          this.vault.audit("adapter.rederive.put_batch_failed", adapterName, {
            error: toError(err, "putBatch").message,
            droppedCount: buffer.length,
          });
        } catch (_e) { /* audit non-fatal */ }
      }
      buffersByAdapter.set(adapterName, []);
    };

    while (true) {
      const page = this.vault.queryRawEvents({
        adapter: opts.adapter,
        limit: batchSize,
        offset,
      });
      if (page.length === 0) break;
      offset += page.length;
      report.rawSeen += page.length;
      // Group by adapter into buffers, flush whenever a buffer hits batchSize.
      for (const raw of page) {
        let buf = buffersByAdapter.get(raw.adapter);
        if (!buf) {
          buf = [];
          buffersByAdapter.set(raw.adapter, buf);
        }
        buf.push(raw);
        if (buf.length >= batchSize) {
          await flushAdapter(raw.adapter);
        }
      }
      totalProcessed += page.length;
    }
    // Final flush of remaining per-adapter buffers
    for (const name of Array.from(buffersByAdapter.keys())) {
      await flushAdapter(name);
    }

    report.durationMs = Date.now() - startedAt;
    try {
      this.vault.audit("adapter.rederive.summary", opts.adapter || "*", {
        rawSeen: report.rawSeen,
        invalidCount: report.invalidCount,
        adapterMissing: report.adapterMissing,
        entityCounts: report.entityCounts,
        durationMs: report.durationMs,
      });
    } catch (_e) { /* audit non-fatal */ }
    return report;
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

    // 4.5. Phase 8.6: EntityResolver ingest hook. Sync-rule stage runs
    // immediately for each new Person; "uncertain" pairs go to the
    // resolve_queue for async embedding+LLM processing. Failures are
    // captured in audit_log but don't break sync.
    if (this.entityResolver && Array.isArray(valid.persons) && valid.persons.length > 0) {
      try {
        const resolverSummary = this.entityResolver.resolveOnIngest(valid.persons);
        report.entityResolver = {
          ...(report.entityResolver || { newPersons: 0, sameImmediate: 0, differentImmediate: 0, enqueued: 0, errored: 0 }),
        };
        for (const k of Object.keys(resolverSummary)) {
          report.entityResolver[k] = (report.entityResolver[k] || 0) + resolverSummary[k];
        }
      } catch (err) {
        this.vault.audit("adapter.sync.entity_resolver_failed", adapter.name, {
          error: toError(err, "entityResolver").message,
        });
      }
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
