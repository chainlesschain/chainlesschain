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

const { parseQuery } = require("./query-parser");
const {
  buildPrompt,
  parseCitations,
  validateCitations,
  DEFAULT_SYSTEM_PROMPT,
} = require("./prompt-builder");
const { toError } = require("./adapter-spec");

const DEFAULT_MAX_FACTS = 80;
const DEFAULT_MAX_QUERY_LIMIT = 200;

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

    // Gather facts from the vault.
    const facts = this._gatherFacts(parsed);

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
      maxFacts: this.maxFacts,
    });

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
   * @returns {Promise<RetrieveContextResult>}
   *
   * @typedef {object} RetrieveContextResult
   * @property {string} question
   * @property {object} parsed
   * @property {Array<object>} facts
   * @property {string[]} factIds
   * @property {number} factCount
   * @property {boolean} truncated
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
    const facts = this._gatherFacts(parsed);

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
      maxFacts: this.maxFacts,
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

  _gatherFacts(parsed) {
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
      limit: this.maxQueryLimit,
    };
    if (parsed.filters && parsed.filters.adapter) q.adapter = parsed.filters.adapter;
    if (parsed.timeWindow) {
      if (Number.isFinite(parsed.timeWindow.since)) q.since = parsed.timeWindow.since;
      if (Number.isFinite(parsed.timeWindow.until)) q.until = parsed.timeWindow.until;
    }
    const events = this.vault.queryEvents(q);

    // Path C follow-up — events alone miss whole categories of facts:
    //  - contacts (system-data-android) land in `persons`, not `events`
    //  - installed apps land in `items`, not `events`
    //  - places (visited locations) live in `places`
    // Without these the LLM gets 0 facts for "我有几个联系人" style questions
    // and hallucinates a count. We pull a bounded slice of each entity type
    // and append; prompt-builder.summarizeFact already handles `person` /
    // `place` / fallback `item` shapes, so this is additive with no schema
    // change to the LLM-facing prompt.
    //
    // Sizing: keep events as the majority (existing behavior is unchanged for
    // event-heavy queries like 消费 / 通话); split the remaining 1/2 budget
    // between persons + items. Time window + adapter filters don't apply to
    // these tables (persons aren't time-stamped events) — they're current-
    // state snapshots that should always be visible. Adapter filter is also
    // skipped because users asking "我有几个联系人" don't say "from
    // system-data-android".
    const remaining = Math.max(0, this.maxFacts - events.length);
    const sideBudget = Math.floor(remaining / 2);
    const personBudget = sideBudget > 0 ? sideBudget : 0;
    const itemBudget = remaining - personBudget;

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

    return [...events, ...persons, ...items];
  }
}

module.exports = {
  AnalysisEngine,
  DEFAULT_MAX_FACTS,
  DEFAULT_MAX_QUERY_LIMIT,
};
