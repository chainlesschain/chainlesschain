/**
 * `cc ops` — CLI surface for Autonomous Ops (AIOps).
 */

import { Command } from "commander";

import {
  SEVERITY,
  INCIDENT_STATUS,
  DETECTION_ALGORITHM,
  ROLLBACK_TYPE,
  ensureAiOpsTables,
  updateBaseline,
  getBaseline,
  listBaselines,
  detectAnomaly,
  createIncident,
  getIncident,
  acknowledgeIncident,
  resolveIncident,
  closeIncident,
  listIncidents,
  createPlaybook,
  getPlaybook,
  togglePlaybook,
  recordPlaybookResult,
  listPlaybooks,
  generatePostmortem,
  getOpsStats,
} from "../lib/aiops.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerOpsCommand(program) {
  const ops = new Command("ops")
    .description("Autonomous operations / AIOps")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureAiOpsTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  ops
    .command("severities")
    .description("List severity levels")
    .option("--json", "JSON output")
    .action((opts) => {
      const sevs = Object.values(SEVERITY);
      if (opts.json) return console.log(JSON.stringify(sevs, null, 2));
      for (const s of sevs) console.log(`  ${s}`);
    });

  ops
    .command("statuses")
    .description("List incident statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const sts = Object.values(INCIDENT_STATUS);
      if (opts.json) return console.log(JSON.stringify(sts, null, 2));
      for (const s of sts) console.log(`  ${s}`);
    });

  ops
    .command("algorithms")
    .description("List detection algorithms")
    .option("--json", "JSON output")
    .action((opts) => {
      const algos = Object.values(DETECTION_ALGORITHM);
      if (opts.json) return console.log(JSON.stringify(algos, null, 2));
      for (const a of algos) console.log(`  ${a}`);
    });

  ops
    .command("rollback-types")
    .description("List rollback types")
    .option("--json", "JSON output")
    .action((opts) => {
      const types = Object.values(ROLLBACK_TYPE);
      if (opts.json) return console.log(JSON.stringify(types, null, 2));
      for (const t of types) console.log(`  ${t}`);
    });

  /* ── Baselines ───────────────────────────────────── */

  ops
    .command("baseline-update <metric>")
    .description("Update metric baseline from values")
    .requiredOption("-v, --values <csv>", "Comma-separated values")
    .option("--json", "JSON output")
    .action((metric, opts) => {
      const db = _dbFromCtx(ops);
      const values = opts.values
        .split(",")
        .map(Number)
        .filter((n) => !isNaN(n));
      const result = updateBaseline(db, metric, values);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.updated) {
        const b = result.baseline;
        console.log(`Baseline updated: ${metric}`);
        console.log(
          `  mean=${b.mean}  stddev=${b.std_dev}  q1=${b.q1}  q3=${b.q3}  samples=${b.sample_count}`,
        );
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  ops
    .command("baseline-show <metric>")
    .description("Show metric baseline")
    .option("--json", "JSON output")
    .action((metric, opts) => {
      const db = _dbFromCtx(ops);
      const b = getBaseline(db, metric);
      if (!b) return console.log("Baseline not found.");
      if (opts.json) return console.log(JSON.stringify(b, null, 2));
      console.log(`Metric:  ${b.metric_name}`);
      console.log(`Mean:    ${b.mean}`);
      console.log(`StdDev:  ${b.std_dev}`);
      console.log(`Q1:      ${b.q1}`);
      console.log(`Q3:      ${b.q3}`);
      console.log(`Samples: ${b.sample_count}`);
    });

  ops
    .command("baselines")
    .description("List metric baselines")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ops);
      const bls = listBaselines(db);
      if (opts.json) return console.log(JSON.stringify(bls, null, 2));
      if (bls.length === 0) return console.log("No baselines.");
      for (const b of bls) {
        console.log(
          `  ${b.metric_name.padEnd(20)} mean=${String(b.mean).padEnd(8)} stddev=${String(b.std_dev).padEnd(8)} n=${b.sample_count}`,
        );
      }
    });

  /* ── Anomaly Detection ───────────────────────────── */

  ops
    .command("detect <metric> <value>")
    .description("Detect anomaly for a metric value")
    .option("-a, --algorithm <algo>", "Algorithm (z_score|iqr)", "z_score")
    .option("--json", "JSON output")
    .action((metric, value, opts) => {
      const db = _dbFromCtx(ops);
      const result = detectAnomaly(db, {
        metricName: metric,
        value: parseFloat(value),
        algorithm: opts.algorithm,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.reason) return console.log(`Cannot detect: ${result.reason}`);
      if (result.anomaly) {
        console.log(
          `⚠ ANOMALY: ${metric}=${value} (${result.algorithm} score=${result.score})`,
        );
        if (result.incidentId)
          console.log(`  Incident: ${result.incidentId} [${result.severity}]`);
      } else {
        console.log(
          `OK: ${metric}=${value} within normal range (score=${result.score})`,
        );
      }
    });

  /* ── Incidents ───────────────────────────────────── */

  ops
    .command("incident-create")
    .description("Create an incident manually")
    .option("-m, --metric <name>", "Anomaly metric")
    .option("-s, --severity <P0-P3>", "Severity", "P3")
    .option("-d, --description <text>", "Description")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ops);
      const result = createIncident(db, {
        anomalyMetric: opts.metric,
        severity: opts.severity,
        description: opts.description,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Incident created: ${result.incidentId}`);
    });

  ops
    .command("incident-show <id>")
    .description("Show incident details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(ops);
      const i = getIncident(db, id);
      if (!i) return console.log("Incident not found.");
      if (opts.json) return console.log(JSON.stringify(i, null, 2));
      console.log(`ID:       ${i.id}`);
      console.log(`Severity: ${i.severity}`);
      console.log(`Status:   ${i.status}`);
      if (i.anomaly_metric) console.log(`Metric:   ${i.anomaly_metric}`);
      if (i.description) console.log(`Desc:     ${i.description.slice(0, 80)}`);
    });

  ops
    .command("incident-ack <id>")
    .description("Acknowledge an incident")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(ops);
      const result = acknowledgeIncident(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.acknowledged
          ? "Incident acknowledged."
          : `Failed: ${result.reason}`,
      );
    });

  ops
    .command("incident-resolve <id>")
    .description("Resolve an incident")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(ops);
      const result = resolveIncident(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.resolved ? "Incident resolved." : `Failed: ${result.reason}`,
      );
    });

  ops
    .command("incident-close <id>")
    .description("Close a resolved incident")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(ops);
      const result = closeIncident(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.closed ? "Incident closed." : `Failed: ${result.reason}`,
      );
    });

  ops
    .command("incidents")
    .description("List incidents")
    .option("-s, --severity <P0-P3>", "Filter by severity")
    .option("-S, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ops);
      const incs = listIncidents(db, {
        severity: opts.severity,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(incs, null, 2));
      if (incs.length === 0) return console.log("No incidents.");
      for (const i of incs) {
        console.log(
          `  [${i.severity}] ${i.status.padEnd(14)} ${(i.anomaly_metric || "").padEnd(20)} ${i.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Playbooks ───────────────────────────────────── */

  ops
    .command("playbook-create")
    .description("Create remediation playbook")
    .requiredOption("-n, --name <name>", "Playbook name")
    .option("-t, --trigger <json>", "Trigger condition JSON")
    .option("-s, --steps <json>", "Steps JSON")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ops);
      const result = createPlaybook(db, {
        name: opts.name,
        triggerCondition: opts.trigger,
        steps: opts.steps,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.playbookId)
        console.log(`Playbook created: ${result.playbookId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  ops
    .command("playbook-show <id>")
    .description("Show playbook details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(ops);
      const p = getPlaybook(db, id);
      if (!p) return console.log("Playbook not found.");
      if (opts.json) return console.log(JSON.stringify(p, null, 2));
      console.log(`ID:       ${p.id}`);
      console.log(`Name:     ${p.name}`);
      console.log(`Enabled:  ${p.enabled ? "YES" : "NO"}`);
      console.log(`Success:  ${p.success_count}  Failure: ${p.failure_count}`);
      if (p.trigger_condition) console.log(`Trigger:  ${p.trigger_condition}`);
      if (p.steps) console.log(`Steps:    ${p.steps}`);
    });

  ops
    .command("playbook-toggle <id> <on|off>")
    .description("Enable or disable a playbook")
    .option("--json", "JSON output")
    .action((id, state, opts) => {
      const db = _dbFromCtx(ops);
      const result = togglePlaybook(db, id, state === "on");
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.toggled
          ? `Playbook ${result.enabled ? "enabled" : "disabled"}.`
          : `Failed: ${result.reason}`,
      );
    });

  ops
    .command("playbook-record <id> <success|failure>")
    .description("Record playbook execution result")
    .option("--json", "JSON output")
    .action((id, outcome, opts) => {
      const db = _dbFromCtx(ops);
      const result = recordPlaybookResult(db, id, outcome === "success");
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.recorded
          ? `Recorded. Success=${result.successCount} Failure=${result.failureCount}`
          : `Failed: ${result.reason}`,
      );
    });

  ops
    .command("playbooks")
    .description("List playbooks")
    .option("-e, --enabled", "Only enabled")
    .option("-d, --disabled", "Only disabled")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ops);
      const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
      const pbs = listPlaybooks(db, { enabled, limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(pbs, null, 2));
      if (pbs.length === 0) return console.log("No playbooks.");
      for (const p of pbs) {
        console.log(
          `  ${p.enabled ? "ON " : "OFF"} ${p.name.padEnd(24)} ok:${String(p.success_count).padEnd(3)} fail:${String(p.failure_count).padEnd(3)} ${p.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Postmortem ──────────────────────────────────── */

  ops
    .command("postmortem <id>")
    .description("Generate postmortem for resolved incident")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(ops);
      const result = generatePostmortem(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (!result.generated) return console.log(`Failed: ${result.reason}`);
      const pm = result.postmortem;
      console.log(`Postmortem for ${pm.incidentId} [${pm.severity}]`);
      console.log(`  Metric:    ${pm.metric || "N/A"}`);
      console.log(`  Impact:    ${pm.impact}`);
      console.log(`  Root Cause: ${pm.rootCause}`);
      console.log(`  TTR:       ${pm.timeline.timeToResolveMs}ms`);
      if (pm.timeline.timeToAcknowledgeMs != null)
        console.log(`  TTA:       ${pm.timeline.timeToAcknowledgeMs}ms`);
    });

  /* ── Stats ───────────────────────────────────────── */

  ops
    .command("stats")
    .description("AIOps statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ops);
      const s = getOpsStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Incidents: ${s.incidents.total}  (avg resolve ${s.incidents.avgResolveMs}ms)`,
      );
      for (const [sev, count] of Object.entries(s.incidents.bySeverity)) {
        if (count > 0) console.log(`  ${sev}: ${count}`);
      }
      console.log(
        `Playbooks: ${s.playbooks.total}  (${s.playbooks.enabled} enabled, ${s.playbooks.totalSuccess} ok / ${s.playbooks.totalFailure} fail)`,
      );
      console.log(`Baselines: ${s.baselines.total} metrics`);
    });

  program.addCommand(ops);
}
