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
    // Current Anthropic list prices (USD per 1M tokens), verified 2026-06-21
    // against the claude-api reference. The Opus tier dropped to $5/$25 with
    // Opus 4.5 (Nov 2025) — the old $15/$75 applies only to the retired
    // Opus 4 / 4.1. Longest-pattern-first matching (see matchRate) resolves
    // dated ids to the specific rate; bare "opus" defaults to the current price.
    { match: "fable-5", in: 10, out: 50 },
    { match: "mythos-5", in: 10, out: 50 },
    { match: "opus-4-8", in: 5, out: 25 },
    { match: "opus-4-7", in: 5, out: 25 },
    { match: "opus-4-6", in: 5, out: 25 },
    { match: "opus-4-5", in: 5, out: 25 },
    { match: "opus-4-1", in: 15, out: 75 },
    { match: "opus", in: 5, out: 25 },
    { match: "sonnet", in: 3, out: 15 },
    { match: "haiku", in: 1, out: 5 },
  ],
  openai: [
    // GPT-5 family (2026). Matching is longest-pattern-first, so dated/variant
    // ids (gpt-5.5, gpt-5.5-pro, gpt-5.5-instant, …) resolve to the most
    // specific rate; bare "gpt-5" is the catch-all base rate.
    { match: "gpt-5.5-pro", in: 30, out: 180 },
    { match: "gpt-5.5", in: 5, out: 30 },
    { match: "gpt-5.4", in: 2.5, out: 15 },
    { match: "gpt-5-mini", in: 0.25, out: 2 },
    { match: "gpt-5-nano", in: 0.05, out: 0.4 },
    { match: "gpt-5", in: 1.25, out: 10 },
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
    // Doubao Seed 2.0 family (2026, e.g. doubao-seed-2-0-lite-260215) is
    // natively multimodal. Rates ≈ official CNY ÷ ~7.2 (lite ≤32k is 0.6/3.6
    // CNY → $0.08/$0.50); the generic "seed" rate below underprices 2.0 output.
    { match: "seed-2-0-pro", in: 0.5, out: 2.5 },
    { match: "seed-2-0-lite", in: 0.08, out: 0.5 },
    { match: "seed-2-0-mini", in: 0.03, out: 0.3 },
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
 * added. Malformed entries (missing match / non-numeric / negative / Infinity
 * rate) are skipped so a bad config line can't crash cost reporting or produce a
 * negative cost that undercounts spend. Returns a new table; never mutates
 * PRICE_TABLE or the input.
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
    // lookupRate() always lowercases the provider, and built-in keys are
    // lowercase, so an override under a mixed-case key (e.g. "Anthropic")
    // would land on an unreachable key and be silently ignored. Normalize.
    const providerKey = String(provider).toLowerCase();
    const valid = rawEntries
      .filter(
        (e) =>
          e &&
          typeof e.match === "string" &&
          e.match.trim() &&
          // Rates must be finite AND non-negative — a negative price would
          // produce a negative cost that undercounts spend (and could keep a
          // CostBudget under its cap). `>= 0` also rejects NaN (NaN >= 0 is
          // false); isFinite additionally rejects Infinity.
          Number.isFinite(Number(e.in)) &&
          Number(e.in) >= 0 &&
          Number.isFinite(Number(e.out)) &&
          Number(e.out) >= 0,
      )
      .map((e) => ({
        match: e.match.toLowerCase(),
        in: Number(e.in),
        out: Number(e.out),
      }));
    if (valid.length === 0) continue;
    const overridden = new Set(valid.map((v) => v.match));
    const kept = (merged[providerKey] || []).filter(
      (e) => !overridden.has(e.match.toLowerCase()),
    );
    merged[providerKey] = [...valid, ...kept];
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
// Prompt-cache price multipliers relative to the input rate. A cache WRITE
// (Anthropic 5-minute ephemeral breakpoint) bills at ~125%; only Anthropic
// reports cache creation. Cache READ pricing differs per provider — Anthropic
// ~10%, OpenAI ~50%, DeepSeek ~25% of the input rate — so the default below is
// overridden per provider. Applied only when cache token counts are present, so
// non-caching usage is priced exactly as before. Public list-price estimates
// that drift; override the table via config.llm.pricing for the base rates.
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER_BY_PROVIDER = Object.freeze({
  anthropic: 0.1,
  openai: 0.5,
  deepseek: 0.25,
});

function cacheReadMultiplier(provider) {
  const p = String(provider || "").toLowerCase();
  return CACHE_READ_MULTIPLIER_BY_PROVIDER[p] ?? CACHE_READ_MULTIPLIER;
}

export function estimateCost({
  provider,
  model,
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
  table,
} = {}) {
  const rate = lookupRate(provider, model, table);
  if (!rate) {
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheCreationCost: 0,
      totalCost: 0,
      currency: "USD",
      matched: false,
      free: false,
      rate: null,
    };
  }
  const inputCost = round((Number(inputTokens) / 1e6) * rate.in);
  const outputCost = round((Number(outputTokens) / 1e6) * rate.out);
  const cacheReadCost = round(
    (Number(cacheReadTokens) / 1e6) * rate.in * cacheReadMultiplier(provider),
  );
  const cacheCreationCost = round(
    (Number(cacheCreationTokens) / 1e6) * rate.in * CACHE_WRITE_MULTIPLIER,
  );
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheCreationCost,
    totalCost: round(
      inputCost + outputCost + cacheReadCost + cacheCreationCost,
    ),
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
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      table,
    });
    return {
      ...row,
      cost: est.totalCost,
      inputCost: est.inputCost,
      outputCost: est.outputCost,
      cacheReadCost: est.cacheReadCost,
      cacheCreationCost: est.cacheCreationCost,
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
