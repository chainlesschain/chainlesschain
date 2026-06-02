/**
 * AnalysisEngine — natural-language Q&A skeleton for Personal Data Hub.
 *
 * Mirrors §8 of docs/design/Personal_Data_Hub_Architecture.md. The flow:
 *
 *   ask(question) →
 *     1. parseQuery(question)        — time window + filters + intent
 *     2. gatherFacts(parsed)         — vault.queryEvents with filters
 *        + optional ragRetriever(question)  for additional context
 *     3. buildPrompt(question, facts) → messages
 *     4. llm.chat(messages)          → text
 *     5. parseCitations(text)        — extract bracketed ids
 *     6. validateCitations(...)      — known vs hallucinated
 *     7. vault.audit(...)            — record query + facts cited
 *     8. return { answer, citations, facts, hallucinatedCitations, ... }
 *
 * Privacy invariant (§11.2): the engine refuses to call a non-local LLM
 * unless the caller passes acceptNonLocal: true. This is a hard runtime
 * gate — every layer downstream of the engine assumes locality.
 */

"use strict";

const { parseQuery, extractEntityTerm, extractPersonNameCandidate } = require("./query-parser");
const {
  buildPrompt,
  parseCitations,
  validateCitations,
  DEFAULT_SYSTEM_PROMPT,
} = require("./prompt-builder");
const { toError } = require("./adapter-spec");

const DEFAULT_MAX_FACTS = 80;
const DEFAULT_MAX_QUERY_LIMIT = 200;

// intent=latest hard cap when no time window is set. "最近的订单" / "最新消息"
// want the newest 1-3 rows, not 80 — freeing prompt budget lets the LLM
// actually read the row content instead of skimming. Memory:
// pdh_analysis_engine_intent_routing.md. When the user also gives a time
// window ("最近 30 天的消费") we treat it as list-with-window and fall
// through to the default broader path — see _gatherFacts.
const LATEST_INTENT_FACT_LIMIT = 3;

// intent=count illustrative-sample cap. The TOTALS block (vault.stats per-table
// counts) is the authoritative count and Rule 6 tells the LLM to quote it, NOT
// count FACTS — so a count question only needs a few example rows, not the full
// ≤80 sample. Hard-cap to keep prompt budget free on local small models (2-4K
// token window). See _gatherFacts intent=count branch.
const COUNT_INTENT_FACT_LIMIT = 5;

// intent=list FTS5 augmentation cap. When the question carries a probable
// entity-name ("提到王老板的消息", "苹果的订单") we run an extra
// vault.searchEvents(q=term) and append non-duplicate hits to FACTS. Cap
// at 10 so a popular term ("订单") can't drown out the adapter+time slice
// the user explicitly asked for. Stays additive (never replaces events).
const LIST_INTENT_FTS_LIMIT = 10;

// intent=sum-amount routing — the only event subtypes that carry an
// amount field worth summing. Order keeps "order" first because it's the
// most common shopping flow (taobao/jd/meituan/pdd all map to it). When
// the user asks "总共花了多少" we only want events from this set; pulling
// `message` / `visit` / `browse` would waste prompt budget on rows the
// LLM cannot use to compute a sum.
const SUM_AMOUNT_SUBTYPES = ["order", "payment", "transfer", "income"];
// Per-subtype query cap divider — split the effMaxQueryLimit across the
// 4 subtypes so a popular `payment` slice can't crowd out `transfer`.
// Floor at 20 so per-call small-model budget (effMaxQueryLimit=50 →
// 12) doesn't starve any single subtype.
const SUM_AMOUNT_MIN_PER_SUBTYPE = 20;

// entityFocus="persons" routing — explicit contact queries ("我有哪些联系人",
// "妈手机号"). When the user names the target table the engine MUST NOT
// compete persons against the events pool: small-model Android budgets
// (20 facts / 50 row cap) get drained by a few hundred Bilibili
// notifications and the contact slice ends up empty. parseEntityFocus
// surfaces the signal; we honor it by going persons-first.
//
// Keep a TINY events headroom (5%) so questions like "我最近跟妈打过电话吗"
// still surface 通话 event rows alongside the contact entry.
const PERSONS_FOCUS_EVENT_HEADROOM_RATIO = 0.05;

