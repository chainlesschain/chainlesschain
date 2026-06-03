/**
 * Phase 11 — Analysis skills base.
 *
 * Each skill = a focused analysis function over the vault. Inputs are
 * a small typed options bag (time range + dimension + filters); output
 * is `{ summary, breakdown, llm_commentary?, citations }`.
 *
 * Skills are pure logic on vault data + optional LLM commentary. They
 * compose with cross-source merge groups (Phase 8 EntityResolver) so
 * "上个月给我妈花了多少" returns combined Email + Alipay + WeChat
 * spending tied to the same merged Person.
 *
 * Skills share these conventions:
 *   - `vault` injected at construction
 *   - `llm` optional; when null, skill returns pure-data result (no
 *     commentary); when provided, llm.chat() generates a 1-2 sentence
 *     prose commentary on the breakdown.
 *   - `timeWindow` is `{ since, until }` ms epoch pair; absent = all-time
 *   - results always carry `citations` = list of event ids that
 *     contributed to the answer (lets UI deep-link back per Phase 5.6
 *     citation flow)
 *
 * Privacy invariant: every skill that calls llm passes
 * `acceptNonLocal: false` to the wrapper; non-local LLMs need explicit
 * opt-in from the caller (same gate as AnalysisEngine).
 */

"use strict";

class AnalysisSkill {
  constructor(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("AnalysisSkill: opts required");
    }
    if (!opts.vault) {
      throw new Error("AnalysisSkill: opts.vault required");
    }
    this.vault = opts.vault;
    this.llm = opts.llm || null; // optional
    this.name = opts.name || "unnamed";
  }

  async run(_options = {}) {
    throw new Error(`AnalysisSkill.run() not implemented for ${this.name}`);
  }

  // ─── helpers shared by skills ───────────────────────────────────────

  /**
   * Normalize a time window. Accepts:
   *   - { since, until }      ms epoch
   *   - { sinceDays }         relative (now - N days)
   *   - { sinceMonths }       relative
   * Returns `{ since, until }` ms or `{ since: null, until: null }` for
   * all-time.
   */
  resolveTimeWindow(options = {}) {
    const now = Date.now();
    if (typeof options.since === "number" && options.since > 0) {
      return {
        since: options.since,
        until: typeof options.until === "number" ? options.until : now,
      };
    }
    if (typeof options.sinceDays === "number" && options.sinceDays > 0) {
      return {
        since: now - options.sinceDays * 24 * 3600_000,
        until: now,
      };
    }
    if (typeof options.sinceMonths === "number" && options.sinceMonths > 0) {
      return {
        since: now - options.sinceMonths * 30 * 24 * 3600_000,
        until: now,
      };
    }
    return { since: null, until: null };
  }

  /**
   * Expand a personId to "all Person ids in its merge group". If
   * EntityResolver hasn't merged anyone, returns just `[personId]`.
   * Phase 8 closure utility.
   */
  expandToMergeGroup(personId) {
    if (!personId) return [];
    try {
      if (typeof this.vault.getMergeGroupMembers === "function") {
        return this.vault.getMergeGroupMembers(personId);
      }
    } catch (_e) {}
    return [personId];
  }

  /**
   * Wrap llm.chat() with the privacy gate. Returns the response text or
   * null when LLM is unavailable / non-local without opt-in.
   */
  async callLlmCommentary(messages, opts = {}) {
    if (!this.llm || typeof this.llm.chat !== "function") return null;
    if (this.llm.isLocal === false && !opts.acceptNonLocal) {
      return null;
    }
    try {
      const r = await this.llm.chat(messages, { temperature: 0.2, ...opts });
      return (r && r.text) || null;
    } catch (_e) {
      return null;
    }
  }
}

module.exports = { AnalysisSkill };
