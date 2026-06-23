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
   * The set of person ids that represent "self" (the account/device owner) —
   * to be excluded from contact rankings (you are not your own top contact).
   *
   * Recognized two ways:
   *   1) canonical self ids: `person-self`, `person-<adapter>-self`
   *   2) legacy hashed-self: actors of self-authored events (`extra.isSend=1`).
   *      WeChat collections historically set self = `person-wechat-<accountUin>`
   *      where accountUin was an md5/uin/wxid that varied per collection run —
   *      fragmenting "self" into several fake top contacts. isSend recovers
   *      every such representation without re-collecting.
   *
   * Cached per skill instance. Best-effort: on any error falls back to the
   * literal `person-self`.
   */
  _selfPersonIds() {
    if (this.__selfIds) return this.__selfIds;
    const ids = new Set(["person-self"]);
    try {
      const db =
        typeof this.vault._requireOpen === "function" ? this.vault._requireOpen() : null;
      if (db) {
        const rows = db
          .prepare(
            "SELECT DISTINCT actor AS id FROM events WHERE actor IS NOT NULL AND " +
              "(actor = 'person-self' OR actor LIKE 'person-%-self' OR " +
              "json_extract(extra, '$.isSend') = 1)"
          )
          .all();
        for (const r of rows) if (r.id) ids.add(r.id);
      }
    } catch (_e) {
      /* best-effort — keep the literal self id only */
    }
    this.__selfIds = ids;
    return ids;
  }

  /** True if `personId` is the account/device owner (see {@link _selfPersonIds}). */
  _isSelf(personId) {
    if (!personId) return true; // empty/missing → not a real contact
    if (personId === "person-self") return true;
    if (/^person-[a-z0-9-]+-self$/i.test(personId)) return true;
    return this._selfPersonIds().has(personId);
  }

  /**
   * True if `personId` is a real *other person* worth ranking as a contact —
   * i.e. a `person-…` id that is not self and not a group/topic conversation.
   * Group ids (`group-…`, `topic-…`) are conversations, not people, and have
   * no person name — they pollute "top contacts" as unnamed/null rows.
   */
  _isPersonContact(personId) {
    if (typeof personId !== "string" || personId.length === 0) return false;
    if (personId.startsWith("group-") || personId.startsWith("topic-")) return false;
    // Some collections keyed group conversations as `person-wechat-<id>@chatroom`
    // (group marker leaked into a person id) — those are rooms, not people.
    if (personId.includes("@chatroom") || personId.endsWith("@im.group")) return false;
    return !this._isSelf(personId);
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
