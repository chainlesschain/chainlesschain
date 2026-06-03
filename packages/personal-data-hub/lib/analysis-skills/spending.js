/**
 * Phase 11 — analysis.spending skill.
 *
 * Inputs:
 *   - timeWindow:  { since, until } | { sinceDays N } | { sinceMonths N }
 *   - dimension:   "merchant" | "category" | "counterparty" | "month"
 *                  Default "merchant".
 *   - merchantFilter:   optional substring (e.g. "美团" to scope to one
 *                       merchant family)
 *   - personId:         optional — scope to spending TO this person (uses
 *                       merge-group expansion)
 *   - topN:             default 10
 *
 * Output:
 *   {
 *     summary: {
 *       totalSpend, totalIncome, netFlow, currency,
 *       eventCount, uniqueCounterparties, period,
 *     },
 *     breakdown: [{ key, totalSpend, eventCount, percentOfTotal }, ...],
 *     trend: [{ monthKey, totalSpend, eventCount }, ...],
 *     citations: [eventId, ...],
 *     llm_commentary: "..." | null,
 *   }
 */

"use strict";

const { AnalysisSkill } = require("./base");

const SUPPORTED_DIMENSIONS = new Set(["merchant", "category", "counterparty", "month"]);

class SpendingSkill extends AnalysisSkill {
  constructor(opts) {
    super({ ...opts, name: "analysis.spending" });
  }

  async run(options = {}) {
    const { since, until } = this.resolveTimeWindow(options);
    const dimension = SUPPORTED_DIMENSIONS.has(options.dimension)
      ? options.dimension
      : "merchant";
    const topN = Number.isFinite(options.topN) && options.topN > 0 ? options.topN : 10;

    // Pull events with subtype = payment / transfer / refund / utility /
    // redenvelope / investment / income. These are the ones with content.amount.
    const events = this._fetchPaymentEvents({ since, until });
    const filtered = this._applyFilters(events, options);

    const summary = this._summarize(filtered, since, until);
    const breakdown = this._breakdown(filtered, dimension, topN);
    const trend = this._monthlyTrend(filtered);
    const citations = filtered.slice(0, 50).map((e) => e.id);

    let llmCommentary = null;
    if (options.commentary !== false && this.llm) {
      llmCommentary = await this._llmCommentary(summary, breakdown, dimension, options);
    }

    return {
      skill: "analysis.spending",
      summary,
      breakdown,
      trend,
      citations,
      llm_commentary: llmCommentary,
    };
  }

  _fetchPaymentEvents({ since, until }) {
    const events = [];
    // Phase 7 shopping adapters emit subtype="order" — must include so
    // spending aggregates cover Taobao/JD/Meituan along with Alipay
    // (payment/transfer) + Email (refund) etc.
    const subtypes = ["payment", "transfer", "refund", "utility", "redenvelope", "investment", "income", "order"];
    for (const subtype of subtypes) {
      const q = { subtype, limit: 5000 };
      if (since != null) q.since = since;
      if (until != null) q.until = until;
      const batch = this.vault.queryEvents(q) || [];
      for (const e of batch) {
        // queryEvents may strip extra; we already get full row from vault
        if (e && e.content && e.content.amount && Number.isFinite(e.content.amount.value)) {
          events.push(e);
        }
      }
    }
    return events;
  }

  _applyFilters(events, options) {
    let out = events;
    if (typeof options.merchantFilter === "string" && options.merchantFilter.length > 0) {
      const needle = options.merchantFilter.toLowerCase();
      out = out.filter((e) => {
        const title = (e.content && e.content.title) || "";
        const counterparty = (e.extra && e.extra.counterparty) || "";
        return title.toLowerCase().includes(needle)
          || counterparty.toLowerCase().includes(needle);
      });
    }
    if (typeof options.personId === "string" && options.personId.length > 0) {
      const memberSet = new Set(this.expandToMergeGroup(options.personId));
      out = out.filter((e) => {
        if (memberSet.has(e.actor)) return true;
        if (Array.isArray(e.participants) && e.participants.some((p) => memberSet.has(p))) return true;
        return false;
      });
    }
    if (options.direction === "out" || options.direction === "in") {
      out = out.filter((e) => e.content.amount.direction === options.direction);
    }
    return out;
  }

