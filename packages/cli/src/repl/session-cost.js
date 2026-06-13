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
export function renderSessionCost(store, { pricingOverrides } = {}) {
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
  if (result.unpriced.length > 0) {
    lines.push(
      `  note: ${result.unpriced.length} model(s) have no rate — ` +
        "tokens excluded from total. Add rates via config: llm.pricing.",
    );
  }
  lines.push("  prices are estimates of public list rates (USD/1M tokens).");
  return lines.join("\n");
}
