/**
 * `cc perf` — CLI surface for Phase 22 性能自动调优.
 *
 * Real os.cpus/freemem + process.memoryUsage sampling → SQLite ring buffer.
 * 5 built-in rules, hysteresis + cooldown tracking. CLI reports
 * recommendations but NEVER auto-applies actions.
 */

import { Command } from "commander";

import {
  ALERT_LEVELS,
  RECOMMENDATION_STATUS,
  BUILTIN_RULES,
  ensurePerfTables,
  getPerfConfig,
  setPerfConfig,
  collectSample,
  listSamples,
  getLatestSample,
  clearHistory,
  listRules,
  getRule,
  setRuleEnabled,
  evaluateRules,
  listRecommendations,
  applyRecommendation,
  dismissRecommendation,
  listHistory,
  getAlerts,
  getPerfStats,
  getPerformanceReport,
} from "../lib/perf-tuning.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

function _json(v) {
  console.log(JSON.stringify(v, null, 2));
}

function _fmtTs(ts) {
  if (!ts) return "—";
  return new Date(ts).toISOString();
}

export function registerPerfCommand(program) {
  const perf = new Command("perf")
    .description("Performance monitoring & auto-tuning (Phase 22)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensurePerfTables(db);
    });

  /* ── Catalogs ─────────────────────────────────────── */

  perf
    .command("levels")
    .description("List alert levels")
    .option("--json", "JSON output")
    .action((opts) => {
      const rows = Object.values(ALERT_LEVELS);
      if (opts.json) return _json(rows);
      for (const r of rows) console.log(`  ${r}`);
    });

  perf
    .command("rule-statuses")
    .description("List recommendation statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const rows = Object.values(RECOMMENDATION_STATUS);
      if (opts.json) return _json(rows);
      for (const r of rows) console.log(`  ${r}`);
    });

  perf
    .command("rules")
    .description("List 5 built-in tuning rules")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const rules = db ? listRules(db) : BUILTIN_RULES.map((r) => ({ ...r }));
      if (opts.json) return _json(rules);
      for (const r of rules) {
        const flag = r.enabled === false ? "[off] " : "      ";
        console.log(
          `${flag}${r.id.padEnd(20)} ${r.severity.padEnd(8)} ${r.name}`,
        );
        console.log(
          `        cond=${r.condition.metric} ${r.condition.op} ${r.condition.value}` +
            `  hyst=${r.consecutiveRequired}x  cooldown=${Math.round(r.cooldownMs / 1000)}s`,
        );
        console.log(`        action=${r.action}`);
      }
    });

  perf
    .command("rule-show")
    .argument("<ruleId>", "Rule id")
    .description("Show a rule with live state")
    .option("--json", "JSON output")
    .action((ruleId, opts) => {
      const db = _dbFromCtx(perf);
      const r = getRule(db, ruleId);
      if (!r) {
        console.error(`Unknown rule: ${ruleId}`);
        process.exit(1);
      }
      if (opts.json) return _json(r);
      console.log(`Rule: ${r.id} — ${r.name}`);
      console.log(`  enabled: ${r.enabled}`);
      console.log(`  severity: ${r.severity}`);
      console.log(
        `  condition: ${r.condition.metric} ${r.condition.op} ${r.condition.value}`,
      );
      console.log(`  action: ${r.action}`);
      console.log(
        `  hysteresis: ${r.consecutiveRequired}x  cooldown: ${r.cooldownMs}ms`,
      );
      console.log(`  consecutive: ${r.consecutiveCount}`);
      console.log(`  totalTriggered: ${r.totalTriggered}`);
      console.log(`  lastTriggeredAt: ${_fmtTs(r.lastTriggeredAt)}`);
    });

  perf
    .command("rule-enable")
    .argument("<ruleId>", "Rule id")
    .description("Enable a rule")
    .option("--json", "JSON output")
    .action((ruleId, opts) => {
      const db = _dbFromCtx(perf);
      const r = setRuleEnabled(db, ruleId, true);
      if (opts.json) return _json(r);
      if (!r.updated) {
        console.error(`Failed: ${r.reason}`);
        process.exit(1);
      }
      console.log(`Enabled ${ruleId}`);
    });

  perf
    .command("rule-disable")
    .argument("<ruleId>", "Rule id")
    .description("Disable a rule")
    .option("--json", "JSON output")
    .action((ruleId, opts) => {
      const db = _dbFromCtx(perf);
      const r = setRuleEnabled(db, ruleId, false);
      if (opts.json) return _json(r);
      if (!r.updated) {
        console.error(`Failed: ${r.reason}`);
        process.exit(1);
      }
      console.log(`Disabled ${ruleId}`);
    });

  /* ── Sampling ─────────────────────────────────────── */

  perf
    .command("collect")
    .description("Collect one performance sample now")
    .option("--slow-queries <n>", "Feed slowQueries counter (int)", (v) =>
      parseInt(v, 10),
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const s = collectSample(db, { slowQueries: opts.slowQueries });
      if (opts.json) return _json(s);
      console.log(`Sample @ ${_fmtTs(s.ts)}`);
      console.log(`  cpu: ${s.cpuPercent}%  mem: ${s.memoryPercent}%`);
      console.log(
        `  heap: ${s.heapPercent}% (${s.heapUsed}/${s.heapTotal})  rss: ${s.rss}`,
      );
      console.log(`  load1: ${s.load1}  loadPerCore: ${s.loadPerCore}`);
    });

  perf
    .command("metrics")
    .description("Show the latest sample (collect one if none exists)")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      let s = getLatestSample(db);
      if (!s) s = collectSample(db);
      if (opts.json) return _json(s);
      console.log(`Latest @ ${_fmtTs(s.ts)}`);
      console.log(
        `  cpu=${s.cpuPercent}%  mem=${s.memoryPercent}%  heap=${s.heapPercent}%`,
      );
      console.log(`  load1=${s.load1}  loadPerCore=${s.loadPerCore}`);
    });

  perf
    .command("samples")
    .description("List recent samples (ring buffer)")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 20)
    .option("--since-ms <ms>", "Only samples newer than N ms ago", (v) =>
      parseInt(v, 10),
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const rows = listSamples(db, {
        limit: opts.limit,
        sinceMs: opts.sinceMs,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${_fmtTs(r.ts)}  cpu=${r.cpuPercent}%  mem=${r.memoryPercent}%  heap=${r.heapPercent}%  load/c=${r.loadPerCore}`,
        );
      console.log(`(${rows.length} rows)`);
    });

  perf
    .command("clear-history")
    .description("Wipe the ring buffer")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const r = clearHistory(db);
      if (opts.json) return _json(r);
      console.log(`Cleared ${r.cleared} samples`);
    });

  /* ── Evaluation ───────────────────────────────────── */

  perf
    .command("evaluate")
    .description("Run the rule engine against the latest sample")
    .option("--collect", "Collect a fresh sample before evaluating")
    .option("--slow-queries <n>", "Feed slowQueries counter (int)", (v) =>
      parseInt(v, 10),
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      if (opts.collect) collectSample(db, { slowQueries: opts.slowQueries });
      const r = evaluateRules(db);
      if (opts.json) return _json(r);
      console.log(`Evaluated @ ${_fmtTs(r.evaluatedAt)}`);
      console.log(
        `Sample: cpu=${r.sample.cpuPercent}%  mem=${r.sample.memoryPercent}%  heap=${r.sample.heapPercent}%  load/c=${r.sample.loadPerCore}`,
      );
      console.log(`Triggered: ${r.triggered.length}`);
      for (const t of r.triggered)
        console.log(
          `  ✱ ${t.ruleId} [${t.severity}] ${t.metric}=${t.value} (> ${t.threshold}) → ${t.recommendationId}`,
        );
      console.log(`Skipped: ${r.skipped.length}`);
      for (const s of r.skipped) console.log(`  · ${s.ruleId} — ${s.reason}`);
    });

  perf
    .command("recommendations")
    .description("List recommendations")
    .option("--status <s>", "Filter: pending|applied|dismissed")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const rows = listRecommendations(db, {
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  [${r.status.padEnd(10)}] ${r.id}  ${r.ruleId}  ${r.metric}=${r.metricValue} (> ${r.threshold})`,
        );
      console.log(`(${rows.length} rows)`);
    });

  perf
    .command("apply")
    .argument("<id>", "Recommendation id")
    .description("Mark a recommendation as applied")
    .option("-n, --note <note>", "Optional note")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(perf);
      const r = applyRecommendation(db, id, { note: opts.note });
      if (opts.json) return _json(r);
      if (!r.applied) {
        console.error(`Failed: ${r.reason}`);
        process.exit(1);
      }
      console.log(`Applied ${id} @ ${_fmtTs(r.appliedAt)}`);
    });

  perf
    .command("dismiss")
    .argument("<id>", "Recommendation id")
    .description("Dismiss a pending recommendation")
    .option("-n, --note <note>", "Optional note")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(perf);
      const r = dismissRecommendation(db, id, { note: opts.note });
      if (opts.json) return _json(r);
      if (!r.dismissed) {
        console.error(`Failed: ${r.reason}`);
        process.exit(1);
      }
      console.log(`Dismissed ${id}`);
    });

  /* ── History / alerts / stats ─────────────────────── */

  perf
    .command("history")
    .description("Tuning action history")
    .option("--rule-id <id>", "Filter by rule id")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const rows = listHistory(db, { ruleId: opts.ruleId, limit: opts.limit });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${_fmtTs(r.createdAt)}  ${r.ruleId.padEnd(20)} ${r.action}`,
        );
      console.log(`(${rows.length} rows)`);
    });

  perf
    .command("alerts")
    .description("Current threshold violations against latest sample")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const rows = getAlerts(db);
      if (opts.json) return _json(rows);
      if (rows.length === 0) {
        console.log("No alerts.");
        return;
      }
      for (const a of rows)
        console.log(`  [${a.level}] ${a.metric}=${a.value} > ${a.threshold}`);
    });

  perf
    .command("config")
    .description("Show or update performance config")
    .option("--max-samples <n>", "Ring buffer size", (v) => parseInt(v, 10))
    .option(
      "--interval-ms <n>",
      "Intended sample interval (informational)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--threshold <metric=value>",
      "Override threshold (repeatable)",
      (val, prev = {}) => {
        const [k, v] = val.split("=");
        prev[k] = parseFloat(v);
        return prev;
      },
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const patch = {};
      if (opts.maxSamples != null) patch.maxSamples = opts.maxSamples;
      if (opts.intervalMs != null) patch.sampleIntervalMs = opts.intervalMs;
      if (opts.threshold) patch.thresholds = opts.threshold;
      const cfg =
        Object.keys(patch).length > 0
          ? setPerfConfig(db, patch)
          : getPerfConfig(db);
      if (opts.json) return _json(cfg);
      console.log(`maxSamples:       ${cfg.maxSamples}`);
      console.log(`sampleIntervalMs: ${cfg.sampleIntervalMs}`);
      console.log("thresholds:");
      for (const [k, v] of Object.entries(cfg.thresholds))
        console.log(`  ${k.padEnd(16)} ${v}`);
    });

  perf
    .command("stats")
    .description("Aggregate perf stats")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const s = getPerfStats(db);
      if (opts.json) return _json(s);
      console.log(`Samples:         ${s.samples}`);
      console.log(
        `Rules:           ${s.rules.enabled}/${s.rules.total} enabled, triggered ${s.rules.triggered}x`,
      );
      console.log(
        `Recommendations: pending=${s.recommendations.pending} applied=${s.recommendations.applied} dismissed=${s.recommendations.dismissed} total=${s.recommendations.total}`,
      );
      console.log(`History:         ${s.historyEntries}`);
      console.log(
        `Averages:        cpu=${s.averages.cpuPercent ?? "—"}%  mem=${s.averages.memoryPercent ?? "—"}%  heap=${s.averages.heapPercent ?? "—"}%`,
      );
    });

  perf
    .command("report")
    .description("Full performance report (sample + alerts + stats + pending)")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perf);
      const r = getPerformanceReport(db);
      if (opts.json) return _json(r);
      console.log(`Report @ ${_fmtTs(r.generatedAt)}`);
      if (r.sample) {
        console.log(
          `Sample:  cpu=${r.sample.cpuPercent}%  mem=${r.sample.memoryPercent}%  heap=${r.sample.heapPercent}%  load/c=${r.sample.loadPerCore}`,
        );
      } else {
        console.log("Sample:  (none — run `cc perf collect`)");
      }
      console.log(`Alerts:  ${r.alerts.length}`);
      for (const a of r.alerts)
        console.log(`  [${a.level}] ${a.metric}=${a.value} > ${a.threshold}`);
      console.log(
        `Pending recommendations: ${r.pendingRecommendations.length}`,
      );
      for (const p of r.pendingRecommendations)
        console.log(`  ${p.id}  ${p.ruleId}  ${p.description}`);
      console.log(`Recent history: ${r.recentHistory.length}`);
    });

  _registerPerfV2(perf);
  program.addCommand(perf);
}

import {
  PERF_TUNING_PROFILE_MATURITY_V2,
  PERF_BENCH_LIFECYCLE_V2,
  setMaxActivePerfTuningProfilesPerOwnerV2,
  getMaxActivePerfTuningProfilesPerOwnerV2,
  setMaxPendingPerfBenchesPerProfileV2,
  getMaxPendingPerfBenchesPerProfileV2,
  setPerfTuningProfileIdleMsV2,
  getPerfTuningProfileIdleMsV2,
  setPerfBenchStuckMsV2,
  getPerfBenchStuckMsV2,
  registerPerfTuningProfileV2,
  activatePerfTuningProfileV2,
  stalePerfTuningProfileV2,
  decommissionPerfTuningProfileV2,
  touchPerfTuningProfileV2,
  getPerfTuningProfileV2,
  listPerfTuningProfilesV2,
  createPerfBenchV2,
  startPerfBenchV2,
  completePerfBenchV2,
  failPerfBenchV2,
  cancelPerfBenchV2,
  getPerfBenchV2,
  listPerfBenchesV2,
  autoStaleIdlePerfTuningProfilesV2,
  autoFailStuckPerfBenchesV2,
  getPerfTuningGovStatsV2,
  _resetStatePerfTuningV2,
} from "../lib/perf-tuning.js";

function _registerPerfV2(parent) {
  parent.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          profileMaturity: PERF_TUNING_PROFILE_MATURITY_V2,
          benchLifecycle: PERF_BENCH_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  parent.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActivePerfTuningProfilesPerOwner:
            getMaxActivePerfTuningProfilesPerOwnerV2(),
          maxPendingPerfBenchesPerProfile:
            getMaxPendingPerfBenchesPerProfileV2(),
          perfTuningProfileIdleMs: getPerfTuningProfileIdleMsV2(),
          perfBenchStuckMs: getPerfBenchStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  parent.command("set-max-active-v2 <n>").action((n) => {
    setMaxActivePerfTuningProfilesPerOwnerV2(Number(n));
    console.log("ok");
  });
  parent.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingPerfBenchesPerProfileV2(Number(n));
    console.log("ok");
  });
  parent.command("set-idle-ms-v2 <n>").action((n) => {
    setPerfTuningProfileIdleMsV2(Number(n));
    console.log("ok");
  });
  parent.command("set-stuck-ms-v2 <n>").action((n) => {
    setPerfBenchStuckMsV2(Number(n));
    console.log("ok");
  });
  parent
    .command("register-profile-v2 <id> <owner>")
    .option("--target <t>", "target")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerPerfTuningProfileV2({ id, owner, target: o.target }),
          null,
          2,
        ),
      ),
    );
  parent
    .command("activate-profile-v2 <id>")
    .action((id) =>
      console.log(JSON.stringify(activatePerfTuningProfileV2(id), null, 2)),
    );
  parent
    .command("stale-profile-v2 <id>")
    .action((id) =>
      console.log(JSON.stringify(stalePerfTuningProfileV2(id), null, 2)),
    );
  parent
    .command("decommission-profile-v2 <id>")
    .action((id) =>
      console.log(JSON.stringify(decommissionPerfTuningProfileV2(id), null, 2)),
    );
  parent
    .command("touch-profile-v2 <id>")
    .action((id) =>
      console.log(JSON.stringify(touchPerfTuningProfileV2(id), null, 2)),
    );
  parent
    .command("get-profile-v2 <id>")
    .action((id) =>
      console.log(JSON.stringify(getPerfTuningProfileV2(id), null, 2)),
    );
  parent
    .command("list-profiles-v2")
    .action(() =>
      console.log(JSON.stringify(listPerfTuningProfilesV2(), null, 2)),
    );
  parent
    .command("create-bench-v2 <id> <profileId>")
    .option("--scenario <s>", "scenario")
    .action((id, profileId, o) =>
      console.log(
        JSON.stringify(
          createPerfBenchV2({ id, profileId, scenario: o.scenario }),
          null,
          2,
        ),
      ),
    );
  parent
    .command("start-bench-v2 <id>")
    .action((id) => console.log(JSON.stringify(startPerfBenchV2(id), null, 2)));
  parent
    .command("complete-bench-v2 <id>")
    .action((id) =>
      console.log(JSON.stringify(completePerfBenchV2(id), null, 2)),
    );
  parent
    .command("fail-bench-v2 <id> [reason]")
    .action((id, reason) =>
      console.log(JSON.stringify(failPerfBenchV2(id, reason), null, 2)),
    );
  parent
    .command("cancel-bench-v2 <id> [reason]")
    .action((id, reason) =>
      console.log(JSON.stringify(cancelPerfBenchV2(id, reason), null, 2)),
    );
  parent
    .command("get-bench-v2 <id>")
    .action((id) => console.log(JSON.stringify(getPerfBenchV2(id), null, 2)));
  parent
    .command("list-benches-v2")
    .action(() => console.log(JSON.stringify(listPerfBenchesV2(), null, 2)));
  parent
    .command("auto-stale-idle-v2")
    .action(() =>
      console.log(JSON.stringify(autoStaleIdlePerfTuningProfilesV2(), null, 2)),
    );
  parent
    .command("auto-fail-stuck-v2")
    .action(() =>
      console.log(JSON.stringify(autoFailStuckPerfBenchesV2(), null, 2)),
    );
  parent
    .command("gov-stats-v2")
    .action(() =>
      console.log(JSON.stringify(getPerfTuningGovStatsV2(), null, 2)),
    );
  parent.command("reset-state-v2").action(() => {
    _resetStatePerfTuningV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
