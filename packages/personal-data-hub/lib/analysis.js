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

    // Call LLM.
    let llmResp;
    try {
      llmResp = await this.llm.chat(messages, {
        temperature: 0.2,
        purpose: "personal-data-hub.analysis.ask",
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
    return this.vault.queryEvents(q);
  }
}

module.exports = {
  AnalysisEngine,
  DEFAULT_MAX_FACTS,
  DEFAULT_MAX_QUERY_LIMIT,
};
