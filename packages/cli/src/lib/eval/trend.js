/**
 * Eval trend analysis (Phase 7) — turn a history of `cc eval` runs into a
 * release-gate signal: is the task-success rate trending down, and did any task
 * that used to pass start failing (a regression)?
 *
 * The eval RUNS themselves need a real model (a dry-run is always 0%), but the
 * REPORTING is pure: given the recorded per-run summaries (pass-rate + which
 * tasks passed), computing the delta, per-task regressions, and the gate verdict
 * is deterministic and unit-testable with fixtures — which is what a release
 * pipeline actually wires up. This module is that consumer.
 *
 * A run record is the JSON `cc eval --json` emits, optionally tagged with
 * `ranAt` / `label` (version or commit). `perTask` is derived from `results`.
 */

/** Normalize one `cc eval` summary into a compact trend record. */
export function summarizeRun(record, { ranAt = null, label = null } = {}) {
  const results = Array.isArray(record?.results) ? record.results : [];
  const perTask = {};
  for (const r of results) {
    if (r && r.id != null) perTask[r.id] = r.pass === true;
  }
  const total = Number.isFinite(record?.total) ? record.total : results.length;
  const passed = Number.isFinite(record?.passed)
    ? record.passed
    : results.filter((r) => r && r.pass === true).length;
  const passRate = Number.isFinite(record?.passRate)
    ? record.passRate
    : total > 0
      ? passed / total
      : 0;
  return {
    ranAt: record?.ranAt ?? ranAt,
    label: record?.label ?? label,
    passed,
    total,
    passRate,
    perTask,
  };
}

/** Stable chronological order: by `ranAt` when present, else preserve input order. */
function ordered(records) {
  const withIdx = records.map((r, i) => ({ r, i }));
  withIdx.sort((a, b) => {
    const ax = a.r.ranAt,
      bx = b.r.ranAt;
    if (ax != null && bx != null && ax !== bx) return ax < bx ? -1 : 1;
    if (ax != null && bx == null) return 1; // timestamped runs sort after untimestamped
    if (ax == null && bx != null) return -1;
    return a.i - b.i; // stable fallback
  });
  return withIdx.map((x) => x.r);
}

/**
 * Compare the latest run against the previous one and report the trend.
 *
 * @param {object[]} runs  array of run records (raw `cc eval` summaries or
 *   already-summarized); ordered by `ranAt` when available, else input order.
 * @param {object} [opts]
 * @param {number} [opts.regressionThreshold] pass-rate drop (0..1) that trips the
 *   gate on its own, independent of per-task regressions. Default 0 (any drop or
 *   any newly-failing task trips it).
 * @returns {{
 *   runs:number, latest:object|null, previous:object|null, delta:number,
 *   direction:"up"|"down"|"flat"|"n/a", regressions:string[], fixed:string[],
 *   newlyMissing:string[], regressed:boolean, history:number[]
 * }}
 */
export function computeTrend(runs, { regressionThreshold = 0 } = {}) {
  const norm = ordered((runs || []).map((r) => summarizeRun(r)));
  const history = norm.map((r) => r.passRate);
  if (norm.length === 0) {
    return {
      runs: 0,
      latest: null,
      previous: null,
      delta: 0,
      direction: "n/a",
      regressions: [],
      fixed: [],
      newlyMissing: [],
      regressed: false,
      history,
    };
  }
  const latest = norm[norm.length - 1];
  const previous = norm.length >= 2 ? norm[norm.length - 2] : null;
  if (!previous) {
    return {
      runs: norm.length,
      latest,
      previous: null,
      delta: 0,
      direction: "n/a",
      regressions: [],
      fixed: [],
      newlyMissing: [],
      regressed: false,
      history,
    };
  }
  const delta = latest.passRate - previous.passRate;
  const regressions = []; // passed before, fails now
  const fixed = []; // failed before, passes now
  const newlyMissing = []; // in previous suite, absent from latest (dropped task)
  for (const [id, prevPass] of Object.entries(previous.perTask)) {
    if (!(id in latest.perTask)) {
      newlyMissing.push(id);
      continue;
    }
    const nowPass = latest.perTask[id];
    if (prevPass && !nowPass) regressions.push(id);
    else if (!prevPass && nowPass) fixed.push(id);
  }
  const direction = delta > 1e-9 ? "up" : delta < -1e-9 ? "down" : "flat";
  // The gate trips on ANY task regression, or a pass-rate drop beyond the
  // threshold. A per-task regression matters even when the aggregate holds
  // (one task fixed while another broke = flat rate but a real regression).
  const regressed =
    regressions.length > 0 || delta < -Math.abs(regressionThreshold);
  return {
    runs: norm.length,
    latest,
    previous,
    delta,
    direction,
    regressions: regressions.sort(),
    fixed: fixed.sort(),
    newlyMissing: newlyMissing.sort(),
    regressed,
    history,
  };
}

const BARS = "▁▂▃▄▅▆▇█";
/** Tiny unicode sparkline of pass-rates (0..1) across the run history. */
export function sparkline(rates) {
  if (!rates || rates.length === 0) return "";
  return rates
    .map((r) => {
      const clamped = Math.max(0, Math.min(1, Number(r) || 0));
      return BARS[
        Math.min(BARS.length - 1, Math.round(clamped * (BARS.length - 1)))
      ];
    })
    .join("");
}

/** Human-readable trend report. */
export function formatTrend(trend) {
  if (!trend || trend.runs === 0) return "No eval history to report.";
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const lines = [];
  const l = trend.latest;
  lines.push(
    `Eval trend over ${trend.runs} run(s)  ${sparkline(trend.history)}`,
  );
  lines.push(
    `  latest: ${l.passed}/${l.total} (${pct(l.passRate)})` +
      (l.label ? ` [${l.label}]` : ""),
  );
  if (!trend.previous) {
    lines.push("  (only one run — no delta yet)");
    return lines.join("\n");
  }
  const arrow =
    trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "▬";
  const sign = trend.delta >= 0 ? "+" : "";
  lines.push(
    `  vs previous: ${arrow} ${sign}${(trend.delta * 100).toFixed(1)} pts`,
  );
  if (trend.regressions.length)
    lines.push(`  ✗ regressions: ${trend.regressions.join(", ")}`);
  if (trend.fixed.length) lines.push(`  ✔ fixed: ${trend.fixed.join(", ")}`);
  if (trend.newlyMissing.length)
    lines.push(`  · dropped tasks: ${trend.newlyMissing.join(", ")}`);
  lines.push(
    trend.regressed
      ? "  RESULT: REGRESSED (gate fails)"
      : "  RESULT: ok (no regression)",
  );
  return lines.join("\n");
}
