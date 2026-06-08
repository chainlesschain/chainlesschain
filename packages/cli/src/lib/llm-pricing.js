/**
 * llm-pricing — turn token counts into estimated $ cost.
 *
 * Layers a price table on top of the token roll-ups produced by
 * `session-usage.js`, so `cc cost` can show spend per provider/model.
 *
 * IMPORTANT: these rates are ESTIMATES of public list prices (USD per 1M
 * tokens) and drift over time. Local providers (ollama / local) are free.
 * An unmatched model is reported as `matched:false` with zero cost rather
 * than guessed — the caller surfaces it as "unpriced" so the number is never
 * silently wrong. Override or extend PRICE_TABLE below as prices change.
 *
 * Rate shape: { in: <USD per 1M input tokens>, out: <USD per 1M output> }.
 * Matching is provider-scoped, longest-pattern-first, case-insensitive
 * substring against the model id.
 */

/** Providers whose models run locally and cost nothing to call. */
export const FREE_PROVIDERS = Object.freeze([
  "ollama",
  "local",
  "llamacpp",
  "mediapipe",
]);

/**
 * Per-provider model price patterns. Each entry: { match, in, out }.
 * Order within a provider matters — more specific patterns first so
 * "gpt-4o-mini" is not shadowed by "gpt-4o".
 */
export const PRICE_TABLE = Object.freeze({
  anthropic: [
    { match: "opus", in: 15, out: 75 },
    { match: "sonnet", in: 3, out: 15 },
    { match: "haiku", in: 1, out: 5 },
  ],
  openai: [
    { match: "gpt-4o-mini", in: 0.15, out: 0.6 },
    { match: "gpt-4o", in: 2.5, out: 10 },
    { match: "gpt-4-turbo", in: 10, out: 30 },
    { match: "gpt-4", in: 30, out: 60 },
    { match: "gpt-3.5", in: 0.5, out: 1.5 },
    { match: "o1-mini", in: 1.1, out: 4.4 },
    { match: "o1", in: 15, out: 60 },
  ],
  deepseek: [
    { match: "reasoner", in: 0.55, out: 2.19 },
    { match: "chat", in: 0.27, out: 1.1 },
  ],
  // Volcengine Doubao — rough USD conversion of public RMB list pricing.
  volcengine: [
    { match: "seed-1-6", in: 0.11, out: 0.28 },
    { match: "seed", in: 0.11, out: 0.28 },
    { match: "pro", in: 0.11, out: 0.28 },
    { match: "lite", in: 0.04, out: 0.08 },
    { match: "doubao", in: 0.11, out: 0.28 },
  ],
});

const round = (n, dp = 6) => {
  const f = Math.pow(10, dp);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

/**
 * Merge user-supplied price overrides (typically `config.llm.pricing`) onto the
 * built-in table. Override shape mirrors PRICE_TABLE:
 *   { "<provider>": [ { match: "<substr>", in: <num>, out: <num> }, ... ] }
 *
 * Per provider, a user entry whose `match` equals a built-in pattern REPLACES
 * it; brand-new patterns are prepended so they win ties; unknown providers are
 * added. Malformed entries (missing match / non-numeric rate) are skipped so a
 * bad config line can't crash cost reporting. Returns a new table; never
 * mutates PRICE_TABLE or the input.
 *
 * @param {object} [overrides]
 * @param {object} [base=PRICE_TABLE]
 * @returns {object} merged price table
 */
export function mergePricing(overrides, base = PRICE_TABLE) {
  const merged = {};
  for (const [p, entries] of Object.entries(base)) {
    merged[p] = entries.map((e) => ({ ...e }));
  }
  if (!overrides || typeof overrides !== "object") return merged;

  for (const [provider, rawEntries] of Object.entries(overrides)) {
    if (!Array.isArray(rawEntries)) continue;
    const valid = rawEntries
      .filter(
        (e) =>
          e &&
          typeof e.match === "string" &&
          e.match.trim() &&
          Number.isFinite(Number(e.in)) &&
          Number.isFinite(Number(e.out)),
      )
      .map((e) => ({
        match: e.match.toLowerCase(),
        in: Number(e.in),
        out: Number(e.out),
      }));
    if (valid.length === 0) continue;
    const overridden = new Set(valid.map((v) => v.match));
    const kept = (merged[provider] || []).filter(
      (e) => !overridden.has(e.match.toLowerCase()),
    );
    merged[provider] = [...valid, ...kept];
  }
  return merged;
}

/**
 * Look up the rate for a provider/model, or null if unpriced.
 * @param {string} provider
 * @param {string} model
 * @param {object} [table=PRICE_TABLE] merged table from mergePricing()
 * @returns {{ in:number, out:number, pattern:string }|null}
 */
export function lookupRate(provider, model, table = PRICE_TABLE) {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();
  if (FREE_PROVIDERS.includes(p)) {
    return { in: 0, out: 0, pattern: "free" };
  }
  const entries = (table || PRICE_TABLE)[p];
  if (!entries) return null;
  // Longest pattern first so specific beats generic regardless of table order.
  const sorted = [...entries].sort((a, b) => b.match.length - a.match.length);
  for (const e of sorted) {
    if (m.includes(e.match)) {
      return { in: e.in, out: e.out, pattern: e.match };
    }
  }
  return null;
}

/**
 * Estimate cost for a single usage record.
 * @returns {{ inputCost:number, outputCost:number, totalCost:number,
 *             currency:string, matched:boolean, free:boolean, rate:object|null }}
 */
export function estimateCost({
  provider,
  model,
  inputTokens = 0,
  outputTokens = 0,
  table,
} = {}) {
  const rate = lookupRate(provider, model, table);
  if (!rate) {
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      currency: "USD",
      matched: false,
      free: false,
      rate: null,
    };
  }
  const inputCost = round((Number(inputTokens) / 1e6) * rate.in);
  const outputCost = round((Number(outputTokens) / 1e6) * rate.out);
  return {
    inputCost,
    outputCost,
    totalCost: round(inputCost + outputCost),
    currency: "USD",
    matched: true,
    free: rate.pattern === "free",
    rate: { in: rate.in, out: rate.out, pattern: rate.pattern },
  };
}

/**
 * Augment a session-usage aggregate ({ total, byModel:[...] }) with cost.
 * Returns a new object — does not mutate the input.
 *
 * Each byModel row gains: cost, currency, matched. The returned `cost`
 * top-level sums priced rows; `unpriced` lists provider/model rows that had
 * usage but no matching rate (their tokens are excluded from `cost.totalCost`).
 */
export function priceRollup(aggregate, { table } = {}) {
  const byModel = (aggregate?.byModel || []).map((row) => {
    const est = estimateCost({
      provider: row.provider,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      table,
    });
    return {
      ...row,
      cost: est.totalCost,
      inputCost: est.inputCost,
      outputCost: est.outputCost,
      currency: est.currency,
      matched: est.matched,
      free: est.free,
    };
  });

  let totalCost = 0;
  const unpriced = [];
  for (const row of byModel) {
    if (row.matched) {
      totalCost = round(totalCost + row.cost);
    } else if (row.totalTokens > 0) {
      unpriced.push({
        provider: row.provider,
        model: row.model,
        totalTokens: row.totalTokens,
      });
    }
  }

  return {
    ...aggregate,
    byModel,
    cost: {
      totalCost,
      currency: "USD",
      unpricedCount: unpriced.length,
    },
    unpriced,
  };
}
