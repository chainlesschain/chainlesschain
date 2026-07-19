/**
 * RuntimeProvenanceLedger - Immutable audit trail for runtime provenance
 *
 * Records every context source, tool call, and response that flows through
 * the CLI runtime. Provides hash-chained immutability guarantees.
 */

import { createHash } from "node:crypto";

class RuntimeProvenanceLedger {
  constructor(options = {}) {
    this._entries = [];
    this._lastHash = options.genesisHash || "0000000000000000000000000000000000000000000000000000000000000000";
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

  /**
   * Append entry with hash chaining for immutability
   */
  _append(entry) {
    const entryWithHash = {
      ...entry,
      index: this._entries.length,
      prevHash: this._lastHash,
    };
    // Compute hash
    const hash = createHash("sha256")
      .update(JSON.stringify(entryWithHash))
      .digest("hex");
    entryWithHash.hash = hash;
    this._entries.push(entryWithHash);
    this._lastHash = hash;
    // Index
    if (entry.traceId) {
      if (!this._traceIndex.has(entry.traceId)) this._traceIndex.set(entry.traceId, []);
      this._traceIndex.get(entry.traceId).push(entryWithHash.index);
    }
    if (entry.span) {
      if (!this._spanIndex.has(entry.span)) this._spanIndex.set(entry.span, []);
      this._spanIndex.get(entry.span).push(entryWithHash.index);
    }
    return entryWithHash;
  }

  /**
   * Verify entire chain integrity
   */
  verifyIntegrity() {
    let currentHash = this._entries[0]?.prevHash || "0".repeat(64);
    for (const entry of this._entries) {
      const { hash, prevHash, ...rest } = entry;
      if (prevHash !== currentHash) return false;
      const computed = createHash("sha256").update(JSON.stringify({ ...rest, prevHash: currentHash })).digest("hex");
      if (computed !== hash) return false;
      currentHash = hash;
    }
    return true;
  }

  /**
   * Get all entries for a trace
   */
  getTraceEntries(traceId) {
    const indices = this._traceIndex.get(traceId) || [];
    return indices.map(i => this._entries[i]);
  }

  /**
   * Get all entries for a span
   */
  getSpanEntries(spanId) {
    const indices = this._spanIndex.get(spanId) || [];
    return indices.map(i => this._entries[i]);
  }

  /**
   * Get provenance chain for a response
   */
  getProvenance(options = {}) {
    if (options.traceId) return this.getTraceEntries(options.traceId);
    if (options.span) return this.getSpanEntries(options.span);
    return [...this._entries];
  }

  /**
   * Export ledger to JSON (for persistence/debugging)
   */
  export() {
    return {
      genesisHash: this._entries[0]?.prevHash,
      lastHash: this._lastHash,
      entries: this._entries,
      verified: this.verifyIntegrity(),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Flush pending entries to disk (called on exit)
   */
  flush() {
    // In production this would persist to disk; for now we're in-memory
    return Promise.resolve(true);
  }
}

// Export global singleton instance
const runtimeProvenanceLedger = new RuntimeProvenanceLedger();
export default runtimeProvenanceLedger;
export { RuntimeProvenanceLedger, runtimeProvenanceLedger };
