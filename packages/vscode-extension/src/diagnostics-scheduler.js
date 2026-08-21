"use strict";

/**
 * Incremental, host-neutral diagnostics snapshot scheduler.
 *
 * The VS Code facade feeds this class URI-scoped readers from
 * `onDidChangeDiagnostics`. Readers are invoked only after the debounce window,
 * and a newer generation prevents an older reader from publishing. Consumers
 * always observe the last complete immutable snapshot; a partially processed
 * burst is never exposed.
 */
const { performance } = require("node:perf_hooks");

const DIAGNOSTICS_SNAPSHOT_SCHEMA = "cc-diagnostics-snapshot/v1";
const DEFAULT_MAX_DIAGNOSTICS = 10_000;
const DEFAULT_MAX_MESSAGE_CHARS = 2_000;
const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_SLICE_ITEMS = 256;
const DEFAULT_CONTEXT_BYTES = 64 * 1024;

function finiteVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) ? version : null;
}

function bounded(value, limit) {
  return String(value ?? "").slice(0, limit);
}

function normalizeSeverity(value) {
  const severity = String(value ?? "unknown").toLowerCase();
  if (severity.includes("error")) return "error";
  if (severity.includes("warn")) return "warning";
  if (severity.includes("info")) return "information";
  if (severity.includes("hint") || severity.includes("weak")) return "hint";
  return bounded(severity || "unknown", 32);
}

function diagnosticKey(value) {
  return [
    value.documentUri,
    value.documentVersion,
    value.severity,
    value.line,
    value.character,
    value.source,
    value.code,
    value.message,
  ].join("\u0000");
}

function defaultNormalize(raw, context) {
  if (!raw || typeof raw !== "object") return null;
  const documentUri = bounded(raw.documentUri ?? context.uri, 2_048);
  if (!documentUri) return null;
  const version = finiteVersion(raw.documentVersion ?? context.documentVersion);
  const line = Number(raw.line ?? raw.range?.start?.line);
  const character = Number(raw.character ?? raw.range?.start?.character);
  const codeValue =
    raw.code && typeof raw.code === "object" ? raw.code.value : raw.code;
  return Object.freeze({
    file: bounded(raw.file ?? context.file ?? "", 2_048),
    documentUri,
    documentVersion: version,
    isDirty:
      raw.isDirty === null || raw.isDirty === undefined
        ? (context.isDirty ?? null)
        : Boolean(raw.isDirty),
    severity: normalizeSeverity(raw.severity),
    message: bounded(raw.message, context.maxMessageChars),
    line: Number.isFinite(line) && line >= 0 ? Math.floor(line) : null,
    character:
      Number.isFinite(character) && character >= 0
        ? Math.floor(character)
        : null,
    source: bounded(raw.source, 128),
    code: bounded(codeValue, 256),
  });
}

function emptySummary() {
  return Object.freeze({
    total: 0,
    error: 0,
    warning: 0,
    information: 0,
    hint: 0,
    unknown: 0,
    uriCount: 0,
    truncatedCount: 0,
  });
}

function immutableSnapshot(generation = 0) {
  return Object.freeze({
    schema: DIAGNOSTICS_SNAPSHOT_SCHEMA,
    generation,
    stable: true,
    capturedAtMs: 0,
    diagnostics: Object.freeze([]),
    versions: Object.freeze([]),
    summary: emptySummary(),
  });
}

class DiagnosticsSnapshotScheduler {
  constructor(options = {}) {
    this.maxDiagnostics = Math.max(
      1,
      Number(options.maxDiagnostics) || DEFAULT_MAX_DIAGNOSTICS,
    );
    this.maxMessageChars = Math.max(
      1,
      Number(options.maxMessageChars) || DEFAULT_MAX_MESSAGE_CHARS,
    );
    this.debounceMs = Math.max(
      0,
      Number.isFinite(Number(options.debounceMs))
        ? Number(options.debounceMs)
        : DEFAULT_DEBOUNCE_MS,
    );
    this.sliceItems = Math.max(
      1,
      Number(options.sliceItems) || DEFAULT_SLICE_ITEMS,
    );
    this.now =
      typeof options.now === "function" ? options.now : () => performance.now();
    this.yieldControl =
      typeof options.yieldControl === "function"
        ? options.yieldControl
        : () => new Promise((resolve) => setImmediate(resolve));
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.documents = new Map();
    this.latestRequestedVersions = new Map();
    this.pending = new Map();
    this.snapshotValue = immutableSnapshot();
    this.timer = null;
    this.generation = 0;
    this.committedGeneration = 0;
    this.processing = false;
    this.disposed = false;
    this.waiters = new Set();
    this.statsValue = {
      requestedGenerationCount: 0,
      committedGenerationCount: 0,
      canceledGenerationCount: 0,
      staleRequestSuppressedCount: 0,
      duplicateDiagnosticSuppressedCount: 0,
      readErrorCount: 0,
      maxWorkSliceMs: 0,
      publishedDuplicateCount: 0,
      publishedStaleVersionCount: 0,
    };
  }

