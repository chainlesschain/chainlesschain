/**
 * RuntimeProvenanceLedger - bounded, hash-chained runtime provenance.
 *
 * Records context sources, tool calls and responses that flow through the CLI
 * runtime. The in-memory view is deliberately a retained window: every entry
 * keeps an absolute index, and the hash of the last evicted entry anchors the
 * first retained entry. Exports state explicitly when older entries are no
 * longer resident instead of claiming that the retained suffix is a complete
 * history.
 */

import { createHash } from "node:crypto";

export const DEFAULT_RUNTIME_PROVENANCE_MAX_ENTRIES = 4_096;
const DEFAULT_GENESIS_HASH = "0".repeat(64);

function positiveEntryLimit(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(
      "runtime provenance maxEntries must be a positive integer",
    );
  }
  return parsed;
}

function freezeJsonSnapshot(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeJsonSnapshot(nested);
    Object.freeze(value);
  }
  return value;
}

class RuntimeProvenanceLedger {
  constructor(options = {}) {
    this._maxEntries = positiveEntryLimit(
      options.maxEntries ?? DEFAULT_RUNTIME_PROVENANCE_MAX_ENTRIES,
    );
    this._genesisHash = options.genesisHash || DEFAULT_GENESIS_HASH;
    this._lastHash = this._genesisHash;
    this._entries = new Array(this._maxEntries);
    this._retainedStart = 0;
    this._retainedCount = 0;
    this._nextIndex = 0;
    this._evictedThroughIndex = null;
    this._evictedThroughHash = null;
    this._entriesByIndex = new Map();
    this._spanIndex = new Map();
    this._traceIndex = new Map();
  }

  /**
   * Record a context source read (RAG, file, MCP, etc.)
   */
  recordRead(entry) {
    return this._append({
      type: "context_read",
      timestamp: Date.now(),
      source: entry.source,
      span: entry.span,
      traceId: entry.traceId,
      content: entry.content,
      tokens: entry.tokens || 0,
      metadata: entry.metadata || {},
    });
  }

  /**
   * Record a tool call invocation
   */
  recordToolCall(entry) {
    return this._append({
      type: "tool_call",
      timestamp: Date.now(),
      tool: entry.tool,
      span: entry.span,
      traceId: entry.traceId,
      args: entry.args,
      resultSummary: entry.resultSummary,
      durationMs: entry.durationMs,
      metadata: entry.metadata || {},
    });
  }

  /**
   * Record an LLM prompt submission
   */
  recordLLMCall(entry) {
    return this._append({
      type: "llm_call",
      timestamp: Date.now(),
      model: entry.model,
      span: entry.span,
      traceId: entry.traceId,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      durationMs: entry.durationMs,
      metadata: entry.metadata || {},
    });
  }

  /**
   * Record a hook execution
   */
  recordHookExecution(entry) {
    return this._append({
      type: "hook_execution",
      timestamp: Date.now(),
      hookId: entry.hookId,
      event: entry.event,
      span: entry.span,
      traceId: entry.traceId,
      blocked: entry.blocked,
      durationMs: entry.durationMs,
      metadata: entry.metadata || {},
    });
  }

  /**
   * Generic record method for custom events
   */
  record(type, entry = {}, source = "runtime") {
    return this._append({
      type,
      timestamp: Date.now(),
      source,
      ...entry,
    });
  }

  _addIndex(index, key, absoluteIndex) {
    if (!key) return;
    let bucket = index.get(key);
    if (!bucket) {
      bucket = new Set();
      index.set(key, bucket);
    }
    bucket.add(absoluteIndex);
  }

  _removeIndex(index, key, absoluteIndex) {
    if (!key) return;
    const bucket = index.get(key);
    if (!bucket) return;
    bucket.delete(absoluteIndex);
    if (bucket.size === 0) index.delete(key);
  }

  _evictOldest() {
    const evicted = this._entries[this._retainedStart];
    if (!evicted) {
      throw new Error("runtime provenance ring is internally inconsistent");
    }
    this._entriesByIndex.delete(evicted.index);
    this._removeIndex(this._traceIndex, evicted.traceId, evicted.index);
    this._removeIndex(this._spanIndex, evicted.span, evicted.index);
    this._evictedThroughIndex = evicted.index;
    this._evictedThroughHash = evicted.hash;
    this._entries[this._retainedStart] = undefined;
    this._retainedStart = (this._retainedStart + 1) % this._maxEntries;
    this._retainedCount -= 1;
  }

  _retainedEntries() {
    const retained = new Array(this._retainedCount);
    for (let offset = 0; offset < this._retainedCount; offset += 1) {
      retained[offset] =
        this._entries[(this._retainedStart + offset) % this._maxEntries];
    }
    return retained;
  }

