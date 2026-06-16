/**
 * analysis.overview — cross-app unified snapshot for decision support.
 *
 * The de-silo capstone: every adapter normalizes into one vault, so this single
 * skill aggregates ALL apps' Events into one picture — activity by app + by type,
 * top relationships (merge-group aware, so the same person across WeChat/Douyin/
 * Weibo counts once), spending across shopping/finance apps, and time trend.
 * Gives the personal AI a unified "基于跨 app 数据" basis for decisions.
 *
 * Output:
 *   {
 *     skill, summary: { totalEvents, appsActive, period, topAppName },
 *     byApp: [{ app, count }], byType: [{ type, count }],
 *     monthlyActivity: [{ monthKey, count }],
 *     topContacts: [{ personId, name, interactions, byApp }],
 *     spending: { total, byDirection, currency },
 *     citations, llm_commentary,
 *   }
 */
"use strict";

const { AnalysisSkill } = require("./base");

const SPEND_SUBTYPES = new Set([
  "payment", "transfer", "refund", "utility", "redenvelope", "investment", "income", "order",
]);

class OverviewSkill extends AnalysisSkill {
  constructor(opts) {
    super({ ...opts, name: "analysis.overview" });
  }

  async run(options = {}) {
    const { since, until } = this.resolveTimeWindow(options);
    const topN = Number.isFinite(options.topN) && options.topN > 0 ? options.topN : 10;

    const q = { limit: Number.isFinite(options.limit) ? options.limit : 50_000 };
    if (since != null) q.since = since;
    if (until != null) q.until = until;
    const events = this.vault.queryEvents(q) || [];

    const byApp = new Map();
    const byType = new Map();
    const byMonth = new Map();
    const contacts = new Map(); // canonicalPersonId → { interactions, byApp:Map }
    let spendTotal = 0;
    const spendByDir = new Map();
    let currency = null;
    const citations = [];

    for (const e of events) {
      const app = (e.source && e.source.adapter) || "unknown";
      byApp.set(app, (byApp.get(app) || 0) + 1);
      const type = e.subtype || "other";
      byType.set(type, (byType.get(type) || 0) + 1);
      if (Number.isFinite(e.occurredAt)) {
        const d = new Date(e.occurredAt);
        if (Number.isFinite(d.getTime())) {
          const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          byMonth.set(m, (byMonth.get(m) || 0) + 1);
        }
      }
      // relationships (actor + participants), merge-group canonicalized
      const ids = (Array.isArray(e.participants) ? e.participants : []).concat(e.actor ? [e.actor] : []);
      for (const pid of ids) {
        if (!pid || pid === "person-self") continue;
        const canon = this._canon(pid);
        const cur = contacts.get(canon) || { interactions: 0, byApp: new Map() };
        cur.interactions += 1;
        cur.byApp.set(app, (cur.byApp.get(app) || 0) + 1);
        contacts.set(canon, cur);
      }
      // spending
      if (SPEND_SUBTYPES.has(type) && e.content && e.content.amount && Number.isFinite(e.content.amount.value)) {
        const v = e.content.amount.value;
        spendTotal += v;
        const dir = e.content.amount.direction || "unknown";
        spendByDir.set(dir, (spendByDir.get(dir) || 0) + v);
        if (!currency && e.content.amount.currency) currency = e.content.amount.currency;
      }
      if (citations.length < 50) citations.push(e.id);
    }

    const byAppArr = [...byApp.entries()].map(([app, count]) => ({ app, count })).sort((a, b) => b.count - a.count);
    const topContacts = [...contacts.entries()]
      .map(([personId, v]) => ({
        personId,
        name: this._lookupName(personId),
        interactions: v.interactions,
        byApp: Object.fromEntries(v.byApp),
      }))
      .sort((a, b) => b.interactions - a.interactions)
      .slice(0, topN);

    const summary = {
      totalEvents: events.length,
      appsActive: byApp.size,
      period: { since: since || null, until: until || null },
      topAppName: byAppArr.length ? byAppArr[0].app : null,
    };

    const result = {
      skill: "analysis.overview",
      summary,
      byApp: byAppArr,
      byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      monthlyActivity: [...byMonth.entries()].map(([monthKey, count]) => ({ monthKey, count })).sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
      topContacts,
      spending: {
        total: Math.round(spendTotal * 100) / 100,
        byDirection: Object.fromEntries(spendByDir),
        currency: currency || null,
      },
      citations,
      llm_commentary: null,
    };

    if (options.commentary !== false && this.llm && events.length > 0) {
      result.llm_commentary = await this._commentary(result, options);
    }
    return result;
  }

  _canon(personId) {
    const members = this.expandToMergeGroup(personId);
    if (!members || members.length === 0) return personId;
    // canonical = smallest id (stable across the group)
    return [...members].sort()[0];
  }

  _lookupName(personId) {
    try {
      if (typeof this.vault.getPerson === "function") {
        const p = this.vault.getPerson(personId);
        if (p && Array.isArray(p.names) && p.names.length) return p.names[0];
      }
    } catch (_e) { /* optional */ }
    return null;
  }

  async _commentary(result, options) {
    const apps = result.byApp.slice(0, 5).map((a) => `${a.app}(${a.count})`).join(", ");
    const types = result.byType.slice(0, 5).map((t) => `${t.type}(${t.count})`).join(", ");
    const msg = `用户跨 ${result.summary.appsActive} 个 app 的数据汇总：
- 共 ${result.summary.totalEvents} 条事件；活跃 app(Top5): ${apps}
- 事件类型(Top5): ${types}
- 跨 app 消费合计: ${result.spending.total} ${result.spending.currency || ""}
- 高频联系人数: ${result.topContacts.length}
请用 3-4 句话，从「为个人决策提供依据」的角度，概括其数字生活重心与可关注点。中文。`;
    return await this.callLlmCommentary([
      { role: "system", content: "你是个人数据中台的跨 app 洞察助手，基于事实给决策参考，克制不臆测。" },
      { role: "user", content: msg },
    ], { acceptNonLocal: options.acceptNonLocal });
  }
}

module.exports = { OverviewSkill };