  /**
   * Queue URI-scoped updates. An update is
   * `{uri, documentVersion, file?, isDirty?, read, normalize?}` where `read`
   * returns the current diagnostics array for that URI.
   */
  schedule(updates, { replaceAll = false } = {}) {
    if (this.disposed) return this.generation;
    const generation = ++this.generation;
    this.statsValue.requestedGenerationCount += 1;
    if (this.timer !== null || this.processing) {
      this.statsValue.canceledGenerationCount += 1;
    }
    if (replaceAll) {
      this.pending.clear();
      this.latestRequestedVersions.clear();
    }
    for (const candidate of Array.isArray(updates) ? updates : []) {
      const uri = bounded(candidate?.uri, 2_048);
      if (!uri || typeof candidate?.read !== "function") continue;
      const documentVersion = finiteVersion(candidate.documentVersion);
      const latest = this.latestRequestedVersions.get(uri);
      if (
        documentVersion !== null &&
        latest !== undefined &&
        latest !== null &&
        documentVersion < latest
      ) {
        this.statsValue.staleRequestSuppressedCount += 1;
        continue;
      }
      if (documentVersion !== null) {
        this.latestRequestedVersions.set(uri, documentVersion);
      }
      this.pending.set(uri, {
        ...candidate,
        uri,
        documentVersion,
        generation,
      });
    }
    this.pendingReplaceAll = Boolean(this.pendingReplaceAll || replaceAll);
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.#drain(generation);
    }, this.debounceMs);
    return generation;
  }

  async flushNow() {
    if (this.disposed) return this.snapshotValue;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.pending.size > 0 && !this.processing) {
      await this.#drain(this.generation);
    }
    if (this.processing || this.pending.size > 0 || this.timer !== null) {
      await this.awaitStable();
    }
    return this.snapshotValue;
  }

  async awaitStable(timeoutMs = 5_000) {
    if (!this.processing && this.pending.size === 0 && this.timer === null) {
      return this.snapshotValue;
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(
        () => {
          this.waiters.delete(waiter);
          reject(
            new Error("diagnostics snapshot did not stabilize before timeout"),
          );
        },
        Math.max(1, Number(timeoutMs) || 5_000),
      );
      this.waiters.add(waiter);
    });
  }

  getSnapshot() {
    return this.snapshotValue;
  }

  getStats() {
    return Object.freeze({ ...this.statsValue });
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending.clear();
    this.#settleWaiters(new Error("diagnostics scheduler disposed"));
  }

  async #drain(generation) {
    if (this.processing || this.disposed) return;
    this.processing = true;
    const updates = [...this.pending.values()].filter(
      (update) => update.generation <= generation,
    );
    for (const update of updates) this.pending.delete(update.uri);
    const replaceAll = Boolean(this.pendingReplaceAll);
    this.pendingReplaceAll = false;
    const nextDocuments = replaceAll ? new Map() : new Map(this.documents);
    try {
      for (const update of updates) {
        if (generation !== this.generation || this.disposed) return;
        let raw;
        try {
          const readStarted = this.now();
          const readResult = update.read();
          this.statsValue.maxWorkSliceMs = Math.max(
            this.statsValue.maxWorkSliceMs,
            this.now() - readStarted,
          );
          raw = await readResult;
        } catch {
          this.statsValue.readErrorCount += 1;
          continue;
        }
        if (generation !== this.generation || this.disposed) return;
        const records = [];
        const keys = new Set();
        let sliceStarted = this.now();
        const values = Array.isArray(raw) ? raw : [];
        for (let index = 0; index < values.length; index += 1) {
          const normalize = update.normalize || defaultNormalize;
          const context = {
            uri: update.uri,
            file: update.file,
            isDirty: update.isDirty,
            documentVersion: update.documentVersion,
            maxMessageChars: this.maxMessageChars,
          };
          const candidate = normalize(values[index], context);
          const record = candidate
            ? defaultNormalize(candidate, context)
            : null;
          if (record) {
            const key = diagnosticKey(record);
            if (keys.has(key)) {
              this.statsValue.duplicateDiagnosticSuppressedCount += 1;
            } else {
              keys.add(key);
              records.push(
                Object.isFrozen(record) ? record : Object.freeze(record),
              );
            }
          }
          if ((index + 1) % this.sliceItems === 0) {
            const elapsed = this.now() - sliceStarted;
            this.statsValue.maxWorkSliceMs = Math.max(
              this.statsValue.maxWorkSliceMs,
              elapsed,
            );
            await this.yieldControl();
            if (generation !== this.generation || this.disposed) return;
            sliceStarted = this.now();
          }
        }
        this.statsValue.maxWorkSliceMs = Math.max(
          this.statsValue.maxWorkSliceMs,
          this.now() - sliceStarted,
        );
        if (records.length > 0) {
          nextDocuments.set(update.uri, {
            version: update.documentVersion,
            records: Object.freeze(records),
          });
        } else {
          nextDocuments.delete(update.uri);
        }
      }
      if (generation !== this.generation || this.disposed) return;
      this.documents = nextDocuments;
      this.snapshotValue = await this.#buildSnapshot(generation);
      this.committedGeneration = generation;
      this.statsValue.committedGenerationCount += 1;
    } finally {
      this.processing = false;
      if (generation !== this.generation && !this.disposed) {
        const newerReplaceAll = Boolean(this.pendingReplaceAll);
        if (!newerReplaceAll) {
          for (const update of updates) {
            if (!this.pending.has(update.uri)) {
              this.pending.set(update.uri, {
                ...update,
                generation: this.generation,
              });
            }
          }
        }
        this.pendingReplaceAll = Boolean(newerReplaceAll || replaceAll);
      }
      if (this.pending.size > 0 && !this.disposed) {
        if (this.timer === null) {
          const nextGeneration = this.generation;
          this.timer = this.setTimer(() => {
            this.timer = null;
            void this.#drain(nextGeneration);
          }, this.debounceMs);
        }
      } else if (!this.disposed) {
        this.#settleWaiters();
      }
    }
  }

  async #buildSnapshot(generation) {
    const diagnostics = [];
    const versions = [];
    const seen = new Set();
    const summary = {
      total: 0,
      error: 0,
      warning: 0,
      information: 0,
      hint: 0,
      unknown: 0,
      uriCount: 0,
      truncatedCount: 0,
    };
    let sliceStarted = this.now();
    let visited = 0;
    for (const uri of [...this.documents.keys()].sort()) {
      const document = this.documents.get(uri);
      if (!document) continue;
      versions.push(Object.freeze({ uri, documentVersion: document.version }));
      summary.uriCount += 1;
      for (const record of document.records) {
        const key = diagnosticKey(record);
        if (seen.has(key)) {
          this.statsValue.publishedDuplicateCount += 1;
          continue;
        }
        seen.add(key);
        if (diagnostics.length < this.maxDiagnostics) {
          diagnostics.push(record);
          const severity = Object.hasOwn(summary, record.severity)
            ? record.severity
            : "unknown";
          summary[severity] += 1;
        } else {
          summary.truncatedCount += 1;
        }
        visited += 1;
        if (visited % this.sliceItems === 0) {
          const elapsed = this.now() - sliceStarted;
          this.statsValue.maxWorkSliceMs = Math.max(
            this.statsValue.maxWorkSliceMs,
            elapsed,
          );
          await this.yieldControl();
          if (generation !== this.generation || this.disposed) {
            return this.snapshotValue;
          }
          sliceStarted = this.now();
        }
      }
    }
    this.statsValue.maxWorkSliceMs = Math.max(
      this.statsValue.maxWorkSliceMs,
      this.now() - sliceStarted,
    );
    summary.total = diagnostics.length;
    const latestByUri = new Map(
      versions.map((value) => [value.uri, value.documentVersion]),
    );
    this.statsValue.publishedStaleVersionCount = diagnostics.filter(
      (record) => {
        const latest = latestByUri.get(record.documentUri);
        return latest !== null && record.documentVersion !== latest;
      },
    ).length;
    this.statsValue.maxWorkSliceMs = Math.max(
      this.statsValue.maxWorkSliceMs,
      this.now() - sliceStarted,
    );
    return Object.freeze({
      schema: DIAGNOSTICS_SNAPSHOT_SCHEMA,
      generation,
      stable: true,
      capturedAtMs: Date.now(),
      diagnostics: Object.freeze(diagnostics),
      versions: Object.freeze(versions),
      summary: Object.freeze(summary),
    });
  }

  #settleWaiters(error = null) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve(this.snapshotValue);
    }
    this.waiters.clear();
  }
}

