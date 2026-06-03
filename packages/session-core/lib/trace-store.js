/**
 * TraceStore — 统一的 trace event 收集器
 *
 * 对标 Managed Agents 的 per-session trace:每个 session 一条完整 trace(消息/工具/耗时/费用)。
 * 解决 Cowork 现状:audit-log / token-tracker / hook-stats 各自为政。
 *
 * 设计要点:
 * - 内存 ring buffer + 可选持久化(sink 函数)
 * - 按 sessionId 索引,支持 query(sessionId, { types, since, limit })
 * - 尺寸受限,达到上限时 drop 最旧事件
 * - sink 异步失败不阻塞写入
 */

const EventEmitter = require("events");

const TRACE_TYPES = Object.freeze({
  MESSAGE: "message",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  HOOK: "hook",
  ERROR: "error",
  COST: "cost",
  STATE: "state",
});

const DEFAULT_MAX_EVENTS = 10_000;

class TraceStore extends EventEmitter {
  constructor({ maxEvents = DEFAULT_MAX_EVENTS, sink = null, now = Date.now } = {}) {
    super();
    this.maxEvents = maxEvents;
    this._sink = sink; // async fn(event) — persistence hook
    this._now = now;
    this._events = []; // flat array, FIFO
    this._bySession = new Map(); // sessionId → array of indices
    this._seq = 0;
  }

  /**
   * 写入一个 trace event
   * 必填字段: sessionId, type
   * 自动补全: ts, seq
   */
  record(event) {
    if (!event || typeof event !== "object") {
      throw new Error("TraceStore.record: event object required");
    }
    if (!event.sessionId) {
      throw new Error("TraceStore.record: sessionId required");
    }
    if (!event.type) {
      throw new Error("TraceStore.record: type required");
    }

    const stored = {
      sessionId: event.sessionId,
      type: event.type,
      ts: event.ts || this._now(),
      seq: ++this._seq,
      payload: event.payload || {},
    };

    this._events.push(stored);
    if (!this._bySession.has(stored.sessionId)) {
      this._bySession.set(stored.sessionId, []);
    }
    this._bySession.get(stored.sessionId).push(this._events.length - 1);

    // Ring buffer: drop oldest when over limit
    if (this._events.length > this.maxEvents) {
      this._compact();
    }

    // Async sink — swallow errors
    if (this._sink) {
      Promise.resolve()
        .then(() => this._sink(stored))
        .catch((err) => {
          this.emit("sink-error", { event: stored, error: err });
        });
    }

    this.emit("event", stored);
    return stored;
  }

  /**
   * 查询某 session 的 trace
   */
  query(sessionId, { types, since, until, limit = 500 } = {}) {
    const indices = this._bySession.get(sessionId) || [];
    const out = [];
    const typeSet = types ? new Set(types) : null;

    for (let i = indices.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this._events[indices[i]];
      if (!e) continue; // compacted away
      if (typeSet && !typeSet.has(e.type)) continue;
      if (since != null && e.ts < since) continue;
      if (until != null && e.ts > until) continue;
      out.push(e);
    }
    return out.reverse(); // chronological
  }

  /**
   * 汇总某 session 的成本/耗时
   */
  summarize(sessionId) {
    const events = this.query(sessionId, { limit: Number.MAX_SAFE_INTEGER });
    const summary = {
      sessionId,
      eventCount: events.length,
      firstTs: events[0]?.ts || null,
      lastTs: events[events.length - 1]?.ts || null,
      byType: {},
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      errorCount: 0,
    };

    for (const e of events) {
      summary.byType[e.type] = (summary.byType[e.type] || 0) + 1;
      if (e.type === TRACE_TYPES.COST) {
        summary.totalCostUsd += Number(e.payload.costUsd) || 0;
        summary.totalInputTokens += Number(e.payload.inputTokens) || 0;
        summary.totalOutputTokens += Number(e.payload.outputTokens) || 0;
      }
      if (e.type === TRACE_TYPES.ERROR) {
        summary.errorCount++;
      }
    }
    return summary;
  }

  /**
   * 清空某 session 的 trace(close 后调用)
   */
  clearSession(sessionId) {
    const indices = this._bySession.get(sessionId);
    if (!indices) return 0;
    // Mark as null; compact() will remove
    for (const i of indices) {
      this._events[i] = null;
    }
    this._bySession.delete(sessionId);
    return indices.length;
  }

  /**
   * 全部清空
   */
  clearAll() {
    this._events = [];
    this._bySession.clear();
  }

  /**
   * 返回所有活跃 sessionId
   */
  listSessions() {
    return Array.from(this._bySession.keys());
  }

  /**
   * 内部:ring buffer 压缩,移除 null 和最旧事件
   */
  _compact() {
    const kept = [];
    const newBySession = new Map();
    const start = this._events.length - this.maxEvents;

    for (let i = 0; i < this._events.length; i++) {
      const e = this._events[i];
      if (!e) continue;
      if (i < start) continue; // drop oldest
      const newIdx = kept.length;
      kept.push(e);
      if (!newBySession.has(e.sessionId)) newBySession.set(e.sessionId, []);
      newBySession.get(e.sessionId).push(newIdx);
    }

    this._events = kept;
    this._bySession = newBySession;
  }

  /**
   * 统计信息(调试)
   */
  stats() {
    return {
      totalEvents: this._events.filter((e) => e !== null).length,
      sessionCount: this._bySession.size,
      seq: this._seq,
      maxEvents: this.maxEvents,
    };
  }
}

// Singleton default store (可选使用)
let _defaultStore = null;
function getDefaultTraceStore() {
  if (!_defaultStore) _defaultStore = new TraceStore();
  return _defaultStore;
}
function setDefaultTraceStore(store) {
  _defaultStore = store;
}

module.exports = {
  TraceStore,
  TRACE_TYPES,
  DEFAULT_MAX_EVENTS,
  getDefaultTraceStore,
  setDefaultTraceStore,
};
