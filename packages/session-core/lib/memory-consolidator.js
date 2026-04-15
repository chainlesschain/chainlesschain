/**
 * MemoryConsolidator — 会话结束时从 trace 中提炼长期记忆
 *
 * Phase D2 of Managed Agents parity plan.
 *
 * 输入: SessionHandle + TraceStore + MemoryStore
 * 输出: 写入 MemoryStore 的若干条 memory(user preferences / tasks / corrections / summary)
 *
 * 支持两种模式:
 *   1. rule-based(默认,无需 LLM)— 根据 trace 事件的 type/payload 模式抽取
 *   2. llm-backed(可选)— 注入 summarizer(messages) => Promise<{ category, content, tags }[]>
 */

const EventEmitter = require("events");
const { TRACE_TYPES } = require("./trace-store.js");
const { SCOPE } = require("./memory-store.js");

const CATEGORIES = Object.freeze({
  PREFERENCE: "preference",
  TASK: "task",
  CORRECTION: "correction",
  SUMMARY: "summary",
});

/**
 * 默认规则抽取器 — 纯启发式,不依赖 LLM
 */
function defaultExtractor(events) {
  const facts = [];

  for (const ev of events) {
    const { type, payload = {} } = ev;

    if (type === TRACE_TYPES.MESSAGE && payload.role === "user") {
      const text = String(payload.content || "").trim();
      if (!text) continue;
      // 偏好线索: "我喜欢 / 我不喜欢 / prefer / always / never / don't"
      if (
        /我喜欢|我不喜欢|我偏好|我希望|prefer|always |never |don't |do not /i.test(
          text
        )
      ) {
        facts.push({
          category: CATEGORIES.PREFERENCE,
          content: text.slice(0, 280),
          tags: ["user-preference"],
        });
      }
    }

    if (type === TRACE_TYPES.ERROR) {
      const msg = String(payload.error || payload.message || "").trim();
      if (msg) {
        facts.push({
          category: CATEGORIES.CORRECTION,
          content: `Error encountered: ${msg.slice(0, 240)}`,
          tags: ["error", "correction"],
          score: 1,
        });
      }
    }

    if (type === TRACE_TYPES.TOOL_RESULT && payload.ok && payload.tool) {
      facts.push({
        category: CATEGORIES.TASK,
        content: `Completed tool ${payload.tool}${
          payload.summary ? `: ${String(payload.summary).slice(0, 200)}` : ""
        }`,
        tags: ["tool", payload.tool],
      });
    }
  }

  return facts;
}

class MemoryConsolidator extends EventEmitter {
  constructor({
    memoryStore,
    traceStore,
    extractor = defaultExtractor,
    summarizer = null, // optional async (events) => facts[]
    scope = SCOPE.AGENT,
    now = Date.now,
  } = {}) {
    super();
    if (!memoryStore) throw new Error("MemoryConsolidator: memoryStore required");
    if (!traceStore) throw new Error("MemoryConsolidator: traceStore required");
    this._memory = memoryStore;
    this._trace = traceStore;
    this._extract = extractor;
    this._summarizer = summarizer;
    this._defaultScope = scope;
    this._now = now;
  }

  /**
   * consolidate(session, options?)
   *   - session: SessionHandle(或 duck-typed {sessionId, agentId})
   *   - options.scope: 写入 memory 的 scope(默认 agent)
   *   - options.scopeId: override(默认取 agentId / sessionId)
   *   - options.useLLM: true 则走 summarizer
   */
  async consolidate(session, options = {}) {
    if (!session || !session.sessionId) {
      throw new Error("MemoryConsolidator.consolidate: session with sessionId required");
    }

    const scope = options.scope || this._defaultScope;
    const scopeId =
      options.scopeId ||
      (scope === SCOPE.SESSION
        ? session.sessionId
        : scope === SCOPE.AGENT
          ? session.agentId || session.sessionId
          : null);

    const events = this._trace.query(session.sessionId) || [];

    let facts = [];
    if (options.useLLM && this._summarizer) {
      try {
        const out = await this._summarizer(events, { session });
        facts = Array.isArray(out) ? out : [];
      } catch (err) {
        this.emit("summarizer-error", { error: err, sessionId: session.sessionId });
        facts = this._extract(events);
      }
    } else {
      facts = this._extract(events);
    }

    const written = [];
    for (const f of facts) {
      if (!f || !f.content) continue;
      try {
        const m = this._memory.add({
          scope,
          scopeId,
          category: f.category || CATEGORIES.SUMMARY,
          content: String(f.content),
          tags: f.tags || [],
          score: f.score || 0,
          metadata: {
            consolidatedAt: this._now(),
            fromSessionId: session.sessionId,
            ...(f.metadata || {}),
          },
        });
        written.push(m);
      } catch (err) {
        this.emit("memory-write-error", { error: err, fact: f });
      }
    }

    const result = {
      sessionId: session.sessionId,
      scope,
      scopeId,
      eventCount: events.length,
      factCount: facts.length,
      writtenCount: written.length,
      written,
    };
    this.emit("consolidated", result);
    return result;
  }
}

module.exports = {
  MemoryConsolidator,
  defaultExtractor,
  CATEGORIES,
};
