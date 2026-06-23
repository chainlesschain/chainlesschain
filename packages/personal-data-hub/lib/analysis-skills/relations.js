/**
 * Phase 11 — analysis.relations skill.
 *
 * Per-Person interaction profile. Either:
 *   - `personId`: scope to one specific Person (uses merge-group expansion
 *     so cross-source identities count together) — returns single
 *     person's interaction profile vs self.
 *   - no `personId`: ranks ALL Persons by total interaction count and
 *     returns the top-N.
 *
 * "Interaction" = any Event where the Person is actor or participant.
 * Counts include payments, messages, emails — adapter-agnostic.
 *
 * Output:
 *   {
 *     mode: "single" | "ranked",
 *     personId: ...,
 *     profile?: {                   // single mode
 *       personId, names,
 *       totalInteractions, byAdapter, byMonth,
 *       outboundCount, inboundCount, outboundShare,
 *       totalSpend, totalIncome,
 *       firstInteraction, lastInteraction,
 *     },
 *     ranked?: [...],               // ranked mode
 *     citations,
 *     llm_commentary,
 *   }
 */

"use strict";

const { AnalysisSkill } = require("./base");

class RelationsSkill extends AnalysisSkill {
  constructor(opts) {
    super({ ...opts, name: "analysis.relations" });
  }

  async run(options = {}) {
    if (typeof options.personId === "string" && options.personId.length > 0) {
      return await this._runSingle(options);
    }
    return await this._runRanked(options);
  }

  async _runSingle(options) {
    const { since, until } = this.resolveTimeWindow(options);
    const members = this.expandToMergeGroup(options.personId);
    const memberSet = new Set(members);

    const events = this._fetchAllRelevant({ since, until, memberSet });
    const profile = this._buildProfile(options.personId, members, events);
    const citations = events.slice(0, 50).map((e) => e.id);

    let llmCommentary = null;
    if (options.commentary !== false && this.llm) {
      llmCommentary = await this._llmCommentary(profile, options);
    }

    return {
      skill: "analysis.relations",
      mode: "single",
      personId: options.personId,
      profile,
      citations,
      llm_commentary: llmCommentary,
    };
  }

  async _runRanked(options) {
    const { since, until } = this.resolveTimeWindow(options);
    const topN = Number.isFinite(options.topN) && options.topN > 0 ? options.topN : 20;

    // Pull all events in window then bucket by counterparty
    const allEvents = this._fetchAllRelevant({ since, until, memberSet: null });
    const buckets = new Map();
    for (const e of allEvents) {
      const ids = (e.participants || []).concat(e.actor ? [e.actor] : []);
      for (const pid of new Set(ids)) {
        // Real other-people only — exclude self (incl. legacy hashed self) + group/topic convos.
        if (!this._isPersonContact(pid)) continue;
        const cur = buckets.get(pid) || {
          personId: pid, totalInteractions: 0, totalSpend: 0, totalIncome: 0,
          byAdapter: {}, firstSeen: e.occurredAt, lastSeen: e.occurredAt,
        };
        cur.totalInteractions += 1;
        if (e.content?.amount?.direction === "out") cur.totalSpend += e.content.amount.value;
        if (e.content?.amount?.direction === "in") cur.totalIncome += e.content.amount.value;
        const adapter = (e.source && e.source.adapter) || "unknown";
        cur.byAdapter[adapter] = (cur.byAdapter[adapter] || 0) + 1;
        if (e.occurredAt < cur.firstSeen) cur.firstSeen = e.occurredAt;
        if (e.occurredAt > cur.lastSeen) cur.lastSeen = e.occurredAt;
        buckets.set(pid, cur);
      }
    }
    // Resolve display names per top bucket; ignore self if it sneaks in
    const ranked = Array.from(buckets.values())
      .sort((a, b) => b.totalInteractions - a.totalInteractions)
      .slice(0, topN)
      .map((b) => ({
        ...b,
        totalSpend: Math.round(b.totalSpend * 100) / 100,
        totalIncome: Math.round(b.totalIncome * 100) / 100,
        name: this._lookupName(b.personId),
      }));

    return {
      skill: "analysis.relations",
      mode: "ranked",
      ranked,
      citations: allEvents.slice(0, 50).map((e) => e.id),
      llm_commentary: null,
    };
  }