  _summarize(events, since, until) {
    let totalSpend = 0;
    let totalIncome = 0;
    const counterparties = new Set();
    for (const e of events) {
      const v = e.content.amount.value;
      if (e.content.amount.direction === "in") totalIncome += v;
      else if (e.content.amount.direction === "out") totalSpend += v;
      // Identify counterparty for distinctness
      const cp = (e.extra && e.extra.counterparty) || e.actor;
      if (cp && cp !== "person-self") counterparties.add(cp);
    }
    return {
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      netFlow: Math.round((totalIncome - totalSpend) * 100) / 100,
      currency: events[0]?.content?.amount?.currency || "CNY",
      eventCount: events.length,
      uniqueCounterparties: counterparties.size,
      period: { since: since || null, until: until || null },
    };
  }

  _breakdown(events, dimension, topN) {
    const buckets = new Map();
    for (const e of events) {
      // Only count "out" for spending breakdown — income tracked separately
      if (e.content.amount.direction !== "out") continue;
      const key = this._keyFor(e, dimension);
      if (!key) continue;
      const cur = buckets.get(key) || { key, totalSpend: 0, eventCount: 0 };
      cur.totalSpend += e.content.amount.value;
      cur.eventCount += 1;
      buckets.set(key, cur);
    }
    const totalOut = Array.from(buckets.values()).reduce((s, b) => s + b.totalSpend, 0);
    const sorted = Array.from(buckets.values())
      .map((b) => ({
        ...b,
        totalSpend: Math.round(b.totalSpend * 100) / 100,
        percentOfTotal: totalOut > 0 ? Math.round((b.totalSpend / totalOut) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, topN);
    return sorted;
  }

  _monthlyTrend(events) {
    const buckets = new Map();
    for (const e of events) {
      if (e.content.amount.direction !== "out") continue;
      const d = new Date(e.occurredAt);
      if (!Number.isFinite(d.getTime())) continue;
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = buckets.get(monthKey) || { monthKey, totalSpend: 0, eventCount: 0 };
      cur.totalSpend += e.content.amount.value;
      cur.eventCount += 1;
      buckets.set(monthKey, cur);
    }
    return Array.from(buckets.values())
      .map((b) => ({ ...b, totalSpend: Math.round(b.totalSpend * 100) / 100 }))
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }

  _keyFor(event, dimension) {
    if (dimension === "merchant" || dimension === "counterparty") {
      return (event.extra && event.extra.counterparty)
        || (event.content && event.content.title)
        || "(unknown)";
    }
    if (dimension === "category") {
      return (event.extra && event.extra.category)
        || event.subtype
        || "(uncategorized)";
    }
    if (dimension === "month") {
      const d = new Date(event.occurredAt);
      if (!Number.isFinite(d.getTime())) return "(unknown date)";
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    return null;
  }

  async _llmCommentary(summary, breakdown, dimension, options) {
    if (summary.eventCount === 0) return "No spending events found in this period.";
    const topItems = breakdown.slice(0, 5).map((b) => `${b.key} ¥${b.totalSpend} (${b.percentOfTotal}%)`).join(", ");
    const periodStr = summary.period.since
      ? `${new Date(summary.period.since).toISOString().slice(0, 10)} 至 ${new Date(summary.period.until).toISOString().slice(0, 10)}`
      : "全部时间";
    const userMsg = `用户的消费数据：
- 期间：${periodStr}
- 总支出 ¥${summary.totalSpend} (${summary.currency}), 总收入 ¥${summary.totalIncome}, 净流 ¥${summary.netFlow}
- 共 ${summary.eventCount} 笔交易, ${summary.uniqueCounterparties} 个独特对方
- 按 ${dimension} 排名 top 5：${topItems}

请用 2-3 句话点评消费习惯，指出最大支出方向和异常（如有）。中文回答。`;
    return await this.callLlmCommentary([
      { role: "system", content: "你是一个理性、克制的财务分析助手。基于事实给出简短结论，不夸张、不臆断。" },
      { role: "user", content: userMsg },
    ], { acceptNonLocal: options.acceptNonLocal });
  }
}

module.exports = { SpendingSkill, SUPPORTED_DIMENSIONS };
