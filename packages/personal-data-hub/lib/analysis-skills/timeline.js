/**
 * Phase 11 — analysis.timeline skill.
 *
 * Cross-source narrative timeline. Given a time window + optional topic
 * keyword, weaves Events from all adapters into a chronological story
 * with adapter-aware glyphs (so "邮件" / "支付" / "出行" are
 * visually distinguishable in the UI).
 *
 * LLM (optional) produces a 1-paragraph synthesis: "你这周买过 X 也去过
 * Y, 给妈妈转账过 Z" rather than just a list.
 *
 * Inputs:
 *   - timeWindow:   required (default last 7 days)
 *   - topicFilter:  optional substring match against title / counterparty
 *   - personId:     optional — scope to events involving this person
 *                   (merge-group expanded)
 *   - limit:        default 100 events
 *
 * Output:
 *   {
 *     entries: [{ id, occurredAt, title, kind, amount?, adapter, snippet }],
 *     summary: { totalEvents, byAdapter, byDay, period },
 *     citations,
 *     llm_narrative: "..." | null,
 *   }
 */

"use strict";

const { AnalysisSkill } = require("./base");

class TimelineSkill extends AnalysisSkill {
  constructor(opts) {
    super({ ...opts, name: "analysis.timeline" });
  }

  async run(options = {}) {
    const window = this.resolveTimeWindow({
      sinceDays: options.sinceDays ?? (options.since ? null : 7), // default 7d
      ...options,
    });
    const limit = Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(options.limit, 1000)
      : 100;

    let events = this._fetchEvents(window, limit);
    events = this._applyFilters(events, options);
    const entries = events.map((e) => this._toEntry(e));
    const summary = this._summarize(entries, window);

    let narrative = null;
    if (options.narrative !== false && this.llm && entries.length > 0) {
      narrative = await this._llmNarrative(entries, summary, options);
    }

    return {
      skill: "analysis.timeline",
      entries,
      summary,
      citations: entries.slice(0, 50).map((e) => e.id),
      llm_narrative: narrative,
    };
  }

  _fetchEvents({ since, until }, limit) {
    const q = { limit };
    if (since != null) q.since = since;
    if (until != null) q.until = until;
    const events = this.vault.queryEvents(q) || [];
    // queryEvents orders DESC; reverse for narrative (oldest first)
    return events.slice().sort((a, b) => (a.occurredAt || 0) - (b.occurredAt || 0));
  }

  _applyFilters(events, options) {
    let out = events;
    if (typeof options.topicFilter === "string" && options.topicFilter.length > 0) {
      const needle = options.topicFilter.toLowerCase();
      out = out.filter((e) => {
        const title = (e.content && e.content.title) || "";
        const counterparty = (e.extra && e.extra.counterparty) || "";
        const text = (e.content && e.content.text) || "";
        return title.toLowerCase().includes(needle)
          || counterparty.toLowerCase().includes(needle)
          || text.toLowerCase().includes(needle);
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
    return out;
  }

  _toEntry(event) {
    const adapter = (event.source && event.source.adapter) || "unknown";
    return {
      id: event.id,
      occurredAt: event.occurredAt,
      title: (event.content && event.content.title) || "(无标题)",
      kind: event.subtype || "event",
      amount: event.content?.amount || null,
      adapter,
      snippet: this._buildSnippet(event),
    };
  }

  _buildSnippet(event) {
    const parts = [];
    const text = (event.content && event.content.text) || "";
    if (text) parts.push(text.slice(0, 100));
    if (event.extra) {
      if (event.extra.counterparty) parts.push(`@${event.extra.counterparty}`);
      if (event.extra.from && event.extra.to) parts.push(`${event.extra.from} → ${event.extra.to}`);
    }
    return parts.join(" · ").slice(0, 200);
  }

  _summarize(entries, window) {
    const byAdapter = {};
    const byDay = {};
    for (const e of entries) {
      byAdapter[e.adapter] = (byAdapter[e.adapter] || 0) + 1;
      const d = new Date(e.occurredAt);
      if (Number.isFinite(d.getTime())) {
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        byDay[day] = (byDay[day] || 0) + 1;
      }
    }
    return {
      totalEvents: entries.length,
      byAdapter,
      byDay,
      period: {
        since: window.since || null,
        until: window.until || null,
      },
    };
  }

  async _llmNarrative(entries, summary, options) {
    if (entries.length === 0) return null;
    // Cap to 30 entries for prompt size
    const sampled = entries.slice(-30);
    const lines = sampled.map((e) => {
      const d = new Date(e.occurredAt).toISOString().slice(0, 10);
      const amt = e.amount ? ` ¥${e.amount.value}(${e.amount.direction})` : "";
      return `- ${d} [${e.adapter}/${e.kind}] ${e.title}${amt}`;
    }).join("\n");

    const userMsg = `用户的事件时间线（共 ${summary.totalEvents} 条, 显示最近 ${sampled.length}）:

${lines}

请用 3-5 句话讲清楚这段时间发生了什么、出现的人物 / 地点、有没有明显的主题或事件。中文回答，平实叙述，不评价。`;

    return await this.callLlmCommentary([
      { role: "system", content: "你是一个克制的时间线叙述助手。基于事实串联事件，不引申、不评价。" },
      { role: "user", content: userMsg },
    ], { acceptNonLocal: options.acceptNonLocal });
  }
}

module.exports = { TimelineSkill };