  _retainedAnchorHash() {
    return this._evictedThroughHash || this._genesisHash;
  }

  /**
   * Append an entry with an absolute index and hash-chain binding.
   */
  _append(entry) {
    // The returned entries are also the ring's storage records. Snapshot the
    // caller's JSON data before hashing so later mutations cannot invalidate
    // the hash chain, then recursively freeze the snapshot so storage keys
    // used during eviction cannot be rewritten through get/export results.
    const payload = { ...entry };
    delete payload.index;
    delete payload.prevHash;
    delete payload.hash;
    const serialized = JSON.stringify({
      ...payload,
      index: this._nextIndex,
      prevHash: this._lastHash,
    });
    const snapshot = JSON.parse(serialized);
    const hash = createHash("sha256").update(serialized).digest("hex");
    snapshot.hash = hash;
    const entryWithHash = freezeJsonSnapshot(snapshot);

    if (this._retainedCount === this._maxEntries) this._evictOldest();
    const writeIndex =
      (this._retainedStart + this._retainedCount) % this._maxEntries;
    this._entries[writeIndex] = entryWithHash;
    this._retainedCount += 1;
    this._entriesByIndex.set(entryWithHash.index, entryWithHash);
    this._addIndex(
      this._traceIndex,
      entryWithHash.traceId,
      entryWithHash.index,
    );
    this._addIndex(this._spanIndex, entryWithHash.span, entryWithHash.index);
    this._nextIndex += 1;
    this._lastHash = hash;
    return entryWithHash;
  }

  /**
   * Verify the retained suffix and its independently stored boundary anchor.
   */
  verifyIntegrity() {
    const entries = this._retainedEntries();
    let currentHash = this._retainedAnchorHash();
    let expectedIndex =
      this._evictedThroughIndex === null ? 0 : this._evictedThroughIndex + 1;
    for (const entry of entries) {
      if (entry.index !== expectedIndex || entry.prevHash !== currentHash) {
        return false;
      }
      const { hash } = entry;
      const entryForHash = { ...entry };
      delete entryForHash.hash;
      const computed = createHash("sha256")
        .update(JSON.stringify(entryForHash))
        .digest("hex");
      if (computed !== hash) return false;
      currentHash = hash;
      expectedIndex += 1;
    }
    return currentHash === this._lastHash && expectedIndex === this._nextIndex;
  }

  _indexedEntries(index, key) {
    const indices = index.get(key);
    if (!indices) return [];
    return [...indices]
      .map((absoluteIndex) => this._entriesByIndex.get(absoluteIndex))
      .filter(Boolean);
  }

  /**
   * Get retained entries for a trace.
   */
  getTraceEntries(traceId) {
    return this._indexedEntries(this._traceIndex, traceId);
  }

  /**
   * Get retained entries for a span.
   */
  getSpanEntries(spanId) {
    return this._indexedEntries(this._spanIndex, spanId);
  }

  /**
   * Get the retained provenance window for a response.
   */
  getProvenance(options = {}) {
    if (options.traceId) return this.getTraceEntries(options.traceId);
    if (options.span) return this.getSpanEntries(options.span);
    return this._retainedEntries();
  }

  /**
   * Export the retained window without presenting it as complete history.
   */
  export() {
    const entries = this._retainedEntries();
    const evictedEntries = this._nextIndex - entries.length;
    const truncated = evictedEntries > 0;
    return {
      // Compatibility: genesisHash remains the hash immediately before the
      // first exported entry, just as it was when every entry was retained.
      genesisHash: entries[0]?.prevHash,
      originalGenesisHash: this._genesisHash,
      lastHash: this._lastHash,
      entries,
      verified: this.verifyIntegrity(),
      verificationScope: truncated ? "retained-window" : "complete",
      totalEntries: this._nextIndex,
      retainedEntries: entries.length,
      evictedEntries,
      truncated,
      anchor: {
        hash: this._retainedAnchorHash(),
        evictedThroughIndex: this._evictedThroughIndex,
        firstRetainedIndex: entries[0]?.index ?? null,
      },
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Flush pending entries to disk (called on exit).
   */
  flush() {
    // In production this would persist to disk; for now the bounded retained
    // window and its eviction anchor remain available in memory.
    return Promise.resolve(true);
  }
}

// Export global singleton instance.
const runtimeProvenanceLedger = new RuntimeProvenanceLedger();
export default runtimeProvenanceLedger;
export { RuntimeProvenanceLedger, runtimeProvenanceLedger };
