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

/**
 * Render a human-readable line from message content that may be raw markup.
 * WeChat link/app/system messages store an XML blob (`<msg><appmsg><title>…`)
 * in content.title/text — dumping it verbatim made the timeline read as XML
 * soup. Extract the inner <title>/<des> when present, otherwise strip tags;
 * decode the few entities that show up, collapse whitespace, and cap length.
 */
function cleanDisplayText(raw, max = 120) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  if (s.startsWith("<?xml") || /<\s*(msg|appmsg|sysmsg|sysmessage)\b/i.test(s)) {
    const title = s.match(/<title>([\s\S]*?)<\/title>/i);
    const des = s.match(/<des>([\s\S]*?)<\/des>/i);
    const picked = [title && title[1], des && des[1]]
      .map((x) => (x || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim())
      .filter(Boolean)
      .join(" — ")
      .trim();
    if (picked) s = picked;
  }
  s = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") // closed CDATA
    .replace(/<!\[CDATA\[/g, "") // orphan open (source truncated the close)
    .replace(/\]\]>/g, "") // orphan close
    .replace(/<[^>]+>/g, " ") // any remaining tags
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&") // decode amp last so we don't double-decode
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max) : s;
}

function safeCodePoint(n) {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch (_e) {
    return "";
  }
}

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
    // Exclude inventory-snapshot + aggregate-baseline events. The snapshots
    // (installed-app / contact roster from system-data-android) carry a
    // synthetic collection-time occurredAt — tens of thousands cluster at one
    // recent timestamp and would crowd out real activity. `app-usage-profile`
    // is a single rolling aggregate (e.g. douyin "24天/108h" baseline), not a
    // discrete activity, so it doesn't belong in a chronological narrative.
    // All remain in the vault for facet counts / overview.
    const q = {
      limit,
      excludeExtraKinds: ["app-snapshot", "contact-snapshot", "app-usage-profile"],
    };
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
    const rawTitle = (event.content && event.content.title) || "";
    const cleanTitle = cleanDisplayText(rawTitle);
    return {
      id: event.id,
      occurredAt: event.occurredAt,
      title: cleanTitle || "(无标题)",
      kind: event.subtype || "event",
      amount: event.content?.amount || null,
      adapter,
      snippet: this._buildSnippet(event),
    };
  }

  _buildSnippet(event) {
    const parts = [];
    const text = cleanDisplayText((event.content && event.content.text) || "", 100);
    if (text) parts.push(text);
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
