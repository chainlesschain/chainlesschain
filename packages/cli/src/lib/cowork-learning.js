/**
 * Cowork Learning Engine — analyze historical runs to optimize template
 * selection, surface failure patterns, and recommend templates for new
 * prompts based on past outcomes.
 *
 * Reads `.chainlesschain/cowork/history.jsonl` produced by the runner.
 * Records have shape:
 *   { taskId, status, templateId, templateName, result, userMessage, timestamp }
 * where result = { summary, tokenCount, toolsUsed, iterationCount, artifacts }.
 *
 * All operations are pure/sync over the in-memory record list, making the
 * module trivially testable with injected fs.
 *
 * @module cowork-learning
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const _deps = { existsSync, readFileSync };

// ─── Loading ─────────────────────────────────────────────────────────────────

/** Read the full history as an array. Returns [] if the file is missing. */
export function loadHistory(cwd) {
  const file = join(cwd, ".chainlesschain", "cowork", "history.jsonl");
  if (!_deps.existsSync(file)) return [];
  const raw = _deps.readFileSync(file, "utf-8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch (_e) {
      // Skip malformed lines
    }
  }
  return out;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Aggregate per-template stats across all runs.
 *
 * @returns {Array<{
 *   templateId: string,
 *   templateName: string,
 *   runs: number,
 *   successes: number,
 *   failures: number,
 *   successRate: number,  // 0..1
 *   avgTokens: number,
 *   avgIterations: number,
 *   topTools: Array<{ tool: string, count: number }>,
 *   lastRunAt: string|null,
 * }>}
 */
export function computeTemplateStats(history) {
  const groups = new Map();
  for (const rec of history) {
    const id = rec.templateId || "unknown";
    if (!groups.has(id)) {
      groups.set(id, {
        templateId: id,
        templateName: rec.templateName || id,
        runs: 0,
        successes: 0,
        failures: 0,
        totalTokens: 0,
        totalIterations: 0,
        toolCounts: new Map(),
        lastRunAt: null,
      });
    }
    const g = groups.get(id);
    g.runs += 1;
    if (rec.status === "completed") g.successes += 1;
    else g.failures += 1;
    const r = rec.result || {};
    g.totalTokens += Number(r.tokenCount || 0);
    g.totalIterations += Number(r.iterationCount || 0);
    for (const t of r.toolsUsed || []) {
      g.toolCounts.set(t, (g.toolCounts.get(t) || 0) + 1);
    }
    if (rec.timestamp && (!g.lastRunAt || rec.timestamp > g.lastRunAt)) {
      g.lastRunAt = rec.timestamp;
    }
  }

  const result = [];
  for (const g of groups.values()) {
    const topTools = [...g.toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));
    result.push({
      templateId: g.templateId,
      templateName: g.templateName,
      runs: g.runs,
      successes: g.successes,
      failures: g.failures,
      successRate: g.runs > 0 ? g.successes / g.runs : 0,
      avgTokens: g.runs > 0 ? Math.round(g.totalTokens / g.runs) : 0,
      avgIterations: g.runs > 0 ? +(g.totalIterations / g.runs).toFixed(1) : 0,
      topTools,
      lastRunAt: g.lastRunAt,
    });
  }
  // Sort by runs desc, then successRate desc
  result.sort((a, b) => b.runs - a.runs || b.successRate - a.successRate);
  return result;
}

// ─── Recommendation ──────────────────────────────────────────────────────────

/**
 * Tokenize a string into lowercased word tokens (Unicode-aware, keeps CJK).
 * Splits on non-letter/digit/CJK characters.
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return tokens;
}

/**
 * Recommend the best template for a new user message based on history.
 *
 * Scoring: for each historical record of a successful run, count token
 * overlap between its userMessage and the query. The template with the
 * highest cumulative overlap × successRate wins.
 *
 * @param {string} userMessage
 * @param {Array<object>} history
 * @param {object} [options]
 * @param {number} [options.minRuns] - Only consider templates with at least this many runs
 * @returns {{ templateId: string, score: number, confidence: number, reasons: string[] } | null}
 */
export function recommendTemplate(userMessage, history, options = {}) {
  const { minRuns = 1 } = options;
  const queryTokens = new Set(tokenize(userMessage));
  if (queryTokens.size === 0) return null;

  const stats = computeTemplateStats(history);
  const statsById = new Map(stats.map((s) => [s.templateId, s]));

  const scores = new Map(); // templateId -> cumulative overlap
  for (const rec of history) {
    if (rec.status !== "completed") continue;
    const id = rec.templateId || "unknown";
    const histTokens = tokenize(rec.userMessage || "");
    let overlap = 0;
    for (const t of histTokens) {
      if (queryTokens.has(t)) overlap += 1;
    }
    if (overlap > 0) {
      scores.set(id, (scores.get(id) || 0) + overlap);
    }
  }

  let best = null;
  for (const [templateId, overlap] of scores) {
    const s = statsById.get(templateId);
    if (!s || s.runs < minRuns) continue;
    const finalScore = overlap * (0.5 + s.successRate / 2);
    if (!best || finalScore > best.score) {
      best = {
        templateId,
        score: +finalScore.toFixed(2),
        confidence: +s.successRate.toFixed(2),
        reasons: [
          `${overlap} overlapping token(s) with past runs`,
          `${s.successes}/${s.runs} past successes (${Math.round(s.successRate * 100)}%)`,
        ],
      };
    }
  }
  return best;
}

// ─── Failure analysis ────────────────────────────────────────────────────────

/**
 * Group failures by template and surface the most common failure summaries.
 *
 * @param {Array<object>} history
 * @param {object} [options]
 * @param {number} [options.limit] - Max examples per template
 * @returns {Array<{
 *   templateId: string,
 *   templateName: string,
 *   failureCount: number,
 *   commonSummaries: Array<{ summary: string, count: number }>,
 *   examples: Array<{ taskId: string, userMessage: string, summary: string, timestamp: string }>,
 * }>}
 */
export function summarizeFailures(history, options = {}) {
  const { limit = 3 } = options;
  const groups = new Map();
  for (const rec of history) {
    if (rec.status === "completed") continue;
    const id = rec.templateId || "unknown";
    if (!groups.has(id)) {
      groups.set(id, {
        templateId: id,
        templateName: rec.templateName || id,
        failureCount: 0,
        summaryCounts: new Map(),
        examples: [],
      });
    }
    const g = groups.get(id);
    g.failureCount += 1;
    const summary = (rec.result?.summary || "").slice(0, 200);
    if (summary) {
      g.summaryCounts.set(summary, (g.summaryCounts.get(summary) || 0) + 1);
    }
    if (g.examples.length < limit) {
      g.examples.push({
        taskId: rec.taskId,
        userMessage: (rec.userMessage || "").slice(0, 200),
        summary,
        timestamp: rec.timestamp || "",
      });
    }
  }

  const out = [];
  for (const g of groups.values()) {
    const commonSummaries = [...g.summaryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([summary, count]) => ({ summary, count }));
    out.push({
      templateId: g.templateId,
      templateName: g.templateName,
      failureCount: g.failureCount,
      commonSummaries,
      examples: g.examples,
    });
  }
  out.sort((a, b) => b.failureCount - a.failureCount);
  return out;
}
