/**
 * Phase 11 — analysis.interests skill.
 *
 * Extracts the user's interest profile from:
 *   - Topic entities (already-categorized by adapter)
 *   - Item entities (product / content names)
 *   - Event content.title from order/payment/visit events
 *
 * LLM is used to cluster + name interest categories. Without LLM,
 * falls back to topic-frequency + most-purchased-item ranking (no
 * generalization).
 *
 * Inputs:
 *   - timeWindow:  optional; default all-time
 *   - topN:        default 15
 *
 * Output:
 *   {
 *     topTopics: [{ name, eventCount, lastSeen }, ...],
 *     topItems:  [{ name, occurrences, totalSpend }, ...],
 *     llmInterests?: [{ category, evidenceCount, examples }, ...],
 *     citations,
 *     llm_commentary,
 *   }
 */

"use strict";

const { AnalysisSkill } = require("./base");

/**
 * A topic name carries real interest signal only if it is a human-readable
 * label. Unresolved group-chat IDs (e.g. WeChat group topics named by their
 * raw numeric chatroom id "45498354778") and empty names are NOT interests —
 * they would crowd out genuine topics (coffee, photography, 豆包...) in the
 * profile. Drop them.
 */
function isMeaningfulTopicName(name) {
  if (typeof name !== "string") return false;
  const s = name.trim();
  if (s.length === 0) return false;
  if (/^\d+$/.test(s)) return false; // pure-numeric = unresolved group id
  return true;
}

class InterestsSkill extends AnalysisSkill {
  constructor(opts) {
    super({ ...opts, name: "analysis.interests" });
  }

  async run(options = {}) {
    const { since, until } = this.resolveTimeWindow(options);
    const topN = Number.isFinite(options.topN) && options.topN > 0 ? options.topN : 15;

    const topTopics = this._topTopics(since, until, topN);
    const topItems = this._topItems(since, until, topN);
    const events = this._sampleEvents(since, until, 200);
    const llmInterests = (options.commentary !== false && this.llm)
      ? await this._clusterInterests(topTopics, topItems, events, options)
      : null;

    return {
      skill: "analysis.interests",
      topTopics,
      topItems,
      llmInterests,
      citations: events.slice(0, 50).map((e) => e.id),
      llm_commentary: null,
    };
  }

  _topTopics(since, until, topN) {
    // Topics are stored in their own table — eventCount is derived from
    // the JSON `derived_from_events` array length; lastSeen is the
    // topic's ingested_at (proxy until we add a real last_seen column).
    let topics = [];
    try {
      const db = this.vault._requireOpen();
      // Over-fetch (×20, capped) before filtering: vaults can hold thousands
      // of unresolved numeric group-chat topics that would otherwise starve
      // the few human-readable interest topics out of the top-N budget.
      topics = db.prepare(
        "SELECT id, name, derived_from_events, ingested_at FROM topics ORDER BY ingested_at DESC LIMIT ?"
      ).all(Math.min(topN * 20, 2000));
    } catch (_e) {
      // Older vaults may not have topics; non-fatal.
    }
    const mapped = topics
      .filter((t) => isMeaningfulTopicName(t.name))
      .map((t) => {
        let eventCount = 0;
        try {
          const arr = t.derived_from_events ? JSON.parse(t.derived_from_events) : [];
          if (Array.isArray(arr)) eventCount = arr.length;
        } catch (_e) {}
        return {
          id: t.id,
          name: t.name,
          eventCount,
          lastSeen: t.ingested_at || null,
        };
      });
    return mapped
      .sort((a, b) => (b.eventCount - a.eventCount) || ((b.lastSeen || 0) - (a.lastSeen || 0)))
      .slice(0, topN);
  }

  _topItems(since, until, topN) {
    let items = [];
    try {
      const db = this.vault._requireOpen();
      items = db.prepare(
        "SELECT id, name FROM items ORDER BY ingested_at DESC LIMIT ?"
      ).all(topN * 3);
    } catch (_e) {}
    // Re-bucket by name (multiple Item rows often share the same product
    // name across adapters). Phase 8 EntityResolver doesn't dedup items
    // yet — that's Phase 9+.
    const buckets = new Map();
    for (const row of items) {
      const item = this.vault.getItem ? this.vault.getItem(row.id) : null;
      if (!item) continue;
      const key = item.name || "(unknown)";
      const cur = buckets.get(key) || { name: key, occurrences: 0, totalSpend: 0 };
      cur.occurrences += 1;
      if (item.price && Number.isFinite(item.price.value)) cur.totalSpend += item.price.value;
      buckets.set(key, cur);
    }
    return Array.from(buckets.values())
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, topN)
      .map((b) => ({ ...b, totalSpend: Math.round(b.totalSpend * 100) / 100 }));
  }

  _sampleEvents(since, until, limit) {
    const q = { limit };
    if (since != null) q.since = since;
    if (until != null) q.until = until;
    return this.vault.queryEvents(q) || [];
  }

  async _clusterInterests(topTopics, topItems, events, options) {
    if (topTopics.length === 0 && topItems.length === 0) return null;
    const userMsg = `用户的互动数据样本：

Topics (按出现频次):
${topTopics.slice(0, 10).map((t) => `- ${t.name} (${t.eventCount}次)`).join("\n") || "(无)"}

Items (购买/收到):
${topItems.slice(0, 10).map((i) => `- ${i.name} (${i.occurrences}次, ¥${i.totalSpend})`).join("\n") || "(无)"}

最近事件 titles (抽样):
${events.slice(0, 20).map((e) => `- ${e.content?.title || "(无标题)"}`).join("\n")}

请将以上抽 3-5 个兴趣类别（如"咖啡"、"科技阅读"、"户外旅行"），每个给出 1-2 个 evidence 引用。
输出 JSON 数组：[{"category": "类别名", "evidenceCount": N, "examples": ["..."]}, ...]
只输出 JSON，不要其它文字。`;

    const resp = await this.callLlmCommentary([
      { role: "system", content: "你是一个克制的兴趣画像分析助手。基于明示数据归纳类别，不臆造。" },
      { role: "user", content: userMsg },
    ], { acceptNonLocal: options.acceptNonLocal });

    if (!resp) return null;
    // Parse JSON array (strict → fenced → regex)
    try {
      return JSON.parse(resp.trim());
    } catch (_e) {}
    const fence = resp.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fence) {
      try { return JSON.parse(fence[1].trim()); } catch (_e) {}
    }
    const arrMatch = resp.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]); } catch (_e) {}
    }
    return null;
  }
}

module.exports = { InterestsSkill };
