/**
 * `/cost` REPL command — running token spend + estimated $ for the LIVE agent
 * session (Claude-Code parity). Where `cc cost` reads persisted JSONL usage,
 * this accumulates each turn's usage events IN MEMORY, so it reflects exactly
 * this conversation and works even for anonymous (non-persisted) sessions.
 *
 * Pure and dependency-light (only the shared pricing lib); the REPL feeds it
 * usage events and prints the rendered string.
 */
import { priceRollup, mergePricing } from "../lib/llm-pricing.js";

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function fmtUsd(n) {
  const v = Number(n) || 0;
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

/** A fresh accumulator: running totals + per provider/model rows. */
export function newCostStore() {
  return {
    total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
    byKey: new Map(),
  };
}

/**
 * Fold the REPL's per-turn usage events ([{ provider, model, usage }]) into the
 * store. Each `usage` is the raw LLM usage object (input_tokens/output_tokens/…
 * with provider-variant aliases). Zero-token events are ignored. Mutates and
 * returns the store.
 */
export function addUsage(store, events) {
  const s = store || newCostStore();
  for (const ev of Array.isArray(events) ? events : []) {
    const u = ev && ev.usage ? ev.usage : null;
    if (!u) continue;
    const inT = num(u.input_tokens ?? u.prompt_tokens ?? u.inputTokens);
    const outT = num(u.output_tokens ?? u.completion_tokens ?? u.outputTokens);
    const totT = num(u.total_tokens ?? u.totalTokens ?? inT + outT);
    if (inT === 0 && outT === 0 && totT === 0) continue;
    s.total.inputTokens += inT;
    s.total.outputTokens += outT;
    s.total.totalTokens += totT;
    s.total.calls += 1;
    const key = `${ev.provider || "?"}/${ev.model || "?"}`;
    let row = s.byKey.get(key);
    if (!row) {
      row = {
        provider: ev.provider || null,
        model: ev.model || null,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        calls: 0,
      };
      s.byKey.set(key, row);
    }
    row.inputTokens += inT;
    row.outputTokens += outT;
    row.totalTokens += totT;
    row.calls += 1;
  }
  return s;
}

/**
 * Classify a priced model row into a cost CATEGORY by its role in the session
 * (Claude-Code `/cost` breakdown parity). Roles are derived from config + the
 * live session: the active model is "main", the configured vision model is
 * "vision", any model in the fallback chain is "fallback", anything else (e.g.
 * a model switched to mid-session) is "other".
 *
 * The active model wins over vision/fallback when names collide, so a session
 * that never used vision shows everything as "main".
 *
 * @param {string} provider
 * @param {string} model
 * @param {{mainProvider?:string, mainModel?:string, visionModel?:string, fallbackModels?:string[]}} roles
 * @returns {"main"|"vision"|"fallback"|"other"}
 */
export function classifyModelRole(provider, model, roles = {}) {
  const lc = (x) => String(x || "").toLowerCase();
  const p = lc(provider);
  const m = lc(model);
  if (
    roles.mainModel &&
    m === lc(roles.mainModel) &&
    (!roles.mainProvider || p === lc(roles.mainProvider))
  ) {
    return "main";
  }
  if (roles.visionModel && m === lc(roles.visionModel)) return "vision";
  if (
    Array.isArray(roles.fallbackModels) &&
    roles.fallbackModels.some((fm) => lc(fm) === m)
  ) {
    return "fallback";
  }
  return "other";
}

/**
 * Group a priced rollup's per-model rows into categories. Operates on the output
 * of priceRollup (rows carry cost/matched/free), so dollar sums are accurate and
 * unpriced models are flagged rather than silently counted as $0.
 *
 * @returns {Array<{category,inputTokens,outputTokens,totalTokens,calls,cost,models,anyUnpriced}>}
 *          sorted by cost (then tokens) descending.
 */
export function categorizeByRole(pricedResult, roles = {}) {
  const cats = new Map();
  for (const row of pricedResult?.byModel || []) {
    const category = classifyModelRole(row.provider, row.model, roles);
    let c = cats.get(category);
    if (!c) {
      c = {
        category,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        calls: 0,
        cost: 0,
        models: [],
        anyUnpriced: false,
      };
      cats.set(category, c);
    }
    c.inputTokens += num(row.inputTokens);
    c.outputTokens += num(row.outputTokens);
    c.totalTokens += num(row.totalTokens);
    c.calls += num(row.calls);
    if (row.matched && !row.free) c.cost += num(row.cost);
    if (!row.matched && !row.free) c.anyUnpriced = true;
    if (row.model && !c.models.includes(row.model)) c.models.push(row.model);
  }
  return Array.from(cats.values()).sort(
    (a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens,
  );
}

/** Snapshot the store as the `{ total, byModel[] }` aggregate priceRollup wants. */
export function costAggregate(store) {
  const s = store || newCostStore();
  return {
    total: { ...s.total },
    byModel: Array.from(s.byKey.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
  };
}

/**
 * Render the live session cost. `pricingOverrides` is typically
 * `config.llm.pricing`. Returns plain text (the REPL does the I/O).
 */
export function renderSessionCost(store, { pricingOverrides, roles } = {}) {
  const agg = costAggregate(store);
  if (agg.total.calls === 0) {
    return "Session cost: no LLM calls yet this session.";
  }
  const table = mergePricing(pricingOverrides);
  const result = priceRollup(agg, { table });
  const lines = [];
  lines.push("Session cost (estimated):");
  lines.push(
    `  total: ${fmtUsd(result.cost.totalCost)} USD  ` +
      `(${result.total.totalTokens.toLocaleString()} tokens, ${result.total.calls} calls)`,
  );
  for (const row of result.byModel) {
    const provider = (row.provider || "?").padEnd(10);
    const model = (row.model || "?").padEnd(24);
    const tokens = `in=${row.inputTokens} out=${row.outputTokens}`;
    const price = row.free
      ? "free (local)"
      : row.matched
        ? fmtUsd(row.cost)
        : "unpriced";
    lines.push(`  ${provider} ${model} ${price}  ${tokens}`);
  }

  // Category breakdown (main / vision / fallback / other) — only worth showing
  // when more than one category was actually used; a single-model session is
  // already fully described by the per-model rows above.
  if (roles) {
    const cats = categorizeByRole(result, roles);
    if (cats.length >= 2) {
      const totalCost = num(result.cost.totalCost);
      lines.push("  by category:");
      for (const c of cats) {
        const label = c.category.padEnd(9);
        const price =
          c.anyUnpriced && c.cost === 0 ? "unpriced" : fmtUsd(c.cost);
        const pct =
          totalCost > 0 ? ` (${Math.round((c.cost / totalCost) * 100)}%)` : "";
        lines.push(
          `    ${label} ${price}${pct}  in=${c.inputTokens} out=${c.outputTokens} ${c.calls} calls`,
        );
      }
    }
  }

  if (result.unpriced.length > 0) {
    lines.push(
      `  note: ${result.unpriced.length} model(s) have no rate — ` +
        "tokens excluded from total. Add rates via config: llm.pricing.",
    );
  }
  lines.push("  prices are estimates of public list rates (USD/1M tokens).");
  return lines.join("\n");
}
