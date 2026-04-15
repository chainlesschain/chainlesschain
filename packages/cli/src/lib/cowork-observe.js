/**
 * Cowork Observe — aggregate view over Cowork task/workflow/schedule history.
 *
 * Produces a single snapshot combining:
 *   - task history (from F9 learning layer)
 *   - workflow run history (from F6)
 *   - active schedules + next fire times (from F5 cron)
 *
 * Pure + `_deps`-injected for testability. Reads files, never writes.
 *
 * @module cowork-observe
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadHistory,
  computeTemplateStats,
  summarizeFailures,
} from "./cowork-learning.js";
import { loadSchedules, parseCron } from "./cowork-cron.js";

export const _deps = {
  existsSync,
  readFileSync,
  now: () => new Date(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _parseTs(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function _loadWorkflowHistory(cwd, cutoffMs) {
  const file = join(cwd, ".chainlesschain", "cowork", "workflow-history.jsonl");
  if (!_deps.existsSync(file)) return [];
  const raw = _deps.readFileSync(file, "utf-8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (_parseTs(rec.startedAt || rec.timestamp) >= cutoffMs) out.push(rec);
    } catch (_e) {
      // skip malformed
    }
  }
  // Most recent first, top 10
  out.sort(
    (a, b) =>
      _parseTs(b.startedAt || b.timestamp) -
      _parseTs(a.startedAt || a.timestamp),
  );
  return out.slice(0, 10);
}

/**
 * Compute the next N fire times across all enabled schedules.
 * Probes minute-by-minute from `from` for up to `maxMinutesAhead` (default 7d).
 *
 * Exported for testability.
 */
export function _computeNextTriggers(schedules, from, limit = 5) {
  const enabled = (schedules || []).filter((s) => s && s.enabled !== false);
  if (enabled.length === 0) return [];
  const matchers = [];
  for (const s of enabled) {
    try {
      matchers.push({ id: s.id, cron: s.cron, match: parseCron(s.cron) });
    } catch (_e) {
      // skip invalid cron
    }
  }
  if (matchers.length === 0) return [];

  const out = [];
  const MAX_MINUTES = 60 * 24 * 7; // 1 week window is enough for typical cadences
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1); // first candidate = next whole minute
  const cursor = new Date(start);
  for (let i = 0; i < MAX_MINUTES && out.length < limit; i++) {
    for (const m of matchers) {
      if (m.match(cursor)) {
        out.push({
          scheduleId: m.id,
          cron: m.cron,
          at: new Date(cursor).toISOString(),
        });
        if (out.length >= limit) break;
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out;
}

// ─── Main aggregate ──────────────────────────────────────────────────────────

/**
 * Aggregate all Cowork state for the given window.
 *
 * @param {string} cwd
 * @param {object} [options]
 * @param {number} [options.windowDays=7]
 * @returns {{
 *   window: { days: number, from: string, to: string },
 *   tasks: { total, completed, failed, successRate, avgTokens },
 *   templates: Array, failures: Array, workflows: Array,
 *   schedules: { active: number, nextTriggers: Array },
 * }}
 */
export function aggregate(cwd, { windowDays = 7 } = {}) {
  const now = _deps.now();
  const cutoff = now.getTime() - windowDays * 86400_000;
  const allHistory = loadHistory(cwd);
  const history = allHistory.filter((r) => _parseTs(r.timestamp) >= cutoff);

  const total = history.length;
  const completed = history.filter((r) => r.status === "completed").length;
  const failed = history.filter((r) => r.status === "failed").length;
  let tokenSum = 0;
  let tokenCount = 0;
  for (const r of history) {
    const t = Number(r.result?.tokenCount || 0);
    if (t > 0) {
      tokenSum += t;
      tokenCount += 1;
    }
  }

  const schedules = loadSchedules(cwd);
  const activeSchedules = schedules.filter((s) => s && s.enabled !== false);

  return {
    window: {
      days: windowDays,
      from: new Date(cutoff).toISOString(),
      to: now.toISOString(),
    },
    tasks: {
      total,
      completed,
      failed,
      successRate: total > 0 ? +(completed / total).toFixed(3) : 0,
      avgTokens: tokenCount > 0 ? Math.round(tokenSum / tokenCount) : 0,
    },
    templates: computeTemplateStats(history),
    failures: summarizeFailures(history),
    workflows: _loadWorkflowHistory(cwd, cutoff),
    schedules: {
      active: activeSchedules.length,
      nextTriggers: _computeNextTriggers(schedules, now, 5),
    },
  };
}