// Default-path budget split when no entityFocus signal. Pre-fix events
// got the entire effMaxFacts pool first and persons/items shared only the
// remainder; on a busy vault that meant 0 contacts in the prompt. Cap
// events at 70%, reserve 20% for persons and 10% for items so a generic
// "what's going on" question still sees the full data shape.
const DEFAULT_EVENT_BUDGET_RATIO = 0.7;
const DEFAULT_PERSON_BUDGET_RATIO = 0.2;
// Items take whatever remains; intent=count/list questions about contacts
// already short-circuit via entityFocus before reaching this branch.

class AnalysisEngine {
  /**
   * @param {object} opts
   * @param {import("./vault").LocalVault} opts.vault
   * @param {{chat: Function, isLocal: boolean, name?: string}} opts.llm
   * @param {(question: string, parsed: object) => Promise<Array<{text: string, metadata: object}>>} [opts.ragRetriever]
   * @param {number} [opts.maxFacts=80]
   * @param {number} [opts.maxQueryLimit=200]
   * @param {string} [opts.systemPrompt]
   */
  constructor(opts) {
    if (!opts || typeof opts !== "object") throw new Error("AnalysisEngine: opts required");
    if (!opts.vault) throw new Error("AnalysisEngine: opts.vault required");
    if (!opts.llm || typeof opts.llm.chat !== "function") {
      throw new Error("AnalysisEngine: opts.llm with .chat() required");
    }
    if (typeof opts.llm.isLocal !== "boolean") {
      throw new Error("AnalysisEngine: opts.llm.isLocal must be declared (true/false)");
    }

    this.vault = opts.vault;
    this.llm = opts.llm;
    this.ragRetriever = typeof opts.ragRetriever === "function" ? opts.ragRetriever : null;
    this.maxFacts = Number.isInteger(opts.maxFacts) && opts.maxFacts > 0 ? opts.maxFacts : DEFAULT_MAX_FACTS;
    this.maxQueryLimit =
      Number.isInteger(opts.maxQueryLimit) && opts.maxQueryLimit > 0
        ? opts.maxQueryLimit
        : DEFAULT_MAX_QUERY_LIMIT;
    this.systemPrompt = opts.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Ask a natural-language question.
   *
   * @param {string} question
   * @param {object} [options]
   * @param {boolean} [options.acceptNonLocal=false]  required true for cloud LLMs
   * @param {number} [options.now]
   * @param {boolean} [options.skipAudit=false]
   * @param {number} [options.maxFacts]                per-call override of constructor `maxFacts` (e.g. on-device 1.5B model wants ~20)
   * @param {number} [options.maxQueryLimit]           per-call override of constructor `maxQueryLimit`
   * @returns {Promise<AskResult>}
   *
   * @typedef {object} AskResult
   * @property {string} answer
   * @property {string[]} citations            event ids cited AND known
   * @property {string[]} hallucinatedCitations event ids cited but not in facts
   * @property {Array<object>} facts           facts handed to the LLM
   * @property {object} parsed                 parseQuery output
   * @property {object} usage                  { promptTokens, completionTokens, totalTokens }
   * @property {string} model
   * @property {number} durationMs
   * @property {string|null} warning           "no-facts" | "hallucinated-citations" | null
   */
  async ask(question, options = {}) {
    if (typeof question !== "string" || question.length === 0) {
      throw new Error("AnalysisEngine.ask: question must be a non-empty string");
    }
    if (!this.llm.isLocal && !options.acceptNonLocal) {
      throw new Error(
        "AnalysisEngine.ask: LLM declared non-local; pass acceptNonLocal: true to opt in. " +
          "(Personal Data Hub default policy: all inference stays on-device.)"
      );
    }

    const startedAt = Date.now();
    const parsed = parseQuery(question, { now: options.now });

    // Per-call budget overrides — on-device small models (Qwen2.5-1.5B etc.)
    // need a much tighter prompt than desktop 7B+. Fall back to constructor
    // defaults if not passed. Non-positive overrides are ignored.
    const effMaxFacts =
      Number.isInteger(options.maxFacts) && options.maxFacts > 0
        ? options.maxFacts
        : this.maxFacts;
    const effMaxQueryLimit =
      Number.isInteger(options.maxQueryLimit) && options.maxQueryLimit > 0
        ? options.maxQueryLimit
        : this.maxQueryLimit;

    // Gather facts from the vault.
    const facts = this._gatherFacts(parsed, { maxFacts: effMaxFacts, maxQueryLimit: effMaxQueryLimit });

    // Telemetry: prove the budget is reaching the engine. Goes to stderr so
    // the Android side's stderrBuilder + logcat can surface it.
    // Grep: `adb logcat | grep PDH-ASK`.
    try {
      process.stderr.write(
        `[PDH-ASK] ask effMaxFacts=${effMaxFacts} effMaxQueryLimit=${effMaxQueryLimit} ` +
          `gathered=${facts.length} (events=${facts.filter((f) => f.type === "event").length} ` +
          `persons=${facts.filter((f) => f.type === "person").length} ` +
          `items=${facts.filter((f) => f.type === "item").length}) ` +
          `adapter=${(parsed.filters && parsed.filters.adapter) || "*"} ` +
          `intent=${parsed.intent || "*"}\n`
      );
    } catch (_e) { /* stderr write failures are non-fatal */ }

    // Optional RAG augmentation.
    let ragContext = [];
    if (this.ragRetriever) {
      try {
        const docs = await this.ragRetriever(question, parsed);
        if (Array.isArray(docs)) {
          // RAG retriever returns docs with metadata.id — fetch matching entities
          // from vault for citation tracking.
          for (const doc of docs) {
            if (!doc || !doc.id) continue;
            const e = this.vault.getEvent(doc.id);
            if (e && !facts.find((f) => f.id === e.id)) {
              facts.push(e);
              ragContext.push(doc.id);
            }
          }
        }
      } catch (err) {
        // RAG failure shouldn't abort Q&A — log and continue with direct facts.
        const e = toError(err, "ragRetriever");
        try {
          this.vault.audit("analysis.rag_failed", question, { error: e.message });
        } catch (_e) {}
      }
    }

    // Build prompt.
    const { messages, factIds, factCount, truncated } = buildPrompt({
      question,
      facts,
      systemPrompt: this.systemPrompt,
      intent: parsed.intent,
      timeWindow: parsed.timeWindow,
      maxFacts: effMaxFacts,
      vaultTotals: this._gatherVaultTotals(),
      amountSummary:
        parsed.intent === "sum-amount" ? this._gatherAmountSummary(parsed) : undefined,
    });

    // Telemetry: post-cap prompt size + truncation count. If `truncated` > 0
    // the LLM is seeing fewer facts than _gatherFacts found.
    try {
      const promptChars = messages.reduce((s, m) => s + (m.content || "").length, 0);
      process.stderr.write(
        `[PDH-ASK] prompt factCount=${factCount} truncated=${truncated} ` +
          `messages=${messages.length} promptChars=${promptChars}\n`
      );
    } catch (_e) { /* non-fatal */ }

    // Call LLM. **skipCache: true** is critical: PDH answers depend on
    // current vault state (new contacts / events / items ingested between
    // asks). The desktop LLMManager has a 7-day ResponseCache keyed on
    // sha256(messages); if a stale entry from before the latest sync hits,
    // the user sees yesterday's hallucinated count after fixing _gatherFacts
    // and never finds out (real-device verify 2026-05-21 Xiaomi 24115RA8EC:
    // "几个联系人" served from cache, returned the pre-Path-C-fix wrong
    // answer of "32" even though vault now had real contact data). PDH's
    // freshness-over-latency tradeoff makes the cache strictly counter-
    // productive at this layer. The cache for OTHER LLM uses (chat /
    // skill orchestration / autonomous-agent) is unaffected.
    let llmResp;
    try {
      llmResp = await this.llm.chat(messages, {
        temperature: 0.2,
        purpose: "personal-data-hub.analysis.ask",
        skipCache: true,
      });
    } catch (err) {
      const e = toError(err, "llm.chat");
      try {
        this.vault.audit("analysis.llm_failed", question, { error: e.message });
      } catch (_e) {}
      throw e;
    }

    const answer = (llmResp && typeof llmResp.text === "string") ? llmResp.text : "";

    // Parse + validate citations.
    const cited = parseCitations(answer);
    const { known, unknown } = validateCitations(cited, factIds);

    // Warnings.
    let warning = null;
    if (factCount === 0) warning = "no-facts";
    else if (unknown.length > 0) warning = "hallucinated-citations";

    const durationMs = Date.now() - startedAt;
    const usage = llmResp.usage || {};

    if (!options.skipAudit) {
      try {
        this.vault.audit("analysis.ask", question, {
          factCount,
          truncated,
          citationsKnown: known.length,
          citationsUnknown: unknown.length,
          warning,
          durationMs,
          model: this.llm.name || (llmResp && llmResp.model),
        });
      } catch (_e) {}
    }

    return {
      answer,
      citations: known,
      hallucinatedCitations: unknown,
      facts,
      ragContextIds: ragContext,
      parsed,
      usage,
      model: this.llm.name || (llmResp && llmResp.model) || "unknown",
      durationMs,
      warning,
    };
  }

  /**
   * Retrieve the prompt context for a question WITHOUT calling the LLM.
   *
   * Mirrors the front half of `ask()` (parseQuery → gatherFacts → ragRetriever
   * → buildPrompt) and returns the assembled messages + facts. The caller is
   * responsible for invoking its own LLM with the returned messages and then
   * (optionally) running citation validation on the answer.
   *
   * Why: lets a mobile / browser front-end host the LLM call locally (e.g.
   * Android-side Volcengine Doubao adapter via API key) while keeping the
   * vault + retrieval on the desktop. The privacy gate does NOT apply here
   * because no LLM is contacted — the caller's gate is the gate.
   *
   * @param {string} question
   * @param {object} [options]
   * @param {number} [options.now]
   * @param {boolean} [options.skipAudit=false]
   * @param {number} [options.maxFacts]                per-call override (small-model budget)
   * @param {number} [options.maxQueryLimit]           per-call override
   * @returns {Promise<RetrieveContextResult>}
   *
   * @typedef {object} RetrieveContextResult
   * @property {string} question
   * @property {object} parsed
   * @property {Array<object>} facts
   * @property {string[]} factIds
   * @property {number} factCount
   * @property {number} truncated   Count of facts dropped at the maxFacts cap (0 = nothing truncated)
   * @property {string[]} ragContextIds
   * @property {Array<{role: string, content: string}>} messages   prompt-builder output, LLM-ready
   * @property {string} systemPrompt
   * @property {number} retrievedAt                                Date.now() at start
   * @property {number} durationMs
   */
  async retrieveContext(question, options = {}) {
    if (typeof question !== "string" || question.length === 0) {
      throw new Error("AnalysisEngine.retrieveContext: question must be a non-empty string");
    }

    const startedAt = Date.now();
    const parsed = parseQuery(question, { now: options.now });

    const effMaxFacts =
      Number.isInteger(options.maxFacts) && options.maxFacts > 0
        ? options.maxFacts
        : this.maxFacts;
    const effMaxQueryLimit =
      Number.isInteger(options.maxQueryLimit) && options.maxQueryLimit > 0
        ? options.maxQueryLimit
        : this.maxQueryLimit;

    const facts = this._gatherFacts(parsed, { maxFacts: effMaxFacts, maxQueryLimit: effMaxQueryLimit });

    const ragContextIds = [];
    if (this.ragRetriever) {
      try {
        const docs = await this.ragRetriever(question, parsed);
        if (Array.isArray(docs)) {
          for (const doc of docs) {
            if (!doc || !doc.id) continue;
            const e = this.vault.getEvent(doc.id);
            if (e && !facts.find((f) => f.id === e.id)) {
              facts.push(e);
              ragContextIds.push(doc.id);
            }
          }
        }
      } catch (err) {
        const e = toError(err, "ragRetriever");
        try {
          this.vault.audit("analysis.rag_failed", question, { error: e.message });
        } catch (_e) { /* audit failures are non-fatal */ }
      }
    }

    const { messages, factIds, factCount, truncated } = buildPrompt({
      question,
      facts,
      systemPrompt: this.systemPrompt,
      intent: parsed.intent,
      timeWindow: parsed.timeWindow,
      maxFacts: effMaxFacts,
      vaultTotals: this._gatherVaultTotals(),
      amountSummary:
        parsed.intent === "sum-amount" ? this._gatherAmountSummary(parsed) : undefined,
    });

    const durationMs = Date.now() - startedAt;

    if (!options.skipAudit) {
      try {
        this.vault.audit("analysis.retrieve_context", question, {
          factCount,
          truncated,
          ragContextIds: ragContextIds.length,
          durationMs,
        });
      } catch (_e) { /* audit failures are non-fatal */ }
    }

    return {
      question,
      parsed,
      facts,
      // buildPrompt returns factIds as a Set; flatten to Array so the result
      // round-trips through IPC / WS JSON serialization without becoming `{}`.
      factIds: Array.from(factIds),
      factCount,
      truncated,
      ragContextIds,
      messages,
      systemPrompt: this.systemPrompt,
      retrievedAt: startedAt,
      durationMs,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────

  _gatherFacts(parsed, budget = {}) {
    // Per-call budget overrides constructor defaults — small-model callers
    // (Android Qwen2.5-1.5B) pass tighter caps here.
    const effMaxFacts =
      Number.isInteger(budget.maxFacts) && budget.maxFacts > 0
        ? budget.maxFacts
        : this.maxFacts;
    const effMaxQueryLimit =
      Number.isInteger(budget.maxQueryLimit) && budget.maxQueryLimit > 0
        ? budget.maxQueryLimit
        : this.maxQueryLimit;

    // Intent routing — intent=latest WITHOUT a time window means "newest
    // few" (e.g. "最近的订单", "最新消息"). Hard-cap to
    // LATEST_INTENT_FACT_LIMIT and skip persons/items entirely: the user
    // is asking about an event timeline, not their contact list.
    //
    // When timeWindow IS set ("最近 30 天的消费" hits BOTH parseTimeWindow
    // AND intent=latest), fall through to the default list-with-window
    // path — a user asking for 30 days doesn't want 3 newest rows.
    //
    // Fallback: if the targeted query returns 0 events, fall through to
    // the broader default behavior. Protects against low-confidence
    // classifier picks (see pdh_analysis_engine_intent_routing memory).
    if (parsed.intent === "latest" && !parsed.timeWindow) {
      const latestQ = {
        limit: Math.min(LATEST_INTENT_FACT_LIMIT, effMaxFacts),
      };
      if (parsed.filters && parsed.filters.adapter) {
        latestQ.adapter = parsed.filters.adapter;
      }
      const latestEvents = this.vault.queryEvents(latestQ);
      if (latestEvents.length > 0) return latestEvents;
      // 0 results → fall through to default broader path below.
    }

    // entityFocus=persons routing — "我有哪些联系人", "妈手机号", "通讯录里
    // 有多少人". Skip the events broad scan and put the entire fact budget
    // on the persons table (with a 5% events headroom for adjacent rows
    // like 通话/短信). Adapter / time window are NOT applied to persons:
    // contacts are current-state snapshots, not time-stamped events.
    //
    // 0 hits → fall through to the default path. A user might say "联系人"
    // colloquially when they mean "people I've messaged" — the default
    // events+persons mix is the right safety net.
    if (parsed.entityFocus === "persons") {
      const personLimit = effMaxFacts > 1 ? effMaxFacts - 1 : effMaxFacts;
      let persons = [];
      // Name-search short-circuit — when the question carries a probable
      // person-name candidate ("妈手机号", "张三的电话"), try LIKE-search
      // against names / identifiers / notes / relation. Hits go straight
      // to FACTS so the LLM sees the target contact even when the vault
      // holds hundreds of others. Falls back to ingest-ordered queryPersons
      // when 0 hits or no name candidate.
      const nameCandidate = extractPersonNameCandidate(parsed.raw);
      if (nameCandidate && typeof this.vault.searchPersons === "function") {
        try {
          persons = this.vault.searchPersons({ q: nameCandidate, limit: personLimit });
        } catch (_e) { /* tolerate — try ingest-ordered fallback */ }
      }
      if (persons.length === 0) {
        try {
          persons = this.vault.queryPersons({ limit: personLimit });
        } catch (_e) {
          // legacy vault — fall through
        }
      }
      if (persons.length > 0) {
        const eventHeadroom = Math.max(
          0,
          Math.floor(effMaxFacts * PERSONS_FOCUS_EVENT_HEADROOM_RATIO)
        );
        let events = [];
        if (eventHeadroom > 0) {
          const eq = { limit: eventHeadroom };
          if (parsed.filters && parsed.filters.adapter) eq.adapter = parsed.filters.adapter;
          if (parsed.timeWindow) {
            if (Number.isFinite(parsed.timeWindow.since)) eq.since = parsed.timeWindow.since;
            if (Number.isFinite(parsed.timeWindow.until)) eq.until = parsed.timeWindow.until;
          }
          try {
            events = this.vault.queryEvents(eq);
          } catch (_e) { /* tolerate */ }
        }
        // persons-first ordering so the LLM reads the contact rows before
        // the (sparse) event tail.
        const combined = [...persons, ...events].slice(0, effMaxFacts);
        return combined;
      }
      // 0 persons → fall through.
    }

    // entityFocus=items routing — "我装了哪些 app", "有哪些游戏". Mirror
    // persons branch: skip events, query items table directly, keep a
    // tiny events headroom for adjacent rows.
    if (parsed.entityFocus === "items") {
      const itemLimit = effMaxFacts > 1 ? effMaxFacts - 1 : effMaxFacts;
      let items = [];
      try {
        items = this.vault.queryItems({ limit: itemLimit });
      } catch (_e) { /* legacy */ }
      if (items.length > 0) {
        const eventHeadroom = Math.max(
          0,
          Math.floor(effMaxFacts * PERSONS_FOCUS_EVENT_HEADROOM_RATIO)
        );
        let events = [];
        if (eventHeadroom > 0) {
          const eq = { limit: eventHeadroom };
          if (parsed.filters && parsed.filters.adapter) eq.adapter = parsed.filters.adapter;
          try {
            events = this.vault.queryEvents(eq);
          } catch (_e) { /* tolerate */ }
        }
        return [...items, ...events].slice(0, effMaxFacts);
      }
    }

    // intent=count routing — "我有多少订单 / 多少条记录". The TOTALS block
    // (vault.stats per-table counts) already carries the authoritative number
    // and Rule 6 tells the LLM to quote it, NOT count FACTS. Pulling the full
    // effMaxFacts (≤80) event sample is wasted prompt budget — expensive on
    // local small models (2-4K token window). Hard-cap to COUNT_INTENT_FACT_LIMIT
    // illustrative rows so the model can cite a couple examples without burning
    // the budget.
    //
    // Adapter + time window pass through (reliable filters); subtype does NOT
    // (keyword classifier too crude — same rationale as sum-amount). Skip
    // persons/items: count of contacts / apps routes via entityFocus above.
    //
    // 0 hits → fall through to the default broader path (safety net for a
    // low-confidence count misclassification of a list question), same as the
    // latest branch.
    if (parsed.intent === "count") {
      const countQ = { limit: Math.min(COUNT_INTENT_FACT_LIMIT, effMaxFacts) };
      if (parsed.filters && parsed.filters.adapter) countQ.adapter = parsed.filters.adapter;
      if (parsed.timeWindow) {
        if (Number.isFinite(parsed.timeWindow.since)) countQ.since = parsed.timeWindow.since;
        if (Number.isFinite(parsed.timeWindow.until)) countQ.until = parsed.timeWindow.until;
      }
      const countEvents = this.vault.queryEvents(countQ);
      if (countEvents.length > 0) return countEvents;
      // 0 results → fall through to default broader path below.
    }

    // intent=sum-amount routing — "总共花了多少" / "在淘宝花了多少钱"
    // only needs events from amount-bearing subtypes (order/payment/
    // transfer/income). Pulling messages / visits / browses wastes
    // prompt budget on rows the LLM can't aggregate into a sum.
    //
    // We split the budget across the 4 subtypes (min 20 each, floor),
    // union the results, dedup by id (an event would only appear once
    // anyway since subtype is unique per event — defensive), and sort
    // by occurredAt DESC. Adapter + time window are passed through so
    // "上个月在淘宝总共花了多少" stays scoped.
    //
    // Skip persons/items — they don't carry amounts.
    //
    // 0 hits → return EMPTY (do NOT fall through). If the user asks
    // "总共花了多少" and the vault has zero amount-bearing events under
    // adapter+time scope, the default path would pull messages / visits /
    // browsing rows the LLM might wrongly try to sum. Empty FACTS +
    // warning="no-facts" + TOTALS preamble lets the model say "找不到
    // 相关花费记录" cleanly. This diverges from latest's fallback (which
    // surfaces persons/items for general "what's recent" context); for
    // sum-amount that fallback would actively mislead.
    if (parsed.intent === "sum-amount") {
      const perSubtype = Math.max(
        SUM_AMOUNT_MIN_PER_SUBTYPE,
        Math.floor(effMaxQueryLimit / SUM_AMOUNT_SUBTYPES.length)
      );
      const seen = new Set();
      const amountEvents = [];
      for (const sub of SUM_AMOUNT_SUBTYPES) {
        const subQ = { limit: perSubtype, subtype: sub };
        if (parsed.filters && parsed.filters.adapter) {
          subQ.adapter = parsed.filters.adapter;
        }
        if (parsed.timeWindow) {
          if (Number.isFinite(parsed.timeWindow.since)) subQ.since = parsed.timeWindow.since;
          if (Number.isFinite(parsed.timeWindow.until)) subQ.until = parsed.timeWindow.until;
        }
        const rows = this.vault.queryEvents(subQ);
        for (const e of rows) {
          if (e && e.id && !seen.has(e.id)) {
            seen.add(e.id);
            amountEvents.push(e);
          }
        }
      }
      amountEvents.sort((a, b) => (b.occurredAt || 0) - (a.occurredAt || 0));
      return amountEvents.slice(0, effMaxFacts);
    }

    // Deliberately do NOT pass parsed.filters.subtype as a vault filter:
    // the keyword heuristic (`order` vs `payment` vs `transfer`) is too
    // crude to reliably narrow without false negatives. E.g. a user
    // asking "在淘宝花了多少" wants taobao-adapter ORDER events; the
    // keyword parser picks `payment` and would over-filter to zero rows.
    // Instead we filter by adapter + time window (both reliable) and
    // pass the subtype/intent into the prompt as a HINT for the LLM to
    // apply on prose. The LLM is good at filtering; SQL keyword guessing
    // is brittle.
    const q = {
      limit: effMaxQueryLimit,
    };
    if (parsed.filters && parsed.filters.adapter) q.adapter = parsed.filters.adapter;
    if (parsed.timeWindow) {
      if (Number.isFinite(parsed.timeWindow.since)) q.since = parsed.timeWindow.since;
      if (Number.isFinite(parsed.timeWindow.until)) q.until = parsed.timeWindow.until;
    }
    const events = this.vault.queryEvents(q);

    // intent=list + entity-name FTS5 augmentation — when the question
    // carries a probable entity-name candidate ("提到王老板的消息",
    // "苹果的订单"), run an extra vault.searchEvents(q=term) and append
    // hits not already in `events`. Adapter + time window are passed
    // through so the FTS slice stays consistent with the main query.
    //
    // Strictly additive: the FTS hits are appended to `events` (no
    // replacement). Wrong term extraction at worst returns 0 rows; FTS
    // errors are swallowed — main path (events + persons + items) stays
    // intact. See pdh_analysis_engine_intent_routing.md.
    //
    // Skipped for intent ∈ {count, sum-amount, latest}:
    //   - count uses TOTALS preamble; FACTS sample doesn't need padding
    //   - sum-amount is value-aggregation; entity-name hits don't help
    //   - latest already returned earlier via narrow path
    if (
      parsed.intent === "list" &&
      typeof this.vault.searchEvents === "function"
    ) {
      const entityTerm = extractEntityTerm(parsed.raw);
      if (entityTerm) {
        const headroom = effMaxFacts - events.length;
        if (headroom > 0) {
          try {
            const ftsQ = {
              q: entityTerm,
              limit: Math.min(headroom, LIST_INTENT_FTS_LIMIT),
            };
            if (parsed.filters && parsed.filters.adapter) {
              ftsQ.adapter = parsed.filters.adapter;
            }
            if (parsed.timeWindow) {
              if (Number.isFinite(parsed.timeWindow.since)) ftsQ.since = parsed.timeWindow.since;
              if (Number.isFinite(parsed.timeWindow.until)) ftsQ.until = parsed.timeWindow.until;
            }
            const ftsResult = this.vault.searchEvents(ftsQ);
            if (ftsResult && Array.isArray(ftsResult.rows)) {
              const existingIds = new Set(events.map((e) => e.id));
              for (const row of ftsResult.rows) {
                if (row && row.id && !existingIds.has(row.id)) {
                  events.push(row);
                  existingIds.add(row.id);
                }
              }
            }
          } catch (_e) {
            // FTS failure is non-fatal — main events array already populated.
          }
        }
      }
    }

    // Path C follow-up — events alone miss whole categories of facts:
    //  - contacts (system-data-android) land in `persons`, not `events`
    //  - installed apps land in `items`, not `events`
    //  - places (visited locations) live in `places`
    // Without these the LLM gets 0 facts for "我有几个联系人" style questions
    // and hallucinates a count.
    //
    // Sizing — two regimes:
    //  (a) Events fit (events.length < effMaxFacts): legacy behavior —
    //      events first, split the remainder evenly between persons + items.
    //  (b) Events would monopolize (events.length >= effMaxFacts): reserve
    //      DEFAULT_PERSON_BUDGET_RATIO (20%) + 10% for persons + items so a
    //      busy event timeline doesn't shove every contact out of the prompt.
    //      If persons + items tables BOTH return 0 rows, refill the reserve
    //      with events — no point starving the LLM of facts when the side
    //      tables are empty (small vaults / pre-Path-C ingest state).
    //
    // Time window + adapter filters don't apply to persons/items: they're
    // current-state snapshots, not time-stamped events. A user asking
    // "上个月联系人变化" is rare enough to leave for a future intent.
    let cappedEvents = events;
    let personBudget;
    let itemBudget;
    if (events.length >= effMaxFacts) {
      const personReserve = Math.max(1, Math.floor(effMaxFacts * DEFAULT_PERSON_BUDGET_RATIO));
      const itemReserve = Math.max(
        1,
        Math.floor(effMaxFacts * (1 - DEFAULT_EVENT_BUDGET_RATIO - DEFAULT_PERSON_BUDGET_RATIO))
      );
      const eventCap = Math.max(1, effMaxFacts - personReserve - itemReserve);
      cappedEvents = events.slice(0, eventCap);
      personBudget = personReserve;
      itemBudget = itemReserve;
    } else {
      const remaining = effMaxFacts - events.length;
      const sideBudget = Math.floor(remaining / 2);
      personBudget = sideBudget > 0 ? sideBudget : 0;
      itemBudget = remaining - personBudget;
    }

    let persons = [];
    if (personBudget > 0) {
      try {
        persons = this.vault.queryPersons({ limit: personBudget });
      } catch (_e) {
        // Older vaults / forks without queryPersons — fall back gracefully.
      }
    }
    let items = [];
    if (itemBudget > 0) {
      try {
        items = this.vault.queryItems({ limit: itemBudget });
      } catch (_e) {
        /* same fallback */
      }
    }

    // Refill backfill — when events overflowed (reservation branch) but
    // persons + items both returned 0 rows, give the reserved slots back
    // to events. Small vaults / pre-Path-C state would otherwise see fewer
    // facts than the budget allowed.
    if (
      events.length >= effMaxFacts &&
      persons.length === 0 &&
      items.length === 0 &&
      cappedEvents.length < effMaxFacts
    ) {
      cappedEvents = events.slice(0, effMaxFacts);
    }

    return [...cappedEvents, ...persons, ...items];
  }

  /**
   * Pull authoritative entity counts from the vault. These go into the
   * prompt's TOTALS block so the LLM can answer "how many X" questions
   * correctly even when the FACTS sample is truncated (maxFacts cap).
   *
   * 2026-05-21 bug: LLM said "32 contacts" when vault actually had ~500.
   * Root cause was a mix of (a) FACTS not including persons (fixed in
   * _gatherFacts), and (b) LLM still counting FACTS array length even after
   * persons were included — capped at the 80-fact ceiling. TOTALS bypasses
   * both: it gives the LLM the real number to quote directly.
   *
   * Wrapped in try because legacy vault forks / mock vaults in tests may
   * not expose `stats()`; falling back to undefined makes prompt-builder
   * skip the block entirely.
   */
  /**
   * intent=sum-amount Phase 2: pull the authoritative amount total from the
   * vault (SQL SUM, not a FACTS sample) so prompt-builder can emit an
   * AMOUNT_SUM block. Scoped by adapter + time window (same reliable filters
   * _gatherFacts uses; subtype is intentionally NOT passed — the keyword
   * classifier is too crude, and non-amount events are excluded by the SUM
   * anyway). Returns undefined when there's nothing to sum (count===0) so the
   * block is omitted rather than showing a misleading ¥0.
   */
  _gatherAmountSummary(parsed) {
    if (typeof this.vault.sumEventAmount !== "function") return undefined;
    try {
      const f = {};
      if (parsed.filters && parsed.filters.adapter) f.adapter = parsed.filters.adapter;
      if (parsed.timeWindow) {
        if (Number.isFinite(parsed.timeWindow.since)) f.since = parsed.timeWindow.since;
        if (Number.isFinite(parsed.timeWindow.until)) f.until = parsed.timeWindow.until;
      }
      const r = this.vault.sumEventAmount(f);
      if (!r || !r.count) return undefined;
      return r;
    } catch (_e) {
      return undefined;
    }
  }

  _gatherVaultTotals() {
    if (typeof this.vault.stats !== "function") return undefined;
    try {
      const s = this.vault.stats();
      // Trim to the fields useful for question answering — schemaVersion /
      // mergeGroups / audit log size are noise here.
      return {
        events: s.events,
        persons: s.persons,
        places: s.places,
        items: s.items,
        topics: s.topics,
      };
    } catch (_e) {
      return undefined;
    }
  }
}

module.exports = {
  AnalysisEngine,
  DEFAULT_MAX_FACTS,
  DEFAULT_MAX_QUERY_LIMIT,
  LATEST_INTENT_FACT_LIMIT,
  COUNT_INTENT_FACT_LIMIT,
  LIST_INTENT_FTS_LIMIT,
  SUM_AMOUNT_SUBTYPES,
  SUM_AMOUNT_MIN_PER_SUBTYPE,
  PERSONS_FOCUS_EVENT_HEADROOM_RATIO,
  DEFAULT_EVENT_BUDGET_RATIO,
  DEFAULT_PERSON_BUDGET_RATIO,
};
