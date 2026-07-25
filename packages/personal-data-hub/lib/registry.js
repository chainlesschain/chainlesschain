/**
 * AdapterRegistry — runtime registry + sync orchestrator for adapters.
 *
 * Responsibilities:
 *   1. Hold registered adapters by .name; reject double-register.
 *   2. Run `syncAdapter(name, options)` end-to-end:
 *        adapter.healthCheck(options)
 *        → adapter.sync({ sinceWatermark }) AsyncIterable<RawEvent>
 *        → vault.putRawEvent(...) (archive verbatim payload)
 *        → adapter.normalize(raw) → NormalizedBatch
 *        → partitionBatch (valid vs invalid)
 *        → vault.putBatch(valid)
 *        → kgSink(triples) / ragSink(docs) (pluggable)
 *        → audit invalidReasons + sync stats
 *        → vault.setWatermark(...)
 *   3. `syncAll()` probes readiness, skips sources that need user input, and
 *      runs collectable adapters sequentially (concurrency: one at a time;
 *      parallel sync needs careful rate-limit coordination per §10).
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

const crypto = require("node:crypto");
const fs = require("node:fs");
const {
  assertAdapter,
  FILE_CHECKPOINT_MODES,
  toError,
} = require("./adapter-spec");
const {
  createAccountScope,
  createAccountScopeFromSnapshot,
  normalizeIdentity,
} = require("./account-scope");
const {
  assertPartitionedWatermarkKey,
  normalizePartitionedWatermarks,
  parsePartitionedWatermark,
  serializePartitionedWatermark,
} = require("./partitioned-watermark");
const { partitionBatch } = require("./batch");
const { readBoundedSnapshot } = require("./snapshot-file");
const { scopeNormalizedBatch } = require("./scope-normalized-batch");
const { deriveBatchTriples } = require("./kg-derive");
const { deriveBatchDocs } = require("./rag-derive");
const { describeReadiness, categoryForMode } = require("./adapter-readiness");
const { getAdapterGuide } = require("./adapter-guide");

const DEFAULT_READINESS_TIMEOUT_MS = 4000;
const DEFAULT_READINESS_CONCURRENCY = 8;

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_SCAN_PAGE_BUDGET = 10;
const DEFAULT_WATERMARK_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SYNC_MAX_RETRIES = 3;
const DEFAULT_SYNC_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_SYNC_RETRY_MAX_DELAY_MS = 30_000;
const MAX_DEFERRED_SYNC_COMMITS = 64;
const SYNC_ATTEMPT_ERROR = Symbol("syncAttemptError");
const ADB_READINESS_REASONS = new Set([
  "ADB_NOT_INSTALLED",
  "ADB_PROBE_FAILED",
  "ADB_DEVICE_NEEDED",
  "ADB_DEVICE_UNAUTHORIZED",
  "ADB_DEVICE_OFFLINE",
  "ADB_SELECTED_DEVICE_NOT_FOUND",
  "ADB_MULTIPLE_DEVICES",
]);

class RawArchiveError extends Error {
  constructor(adapter, message, failures = []) {
    super(
      `AdapterRegistry: raw archive incomplete for "${adapter}"; ` +
        `${message}. Checkpoint was not advanced`,
    );
    this.name = "RawArchiveError";
    this.code = "RAW_ARCHIVE_INCOMPLETE";
    this.failures = failures;
  }
}

class SourceRequestRateLimitError extends Error {
  constructor(adapter, reason, retryAfterMs) {
    super(
      `AdapterRegistry: source request limit "${reason}" reached for ` +
        `"${adapter}"; retry after ${retryAfterMs}ms`,
    );
    this.name = "SourceRequestRateLimitError";
    this.code = "SOURCE_REQUEST_RATE_LIMITED";
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
    this.retryable = false;
  }
}

class SyncAbortedError extends Error {
  constructor(reason) {
    super(
      reason instanceof Error
        ? reason.message
        : reason == null
          ? "Sync aborted"
          : String(reason),
    );
    this.name = "AbortError";
    this.code = "ABORT_ERR";
    this.retryable = false;
    if (reason instanceof Error) this.cause = reason;
  }
}

const NON_RETRYABLE_SYNC_CODES = new Set([
  "ABORT_ERR",
  "AUTH_FAILED",
  "AUTH_EXPIRED",
  "COOKIE_EXPIRED",
  "INVALID_ARGUMENT",
  "INVALID_INPUT",
  "PERMISSION_DENIED",
  "RAW_ARCHIVE_INCOMPLETE",
  "SCHEMA_INVALID",
  "SOURCE_REQUEST_RATE_LIMITED",
  "UNAUTHORIZED",
  "UNSUPPORTED",
]);

const RETRYABLE_SYNC_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "TEMPORARILY_UNAVAILABLE",
]);

function isRetryableSyncError(error, adapter) {
  if (!error || error instanceof RawArchiveError) return false;
  const code =
    typeof error.code === "string" ? error.code.trim().toUpperCase() : "";
  if (error.name === "AbortError" || code === "ABORT_ERR") return false;
  if (typeof adapter?.isRetryableSyncError === "function") {
    try {
      const decision = adapter.isRetryableSyncError(error);
      if (typeof decision === "boolean") return decision;
    } catch (_hookError) {
      // A classifier hook is advisory; fall through to the safe defaults.
    }
  }
  if (typeof error.retryable === "boolean") return error.retryable;

  if (NON_RETRYABLE_SYNC_CODES.has(code)) return false;
  if (RETRYABLE_SYNC_CODES.has(code)) return true;

  const status = Number(error.status ?? error.statusCode);
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true;
  }
  if (status >= 400 && status < 500) return false;

  const message = String(error.message || error).toLowerCase();
  if (
    /auth|unauthori[sz]ed|forbidden|permission|invalid (input|argument)|schema/.test(
      message,
    )
  ) {
    return false;
  }
  return /timeout|timed out|temporar|rate.?limit|too many requests|connection (reset|refused|closed|lost)|socket hang up|network (error|unreachable)|fetch failed|service unavailable|gateway (timeout|error)|\b5\d\d\b/.test(
    message,
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

class AdapterRegistry {
  /**
   * @param {object} opts
   * @param {import("./vault").LocalVault} opts.vault       open LocalVault to write into
   * @param {(triples: object[]) => void|Promise<void>} [opts.kgSink]
   * @param {(docs: object[]) => void|Promise<void>} [opts.ragSink]
   * @param {number} [opts.batchSize=100]   raw events per ingest batch (commit size)
   * @param {(msg: object) => void} [opts.onSyncEvent]   optional progress callback
   * @param {number} [opts.syncMaxRetries=3] transient sync retries after the first attempt
   * @param {number} [opts.syncRetryBaseDelayMs=500] exponential backoff base
   * @param {number} [opts.syncRetryMaxDelayMs=30000] exponential backoff ceiling
   * @param {(ms: number) => Promise<void>} [opts.sleep] testable delay hook
   * @param {() => number} [opts.now] testable rate-limit clock
   */
  constructor(opts) {
    if (!opts || typeof opts !== "object")
      throw new Error("AdapterRegistry: opts required");
    if (!opts.vault) throw new Error("AdapterRegistry: opts.vault required");
    this.vault = opts.vault;
    this.kgSink = typeof opts.kgSink === "function" ? opts.kgSink : null;
    this.ragSink = typeof opts.ragSink === "function" ? opts.ragSink : null;
    this.onSyncEvent =
      typeof opts.onSyncEvent === "function" ? opts.onSyncEvent : null;
    this.batchSize =
      Number.isInteger(opts.batchSize) && opts.batchSize > 0
        ? opts.batchSize
        : DEFAULT_BATCH_SIZE;
    this.syncMaxRetries =
      Number.isSafeInteger(opts.syncMaxRetries) && opts.syncMaxRetries >= 0
        ? opts.syncMaxRetries
        : DEFAULT_SYNC_MAX_RETRIES;
    this.syncRetryBaseDelayMs =
      Number.isSafeInteger(opts.syncRetryBaseDelayMs) &&
      opts.syncRetryBaseDelayMs >= 0
        ? opts.syncRetryBaseDelayMs
        : DEFAULT_SYNC_RETRY_BASE_DELAY_MS;
    const configuredRetryMaxDelayMs =
      Number.isSafeInteger(opts.syncRetryMaxDelayMs) &&
      opts.syncRetryMaxDelayMs >= 0
        ? opts.syncRetryMaxDelayMs
        : DEFAULT_SYNC_RETRY_MAX_DELAY_MS;
    this.syncRetryMaxDelayMs = Math.max(
      configuredRetryMaxDelayMs,
      this.syncRetryBaseDelayMs,
    );
    this._sleep =
      typeof opts.sleep === "function"
        ? opts.sleep
        : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this._now = typeof opts.now === "function" ? opts.now : Date.now;
    this._watermarkTelemetryHmacKey = crypto.randomBytes(32);

    // Phase 8.6 — EntityResolver ingest hook. If supplied, every successful
    // putBatch triggers resolver.resolveOnIngest(persons) so cross-source
    // merges happen at sync time rather than during a separate later run.
    // Optional — registry works fine without it (Phase 5/6 adapters don't
    // depend on it).
    this.entityResolver = opts.entityResolver || null;

    // ADB one-click readiness (Phase: social platforms). When supplied by the
    // wiring, readiness() treats the named adapters as "collectable via a
    // rooted-phone USB one-click" — flipping their NO_INPUT / DB_NOT_PULLED
    // status to "ready (exactly one device connected)",
    // "ADB_MULTIPLE_DEVICES", or "ADB_DEVICE_NEEDED" depending on the number
    // of authorized devices. Keeps the registry generic: the platform list +
    // the actual `adb devices` probe come from the host wiring.
    //   opts.adbReadiness = {
    //     probe: async () => ({
    //       authorizedDeviceCount: number,
    //       deviceConnected: boolean,
    //       serial?: string,
    //     }),
    //     oneClickNames: Set<string>,  // adapter names with an *AdbSync path
    //   }
    this._adbReadiness =
      opts.adbReadiness && typeof opts.adbReadiness.probe === "function"
        ? {
            probe: opts.adbReadiness.probe,
            oneClickNames:
              opts.adbReadiness.oneClickNames instanceof Set
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
      throw new Error(
        `AdapterRegistry.register: invalid adapter — ${r.errors.join("; ")}`,
      );
    }
    if (this._adapters.has(adapter.name)) {
      throw new Error(
        `AdapterRegistry.register: adapter "${adapter.name}" already registered`,
      );
    }
    this._adapters.set(adapter.name, adapter);
    this._emit({ kind: "registered", adapter: adapter.name });
  }

  unregister(name) {
    if (!this._adapters.has(name)) return false;
    if (this._activeSync === name) {
      throw new Error(
        `AdapterRegistry.unregister: cannot unregister "${name}" mid-sync`,
      );
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
      extractMode: a.extractMode || "web-api",
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
   * @param {number} [opts.concurrency=8] bounded parallel probe count
   * @returns {Promise<Array<ReadinessReport>>} in registration order
   *
   * @typedef {object} ReadinessReport
   * @property {string}  name
   * @property {string}  version
   * @property {string[]} capabilities
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
    const concurrency =
      Number.isInteger(opts.concurrency) && opts.concurrency > 0
        ? opts.concurrency
        : DEFAULT_READINESS_CONCURRENCY;
    // Probe the host's ADB device state ONCE (best-effort) so all ADB
    // one-click adapters share a single `adb devices` call this round.
    let adbState = null;
    if (this._adbReadiness) {
      try {
        adbState = await this._withTimeout(
          Promise.resolve().then(() => this._adbReadiness.probe()),
          timeoutMs,
          "adb-probe",
        );
      } catch (_e) {
        adbState = {
          authorizedDeviceCount: 0,
          deviceConnected: false,
          reason: "ADB_PROBE_FAILED",
        };
      }
    }

    const adapters = Array.from(this._adapters.values());
    return mapWithConcurrency(adapters, concurrency, async (adapter) => {
      const report = await this._probeReadiness(adapter, timeoutMs, adbState);
      // Attach the step-by-step import guide (how to get this source's data
      // into the vault) keyed off the resolved category. Single source of
      // truth in adapter-guide.js — reused by every shell.
      report.guide = getAdapterGuide(report.name, report.category);
      return report;
    });
  }

  async _probeReadiness(adapter, timeoutMs, adbState) {
    const dd = adapter.dataDisclosure || {};
    const extractMode = adapter.extractMode || "web-api";
    const base = {
      name: adapter.name,
      version: adapter.version,
      capabilities: [...adapter.capabilities],
      extractMode,
      sensitivity: dd.sensitivity || null,
      legalGate: !!dd.legalGate,
    };

    // Fold in last sync outcome from the watermark (best-effort).
    let lastSyncedAt = null;
    let lastStatus = null;
    let lastError = null;
    try {
      const wm = this.vault.getWatermark(
        adapter.name,
        this._resolveScope(adapter),
      );
      if (wm) {
        lastSyncedAt = wm.last_synced_at != null ? wm.last_synced_at : null;
        lastStatus = wm.last_status != null ? wm.last_status : null;
        lastError = wm.last_error != null ? wm.last_error : null;
      }
    } catch (_e) {
      // watermark read is non-fatal — a fresh vault has no row yet
    }

    let auth;
    if (
      adapter._cookieAuth &&
      Array.isArray(adapter.capabilities) &&
      adapter.capabilities.includes("sync:cookie-api") &&
      typeof adapter._fetchFn === "function" &&
      adapter._fetchFn.name === "defaultFetch"
    ) {
      const desc = describeReadiness("CUSTOM_FETCH_REQUIRED");
      return {
        ...base,
        ready: false,
        status: desc.status,
        category: desc.category,
        reason: "CUSTOM_FETCH_REQUIRED",
        message: desc.message,
        actionHint: desc.actionHint,
        mode: null,
        lastSyncedAt,
        lastStatus,
        lastError,
      };
    }
    try {
      auth = await this._withTimeout(
        Promise.resolve().then(() =>
          adapter.authenticate({ readinessOnly: true }),
        ),
        timeoutMs,
        adapter.name,
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

    // ADB-capable sources: the adapter itself has no snapshot yet
    // (NO_INPUT / INPUT_PATH_REQUIRED / DB_NOT_PULLED), but the source CAN be
    // collected from an authorized Android phone over USB. Reflect the real
    // device state instead of the misleading "采集需先在手机 App 内…".
    if (
      this._adbReadiness &&
      this._adbReadiness.oneClickNames.has(adapter.name) &&
      (reason === "NO_INPUT" ||
        reason === "INPUT_PATH_REQUIRED" ||
        reason === "DB_NOT_PULLED")
    ) {
      const authorizedDeviceCount =
        adbState &&
        Number.isSafeInteger(adbState.authorizedDeviceCount) &&
        adbState.authorizedDeviceCount >= 0
          ? adbState.authorizedDeviceCount
          : 0;
      if (authorizedDeviceCount === 1) {
        return {
          ...base,
          ready: true,
          status: "ready",
          category: "device",
          reason: null,
          message: "已连接 Android 手机，可直接一键采集",
          actionHint: null,
          mode: "adb-oneclick",
          lastSyncedAt,
          lastStatus,
          lastError,
        };
      }
      const reportedAdbReason =
        adbState &&
        typeof adbState.reason === "string" &&
        ADB_READINESS_REASONS.has(adbState.reason)
          ? adbState.reason
          : null;
      const adbReason =
        reportedAdbReason ||
        (authorizedDeviceCount > 1
          ? "ADB_MULTIPLE_DEVICES"
          : "ADB_DEVICE_NEEDED");
      const adbDesc = describeReadiness(adbReason);
      return {
        ...base,
        ready: false,
        status: adbDesc.status,
        category: adbDesc.category,
        reason: adbReason,
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
      desc.appendDetail && detail
        ? `${desc.message}（${detail}）`
        : desc.message;
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
        },
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
   * @param {string|number} [options.sinceWatermark] override stored watermark
   * @param {Record<string,string|number|bigint>} [options.sinceWatermarks]
   *        per-stream overrides for partitioned adapters
   * @returns {Promise<SyncReport>}
   *
   * @typedef {object} SyncReport
   * @property {string} adapter
   * @property {string} status         "ok" | "auth_expired" | "unhealthy" | "rate_limited" | "error" | "skipped"
   * @property {number} rawCount
   * @property {number} archivedRawCount
   * @property {number} archiveFailureCount
   * @property {object} entityCounts   { events, persons, places, items, topics }
   * @property {number} invalidCount
   * @property {number} kgTripleCount
   * @property {number} ragDocCount
   * @property {number} durationMs
   * @property {string|null} error
   * @property {string|null} watermark
   * @property {boolean} watermarkDeferred
   * @property {boolean} checkpointCommitted
   * @property {number|null} pageBudget
   * @property {number|null} nextPageBudget
   * @property {number} scanDeferredCount
   * @property {number} watermarkLookbackMs
   * @property {string|null} collectionSinceWatermark
   * @property {string[]} committedWatermarkKeys
   * @property {string[]} deferredWatermarkKeys
   * @property {number} attemptCount
   * @property {number} retryCount
   * @property {number} totalRetryDelayMs
   * @property {boolean} retryExhausted
   * @property {number|null} retryAfterMs
   * @property {string|null} rateLimitReason
   * @property {number|null} rateLimitRemainingMinute
   * @property {number|null} rateLimitRemainingDay
   * @property {number} sourceRequestCount
   * @property {number} sourceRequestThrottleMs
   * @property {number|null} sourceRequestRateLimitRemainingMinute
   * @property {number|null} sourceRequestRateLimitRemainingDay
   * @property {string} scope         Privacy-safe account/source scope
   */
  async syncAdapter(name, options = {}) {
    const adapter = this._adapters.get(name);
    if (!adapter)
      throw new Error(`AdapterRegistry.syncAdapter: no adapter "${name}"`);
    if (this._activeSync) {
      throw new Error(
        `AdapterRegistry.syncAdapter: already syncing "${this._activeSync}"; one at a time`,
      );
    }
    this._activeSync = name;
    const overallStartedAt = Date.now();
    let retryCount = 0;
    let totalRetryDelayMs = 0;
    let sourceRequestCount = 0;
    let sourceRequestThrottleMs = 0;

    try {
      while (true) {
        const report = await this._syncAdapterOnce(name, options, {
          attemptCount: retryCount + 1,
          retryCount,
          totalRetryDelayMs,
          sourceRequestCount,
          sourceRequestThrottleMs,
        });
        report.durationMs = Date.now() - overallStartedAt;
        sourceRequestCount = report.sourceRequestCount;
        sourceRequestThrottleMs = report.sourceRequestThrottleMs;
        if (report.status !== "error") return report;

        const attemptError = report[SYNC_ATTEMPT_ERROR];
        const retryable = isRetryableSyncError(attemptError, adapter);
        if (!retryable || retryCount >= this.syncMaxRetries) {
          report.retryExhausted =
            retryable && retryCount >= this.syncMaxRetries;
          if (report.retryExhausted) {
            try {
              this.vault.audit("adapter.sync.retry_exhausted", name, {
                scope: report.scope,
                attemptCount: report.attemptCount,
                retryCount: report.retryCount,
                message: report.error,
              });
            } catch (_auditError) {
              // Terminal reporting must not depend on observability storage.
            }
          }
          this._emit({
            kind: "sync.error",
            adapter: name,
            scope: report.scope,
            error: report.error,
            attemptCount: report.attemptCount,
            retryCount: report.retryCount,
            retryExhausted: report.retryExhausted,
          });
          return report;
        }

        try {
          this._throwIfAborted(options.signal);
        } catch (abortError) {
          report.error = toError(abortError, `sync ${name}`).message;
          report.retryAfterMs = null;
          report.durationMs = Date.now() - overallStartedAt;
          try {
            this.vault.audit("adapter.sync.error", name, {
              scope: report.scope,
              message: report.error,
              checkpointCommitted: false,
              phase: "retry_backoff",
              attemptCount: report.attemptCount,
              retryCount: report.retryCount,
            });
          } catch {
            // Cancellation reporting must not depend on observability storage.
          }
          this._emit({
            kind: "sync.error",
            adapter: name,
            scope: report.scope,
            error: report.error,
            attemptCount: report.attemptCount,
            retryCount: report.retryCount,
            retryExhausted: false,
          });
          return report;
        }

        const exponentialDelay = Math.min(
          this.syncRetryMaxDelayMs,
          this.syncRetryBaseDelayMs * 2 ** retryCount,
        );
        const hintedDelay =
          Number.isSafeInteger(attemptError?.retryAfterMs) &&
          attemptError.retryAfterMs >= 0
            ? attemptError.retryAfterMs
            : 0;
        const delayMs = Math.min(
          this.syncRetryMaxDelayMs,
          Math.max(exponentialDelay, hintedDelay),
        );
        const nextRetryCount = retryCount + 1;
        report.retryAfterMs = delayMs;
        try {
          this.vault.audit("adapter.sync.retry_scheduled", name, {
            scope: report.scope,
            attemptCount: report.attemptCount,
            retryCount: nextRetryCount,
            delayMs,
            message: report.error,
          });
        } catch (_auditError) {
          // Retry recovery must not depend on observability storage.
        }
        this._emit({
          kind: "sync.retry",
          adapter: name,
          scope: report.scope,
          attemptCount: report.attemptCount,
          nextAttempt: report.attemptCount + 1,
          retryCount: nextRetryCount,
          delayMs,
          error: report.error,
        });
        try {
          await this._sleepWithSignal(delayMs, options.signal);
        } catch (abortError) {
          report.error = toError(abortError, `sync ${name}`).message;
          report.retryAfterMs = null;
          report.durationMs = Date.now() - overallStartedAt;
          try {
            this.vault.audit("adapter.sync.error", name, {
              scope: report.scope,
              message: report.error,
              checkpointCommitted: false,
              phase: "retry_backoff",
              attemptCount: report.attemptCount,
              retryCount: report.retryCount,
            });
          } catch {
            // Cancellation reporting must not depend on observability storage.
          }
          this._emit({
            kind: "sync.error",
            adapter: name,
            scope: report.scope,
            error: report.error,
            attemptCount: report.attemptCount,
            retryCount: report.retryCount,
            retryExhausted: false,
          });
          return report;
        }
        retryCount = nextRetryCount;
        totalRetryDelayMs += delayMs;
      }
    } finally {
      this._activeSync = null;
    }
  }

  async _syncAdapterOnce(name, options = {}, attemptMeta = {}) {
    const adapter = this._adapters.get(name);
    const startedAt = Date.now();
    const report = {
      adapter: name,
      status: "ok",
      rawCount: 0,
      archivedRawCount: 0,
      archiveFailureCount: 0,
      entityCounts: { events: 0, persons: 0, places: 0, items: 0, topics: 0 },
      invalidCount: 0,
      kgTripleCount: 0,
      ragDocCount: 0,
      resolvedConflictCount: 0,
      sourceAliasCount: 0,
      rawObservationCount: 0,
      durationMs: 0,
      error: null,
      watermark: null,
      watermarkDeferred: false,
      checkpointCommitted: false,
      pageBudget: null,
      nextPageBudget: null,
      scanDeferredCount: 0,
      watermarkLookbackMs: 0,
      collectionSinceWatermark: null,
      committedWatermarkKeys: [],
      deferredWatermarkKeys: [],
      attemptCount:
        Number.isSafeInteger(attemptMeta.attemptCount) &&
        attemptMeta.attemptCount > 0
          ? attemptMeta.attemptCount
          : 1,
      retryCount:
        Number.isSafeInteger(attemptMeta.retryCount) &&
        attemptMeta.retryCount >= 0
          ? attemptMeta.retryCount
          : 0,
      totalRetryDelayMs:
        Number.isSafeInteger(attemptMeta.totalRetryDelayMs) &&
        attemptMeta.totalRetryDelayMs >= 0
          ? attemptMeta.totalRetryDelayMs
          : 0,
      retryExhausted: false,
      retryAfterMs: null,
      rateLimitReason: null,
      rateLimitRemainingMinute: null,
      rateLimitRemainingDay: null,
      sourceRequestCount:
        Number.isSafeInteger(attemptMeta.sourceRequestCount) &&
        attemptMeta.sourceRequestCount >= 0
          ? attemptMeta.sourceRequestCount
          : 0,
      sourceRequestThrottleMs:
        Number.isSafeInteger(attemptMeta.sourceRequestThrottleMs) &&
        attemptMeta.sourceRequestThrottleMs >= 0
          ? attemptMeta.sourceRequestThrottleMs
          : 0,
      sourceRequestRateLimitRemainingMinute: null,
      sourceRequestRateLimitRemainingDay: null,
    };
    let scope = "";
    report.scope = scope;
    const watermarkStrategy = adapter.watermarkStrategy || "count";
    const partitionedWatermark = watermarkStrategy === "partitioned";
    const explicitFileSync = this._isExplicitFileSync(options);
    let fileCheckpointMode = null;
    // Fail closed for explicit file inputs. If the adapter's dynamic policy
    // hook throws or returns an invalid value, the error path must not create
    // or mutate a durable live-source checkpoint.
    let preserveFileCheckpoint = explicitFileSync;
    const deferredSyncCommits = [];
    const deferSyncCommit = (callback) => {
      if (typeof callback !== "function") {
        throw new TypeError(
          "AdapterRegistry: deferSyncCommit requires a function",
        );
      }
      if (deferredSyncCommits.length >= MAX_DEFERRED_SYNC_COMMITS) {
        throw new RangeError(
          `AdapterRegistry: deferSyncCommit accepts at most ${MAX_DEFERRED_SYNC_COMMITS} callbacks per attempt`,
        );
      }
      deferredSyncCommits.push(callback);
    };

    try {
      this._throwIfAborted(options.signal);

      // Resolve file checkpoint policy before scope. Shared file inputs are
      // continuing sources (for example a selected SQLite profile), so their
      // scope must flow through the adapter's normal runtime/default scope
      // resolution instead of the snapshot import fallback.
      fileCheckpointMode = explicitFileSync
        ? this._resolveFileCheckpointMode(adapter, options)
        : null;
      preserveFileCheckpoint = fileCheckpointMode === "preserve";
      scope = this._resolveScope(adapter, options, { fileCheckpointMode });
      report.scope = scope;

      // 1. Health check (gate)
      // Forward sync-time input (inputPath / cookie / key / ...) to the
      // health gate as well as sync(). File-import adapters cannot validate a
      // path that only exists in options if this call is parameterless.
      const health = await adapter.healthCheck(options);
      this._throwIfAborted(options.signal);
      if (!health || !health.ok) {
        report.status = "unhealthy";
        report.error =
          (health && health.reason) || "healthCheck returned not ok";
        this.vault.audit("adapter.sync.unhealthy", name, {
          scope,
          reason: report.error,
        });
        return this._finish(report, startedAt);
      }

      // 2. Enforce trigger-level rate limits after readiness succeeds but
      // before adapter.sync can touch the source. LocalVault reserves the
      // slot transactionally and persists it across process restarts.
      const rateLimits =
        adapter.rateLimits && typeof adapter.rateLimits === "object"
          ? adapter.rateLimits
          : {};
      const hasRateLimit = ["perMinute", "perDay", "minIntervalMs"].some(
        (field) =>
          Number.isSafeInteger(rateLimits[field]) && rateLimits[field] > 0,
      );
      if (
        hasRateLimit &&
        typeof this.vault.acquireSyncRateLimit === "function"
      ) {
        const reservation = this.vault.acquireSyncRateLimit(
          name,
          scope,
          rateLimits,
          this._now(),
        );
        report.rateLimitRemainingMinute = reservation.remainingMinute;
        report.rateLimitRemainingDay = reservation.remainingDay;
        if (!reservation.allowed) {
          report.status = "rate_limited";
          report.rateLimitReason = reservation.reason;
          report.retryAfterMs = reservation.retryAfterMs;
          report.error =
            `rate limit ${reservation.reason} reached; retry after ` +
            `${reservation.retryAfterMs}ms`;
          const stored = this.vault.getWatermark(name, scope);
          report.watermark = stored?.watermark ?? null;
          if (!preserveFileCheckpoint) {
            this.vault.setWatermark(name, scope, {
              watermark: report.watermark,
              lastSyncedAt: Date.now(),
              lastStatus: "rate_limited",
              lastError: report.error,
            });
          }
          this.vault.audit("adapter.sync.rate_limited", name, {
            scope,
            reason: reservation.reason,
            retryAfterMs: reservation.retryAfterMs,
            retryAt: reservation.retryAt,
            remainingMinute: reservation.remainingMinute,
            remainingDay: reservation.remainingDay,
            attemptCount: report.attemptCount,
            retryCount: report.retryCount,
          });
          this._emit({
            kind: "sync.rate_limited",
            adapter: name,
            scope,
            reason: reservation.reason,
            retryAfterMs: reservation.retryAfterMs,
            retryAt: reservation.retryAt,
            attemptCount: report.attemptCount,
            retryCount: report.retryCount,
          });
          return this._finish(report, startedAt);
        }
      }

      // 3. Resolve the durable checkpoint, collection overlap, and adaptive
      // page budget. The checkpoint is never replaced by the overlap value:
      // replaying a recent time window must not move durable progress back.
      let declaredWatermarkKeys = [];
      let targetWatermarkKeys = [];
      let targetWatermarkKeySet = new Set();
      if (partitionedWatermark) {
        declaredWatermarkKeys = adapter.watermarkStreams.map((key) =>
          assertPartitionedWatermarkKey(key),
        );
        const declaredSet = new Set(declaredWatermarkKeys);
        const selected = adapter.targetWatermarkKeys(options);
        if (!Array.isArray(selected)) {
          throw new TypeError(
            `AdapterRegistry: ${name}.targetWatermarkKeys() must return an array`,
          );
        }
        targetWatermarkKeys = Array.from(
          new Set(
            selected.map((key) =>
              assertPartitionedWatermarkKey(
                key,
                `${name} target watermark stream key`,
              ),
            ),
          ),
        );
        for (const key of targetWatermarkKeys) {
          if (!declaredSet.has(key)) {
            throw new TypeError(
              `AdapterRegistry: ${name} selected undeclared watermark stream "${key}"`,
            );
          }
        }
        targetWatermarkKeySet = new Set(targetWatermarkKeys);
      }
      const boundedCompleteScan =
        adapter.watermarkRequiresCompleteScan === true &&
        !preserveFileCheckpoint &&
        (!partitionedWatermark || targetWatermarkKeys.length > 0);
      const boundedTimestampScan =
        (watermarkStrategy === "max-captured-at" || partitionedWatermark) &&
        boundedCompleteScan;
      const explicitPageBudget =
        Number.isSafeInteger(options.maxPages) && options.maxPages > 0
          ? options.maxPages
          : null;
      const configuredEventLimits = [options.limit, options.maxEvents].filter(
        (value) => Number.isSafeInteger(value) && value > 0,
      );
      const eventLimit =
        configuredEventLimits.length > 0
          ? Math.min(...configuredEventLimits)
          : null;
      const hasExplicitEventLimit = eventLimit !== null;
      const canPersistScanState =
        typeof this.vault.getSyncScanState === "function" &&
        typeof this.vault.setSyncScanState === "function" &&
        typeof this.vault.clearSyncScanState === "function";
      const adaptivePageBudget =
        boundedCompleteScan &&
        explicitPageBudget === null &&
        !hasExplicitEventLimit &&
        canPersistScanState;
      let scanState = null;
      const scanStatesByWatermarkKey = {};
      const pageBudgetsByWatermarkKey = {};
      if (adaptivePageBudget) {
        if (partitionedWatermark) {
          for (const key of targetWatermarkKeys) {
            scanStatesByWatermarkKey[key] = this.vault.getSyncScanState(
              name,
              this._partitionedScanStateScope(scope, key),
            );
          }
        } else {
          scanState = this.vault.getSyncScanState(name, scope);
        }
      }
      if (boundedCompleteScan) {
        const initialPageBudget =
          Number.isSafeInteger(adapter.initialPageBudget) &&
          adapter.initialPageBudget > 0
            ? adapter.initialPageBudget
            : DEFAULT_SCAN_PAGE_BUDGET;
        if (partitionedWatermark) {
          for (const key of targetWatermarkKeys) {
            const state = scanStatesByWatermarkKey[key];
            pageBudgetsByWatermarkKey[key] =
              explicitPageBudget ||
              (state &&
              Number.isSafeInteger(state.page_budget) &&
              state.page_budget > 0
                ? state.page_budget
                : initialPageBudget);
          }
          const budgets = Object.values(pageBudgetsByWatermarkKey);
          report.pageBudget = budgets.length > 0 ? Math.max(...budgets) : null;
          report.scanDeferredCount = Math.max(
            0,
            ...Object.values(scanStatesByWatermarkKey).map((state) =>
              state &&
              Number.isSafeInteger(state.deferred_count) &&
              state.deferred_count >= 0
                ? state.deferred_count
                : 0,
            ),
          );
        } else {
          report.pageBudget =
            explicitPageBudget ||
            (scanState &&
            Number.isSafeInteger(scanState.page_budget) &&
            scanState.page_budget > 0
              ? scanState.page_budget
              : initialPageBudget);
          report.scanDeferredCount =
            scanState &&
            Number.isSafeInteger(scanState.deferred_count) &&
            scanState.deferred_count >= 0
              ? scanState.deferred_count
              : 0;
        }
      }

      const watermarkWasOverridden = partitionedWatermark
        ? options.sinceWatermark !== undefined ||
          options.sinceWatermarks !== undefined
        : options.sinceWatermark !== undefined;
      const stored = this.vault.getWatermark(name, scope);
      const storedWatermarkExact =
        stored && stored.watermark != null ? stored.watermark : null;
      const storedWatermark =
        stored && stored.watermark != null
          ? this._deserializeWatermark(stored.watermark, watermarkStrategy)
          : undefined;
      let checkpointWatermark = partitionedWatermark
        ? storedWatermark
        : options.sinceWatermark;
      if (checkpointWatermark === undefined) {
        checkpointWatermark = storedWatermark;
      }
      let checkpointWatermarks = {};
      let durableCheckpointWatermarks = {};
      const overriddenWatermarkKeySet = new Set();
      let partitionedAggregateOverride = null;
      let partitionedKeyOverrides = {};
      if (partitionedWatermark) {
        durableCheckpointWatermarks = parsePartitionedWatermark(
          checkpointWatermark,
          {
            allowedKeys: declaredWatermarkKeys,
          },
        );
        checkpointWatermarks = { ...durableCheckpointWatermarks };
        if (options.sinceWatermark !== undefined) {
          if (typeof options.sinceWatermark !== "string") {
            throw new TypeError(
              "AdapterRegistry: partitioned sinceWatermark must be a versioned aggregate string",
            );
          }
          partitionedAggregateOverride = parsePartitionedWatermark(
            options.sinceWatermark,
            { allowedKeys: targetWatermarkKeys },
          );
          for (const key of targetWatermarkKeys) {
            overriddenWatermarkKeySet.add(key);
          }
        }
        if (options.sinceWatermarks !== undefined) {
          partitionedKeyOverrides = normalizePartitionedWatermarks(
            options.sinceWatermarks,
            {
              allowedKeys: targetWatermarkKeys,
              rejectUnknown: true,
            },
          );
          for (const key of Object.keys(partitionedKeyOverrides)) {
            overriddenWatermarkKeySet.add(key);
          }
        }
        for (const key of targetWatermarkKeys) {
          if (
            !Object.prototype.hasOwnProperty.call(checkpointWatermarks, key)
          ) {
            continue;
          }
          const value = checkpointWatermarks[key];
          const parsedSince = this._parseFiniteWatermark(value);
          if (parsedSince === undefined || parsedSince <= startedAt) continue;
          try {
            this.vault.audit("adapter.sync.future_watermark_repaired", name, {
              scope,
              watermarkKey: key,
              discardedWatermark: this._watermarkForTelemetry(
                value,
                "partitioned",
              ),
              syncStartedAt: startedAt,
            });
          } catch (_auditError) {
            // A repair must not depend on observability storage.
          }
          delete checkpointWatermarks[key];
        }
        // A live partitioned sync migrates legacy/corrupt scalar state to the
        // versioned aggregate. Snapshot imports have zero target keys and
        // preserve the stored scalar byte-for-byte.
        if (targetWatermarkKeys.length > 0 || watermarkWasOverridden) {
          checkpointWatermark =
            serializePartitionedWatermark(checkpointWatermarks);
        }
      } else if (watermarkStrategy === "max-captured-at") {
        const parsedSince = this._parseFiniteWatermark(checkpointWatermark);
        if (parsedSince !== undefined && parsedSince > startedAt) {
          // A business date (licence expiry, booking departure, bill due
          // date, etc.) may accidentally have been used as capturedAt by an
          // adapter. A future high-water mark would suppress every legitimate
          // record until wall-clock time catches up. Discard it and force one
          // lossless full scan; the final candidate is bounded below.
          try {
            this.vault.audit("adapter.sync.future_watermark_repaired", name, {
              scope,
              discardedWatermark: String(checkpointWatermark),
              syncStartedAt: startedAt,
            });
          } catch (_auditError) {
            // A repair must not depend on observability storage.
          }
          checkpointWatermark = undefined;
        }
      }
      const configuredLookback =
        Number.isSafeInteger(adapter.watermarkLookbackMs) &&
        adapter.watermarkLookbackMs >= 0
          ? adapter.watermarkLookbackMs
          : boundedTimestampScan
            ? DEFAULT_WATERMARK_LOOKBACK_MS
            : 0;
      report.watermarkLookbackMs = configuredLookback;
      let collectionSinceWatermark = preserveFileCheckpoint
        ? watermarkWasOverridden
          ? checkpointWatermark
          : undefined
        : checkpointWatermark;
      let collectionSinceWatermarks = {};
      if (partitionedWatermark) {
        collectionSinceWatermarks = preserveFileCheckpoint
          ? {}
          : Object.fromEntries(
              targetWatermarkKeys
                .filter((key) =>
                  Object.prototype.hasOwnProperty.call(
                    checkpointWatermarks,
                    key,
                  ),
                )
                .map((key) => [key, checkpointWatermarks[key]]),
            );
        if (partitionedAggregateOverride) {
          for (const key of targetWatermarkKeys) {
            if (
              Object.prototype.hasOwnProperty.call(
                partitionedAggregateOverride,
                key,
              )
            ) {
              collectionSinceWatermarks[key] =
                partitionedAggregateOverride[key];
            } else {
              delete collectionSinceWatermarks[key];
            }
          }
        }
        Object.assign(collectionSinceWatermarks, partitionedKeyOverrides);
        for (const [key, value] of Object.entries(collectionSinceWatermarks)) {
          const parsed = this._parseFiniteWatermark(value);
          if (parsed === undefined || parsed <= startedAt) continue;
          try {
            this.vault.audit("adapter.sync.future_watermark_repaired", name, {
              scope,
              watermarkKey: key,
              source: "sync_override",
              discardedWatermark: this._watermarkForTelemetry(
                value,
                "partitioned",
              ),
              syncStartedAt: startedAt,
            });
          } catch (_auditError) {
            // A repair must not depend on observability storage.
          }
          delete collectionSinceWatermarks[key];
        }
        if (configuredLookback > 0) {
          for (const [key, value] of Object.entries(
            collectionSinceWatermarks,
          )) {
            if (overriddenWatermarkKeySet.has(key)) continue;
            const parsed = this._parseFiniteWatermark(value);
            if (parsed !== undefined) {
              collectionSinceWatermarks[key] = String(
                Math.max(0, parsed - configuredLookback),
              );
            }
          }
        }
        collectionSinceWatermark =
          preserveFileCheckpoint &&
          options.sinceWatermark === undefined &&
          options.sinceWatermarks === undefined
            ? undefined
            : checkpointWatermark == null && targetWatermarkKeys.length === 0
              ? undefined
              : serializePartitionedWatermark(collectionSinceWatermarks);
      } else {
        const parsedCheckpoint =
          this._parseFiniteWatermark(checkpointWatermark);
        if (
          !watermarkWasOverridden &&
          parsedCheckpoint !== undefined &&
          configuredLookback > 0
        ) {
          collectionSinceWatermark = Math.max(
            0,
            parsedCheckpoint - configuredLookback,
          );
        }
      }
      report.collectionSinceWatermark = this._serializeWatermark(
        collectionSinceWatermark,
      );

      let nextWatermark = this._serializeWatermark(checkpointWatermark);
      const nextWatermarks = { ...checkpointWatermarks };
      let maxCapturedAt = this._parseFiniteWatermark(checkpointWatermark);
      let watermarkComplete = adapter.watermarkRequiresCompleteScan !== true;
      let explicitContinuationPublished = false;
      let eventLimitReached = false;
      const completedWatermarkKeySet = new Set();

      this._emit({
        kind: "sync.start",
        adapter: name,
        scope,
        sinceWatermark: this._watermarkForTelemetry(
          collectionSinceWatermark,
          watermarkStrategy,
        ),
        checkpointWatermark: this._watermarkForTelemetry(
          checkpointWatermark,
          watermarkStrategy,
        ),
        watermarkTargetKeys: targetWatermarkKeys,
        pageBudget: report.pageBudget,
      });

      // 4. Iterate raw events, batch them, ingest each batch
      let buffer = [];
      const flush = async () => {
        if (buffer.length === 0) return;
        await this._ingestRawBatch(adapter, buffer, report, scope);
        buffer = [];
        this._throwIfAborted(options.signal);
      };

      // Phase 5.7: forward adapter progress events through onSyncEvent so
      // the WS / IPC layer can stream them to the UI. Adapter-specific
      // payload is passed through opaque (each adapter defines its own
      // phases); the registry only stamps `kind: "adapter-progress"` so
      // listeners can filter.
      const adapterOnProgress = (msg) => {
        this._emit({ kind: "adapter-progress", adapter: name, ...msg });
      };
      const requireTargetWatermarkKey = (key, action) => {
        const normalized = assertPartitionedWatermarkKey(
          key,
          `${name} ${action} watermark stream key`,
        );
        if (!targetWatermarkKeySet.has(normalized)) {
          throw new TypeError(
            `AdapterRegistry: ${name}.${action} selected non-target watermark stream "${normalized}"`,
          );
        }
        return normalized;
      };
      const adapterUpdateWatermark = partitionedWatermark
        ? (key, value) => {
            const normalized = requireTargetWatermarkKey(
              key,
              "updateWatermark",
            );
            const candidate = normalizePartitionedWatermarks(
              { [normalized]: value },
              {
                allowedKeys: [normalized],
                rejectUnknown: true,
              },
            )[normalized];
            const safeCandidate = String(
              Math.min(Number(candidate), startedAt),
            );
            const previous = this._parseFiniteWatermark(
              nextWatermarks[normalized],
            );
            if (previous === undefined || Number(safeCandidate) > previous) {
              nextWatermarks[normalized] = safeCandidate;
            }
          }
        : (value) => {
            nextWatermark = this._serializeWatermark(value, {
              rejectNull: true,
            });
            if (watermarkStrategy === "explicit") {
              explicitContinuationPublished = true;
            }
          };
      const adapterMarkWatermarkComplete = partitionedWatermark
        ? (key) => {
            completedWatermarkKeySet.add(
              requireTargetWatermarkKey(key, "markWatermarkComplete"),
            );
          }
        : () => {
            watermarkComplete = true;
          };
      const beforeSourceRequest = this._createSourceRequestPermit({
        adapter,
        scope,
        report,
        signal: options.signal,
      });

      // Phase 6: forward all options opaquely so adapter-specific opts
      // (Alipay: zipPath/csvPath/zipPassword; future adapters: ...) reach
      // sync() without the registry needing to know about them. Explicit
      // standard keys come last so they always win.
      const iter = adapter.sync({
        ...options,
        ...(report.pageBudget !== null ? { maxPages: report.pageBudget } : {}),
        ...(partitionedWatermark
          ? {
              maxPagesByWatermarkKey: Object.freeze({
                ...pageBudgetsByWatermarkKey,
              }),
            }
          : {}),
        sinceWatermark: partitionedWatermark
          ? undefined
          : collectionSinceWatermark,
        sinceWatermarks: partitionedWatermark
          ? Object.freeze({ ...collectionSinceWatermarks })
          : options.sinceWatermarks,
        ...(eventLimit === null
          ? { maxEvents: options.maxEvents }
          : { limit: eventLimit, maxEvents: eventLimit }),
        scope,
        onProgress: adapterOnProgress,
        updateWatermark: adapterUpdateWatermark,
        markWatermarkComplete: adapterMarkWatermarkComplete,
        beforeSourceRequest,
        deferSyncCommit,
      });

      for await (const raw of iter) {
        this._throwIfAborted(options.signal);
        if (!raw || typeof raw !== "object") {
          report.invalidCount += 1;
          report.archiveFailureCount += 1;
          throw new RawArchiveError(
            name,
            "adapter yielded a non-object raw envelope",
          );
        }
        if (partitionedWatermark && targetWatermarkKeys.length > 0) {
          if (
            !Object.prototype.hasOwnProperty.call(raw, "watermarkKey") ||
            !Object.prototype.hasOwnProperty.call(raw, "watermarkAt")
          ) {
            throw new TypeError(
              `AdapterRegistry: ${name} partitioned raw envelopes require watermarkKey and watermarkAt`,
            );
          }
          const watermarkKey = requireTargetWatermarkKey(
            raw.watermarkKey,
            "raw",
          );
          const candidate = this._parseFiniteWatermark(raw.watermarkAt);
          const previous = this._parseFiniteWatermark(
            nextWatermarks[watermarkKey],
          );
          const safeCandidate =
            candidate !== undefined
              ? Math.min(candidate, startedAt)
              : undefined;
          if (
            safeCandidate !== undefined &&
            safeCandidate > 0 &&
            (previous === undefined || safeCandidate > previous)
          ) {
            nextWatermarks[watermarkKey] = String(safeCandidate);
          }
        } else if (watermarkStrategy === "max-captured-at") {
          const watermarkValue = Object.prototype.hasOwnProperty.call(
            raw,
            "watermarkAt",
          )
            ? raw.watermarkAt
            : raw.capturedAt;
          const capturedAt = this._parseFiniteWatermark(watermarkValue);
          const safeCapturedAt =
            capturedAt !== undefined
              ? Math.min(capturedAt, startedAt)
              : undefined;
          if (
            safeCapturedAt !== undefined &&
            safeCapturedAt > 0 &&
            (maxCapturedAt === undefined || safeCapturedAt > maxCapturedAt)
          ) {
            maxCapturedAt = safeCapturedAt;
            nextWatermark = String(safeCapturedAt);
          }
        }
        buffer.push(raw);
        report.rawCount += 1;
        this._throwIfAborted(options.signal);
        if (buffer.length >= this.batchSize) {
          await flush();
        }
        if (eventLimit !== null && report.rawCount >= eventLimit) {
          eventLimitReached = true;
          break;
        }
      }
      this._throwIfAborted(options.signal);
      await flush();
      this._throwIfAborted(options.signal);

      // 5. Persist final watermark
      const eventLimitHasExactContinuation =
        eventLimitReached &&
        (watermarkStrategy === "count" ||
          (watermarkStrategy === "explicit" && explicitContinuationPublished));
      const checkpointBlockedByEventLimit =
        eventLimitReached && !eventLimitHasExactContinuation;
      if (checkpointBlockedByEventLimit) {
        watermarkComplete = false;
        completedWatermarkKeySet.clear();
      }
      if (preserveFileCheckpoint) {
        // File/snapshot imports are independent replay sources by default.
        // They may use an explicit caller-provided collection cursor, but
        // never read or replace the durable live-source checkpoint.
        report.watermark = storedWatermarkExact;
        report.committedWatermarkKeys = [];
        report.deferredWatermarkKeys = [];
      } else if (partitionedWatermark) {
        const committed = [];
        const deferred = [];
        for (const key of targetWatermarkKeys) {
          if (completedWatermarkKeySet.has(key)) {
            committed.push(key);
          } else {
            deferred.push(key);
            if (
              Object.prototype.hasOwnProperty.call(
                durableCheckpointWatermarks,
                key,
              )
            ) {
              nextWatermarks[key] = durableCheckpointWatermarks[key];
            } else {
              delete nextWatermarks[key];
            }
          }
        }
        report.committedWatermarkKeys = committed;
        report.deferredWatermarkKeys = deferred;
        report.watermarkDeferred = deferred.length > 0;
        report.watermark =
          committed.length === 0
            ? this._serializeWatermark(storedWatermark)
            : serializePartitionedWatermark(nextWatermarks);
      } else if (
        checkpointBlockedByEventLimit ||
        (boundedCompleteScan &&
          !watermarkComplete &&
          !eventLimitHasExactContinuation)
      ) {
        // A bounded collector may publish a tentative timestamp or opaque
        // cursor while it scans. Never commit that candidate until the
        // adapter confirms it is either at the source boundary or has encoded
        // an exact resumable continuation.
        report.watermark = this._serializeWatermark(checkpointWatermark);
        report.watermarkDeferred = true;
      } else if (watermarkStrategy === "count") {
        const newWatermark =
          report.rawCount +
          (this._parseStoredWatermark(checkpointWatermark) || 0);
        report.watermark = String(newWatermark);
      } else {
        // Timestamp and opaque cursor strategies preserve the previous
        // watermark on an empty successful sync. Explicit candidates are
        // committed only after the whole adapter iteration and ingest path
        // succeeds; the catch path below therefore cannot advance state.
        report.watermark = nextWatermark;
      }
      if (report.watermarkDeferred && adaptivePageBudget) {
        if (partitionedWatermark) {
          let maxNextBudget = null;
          let maxDeferredCount = 0;
          for (const key of report.deferredWatermarkKeys) {
            this._throwIfAborted(options.signal);
            const currentBudget =
              pageBudgetsByWatermarkKey[key] || DEFAULT_SCAN_PAGE_BUDGET;
            const nextBudget =
              currentBudget <= Math.floor(Number.MAX_SAFE_INTEGER / 2)
                ? currentBudget * 2
                : Number.MAX_SAFE_INTEGER;
            const state = scanStatesByWatermarkKey[key];
            const currentDeferredCount =
              state &&
              Number.isSafeInteger(state.deferred_count) &&
              state.deferred_count >= 0
                ? state.deferred_count
                : 0;
            const nextDeferredCount =
              currentDeferredCount < Number.MAX_SAFE_INTEGER
                ? currentDeferredCount + 1
                : Number.MAX_SAFE_INTEGER;
            this.vault.setSyncScanState(
              name,
              this._partitionedScanStateScope(scope, key),
              {
                pageBudget: nextBudget,
                deferredCount: nextDeferredCount,
                updatedAt: Date.now(),
              },
            );
            maxNextBudget =
              maxNextBudget == null
                ? nextBudget
                : Math.max(maxNextBudget, nextBudget);
            maxDeferredCount = Math.max(maxDeferredCount, nextDeferredCount);
          }
          report.nextPageBudget = maxNextBudget;
          report.scanDeferredCount = maxDeferredCount;
        } else {
          this._throwIfAborted(options.signal);
          const currentBudget = report.pageBudget || DEFAULT_SCAN_PAGE_BUDGET;
          const nextBudget =
            currentBudget <= Math.floor(Number.MAX_SAFE_INTEGER / 2)
              ? currentBudget * 2
              : Number.MAX_SAFE_INTEGER;
          const nextDeferredCount =
            report.scanDeferredCount < Number.MAX_SAFE_INTEGER
              ? report.scanDeferredCount + 1
              : Number.MAX_SAFE_INTEGER;
          this.vault.setSyncScanState(name, scope, {
            pageBudget: nextBudget,
            deferredCount: nextDeferredCount,
            updatedAt: Date.now(),
          });
          report.nextPageBudget = nextBudget;
          report.scanDeferredCount = nextDeferredCount;
        }
      }
      if (!preserveFileCheckpoint) {
        this._throwIfAborted(options.signal);
        this.vault.setWatermark(name, scope, {
          watermark: report.watermark,
          lastSyncedAt: Date.now(),
          lastStatus: "ok",
          lastError: null,
        });
      }
      report.checkpointCommitted = preserveFileCheckpoint
        ? false
        : partitionedWatermark
          ? report.committedWatermarkKeys.length > 0
          : !report.watermarkDeferred;
      if (boundedCompleteScan && canPersistScanState) {
        const completedScanStateKeys = partitionedWatermark
          ? report.committedWatermarkKeys
          : report.watermarkDeferred
            ? []
            : [null];
        for (const key of completedScanStateKeys) {
          const scanStateScope =
            key == null ? scope : this._partitionedScanStateScope(scope, key);
          try {
            this.vault.clearSyncScanState(name, scanStateScope);
          } catch (scanStateError) {
            try {
              this.vault.audit("adapter.sync.scan_state_clear_failed", name, {
                scope,
                watermarkKey: key,
                error: toError(scanStateError, "clearSyncScanState").message,
              });
            } catch (_auditError) {
              // Stale state only causes a larger future rescan; it cannot move
              // the committed source watermark or lose data.
            }
          }
        }
      }

      // Adapter-local cursors/samplers are not durable source checkpoints,
      // but they still must not advance before every raw and normalized batch
      // is safely stored. Run deferred mutations only after the final flush
      // and successful checkpoint/preserve handling. A callback failure is an
      // observability issue, not grounds to turn an already committed sync
      // into an error.
      if (report.invalidCount === 0 && report.archiveFailureCount === 0) {
        for (const callback of deferredSyncCommits) {
          try {
            await callback();
          } catch (commitError) {
            try {
              this.vault.audit("adapter.sync.deferred_commit_failed", name, {
                scope,
                error: toError(commitError, "deferSyncCommit").message,
              });
            } catch (_auditError) {
              // Best-effort callback diagnostics only.
            }
          }
        }
      }

      const telemetryReport = this._syncReportForTelemetry(
        report,
        watermarkStrategy,
      );
      try {
        this.vault.audit("adapter.sync.ok", name, {
          scope,
          rawCount: report.rawCount,
          archivedRawCount: report.archivedRawCount,
          archiveFailureCount: report.archiveFailureCount,
          invalidCount: report.invalidCount,
          watermark: telemetryReport.watermark,
          watermarkDeferred: report.watermarkDeferred,
          checkpointCommitted: report.checkpointCommitted,
          pageBudget: report.pageBudget,
          nextPageBudget: report.nextPageBudget,
          scanDeferredCount: report.scanDeferredCount,
          watermarkLookbackMs: report.watermarkLookbackMs,
          collectionSinceWatermark: telemetryReport.collectionSinceWatermark,
          committedWatermarkKeys: report.committedWatermarkKeys,
          deferredWatermarkKeys: report.deferredWatermarkKeys,
          attemptCount: report.attemptCount,
          retryCount: report.retryCount,
          totalRetryDelayMs: report.totalRetryDelayMs,
          rateLimitRemainingMinute: report.rateLimitRemainingMinute,
          rateLimitRemainingDay: report.rateLimitRemainingDay,
          sourceRequestCount: report.sourceRequestCount,
          sourceRequestThrottleMs: report.sourceRequestThrottleMs,
          sourceRequestRateLimitRemainingMinute:
            report.sourceRequestRateLimitRemainingMinute,
          sourceRequestRateLimitRemainingDay:
            report.sourceRequestRateLimitRemainingDay,
        });
      } catch {
        // A completed sync must not depend on observability storage.
      }
      this._emit({
        kind: "sync.ok",
        adapter: name,
        ...telemetryReport,
      });
    } catch (err) {
      const error =
        options.signal && options.signal.aborted
          ? new SyncAbortedError(options.signal.reason)
          : toError(err, `sync ${name}`);
      const requestRateLimited = error instanceof SourceRequestRateLimitError;
      report.status = requestRateLimited ? "rate_limited" : "error";
      report.error = error.message;
      if (requestRateLimited) {
        report.rateLimitReason = `request_${error.reason}`;
        report.retryAfterMs = error.retryAfterMs;
      } else {
        Object.defineProperty(report, SYNC_ATTEMPT_ERROR, {
          value: error,
          enumerable: false,
          configurable: false,
        });
      }
      try {
        this.vault.audit(
          requestRateLimited
            ? "adapter.sync.request_rate_limited"
            : "adapter.sync.error",
          name,
          {
            scope,
            message: error.message,
            rawCount: report.rawCount,
            archivedRawCount: report.archivedRawCount,
            archiveFailureCount: report.archiveFailureCount,
            checkpointCommitted: report.checkpointCommitted,
            pageBudget: report.pageBudget,
            nextPageBudget: report.nextPageBudget,
            scanDeferredCount: report.scanDeferredCount,
            attemptCount: report.attemptCount,
            retryCount: report.retryCount,
            sourceRequestCount: report.sourceRequestCount,
            sourceRequestThrottleMs: report.sourceRequestThrottleMs,
            rateLimitReason: report.rateLimitReason,
            retryAfterMs: report.retryAfterMs,
          },
        );
      } catch {
        // A failed sync must retain its original result when auditing fails.
      }
      // Update watermark with error status (preserve last successful watermark value)
      try {
        const prev = this.vault.getWatermark(name, scope);
        report.watermark = prev ? prev.watermark : null;
        if (!preserveFileCheckpoint) {
          this.vault.setWatermark(name, scope, {
            watermark: prev ? prev.watermark : null,
            lastSyncedAt: Date.now(),
            lastStatus: report.status,
            lastError: error.message,
          });
        }
      } catch (_e) {
        // Watermark write failure is non-fatal in the error path.
      }
      if (requestRateLimited) {
        this._emit({
          kind: "sync.rate_limited",
          adapter: name,
          scope,
          phase: "source_request",
          reason: report.rateLimitReason,
          retryAfterMs: report.retryAfterMs,
          attemptCount: report.attemptCount,
          retryCount: report.retryCount,
          sourceRequestCount: report.sourceRequestCount,
        });
      }
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
   *   - Iterates raw_events filtered by [opts.adapter] / [opts.scope] (or all)
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
   * @param {string} [opts.scope]    Filter by exact account scope
   * @param {number} [opts.batchSize=100] Raws per partitionBatch+putBatch tx
   * @returns {Promise<RederiveReport>}
   *
   * @typedef {object} RederiveReport
   * @property {number} rawSeen        Total raw_events iterated
   * @property {number} invalidCount   Normalize threw or partition rejected
   * @property {number} adapterMissing Raws whose adapter not registered
   * @property {object} entityCounts   { events, persons, places, items, topics }
   * @property {number} durationMs
   * @property {Array<{adapter,scope,error,sample?}>} errors  Source-level errors
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
    const batchSize =
      Number.isInteger(opts.batchSize) && opts.batchSize > 0
        ? opts.batchSize
        : 100;

    // Page through raw_events in batches to avoid loading the whole table
    // for large vaults (1000+ rows is normal). Group raws by adapter + account
    // scope so re-derive can never collapse records from different accounts.
    let offset = 0;
    /** @type {Map<string, Array<object>>} */
    const buffersBySource = new Map();

    const flushSource = async (sourceKey) => {
      const [adapterName, scope] = JSON.parse(sourceKey);
      const buffer = buffersBySource.get(sourceKey);
      if (!buffer || buffer.length === 0) return;
      const adapter = this._adapters.get(adapterName);
      if (!adapter) {
        report.adapterMissing += buffer.length;
        try {
          this.vault.audit("adapter.rederive.adapter_missing", adapterName, {
            scope,
            droppedCount: buffer.length,
          });
        } catch (_e) {
          /* audit failure is non-fatal */
        }
        buffersBySource.set(sourceKey, []);
        return;
      }
      // normalize + collect into one merged batch (per adapter buffer)
      const merged = {
        events: [],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
      for (const raw of buffer) {
        let normalized;
        try {
          normalized = adapter.normalize(raw);
        } catch (err) {
          report.invalidCount += 1;
          try {
            this.vault.audit("adapter.rederive.normalize_failed", adapterName, {
              scope,
              originalId: raw.originalId,
              error: toError(err, "normalize").message,
            });
          } catch (_e) {
            /* audit non-fatal */
          }
          continue;
        }
        if (!normalized || typeof normalized !== "object") continue;
        for (const k of ["events", "persons", "places", "items", "topics"]) {
          if (Array.isArray(normalized[k])) merged[k].push(...normalized[k]);
        }
      }
      const scoped = scopeNormalizedBatch(merged, scope);
      const { valid, invalidReasons } = partitionBatch(scoped);
      if (invalidReasons.length > 0) {
        report.invalidCount += invalidReasons.length;
        try {
          this.vault.audit("adapter.rederive.invalid_entities", adapterName, {
            scope,
            count: invalidReasons.length,
            sample: invalidReasons.slice(0, 5),
          });
        } catch (_e) {
          /* audit non-fatal */
        }
      }
      try {
        const { counts } = this._persistNormalizedBatch(
          adapter,
          buffer,
          valid,
          scope,
        );
        for (const k of Object.keys(counts)) {
          report.entityCounts[k] = (report.entityCounts[k] || 0) + counts[k];
        }
      } catch (err) {
        report.errors.push({
          adapter: adapterName,
          scope,
          error: toError(err, "putBatch").message,
          sample: buffer.slice(0, 3).map((r) => r.originalId),
        });
        try {
          this.vault.audit("adapter.rederive.put_batch_failed", adapterName, {
            scope,
            error: toError(err, "putBatch").message,
            droppedCount: buffer.length,
          });
        } catch (_e) {
          /* audit non-fatal */
        }
      }
      buffersBySource.set(sourceKey, []);
    };

    while (true) {
      const page = this.vault.queryRawEvents({
        adapter: opts.adapter,
        scope: opts.scope,
        limit: batchSize,
        offset,
      });
      if (page.length === 0) break;
      offset += page.length;
      report.rawSeen += page.length;
      // Group by adapter + scope, flush whenever a buffer hits batchSize.
      for (const raw of page) {
        const sourceKey = JSON.stringify([raw.adapter, raw.scope || ""]);
        let buf = buffersBySource.get(sourceKey);
        if (!buf) {
          buf = [];
          buffersBySource.set(sourceKey, buf);
        }
        buf.push(raw);
        if (buf.length >= batchSize) {
          await flushSource(sourceKey);
        }
      }
    }
    // Final flush of remaining per-source buffers.
    for (const sourceKey of Array.from(buffersBySource.keys())) {
      await flushSource(sourceKey);
    }

    report.durationMs = Date.now() - startedAt;
    try {
      this.vault.audit("adapter.rederive.summary", opts.adapter || "*", {
        scope: typeof opts.scope === "string" ? opts.scope : null,
        rawSeen: report.rawSeen,
        invalidCount: report.invalidCount,
        adapterMissing: report.adapterMissing,
        entityCounts: report.entityCounts,
        durationMs: report.durationMs,
      });
    } catch (_e) {
      /* audit non-fatal */
    }
    return report;
  }

  /**
   * Sync registered adapters sequentially.
   *
   * Default behaviour is readiness-aware: adapters that still need a file,
   * Cookie, device, key, or platform-specific collector return an explicit
   * `{ status: "skipped" }` report instead of generating predictable
   * unhealthy/error noise. Set `readyOnly:false` for the legacy force-all
   * behaviour.
   *
   * Per-adapter runtime inputs can be supplied through `adapterOptions`.
   * Their presence is treated as explicit intent and bypasses readiness
   * skipping for that adapter, e.g.
   *   syncAll({ adapterOptions: {
   *     "weread": { cookie: "..." },
   *     "apple-health": { inputPath: "export.xml" }
   *   }})
   *
   * @param {object} [options]
   * @param {boolean} [options.readyOnly=true]
   * @param {number} [options.readinessTimeoutMs=4000]
   * @param {number} [options.readinessConcurrency=8]
   * @param {Record<string,object>} [options.adapterOptions]
   * @returns {Promise<Array<SyncReport>>} registration-order reports
   */
  async syncAll(options = {}) {
    const normalizedOptions =
      options && typeof options === "object" ? options : {};
    const readyOnly = normalizedOptions.readyOnly !== false;
    const adapterOptions =
      normalizedOptions.adapterOptions &&
      typeof normalizedOptions.adapterOptions === "object" &&
      !Array.isArray(normalizedOptions.adapterOptions)
        ? normalizedOptions.adapterOptions
        : {};
    const sharedOptions = { ...normalizedOptions };
    delete sharedOptions.readyOnly;
    delete sharedOptions.readinessTimeoutMs;
    delete sharedOptions.readinessConcurrency;
    delete sharedOptions.adapterOptions;
    const totalAdapters = this._adapters.size;
    this._emit({
      kind: "sync.batch.start",
      adapter: "(all)",
      current: 0,
      total: totalAdapters,
      readyOnly,
    });

    let readinessByName = null;
    if (readyOnly) {
      const readinessOptions = {};
      if (
        Number.isInteger(normalizedOptions.readinessTimeoutMs) &&
        normalizedOptions.readinessTimeoutMs > 0
      ) {
        readinessOptions.timeoutMs = normalizedOptions.readinessTimeoutMs;
      }
      if (
        Number.isInteger(normalizedOptions.readinessConcurrency) &&
        normalizedOptions.readinessConcurrency > 0
      ) {
        readinessOptions.concurrency = normalizedOptions.readinessConcurrency;
      }
      const readinessReports = await this.readiness(readinessOptions);
      readinessByName = new Map(
        readinessReports.map((report) => [report.name, report]),
      );
    }

    const reports = [];
    const recordReport = (report) => {
      reports.push(report);
      this._emit({
        kind: "sync.batch.progress",
        adapter: report.adapter,
        current: reports.length,
        total: totalAdapters,
        status: report.status,
      });
    };
    for (const adapter of this._adapters.values()) {
      const specificOptions =
        Object.prototype.hasOwnProperty.call(adapterOptions, adapter.name) &&
        adapterOptions[adapter.name] &&
        typeof adapterOptions[adapter.name] === "object" &&
        !Array.isArray(adapterOptions[adapter.name])
          ? adapterOptions[adapter.name]
          : {};
      const hasSpecificOptions = Object.keys(specificOptions).length > 0;
      const readiness = readinessByName && readinessByName.get(adapter.name);

      if (readyOnly && !hasSpecificOptions) {
        const needsDedicatedCollector =
          readiness &&
          readiness.mode === "adb-oneclick" &&
          !adapter.capabilities.includes("sync:adb");
        if (!readiness || readiness.ready !== true || needsDedicatedCollector) {
          const skipReason = needsDedicatedCollector
            ? "DEDICATED_COLLECTOR_REQUIRED"
            : (readiness && readiness.reason) || "NOT_READY";
          const skipMessage = needsDedicatedCollector
            ? "该来源需要宿主专用采集器，不能通过通用 syncAll 直接采集"
            : (readiness && readiness.message) || "来源当前未就绪";
          const report = this._skippedSyncReport(
            adapter.name,
            skipReason,
            skipMessage,
            readiness,
          );
          recordReport(report);
          continue;
        }
      }

      try {
        recordReport(
          await this.syncAdapter(adapter.name, {
            ...sharedOptions,
            ...specificOptions,
          }),
        );
      } catch (err) {
        // Should not happen — syncAdapter catches everything — but be paranoid.
        recordReport({
          adapter: adapter.name,
          status: "error",
          error: toError(err, "syncAll").message,
          rawCount: 0,
          archivedRawCount: 0,
          archiveFailureCount: 0,
          entityCounts: {
            events: 0,
            persons: 0,
            places: 0,
            items: 0,
            topics: 0,
          },
          invalidCount: 0,
          kgTripleCount: 0,
          ragDocCount: 0,
          durationMs: 0,
          watermark: null,
          watermarkDeferred: false,
          checkpointCommitted: false,
          pageBudget: null,
          nextPageBudget: null,
          scanDeferredCount: 0,
          watermarkLookbackMs: 0,
          collectionSinceWatermark: null,
          attemptCount: 0,
          retryCount: 0,
          totalRetryDelayMs: 0,
          retryExhausted: false,
          retryAfterMs: null,
          rateLimitReason: null,
          rateLimitRemainingMinute: null,
          rateLimitRemainingDay: null,
          sourceRequestCount: 0,
          sourceRequestThrottleMs: 0,
          sourceRequestRateLimitRemainingMinute: null,
          sourceRequestRateLimitRemainingDay: null,
        });
      }
    }
    const statusCounts = reports.reduce((counts, report) => {
      const status =
        report && typeof report.status === "string" ? report.status : "invalid";
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    this._emit({
      kind: "sync.batch.done",
      adapter: "(all)",
      current: reports.length,
      total: totalAdapters,
      statusCounts,
    });
    return reports;
  }

  _skippedSyncReport(adapter, skipReason, skipMessage, readiness) {
    const report = {
      adapter,
      status: "skipped",
      rawCount: 0,
      archivedRawCount: 0,
      archiveFailureCount: 0,
      entityCounts: {
        events: 0,
        persons: 0,
        places: 0,
        items: 0,
        topics: 0,
      },
      invalidCount: 0,
      kgTripleCount: 0,
      ragDocCount: 0,
      durationMs: 0,
      error: null,
      watermark: null,
      watermarkDeferred: false,
      checkpointCommitted: false,
      pageBudget: null,
      nextPageBudget: null,
      scanDeferredCount: 0,
      watermarkLookbackMs: 0,
      collectionSinceWatermark: null,
      attemptCount: 0,
      retryCount: 0,
      totalRetryDelayMs: 0,
      retryExhausted: false,
      retryAfterMs: null,
      rateLimitReason: null,
      rateLimitRemainingMinute: null,
      rateLimitRemainingDay: null,
      sourceRequestCount: 0,
      sourceRequestThrottleMs: 0,
      sourceRequestRateLimitRemainingMinute: null,
      sourceRequestRateLimitRemainingDay: null,
      skipReason,
      skipMessage,
      readiness: readiness
        ? {
            status: readiness.status,
            reason: readiness.reason,
            mode: readiness.mode,
            category: readiness.category,
          }
        : null,
    };
    try {
      this.vault.audit("adapter.sync.skipped", adapter, {
        reason: skipReason,
        message: skipMessage,
      });
    } catch (_error) {
      // Audit failure must not turn a deliberate skip into a sync failure.
    }
    this._emit({
      kind: "sync.skipped",
      adapter,
      reason: skipReason,
      message: skipMessage,
    });
    return report;
  }

  // ─── Internals ───────────────────────────────────────────────────────

  _createSourceRequestPermit({ adapter, scope, report, signal }) {
    const declared =
      adapter.rateLimits && typeof adapter.rateLimits === "object"
        ? adapter.rateLimits
        : {};
    const perMinute =
      Number.isSafeInteger(declared.perMinute) && declared.perMinute > 0
        ? declared.perMinute
        : 0;
    const perDay =
      Number.isSafeInteger(declared.perDay) && declared.perDay > 0
        ? declared.perDay
        : 0;
    const declaredMinInterval =
      Number.isSafeInteger(declared.minIntervalMs) && declared.minIntervalMs > 0
        ? declared.minIntervalMs
        : 0;
    // A fixed-window quota alone permits every request to burst at the start
    // of a minute. Derive an evenly spaced floor while honoring any stricter
    // interval explicitly declared by the adapter.
    const minIntervalMs = Math.max(
      declaredMinInterval,
      perMinute > 0 ? Math.ceil(60_000 / perMinute) : 0,
    );
    const rateLimits = { perMinute, perDay, minIntervalMs };
    const hasRateLimit = perMinute > 0 || perDay > 0 || minIntervalMs > 0;
    let logicalNow = this._now();

    return async (detail = {}) => {
      this._throwIfAborted(signal);
      if (
        !hasRateLimit ||
        typeof this.vault.acquireSourceRequestRateLimit !== "function"
      ) {
        report.sourceRequestCount += 1;
        return;
      }

      while (true) {
        logicalNow = Math.max(logicalNow, this._now());
        const reservation = this.vault.acquireSourceRequestRateLimit(
          adapter.name,
          scope,
          rateLimits,
          logicalNow,
        );
        report.sourceRequestRateLimitRemainingMinute =
          reservation.remainingMinute;
        report.sourceRequestRateLimitRemainingDay = reservation.remainingDay;
        if (reservation.allowed) {
          report.sourceRequestCount += 1;
          return;
        }

        if (reservation.reason === "per_day") {
          throw new SourceRequestRateLimitError(
            adapter.name,
            reservation.reason,
            reservation.retryAfterMs,
          );
        }

        const waitMs = reservation.retryAfterMs;
        report.sourceRequestThrottleMs += waitMs;
        this._emit({
          kind: "sync.request_throttled",
          adapter: adapter.name,
          scope,
          reason: reservation.reason,
          delayMs: waitMs,
          retryAt: reservation.retryAt,
          sourceRequestCount: report.sourceRequestCount,
          operation:
            typeof detail.operation === "string" ? detail.operation : null,
          page: Number.isSafeInteger(detail.page) ? detail.page : null,
        });
        await this._sleepWithSignal(waitMs, signal);
        logicalNow = Math.max(logicalNow + waitMs, this._now());
        this._throwIfAborted(signal);
      }
    };
  }

  _throwIfAborted(signal) {
    if (signal && signal.aborted) {
      throw new SyncAbortedError(signal.reason);
    }
  }

  async _sleepWithSignal(ms, signal) {
    this._throwIfAborted(signal);
    if (!signal || typeof signal.addEventListener !== "function") {
      await this._sleep(ms);
      return;
    }

    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const onAbort = () => finish(reject, new SyncAbortedError(signal.reason));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => this._sleep(ms))
        .then(
          () => finish(resolve),
          (error) => finish(reject, error),
        );
      if (signal.aborted) onAbort();
    });
  }

  async _ingestRawBatch(adapter, rawBatch, report, scope = "") {
    // 1. Archive raw payloads to vault.raw_events. Done first so even if
    //    normalize / KG / RAG fails, the raw is recoverable for re-derive.
    const archiveFailures = [];
    for (const raw of rawBatch) {
      try {
        this.vault.putRawEvent({
          adapter: adapter.name,
          scope,
          originalId: raw.originalId,
          capturedAt: raw.capturedAt,
          payload: raw.payload,
        });
        report.archivedRawCount += 1;
      } catch (err) {
        // Bad raw — record and skip.
        const error = toError(err, "putRawEvent");
        report.invalidCount += 1;
        report.archiveFailureCount += 1;
        archiveFailures.push({
          originalId: raw && raw.originalId,
          error: error.message,
        });
        try {
          this.vault.audit("adapter.sync.invalid_raw", adapter.name, {
            scope,
            originalId: raw && raw.originalId,
            error: error.message,
            checkpointBlocked: true,
          });
        } catch (_auditError) {
          // Preserve the original archive failure as the sync error.
        }
      }
    }

    // 2. Normalize each raw → merge into one batch for transactional commit.
    if (archiveFailures.length > 0) {
      throw new RawArchiveError(
        adapter.name,
        `${archiveFailures.length} raw record(s) were not durably stored`,
        archiveFailures.slice(0, 5),
      );
    }

    const merged = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
    for (const raw of rawBatch) {
      let normalized;
      try {
        normalized = adapter.normalize(raw);
      } catch (err) {
        report.invalidCount += 1;
        this.vault.audit("adapter.sync.normalize_failed", adapter.name, {
          scope,
          originalId: raw.originalId,
          error: toError(err, "normalize").message,
        });
        continue;
      }
      if (!normalized || typeof normalized !== "object") continue;
      for (const key of ["events", "persons", "places", "items", "topics"]) {
        if (Array.isArray(normalized[key]))
          merged[key].push(...normalized[key]);
      }
    }

    // 3. Partition valid vs invalid (validators gate before vault write).
    const scoped = scopeNormalizedBatch(merged, scope);
    const { valid, invalid, invalidReasons } = partitionBatch(scoped);
    if (invalidReasons.length > 0) {
      report.invalidCount += invalidReasons.length;
      // Only audit a small sample — invalid rows can be high-cardinality.
      this.vault.audit("adapter.sync.invalid_entities", adapter.name, {
        scope,
        count: invalidReasons.length,
        sample: invalidReasons.slice(0, 5),
      });
    }

    // 4. Transactional write to vault. Adapters with cross-producer identity
    // and quality evidence can opt into LocalVault.putBatchResolved through
    // buildResolvedIngestOptions(). The returned batch is the exact entity
    // graph persisted by the vault after ID and reference rewriting.
    const {
      counts,
      persistedBatch,
      conflicts,
      aliasesRegistered,
      rawObservationWrites,
    } = this._persistNormalizedBatch(adapter, rawBatch, valid, scope);
    for (const k of Object.keys(counts)) {
      report.entityCounts[k] = (report.entityCounts[k] || 0) + counts[k];
    }
    report.resolvedConflictCount += conflicts.length;
    report.sourceAliasCount += aliasesRegistered;
    report.rawObservationCount += rawObservationWrites;

    // 4.5. Phase 8.6: EntityResolver ingest hook. Sync-rule stage runs
    // immediately for each new Person; "uncertain" pairs go to the
    // resolve_queue for async embedding+LLM processing. Failures are
    // captured in audit_log but don't break sync.
    if (
      this.entityResolver &&
      Array.isArray(persistedBatch.persons) &&
      persistedBatch.persons.length > 0
    ) {
      try {
        const resolverSummary = this.entityResolver.resolveOnIngest(
          persistedBatch.persons,
        );
        report.entityResolver = {
          ...(report.entityResolver || {
            newPersons: 0,
            sameImmediate: 0,
            differentImmediate: 0,
            enqueued: 0,
            errored: 0,
          }),
        };
        for (const k of Object.keys(resolverSummary)) {
          report.entityResolver[k] =
            (report.entityResolver[k] || 0) + resolverSummary[k];
        }
      } catch (err) {
        this.vault.audit("adapter.sync.entity_resolver_failed", adapter.name, {
          scope,
          error: toError(err, "entityResolver").message,
        });
      }
    }

    // 5. KG sink (per-batch, not per-entity, so the sink can amortize work).
    if (this.kgSink) {
      const triples = deriveBatchTriples(persistedBatch);
      report.kgTripleCount += triples.length;
      try {
        await this.kgSink(triples);
      } catch (err) {
        this.vault.audit("adapter.sync.kg_sink_failed", adapter.name, {
          scope,
          error: toError(err, "kgSink").message,
        });
      }
    }

    // 6. RAG sink.
    if (this.ragSink) {
      const docs = deriveBatchDocs(persistedBatch);
      report.ragDocCount += docs.length;
      try {
        await this.ragSink(docs);
      } catch (err) {
        this.vault.audit("adapter.sync.rag_sink_failed", adapter.name, {
          scope,
          error: toError(err, "ragSink").message,
        });
      }
    }

    this._emit({
      kind: "sync.batch",
      adapter: adapter.name,
      scope,
      rawCount: report.rawCount,
      invalidCount: report.invalidCount,
    });

    // Suppress unused-var lint
    void invalid;
  }

  _persistNormalizedBatch(adapter, rawBatch, batch, scope) {
    if (typeof adapter.buildResolvedIngestOptions !== "function") {
      return {
        counts: this.vault.putBatch(batch),
        persistedBatch: batch,
        conflicts: [],
        aliasesRegistered: 0,
        rawObservationWrites: 0,
      };
    }
    if (typeof this.vault.putBatchResolved !== "function") {
      throw new Error(
        `AdapterRegistry: adapter "${adapter.name}" requires vault.putBatchResolved`,
      );
    }

    let options = adapter.buildResolvedIngestOptions({
      rawBatch,
      batch,
      scope,
    });
    if (options && typeof options.then === "function") {
      if (typeof options.catch === "function") options.catch(() => {});
      throw new TypeError(
        `AdapterRegistry: ${adapter.name}.buildResolvedIngestOptions must be synchronous`,
      );
    }
    if (options == null) options = {};
    const optionsPrototype =
      typeof options === "object" && options
        ? Object.getPrototypeOf(options)
        : undefined;
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      (optionsPrototype !== Object.prototype && optionsPrototype !== null)
    ) {
      throw new TypeError(
        `AdapterRegistry: ${adapter.name}.buildResolvedIngestOptions must return a plain object`,
      );
    }

    const result = this.vault.putBatchResolved(batch, options);
    if (
      !result ||
      typeof result !== "object" ||
      !result.counts ||
      !result.resolvedBatch
    ) {
      throw new Error(
        "AdapterRegistry: vault.putBatchResolved returned an invalid result",
      );
    }
    return {
      counts: result.counts,
      persistedBatch: result.resolvedBatch,
      conflicts: Array.isArray(result.conflicts) ? result.conflicts : [],
      aliasesRegistered: Number.isSafeInteger(result.aliasesRegistered)
        ? result.aliasesRegistered
        : 0,
      rawObservationWrites: Number.isSafeInteger(result.rawObservationWrites)
        ? result.rawObservationWrites
        : 0,
    };
  }

  _parseStoredWatermark(s) {
    if (s == null) return undefined;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  }

  _parseFiniteWatermark(value) {
    if (value == null || value === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  _deserializeWatermark(value, strategy) {
    if (value == null) return undefined;
    return strategy === "count"
      ? this._parseStoredWatermark(value)
      : String(value);
  }

  _serializeWatermark(value, { rejectNull = false } = {}) {
    if (value == null) {
      if (rejectNull) {
        throw new TypeError(
          "AdapterRegistry: updateWatermark requires a non-null string, number, or bigint",
        );
      }
      return null;
    }
    if (typeof value === "string") {
      if (value.length === 0 && rejectNull) {
        throw new TypeError(
          "AdapterRegistry: updateWatermark requires a non-empty string",
        );
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new TypeError(
          "AdapterRegistry: updateWatermark requires a finite number",
        );
      }
      return String(value);
    }
    if (typeof value === "bigint") return String(value);
    throw new TypeError(
      "AdapterRegistry: updateWatermark requires a string, number, or bigint",
    );
  }

  _watermarkForTelemetry(value, strategy) {
    if (!["explicit", "partitioned"].includes(strategy) || value == null) {
      return value;
    }
    let serialized;
    try {
      serialized = this._serializeWatermark(value, { rejectNull: true });
    } catch {
      return {
        format: strategy,
        valueType: Array.isArray(value) ? "array" : typeof value,
      };
    }
    const byteLength = Buffer.byteLength(serialized, "utf8");
    return {
      format: strategy,
      byteLength,
      hmacSha256: crypto
        .createHmac("sha256", this._watermarkTelemetryHmacKey)
        .update(serialized, "utf8")
        .digest("hex"),
    };
  }

  _syncReportForTelemetry(report, strategy) {
    const { watermark, collectionSinceWatermark, ...telemetryReport } = report;
    return {
      ...telemetryReport,
      watermark: this._watermarkForTelemetry(watermark, strategy),
      collectionSinceWatermark: this._watermarkForTelemetry(
        collectionSinceWatermark,
        strategy,
      ),
    };
  }

  _partitionedScanStateScope(scope, key) {
    return JSON.stringify([
      typeof scope === "string" ? scope : "",
      "pdh-partitioned-v1",
      assertPartitionedWatermarkKey(key),
    ]);
  }

  _resolveScope(adapter, options = {}, { fileCheckpointMode = null } = {}) {
    if (typeof options.scope === "string") return options.scope;

    // JSON snapshots carry the source account inside the file. Resolve that
    // identity before reading a watermark so a no-arg snapshot adapter can
    // safely ingest multiple accounts without sharing cursors. A snapshot
    // that has no usable account identity intentionally falls back to the
    // legacy empty scope instead of inheriting an unrelated live account.
    if (
      options.snapshotAccount &&
      typeof options.snapshotAccount === "object"
    ) {
      const scope = this._scopeFromSnapshot(adapter, {
        account: options.snapshotAccount,
      });
      if (scope) return scope;
    }
    if (
      fileCheckpointMode !== "shared" &&
      typeof options.inputPath === "string" &&
      options.inputPath.trim().length > 0
    ) {
      // Scope discovery must obey the same bounded, no-follow, stable-file
      // boundary as the adapter itself. Non-JSON imports (XML/SQLite/etc.) do
      // not carry the standard snapshot account envelope and are skipped.
      if (/\.json$/iu.test(options.inputPath.trim())) {
        try {
          const snapshot = JSON.parse(
            readBoundedSnapshot(fs, options.inputPath, {
              maxBytes: options.maxSnapshotBytes,
            }),
          );
          const scope = this._scopeFromSnapshot(adapter, snapshot);
          if (scope) return scope;
        } catch (_err) {
          // The adapter health/sync path owns the user-facing parse error.
        }
      }
      if (adapter && typeof adapter.resolveInputScope === "function") {
        try {
          const resolved = adapter.resolveInputScope(options);
          if (typeof resolved === "string" && resolved.length > 0) {
            return resolved;
          }
        } catch {
          // Authentication/health checks own invalid input diagnostics.
        }
      }
      return "";
    }

    // Ephemeral credential syncs provide an account id at call time instead
    // of mutating/persisting the adapter. Keep their cursors isolated exactly
    // like constructor-configured accounts and snapshots. Cookie collectors
    // use the legacy default; OAuth collectors declare runtimeCredentialOption.
    const runtimeIdentityKey =
      adapter && typeof adapter.runtimeScopeIdentityKey === "string"
        ? adapter.runtimeScopeIdentityKey
        : null;
    const runtimeCredentialOption =
      adapter && typeof adapter.runtimeCredentialOption === "string"
        ? adapter.runtimeCredentialOption
        : "cookie";
    const runtimeIdentity =
      runtimeIdentityKey && options[runtimeIdentityKey] != null
        ? options[runtimeIdentityKey]
        : options.accountId;
    const normalizedRuntimeIdentity = normalizeIdentity(runtimeIdentity);
    const runtimeCredential = options[runtimeCredentialOption];
    if (
      typeof runtimeCredential === "string" &&
      runtimeCredential.trim().length > 0 &&
      runtimeIdentityKey &&
      normalizedRuntimeIdentity
    ) {
      const identityParts = [
        `${runtimeIdentityKey}:${normalizedRuntimeIdentity}`,
      ];
      const discriminatorKeys =
        adapter && Array.isArray(adapter.runtimeScopeDiscriminatorKeys)
          ? adapter.runtimeScopeDiscriminatorKeys
          : [];
      const discriminatorDefaults =
        adapter &&
        adapter.runtimeScopeDiscriminatorDefaults &&
        typeof adapter.runtimeScopeDiscriminatorDefaults === "object"
          ? adapter.runtimeScopeDiscriminatorDefaults
          : {};
      for (const key of discriminatorKeys) {
        if (typeof key !== "string" || key.length === 0) continue;
        const value =
          options[key] != null ? options[key] : discriminatorDefaults[key];
        if (value == null || String(value).trim().length === 0) continue;
        // Account identifiers are intentionally normalized, while opaque
        // drive/folder IDs and paths may be case- and Unicode-sensitive.
        // Encode their exact trimmed UTF-8 bytes before createAccountScope
        // normalizes the composite.
        const discriminatorHex = Buffer.from(
          String(value).trim(),
          "utf8",
        ).toString("hex");
        identityParts.push(`${key}:hex:${discriminatorHex}`);
      }
      return createAccountScope(adapter.name, identityParts.join("\0"));
    }

    // Local profile adapters discover their default account lazily. Merely
    // constructing an adapter (for example while generating the catalog)
    // must not inspect browser profile metadata on the host.
    if (adapter && typeof adapter.resolveDefaultScope === "function") {
      try {
        const resolved = adapter.resolveDefaultScope(options);
        if (typeof resolved === "string" && resolved.length > 0) {
          return resolved;
        }
      } catch {
        // Authentication/health checks own the actionable discovery error.
      }
    }

    return adapter && typeof adapter.defaultScope === "string"
      ? adapter.defaultScope
      : "";
  }

  _scopeFromSnapshot(adapter, snapshot) {
    const namespace =
      typeof adapter.scopeNamespace === "string" &&
      adapter.scopeNamespace.length > 0
        ? adapter.scopeNamespace
        : adapter.name;
    return createAccountScopeFromSnapshot(namespace, snapshot, {
      identityFields: adapter.snapshotScopeIdentityFields,
      topLevelFields: adapter.snapshotScopeTopLevelFields,
      includeField: adapter.snapshotScopeIdentityIncludesField,
    });
  }

  _isExplicitFileSync(options) {
    return ["inputPath", "dataPath", "csvPath", "zipPath"].some(
      (key) =>
        typeof options?.[key] === "string" && options[key].trim().length > 0,
    );
  }

  _resolveFileCheckpointMode(adapter, options) {
    const mode =
      typeof adapter.fileCheckpointMode === "function"
        ? adapter.fileCheckpointMode(options)
        : "preserve";
    if (!FILE_CHECKPOINT_MODES.includes(mode)) {
      throw new TypeError(
        `AdapterRegistry: ${adapter.name}.fileCheckpointMode() must return one of ${FILE_CHECKPOINT_MODES.join("|")}`,
      );
    }
    return mode;
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
  DEFAULT_SYNC_MAX_RETRIES,
  DEFAULT_SYNC_RETRY_BASE_DELAY_MS,
  DEFAULT_SYNC_RETRY_MAX_DELAY_MS,
  SourceRequestRateLimitError,
  isRetryableSyncError,
};