function formatDiagnosticsSnapshotForContext(
  snapshot,
  maxBytes = DEFAULT_CONTEXT_BYTES,
) {
  if (!snapshot || snapshot.stable !== true) return "";
  const summary = snapshot.summary || emptySummary();
  const lines = [
    `stable diagnostics snapshot generation=${snapshot.generation} total=${summary.total} errors=${summary.error} warnings=${summary.warning} information=${summary.information} hints=${summary.hint} truncated=${summary.truncatedCount}`,
  ];
  let used = Buffer.byteLength(lines[0], "utf8");
  for (const item of snapshot.diagnostics || []) {
    const lineNumber =
      item.line != null && Number.isFinite(Number(item.line))
        ? Number(item.line) + 1
        : "?";
    const characterNumber =
      item.character != null && Number.isFinite(Number(item.character))
        ? Number(item.character) + 1
        : "?";
    const line = `${item.severity} ${item.file || item.documentUri}:${lineNumber}:${characterNumber} ${item.message}`;
    const bytes = Buffer.byteLength(`\n${line}`, "utf8");
    if (used + bytes > maxBytes) {
      lines.push("…(diagnostics context payload bounded)");
      break;
    }
    lines.push(line);
    used += bytes;
  }
  return lines.join("\n");
}

module.exports = {
  DEFAULT_CONTEXT_BYTES,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_DIAGNOSTICS,
  DEFAULT_MAX_MESSAGE_CHARS,
  DIAGNOSTICS_SNAPSHOT_SCHEMA,
  DiagnosticsSnapshotScheduler,
  defaultNormalize,
  formatDiagnosticsSnapshotForContext,
};
