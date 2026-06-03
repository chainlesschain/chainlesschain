/**
 * MemoryStore — 跨会话记忆,作用域化
 *
 * Phase D of Managed Agents parity plan.
 *
 * 对标 Managed Agents 的 Agent Memory 研究预览版:
 *   scope = session | agent | global
 *
 * 设计要点:
 * - 纯内存 + 可选 persistence adapter(通用,不绑定具体 DB)
 * - 每条 memory 有 { id, scope, scopeId, category, content, tags, score, createdAt, updatedAt, accessedAt }
 * - recall({ query, scope, scopeId, limit }) — 默认基于 tag 匹配 + token 重叠的简单相关性评分,可注入自定义 scorer
 * - 不强行做 embedding — 上层消费方若要向量检索,可 override scorer 并传入 embedder
 */

const EventEmitter = require("events");
const crypto = require("crypto");

const SCOPE = Object.freeze({
  SESSION: "session",
  AGENT: "agent",
  USER: "user",
  GLOBAL: "global",
});

const VALID_SCOPES = new Set(Object.values(SCOPE));

function generateMemoryId() {
  return `mem_${crypto.randomBytes(8).toString("hex")}`;
}

function validateScope(scope) {
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(
      `MemoryStore: invalid scope "${scope}", must be one of ${Array.from(VALID_SCOPES).join(", ")}`
    );
  }
}

/**
 * 默认 scorer: 基于 query token 与 memory content+tags 的重叠度
 */
function defaultScorer(query, memory) {
  if (!query) return memory.score || 0;
  const qTokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (qTokens.length === 0) return memory.score || 0;

  const haystack = [
    memory.content || "",
    (memory.tags || []).join(" "),
    memory.category || "",
  ]
    .join(" ")
    .toLowerCase();

  let hits = 0;
  for (const tok of qTokens) {
    if (haystack.includes(tok)) hits++;
  }
  const relevance = hits / qTokens.length;
  // 组合:relevance(主) + score(次,防止同分顺序抖动)
  return relevance + (memory.score || 0) * 0.01;
}

class MemoryStore extends EventEmitter {
  constructor({
    adapter = null,
    scorer = defaultScorer,
    now = Date.now,
  } = {}) {
    super();
    this._memories = new Map(); // id → memory
    this._adapter = adapter; // { save, load, remove } — optional
    this._scorer = scorer;
    this._now = now;
  }

  /**
   * 写入一条 memory
   */
  add({
    scope,
    scopeId = null,
    category = "general",
    content,
    tags = [],
    score = 0,
    metadata = {},
  }) {
    validateScope(scope);
    if (scope !== SCOPE.GLOBAL && !scopeId) {
      throw new Error(`MemoryStore.add: scopeId required for scope=${scope}`);
    }
    if (!content || typeof content !== "string") {
      throw new Error("MemoryStore.add: content (string) required");
    }

    const id = generateMemoryId();
    const ts = this._now();
    const memory = {
      id,
      scope,
      scopeId,
      category,
      content,
      tags: [...tags],
      score,
      metadata: { ...metadata },
      createdAt: ts,
      updatedAt: ts,
      accessedAt: ts,
    };
    this._memories.set(id, memory);

    if (this._adapter?.save) {
      Promise.resolve()
        .then(() => this._adapter.save(memory))
        .catch((err) => this.emit("adapter-error", { op: "save", error: err }));
    }
    this.emit("added", memory);
    return { ...memory };
  }

  get(id) {
    const m = this._memories.get(id);
    if (!m) return null;
    m.accessedAt = this._now();
    return { ...m };
  }

  /**
   * recall: 按 scope + query 召回 top-K
   * - scope 未指定 → 跨所有 scope 查询
   * - scopeId 指定时,session scope 只看匹配的 session,agent 同理
   * - global scope 不需要 scopeId 匹配
   */
  recall({
    query = "",
    scope = null,
    scopeId = null,
    category = null,
    tags = null,
    limit = 5,
  } = {}) {
    let candidates = Array.from(this._memories.values());

    if (scope) {
      validateScope(scope);
      candidates = candidates.filter((m) => m.scope === scope);
      if (scope !== SCOPE.GLOBAL && scopeId) {
        candidates = candidates.filter((m) => m.scopeId === scopeId);
      }
    }
    if (category) {
      candidates = candidates.filter((m) => m.category === category);
    }
    if (tags && tags.length > 0) {
      const tagSet = new Set(tags);
      candidates = candidates.filter((m) => (m.tags || []).some((t) => tagSet.has(t)));
    }

    const scored = candidates.map((m) => ({
      memory: m,
      relevance: this._scorer(query, m),
    }));
    scored.sort((a, b) => b.relevance - a.relevance);
    const top = scored.slice(0, limit).filter((s) => s.relevance > 0 || !query);

    const ts = this._now();
    return top.map(({ memory, relevance }) => {
      memory.accessedAt = ts;
      return { ...memory, relevance };
    });
  }

  /**
   * 更新 memory(content/tags/score/metadata)
   */
  update(id, patch = {}) {
    const m = this._memories.get(id);
    if (!m) return null;
    const allowed = ["content", "tags", "score", "metadata", "category"];
    for (const k of allowed) {
      if (patch[k] !== undefined) m[k] = patch[k];
    }
    m.updatedAt = this._now();
    if (this._adapter?.save) {
      Promise.resolve()
        .then(() => this._adapter.save(m))
        .catch((err) => this.emit("adapter-error", { op: "save", error: err }));
    }
    this.emit("updated", m);
    return { ...m };
  }

  remove(id) {
    const m = this._memories.get(id);
    if (!m) return false;
    this._memories.delete(id);
    if (this._adapter?.remove) {
      Promise.resolve()
        .then(() => this._adapter.remove(id))
        .catch((err) => this.emit("adapter-error", { op: "remove", error: err }));
    }
    this.emit("removed", m);
    return true;
  }

  /**
   * 删除一个 scope 下所有 memory(如 session 关闭时清理 session-scope 内存)
   */
  clearScope(scope, scopeId) {
    validateScope(scope);
    const removed = [];
    for (const [id, m] of this._memories) {
      if (m.scope !== scope) continue;
      if (scope !== SCOPE.GLOBAL && m.scopeId !== scopeId) continue;
      this._memories.delete(id);
      removed.push(m);
    }
    if (this._adapter?.remove) {
      for (const m of removed) {
        Promise.resolve()
          .then(() => this._adapter.remove(m.id))
          .catch((err) => this.emit("adapter-error", { op: "remove", error: err }));
      }
    }
    return removed.length;
  }

  list({ scope, scopeId } = {}) {
    let out = Array.from(this._memories.values());
    if (scope) {
      validateScope(scope);
      out = out.filter((m) => m.scope === scope);
      if (scope !== SCOPE.GLOBAL && scopeId) {
        out = out.filter((m) => m.scopeId === scopeId);
      }
    }
    return out.map((m) => ({ ...m }));
  }

  size() {
    return this._memories.size;
  }

  clear() {
    this._memories.clear();
  }

  /**
   * 按 scope 汇总
   */
  stats() {
    const counts = { total: 0, session: 0, agent: 0, user: 0, global: 0 };
    for (const m of this._memories.values()) {
      counts.total++;
      if (counts[m.scope] !== undefined) counts[m.scope]++;
    }
    return counts;
  }
}

module.exports = {
  MemoryStore,
  SCOPE,
  defaultScorer,
  validateScope,
  generateMemoryId,
};
