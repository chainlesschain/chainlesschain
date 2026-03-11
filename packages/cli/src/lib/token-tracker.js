/**
 * Token usage tracker for CLI
 *
 * Tracks LLM API call token counts and costs.
 * Lightweight port of desktop-app-vue/src/main/llm/token-tracker.js
 */

import { createHash } from "crypto";

/**
 * Pricing data per million tokens (USD)
 */
const PRICING = {
  ollama: { input: 0, output: 0 },
  openai: {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10, output: 30 },
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    o1: { input: 15, output: 60 },
    _default: { input: 2.5, output: 10 },
  },
  anthropic: {
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-opus-4-6": { input: 15, output: 75 },
    "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
    _default: { input: 3, output: 15 },
  },
  deepseek: {
    "deepseek-chat": { input: 0.14, output: 0.28 },
    _default: { input: 0.14, output: 0.28 },
  },
  dashscope: {
    "qwen-turbo": { input: 0.3, output: 0.6 },
    "qwen-plus": { input: 0.8, output: 2 },
    _default: { input: 0.3, output: 0.6 },
  },
};

function ensureTokenTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage_log (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      response_time_ms INTEGER DEFAULT 0,
      endpoint TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Calculate cost for a given usage
 */
export function calculateCost(provider, model, inputTokens, outputTokens) {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return 0;

  // Ollama is free
  if (provider === "ollama") return 0;

  const modelPricing = providerPricing[model] || providerPricing._default;
  if (!modelPricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
  return inputCost + outputCost;
}

/**
 * Record a token usage event
 */
export function recordUsage(db, params) {
  ensureTokenTable(db);

  const {
    provider,
    model,
    inputTokens = 0,
    outputTokens = 0,
    responseTimeMs = 0,
    endpoint = "",
  } = params;

  const totalTokens = inputTokens + outputTokens;
  const costUsd = calculateCost(provider, model, inputTokens, outputTokens);

  const id = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 16);

  db.prepare(
    `INSERT INTO llm_usage_log (id, provider, model, input_tokens, output_tokens, total_tokens, cost_usd, response_time_ms, endpoint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    responseTimeMs,
    endpoint,
  );

  return { id, totalTokens, costUsd };
}

/**
 * Get usage stats with optional date filtering
 */
export function getUsageStats(db, options = {}) {
  ensureTokenTable(db);

  const { startDate, endDate, provider, model } = options;
  let sql = `SELECT
    COUNT(*) as total_calls,
    COALESCE(SUM(input_tokens), 0) as total_input_tokens,
    COALESCE(SUM(output_tokens), 0) as total_output_tokens,
    COALESCE(SUM(total_tokens), 0) as total_tokens,
    COALESCE(SUM(cost_usd), 0) as total_cost_usd,
    COALESCE(AVG(response_time_ms), 0) as avg_response_time_ms
    FROM llm_usage_log WHERE 1=1`;

  const params = [];
  if (startDate) {
    sql += " AND created_at >= ?";
    params.push(startDate);
  }
  if (endDate) {
    sql += " AND created_at <= ?";
    params.push(endDate);
  }
  if (provider) {
    sql += " AND provider = ?";
    params.push(provider);
  }
  if (model) {
    sql += " AND model = ?";
    params.push(model);
  }

  const result = db.prepare(sql).get(...params);
  return {
    total_calls: result?.total_calls || 0,
    total_input_tokens: result?.total_input_tokens || 0,
    total_output_tokens: result?.total_output_tokens || 0,
    total_tokens: result?.total_tokens || 0,
    total_cost_usd: result?.total_cost_usd || 0,
    avg_response_time_ms: result?.avg_response_time_ms || 0,
  };
}

/**
 * Get cost breakdown by provider
 */
export function getCostBreakdown(db) {
  ensureTokenTable(db);

  return db
    .prepare(
      `SELECT provider, model,
       COUNT(*) as calls,
       SUM(input_tokens) as input_tokens,
       SUM(output_tokens) as output_tokens,
       SUM(total_tokens) as total_tokens,
       SUM(cost_usd) as cost_usd
       FROM llm_usage_log
       GROUP BY provider, model
       ORDER BY cost_usd DESC`,
    )
    .all();
}

/**
 * Get recent usage entries
 */
export function getRecentUsage(db, limit = 20) {
  ensureTokenTable(db);

  return db
    .prepare(`SELECT * FROM llm_usage_log ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

/**
 * Get today's stats
 */
export function getTodayStats(db) {
  return getUsageStats(db, {
    startDate: new Date().toISOString().slice(0, 10),
  });
}
