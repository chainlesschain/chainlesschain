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

// File/config noise that the device file-scan (system-data-android) records as
// "items": configs, system files, downloads, screenshots, exported text dumps.
// These are NOT interests (a real interest item is a product / media title /
// place). Drop names that look like a filename or a bare config token.
const FILE_NOISE_EXT = new RegExp(
  "\\.(xml|html?|txt|md|json|ya?ml|log|ini|cfg|conf|properties|lock|csv|tsv|" +
    "png|jpe?g|gif|webp|bmp|svg|ico|heic|" +
    "mp3|mp4|mov|avi|mkv|wav|flac|m4a|" +
    "apk|db|sqlite|dat|bak|tmp|cache|" +
    "zip|rar|7z|gz|tar|" +
    "so|dll|exe|bin|" +
    "js|ts|java|kt|py|c|h|cpp|gradle|sh|bat)$",
  "i"
);
const CONFIG_TOKEN = /^(appid|tone|config|settings?|index|default|temp|tmp|cache|manifest|readme|license)$/i;
function isMeaningfulItemName(name) {
  if (typeof name !== "string") return false;
  const s = name.trim();
  if (s.length === 0 || s === "(unknown)") return false;
  // Strip a trailing dedup suffix like " (1)" / " (2)" before checking ext.
  const base = s.replace(/\s*\(\d+\)$/, "");
  if (FILE_NOISE_EXT.test(base)) return false; // looks like a filename → device file, not an interest
  if (CONFIG_TOKEN.test(s)) return false; // bare config key
  return true;
}

// Adapters that catalog the device's files / code / shell / repos rather than
// the user's interests. Their "items" are filenames, not products/media/places,
// so they must not appear in the interest profile (a real interest item comes
// from a shopping / media / browse / social source).
const NON_INTEREST_ITEM_ADAPTERS = new Set([
  "system-data-android", "local-files", "vscode", "shell-history", "git-activity",
]);

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
    // Rank topics by REAL engagement: count events that actually reference each
    // topic (the events.topics JSON array) and join to the topics table for the
    // human name. The old path read topics.derived_from_events (which the
    // derivation never populates → eventCount always 0) and fell back to
    // ordering by ingested_at — so "top interests" were just the most recently
    // ingested group names, including inactive memberships the user never
    // participates in. Now an active group like "EasyWeChat 开发者闲聊吹水群"
    // (hundreds of events) ranks above a group joined once and never used.
    let rows = [];
    try {
      const db = this.vault._requireOpen();
      const where = ["events.topics IS NOT NULL", "events.topics != '[]'"];
      const params = {};
      if (Number.isFinite(since)) { where.push("events.occurred_at >= @since"); params.since = since; }
      if (Number.isFinite(until)) { where.push("events.occurred_at <= @until"); params.until = until; }
      // Over-fetch (×20, capped) before the meaningful-name filter so a burst
      // of numeric-named group topics can't starve human-readable ones.
      params.lim = Math.min(topN * 20, 2000);
      rows = db.prepare(
        "SELECT t.id AS id, t.name AS name, c.cnt AS eventCount, t.ingested_at AS lastSeen " +
        "FROM topics t JOIN (" +
          "SELECT je.value AS tid, COUNT(*) AS cnt " +
          "FROM events, json_each(events.topics) je " +
          "WHERE " + where.join(" AND ") + " " +
          "GROUP BY je.value" +
        ") c ON c.tid = t.id " +
        "ORDER BY c.cnt DESC LIMIT @lim"
      ).all(params);
    } catch (_e) {
      // Older vaults may lack topics / JSON1 — non-fatal, return empty.
    }
    return rows
      .filter((t) => isMeaningfulTopicName(t.name))
      .map((t) => ({
        id: t.id,
        name: t.name,
        eventCount: t.eventCount || 0,
        lastSeen: t.lastSeen || null,
      }))
      .slice(0, topN);
  }

  _topItems(since, until, topN) {
    let items = [];
    try {
      const db = this.vault._requireOpen();
      // Over-fetch (×30, capped) before the noise filter: the device file-scan
      // (system-data-android) floods the items table with configs/screenshots/
      // exports that would otherwise fill the recent-N window and crowd out
      // genuine product/media items.
      items = db.prepare(
        "SELECT id, name, source_adapter FROM items ORDER BY ingested_at DESC LIMIT ?"
      ).all(Math.min(topN * 30, 3000));
    } catch (_e) {}
    // Re-bucket by name (multiple Item rows often share the same product
    // name across adapters). Phase 8 EntityResolver doesn't dedup items
    // yet — that's Phase 9+.
    const buckets = new Map();
    for (const row of items) {
      if (NON_INTEREST_ITEM_ADAPTERS.has(row.source_adapter)) continue; // device file/code scans, not interests
      if (!isMeaningfulItemName(row.name)) continue; // skip device files / config noise
      const item = this.vault.getItem ? this.vault.getItem(row.id) : null;
      if (!item) continue;
      const key = item.name || "(unknown)";
      if (!isMeaningfulItemName(key)) continue;
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