  _fetchAllRelevant({ since, until, memberSet }) {
    // No subtype filter — relations cares about ALL events. Limit guards
    // memory for big vaults.
    const q = { limit: 10_000 };
    if (since != null) q.since = since;
    if (until != null) q.until = until;
    const events = this.vault.queryEvents(q) || [];
    if (!memberSet) return events;
    return events.filter((e) => {
      if (memberSet.has(e.actor)) return true;
      if (Array.isArray(e.participants) && e.participants.some((p) => memberSet.has(p))) return true;
      return false;
    });
  }

  _buildProfile(personId, members, events) {
    let outboundCount = 0;
    let inboundCount = 0;
    let totalSpend = 0;
    let totalIncome = 0;
    let firstInteraction = Infinity;
    let lastInteraction = -Infinity;
    const byAdapter = {};
    const byMonth = {};
    const memberSet = new Set(members);

    for (const e of events) {
      const t = e.occurredAt || 0;
      if (t < firstInteraction) firstInteraction = t;
      if (t > lastInteraction) lastInteraction = t;
      // Outbound = self → them (actor=self, target=them); inbound = them → self
      if (e.actor === "person-self" || memberSet.has(e.actor)) {
        if (e.actor === "person-self") outboundCount += 1;
        else inboundCount += 1;
      } else {
        // Participant-only event; counts as both? Most adapters keep
        // actor+participants consistent so this branch is rare.
        outboundCount += 1;
      }
      if (e.content?.amount) {
        if (e.content.amount.direction === "out") totalSpend += e.content.amount.value;
        else if (e.content.amount.direction === "in") totalIncome += e.content.amount.value;
      }
      const adapter = (e.source && e.source.adapter) || "unknown";
      byAdapter[adapter] = (byAdapter[adapter] || 0) + 1;
      const d = new Date(t);
      if (Number.isFinite(d.getTime())) {
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        byMonth[m] = (byMonth[m] || 0) + 1;
      }
    }
    const total = outboundCount + inboundCount;

    return {
      personId,
      members,
      names: this._lookupNames(members),
      totalInteractions: total,
      byAdapter,
      byMonth,
      outboundCount,
      inboundCount,
      outboundShare: total > 0 ? Math.round((outboundCount / total) * 100) / 100 : 0,
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      firstInteraction: firstInteraction === Infinity ? null : firstInteraction,
      lastInteraction: lastInteraction === -Infinity ? null : lastInteraction,
    };
  }

  _lookupName(personId) {
    try {
      const p = this.vault.getPerson ? this.vault.getPerson(personId) : null;
      return (p && p.names && p.names[0]) || personId;
    } catch (_e) {
      return personId;
    }
  }

  _lookupNames(personIds) {
    const set = new Set();
    for (const id of personIds) {
      try {
        const p = this.vault.getPerson ? this.vault.getPerson(id) : null;
        if (p && Array.isArray(p.names)) {
          for (const n of p.names) if (n) set.add(n);
        }
      } catch (_e) {}
    }
    return Array.from(set);
  }

  async _llmCommentary(profile, options) {
    if (!profile.totalInteractions) return "No interactions found in this period.";
    const userMsg = `分析与某人的关系：
- 姓名/别名: ${profile.names.join(", ") || profile.personId}
- 互动总数: ${profile.totalInteractions}
- 主动占比: ${(profile.outboundShare * 100).toFixed(0)}% (${profile.outboundCount} 主动 vs ${profile.inboundCount} 收到)
- 钱款来往: 支出 ¥${profile.totalSpend} / 收入 ¥${profile.totalIncome}
- 跨源: ${Object.keys(profile.byAdapter).join(", ")}
- 时间跨度: ${profile.firstInteraction ? new Date(profile.firstInteraction).toISOString().slice(0,10) : "?"} 到 ${profile.lastInteraction ? new Date(profile.lastInteraction).toISOString().slice(0,10) : "?"}

请用 2-3 句话总结关系特征（亲密 / 疏远 / 单向 / 平等）。中文回答。`;
    return await this.callLlmCommentary([
      { role: "system", content: "你是一个克制的人际分析助手。仅基于提供的数据给出温和的描述性总结，不评价、不臆断情感。" },
      { role: "user", content: userMsg },
    ], { acceptNonLocal: options.acceptNonLocal });
  }
}

module.exports = { RelationsSkill };
