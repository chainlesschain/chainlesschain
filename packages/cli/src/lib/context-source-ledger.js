/**
 * Context Source Ledger — M4-1: 上下文来源归因系统
 * 对应文档 §2.5
 *
 * 统一追踪每段上下文的来源、工具调用、权限模式、置信度，
 * 让"AI 为什么此刻知道这件事"完全可追溯
 */

import crypto from "node:crypto";

/**
 * @typedef {Object} ContextEntry
 * @property {string} entryId
 * @property {string} sessionId
 * @property {string} turnId
 * @property {string} sourceType - slash_command|mcp|tool|hook|skill|agent|file|memory|prompt|plugin
 * @property {string} sourceId - tool name, mcp server name, hook id, etc.
 * @property {'system'|'developer'|'plugin'|'user'|'agent'} permissionMode
 * @property {number} confidence - 0-1
 * @property {string} [summary]
 * @property {any} [metadata]
 * @property {number} tokenCount
 * @property {Date} insertedAt
 * @property {string[]} tags
 */

class ContextSourceLedger {
  constructor() {
    /** @type {Map<string, ContextEntry>} */
    this._entries = new Map();
    /** @type {Map<string, ContextEntry[]>} turnIndex: turnId -> entries */
    this._byTurn = new Map();
    /** @type {Map<string, ContextEntry[]>} sessionIndex: sessionId -> entries */
    this._bySession = new Map();
  }

  /**
   * Record a context source entry
   * @param {Partial<ContextEntry>} entry
   * @returns {string} entryId
   */
  record(entry) {
    const entryId = entry.entryId || crypto.randomUUID();
    const full = {
      entryId,
      traceId: entry.traceId || null,
      sessionId: entry.sessionId || "unknown",
      turnId: entry.turnId || "unknown",
      sourceType: entry.sourceType || "unknown",
      sourceId: entry.sourceId || "unknown",
      permissionMode: entry.permissionMode || "agent",
      confidence: entry.confidence ?? 0.8,
      summary: entry.summary,
      metadata: entry.metadata,
      tokenCount: entry.tokenCount || 0,
      insertedAt: new Date(),
      tags: entry.tags || [],
    };

    this._entries.set(entryId, full);

    // Index by turn
    if (!this._byTurn.has(full.turnId)) this._byTurn.set(full.turnId, []);
    this._byTurn.get(full.turnId).push(full);

    // Index by session
    if (!this._bySession.has(full.sessionId)) this._bySession.set(full.sessionId, []);
    this._bySession.get(full.sessionId).push(full);

    return entryId;
  }

  /** Compatibility adapter for runtime provenance producers. */
  recordRead(entry = {}) {
    return this.record({
      sessionId: entry.sessionId,
      turnId: entry.turnId,
      sourceType: entry.sourceType || entry.source || "unknown",
      sourceId: entry.sourceId || entry.span || "unknown",
      permissionMode: entry.permissionMode || "agent",
      confidence: entry.confidence,
      summary: entry.summary || entry.content,
      metadata: entry.metadata,
      tokenCount: entry.tokenCount ?? entry.tokens ?? 0,
      traceId: entry.traceId,
    });
  }

  /** Return a flat, read-only provenance snapshot for diagnostics/export. */
  getProvenance({ sessionId, turnId } = {}) {
    let entries = Array.from(this._entries.values());
    if (sessionId) entries = entries.filter((e) => e.sessionId === sessionId);
    if (turnId) entries = entries.filter((e) => e.turnId === turnId);
    return entries.map((entry) => ({ ...entry, tags: [...entry.tags] }));
  }

  /** Aggregate token usage by source type. */
  getTokenBreakdown() {
    const bySource = {};
    let total = 0;
    for (const entry of this._entries.values()) {
      total += entry.tokenCount;
      bySource[entry.sourceType] = (bySource[entry.sourceType] || 0) + entry.tokenCount;
    }
    return { total, bySource };
  }

  /** Clear the in-memory ledger (test/runtime lifecycle boundary). */
  clear() {
    this._entries.clear();
    this._byTurn.clear();
    this._bySession.clear();
  }

  /**
   * Get all context entries for a given turn
   * @param {string} turnId
   * @returns {ContextEntry[]}
   */
  getTurnContext(turnId) {
    return this._byTurn.get(turnId) || [];
  }

  /**
   * Get all context entries for a session
   * @param {string} sessionId
   * @returns {ContextEntry[]}
   */
  getSessionContext(sessionId) {
    return this._bySession.get(sessionId) || [];
  }

  /**
   * Generate context provenance summary for a turn
   * Shows exactly where each piece of context came from
   * @param {string} turnId
   * @returns {Object} provenance report
   */
  getTurnProvenance(turnId) {
    const entries = this.getTurnContext(turnId);
    const byType = {};
    const byPermission = {};
    const bySource = {};
    let totalTokens = 0;
    let avgConfidence = 0;

    for (const e of entries) {
      byType[e.sourceType] = (byType[e.sourceType] || 0) + 1;
      byPermission[e.permissionMode] = (byPermission[e.permissionMode] || 0) + 1;
      bySource[e.sourceId] = (bySource[e.sourceId] || 0) + 1;
      totalTokens += e.tokenCount;
      avgConfidence += e.confidence;
    }

    avgConfidence = entries.length > 0 ? avgConfidence / entries.length : 0;

    return {
      turnId,
      totalEntries: entries.length,
      totalTokens,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      byType,
      byPermission,
      bySource,
      entries: entries.map(e => ({
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        permissionMode: e.permissionMode,
        confidence: e.confidence,
        tokenCount: e.tokenCount,
        summary: e.summary,
        tags: e.tags,
      })),
    };
  }

  /**
   * Clear entries for a session
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    const entries = this._bySession.get(sessionId) || [];
    for (const e of entries) {
      this._entries.delete(e.entryId);
      const turnEntries = this._byTurn.get(e.turnId);
      if (turnEntries) {
        const idx = turnEntries.findIndex(x => x.entryId === e.entryId);
        if (idx >= 0) turnEntries.splice(idx, 1);
      }
    }
    this._bySession.delete(sessionId);
  }

  /** Get stats */
  getStats() {
    return {
      totalEntries: this._entries.size,
      sessionsTracked: this._bySession.size,
      turnsTracked: this._byTurn.size,
    };
  }
}

// Singleton
const ledger = new ContextSourceLedger();
export default ledger;
export { ContextSourceLedger };
