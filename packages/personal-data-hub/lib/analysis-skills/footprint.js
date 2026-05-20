/**
 * Phase 11 — analysis.footprint skill.
 *
 * Travel + location patterns based on Place entities + Event records
 * with location data. Phase 9 (Travel adapters) will substantially
 * expand the source data; this v0 works with whatever Place rows
 * adapters already produce (Phase 6 Alipay travel transactions /
 * Phase 5 Email travel template).
 *
 * Inputs:
 *   - timeWindow:  { since, until } | { sinceDays N } | { sinceMonths N }
 *   - topN:        default 10
 *   - groupBy:     "city" | "place" | "country"  (default "place")
 *
 * Output:
 *   {
 *     summary: {
 *       totalTrips, uniquePlaces, period,
 *     },
 *     topPlaces: [{ name, visits, lastVisit, eventIds }, ...],
 *     monthlyDistribution: [{ monthKey, trips }, ...],
 *     citations,
 *     llm_commentary,
 *   }
 */

"use strict";

const { AnalysisSkill } = require("./base");

const TRAVEL_SUBTYPES = new Set(["travel", "visit", "checkin"]);

class FootprintSkill extends AnalysisSkill {
  constructor(opts) {
    super({ ...opts, name: "analysis.footprint" });
  }

  async run(options = {}) {
    const { since, until } = this.resolveTimeWindow(options);
    const topN = Number.isFinite(options.topN) && options.topN > 0 ? options.topN : 10;
    const groupBy = options.groupBy || "place";

    const events = this._fetchTravelEvents({ since, until });
    const visits = this._extractVisits(events);
    const topPlaces = this._topPlaces(visits, groupBy, topN);
    const monthly = this._monthlyDistribution(visits);

    const summary = {
      totalTrips: visits.length,
      uniquePlaces: new Set(visits.map((v) => v.key)).size,
      period: { since: since || null, until: until || null },
    };

    let llmCommentary = null;
    if (options.commentary !== false && this.llm && visits.length > 0) {
      llmCommentary = await this._llmCommentary(summary, topPlaces, options);
    }

    return {
      skill: "analysis.footprint",
      summary,
      topPlaces,
      monthlyDistribution: monthly,
      citations: events.slice(0, 50).map((e) => e.id),
      llm_commentary: llmCommentary,
    };
  }

  _fetchTravelEvents({ since, until }) {
    const events = [];
    for (const subtype of TRAVEL_SUBTYPES) {
      const q = { subtype, limit: 5000 };
      if (since != null) q.since = since;
      if (until != null) q.until = until;
      const batch = this.vault.queryEvents(q) || [];
      events.push(...batch);
    }
    // Also include events with explicit Place participants
    const general = this.vault.queryEvents({
      limit: 10_000,
      ...(since != null ? { since } : {}),
      ...(until != null ? { until } : {}),
    }) || [];
    for (const e of general) {
      if (e.extra && (e.extra.placeId || e.extra.from || e.extra.to)) events.push(e);
    }
    // Dedup by id
    const seen = new Set();
    return events.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  _extractVisits(events) {
    const visits = [];
    for (const e of events) {
      const places = [];
      // Travel adapters typically store from/to in extra
      if (e.extra) {
        if (typeof e.extra.from === "string") places.push({ key: e.extra.from, role: "from" });
        if (typeof e.extra.to === "string") places.push({ key: e.extra.to, role: "to" });
        if (typeof e.extra.placeId === "string") places.push({ key: e.extra.placeId, role: "visit" });
        if (typeof e.extra.city === "string") places.push({ key: e.extra.city, role: "city" });
      }
      // Event with location in content
      if (e.content && typeof e.content.location === "string") {
        places.push({ key: e.content.location, role: "location" });
      }
      for (const p of places) {
        if (!p.key || p.key === "(unknown)") continue;
        visits.push({
          key: p.key,
          role: p.role,
          eventId: e.id,
          occurredAt: e.occurredAt,
        });
      }
    }
    return visits;
  }

  _topPlaces(visits, _groupBy, topN) {
    const buckets = new Map();
    for (const v of visits) {
      const cur = buckets.get(v.key) || { name: v.key, visits: 0, lastVisit: 0, eventIds: [] };
      cur.visits += 1;
      if (v.occurredAt > cur.lastVisit) cur.lastVisit = v.occurredAt;
      if (cur.eventIds.length < 5) cur.eventIds.push(v.eventId);
      buckets.set(v.key, cur);
    }
    return Array.from(buckets.values())
      .sort((a, b) => b.visits - a.visits)
      .slice(0, topN);
  }

  _monthlyDistribution(visits) {
    const buckets = new Map();
    for (const v of visits) {
      const d = new Date(v.occurredAt);
      if (!Number.isFinite(d.getTime())) continue;
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(m, (buckets.get(m) || 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([monthKey, trips]) => ({ monthKey, trips }))
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }

  async _llmCommentary(summary, topPlaces, options) {
    if (summary.totalTrips === 0) return "No travel events in this period.";
    const topList = topPlaces.slice(0, 5).map((p) => `${p.name}(${p.visits}次)`).join(", ");
    const userMsg = `用户的出行数据：
- 期间: ${summary.period.since ? new Date(summary.period.since).toISOString().slice(0,10) : "全部"} 至 ${summary.period.until ? new Date(summary.period.until).toISOString().slice(0,10) : "现在"}
- 共 ${summary.totalTrips} 次足迹, ${summary.uniquePlaces} 个独特地点
- Top 5: ${topList}

请用 2-3 句话总结出行模式（常去、稀去、季节性 etc.）。中文回答。`;
    return await this.callLlmCommentary([
      { role: "system", content: "你是一个克制的足迹分析助手。基于事实简短描述出行模式。" },
      { role: "user", content: userMsg },
    ], { acceptNonLocal: options.acceptNonLocal });
  }
}

module.exports = { FootprintSkill };
