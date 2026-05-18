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
  PLAYBOOK_MATURITY_V2,
  REMEDIATION_LIFECYCLE_V2,
  getDefaultMaxActivePlaybooksPerOwnerV2,
  getMaxActivePlaybooksPerOwnerV2,
  setMaxActivePlaybooksPerOwnerV2,
  getDefaultMaxPendingRemediationsPerOwnerV2,
  getMaxPendingRemediationsPerOwnerV2,
  setMaxPendingRemediationsPerOwnerV2,
  getDefaultPlaybookStaleMsV2,
  getPlaybookStaleMsV2,
  setPlaybookStaleMsV2,
  getDefaultRemediationTimeoutMsV2,
  getRemediationTimeoutMsV2,
  setRemediationTimeoutMsV2,
  registerPlaybookV2,
  getPlaybookV2,
  setPlaybookMaturityV2,
  activatePlaybook,
  deprecatePlaybookV2,
  retirePlaybook,
  touchPlaybookActivity,
  submitRemediationV2,
  getRemediationV2,
  setRemediationStatusV2,
  startRemediation,
  completeRemediation,
  failRemediation,
  abortRemediation,
  getActivePlaybookCount,
  getPendingRemediationCount,
  autoRetireStalePlaybooks,
  autoTimeoutStuckRemediations,
  getAiOpsStatsV2,
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

  /* ── V2: Playbook Maturity + Remediation Lifecycle ───────── */

  ops
    .command("playbook-maturities-v2")
    .description("List playbook V2 maturity states")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = Object.values(PLAYBOOK_MATURITY_V2);
      if (opts.json) console.log(JSON.stringify(s));
      else s.forEach((v) => console.log(v));
    });

  ops
    .command("remediation-lifecycles-v2")
    .description("List remediation V2 lifecycle states")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = Object.values(REMEDIATION_LIFECYCLE_V2);
      if (opts.json) console.log(JSON.stringify(s));
      else s.forEach((v) => console.log(v));
    });

  ops
    .command("default-max-active-playbooks-per-owner")
    .description("Show default max-active-playbooks-per-owner")
    .action(() => console.log(getDefaultMaxActivePlaybooksPerOwnerV2()));
  ops
    .command("max-active-playbooks-per-owner")
    .description("Show current max-active-playbooks-per-owner")
    .action(() => console.log(getMaxActivePlaybooksPerOwnerV2()));
  ops
    .command("set-max-active-playbooks-per-owner <n>")
    .description("Set max-active-playbooks-per-owner")
    .action((n) => {
      setMaxActivePlaybooksPerOwnerV2(n);
      console.log(getMaxActivePlaybooksPerOwnerV2());
    });

  ops
    .command("default-max-pending-remediations-per-owner")
    .description("Show default max-pending-remediations-per-owner")
    .action(() => console.log(getDefaultMaxPendingRemediationsPerOwnerV2()));
  ops
    .command("max-pending-remediations-per-owner")
    .description("Show current max-pending-remediations-per-owner")
    .action(() => console.log(getMaxPendingRemediationsPerOwnerV2()));
  ops
    .command("set-max-pending-remediations-per-owner <n>")
    .description("Set max-pending-remediations-per-owner")
    .action((n) => {
      setMaxPendingRemediationsPerOwnerV2(n);
      console.log(getMaxPendingRemediationsPerOwnerV2());
    });

  ops
    .command("default-playbook-stale-ms")
    .description("Show default playbook-stale-ms")
    .action(() => console.log(getDefaultPlaybookStaleMsV2()));
  ops
    .command("playbook-stale-ms")
    .description("Show current playbook-stale-ms")
    .action(() => console.log(getPlaybookStaleMsV2()));
  ops
    .command("set-playbook-stale-ms <ms>")
    .description("Set playbook-stale-ms")
    .action((ms) => {
      setPlaybookStaleMsV2(ms);
      console.log(getPlaybookStaleMsV2());
    });

  ops
    .command("default-remediation-timeout-ms")
    .description("Show default remediation-timeout-ms")
    .action(() => console.log(getDefaultRemediationTimeoutMsV2()));
  ops
    .command("remediation-timeout-ms")
    .description("Show current remediation-timeout-ms")
    .action(() => console.log(getRemediationTimeoutMsV2()));
  ops
    .command("set-remediation-timeout-ms <ms>")
    .description("Set remediation-timeout-ms")
    .action((ms) => {
      setRemediationTimeoutMsV2(ms);
      console.log(getRemediationTimeoutMsV2());
    });

  ops
    .command("active-playbook-count")
    .description("Active playbook count (optionally scoped by owner)")
    .option("-o, --owner <id>", "Owner ID")
    .action((opts) => console.log(getActivePlaybookCount(opts.owner)));

  ops
    .command("pending-remediation-count")
    .description(
      "Pending/executing remediation count (optionally scoped by owner)",
    )
    .option("-o, --owner <id>", "Owner ID")
    .action((opts) => console.log(getPendingRemediationCount(opts.owner)));

  ops
    .command("register-playbook-v2 <playbook-id>")
    .description("Register a V2 playbook")
    .requiredOption("-o, --owner <id>", "Owner ID")
    .option("-n, --name <name>", "Name")
    .option("-i, --initial-status <status>", "Initial status (default draft)")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((playbookId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      const config = { playbookId, ownerId: opts.owner };
      if (opts.name) config.name = opts.name;
      if (opts.initialStatus) config.initialStatus = opts.initialStatus;
      if (opts.metadata) config.metadata = JSON.parse(opts.metadata);
      console.log(JSON.stringify(registerPlaybookV2(db, config), null, 2));
    });

  ops
    .command("playbook-v2 <playbook-id>")
    .description("Get V2 playbook record")
    .action((playbookId) => {
      const rec = getPlaybookV2(playbookId);
      console.log(rec ? JSON.stringify(rec, null, 2) : "null");
    });

  ops
    .command("set-playbook-maturity-v2 <playbook-id> <status>")
    .description("Set playbook V2 maturity status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON patch")
    .action((playbookId, status, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      const patch = {};
      if (opts.reason !== undefined) patch.reason = opts.reason;
      if (opts.metadata) patch.metadata = JSON.parse(opts.metadata);
      console.log(
        JSON.stringify(
          setPlaybookMaturityV2(db, playbookId, status, patch),
          null,
          2,
        ),
      );
    });

  ops
    .command("activate-playbook <playbook-id>")
    .description("Transition playbook → active")
    .option("-r, --reason <reason>", "Reason")
    .action((playbookId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      console.log(
        JSON.stringify(activatePlaybook(db, playbookId, opts.reason), null, 2),
      );
    });

  ops
    .command("deprecate-playbook-v2 <playbook-id>")
    .description("Transition playbook → deprecated")
    .option("-r, --reason <reason>", "Reason")
    .action((playbookId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      console.log(
        JSON.stringify(
          deprecatePlaybookV2(db, playbookId, opts.reason),
          null,
          2,
        ),
      );
    });

  ops
    .command("retire-playbook <playbook-id>")
    .description("Transition playbook → retired (terminal)")
    .option("-r, --reason <reason>", "Reason")
    .action((playbookId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      console.log(
        JSON.stringify(retirePlaybook(db, playbookId, opts.reason), null, 2),
      );
    });

  ops
    .command("touch-playbook-activity <playbook-id>")
    .description("Bump lastUsedAt for a playbook")
    .action((playbookId) => {
      console.log(JSON.stringify(touchPlaybookActivity(playbookId), null, 2));
    });

  ops
    .command("submit-remediation-v2 <remediation-id>")
    .description("Submit a V2 remediation")
    .requiredOption("-o, --owner <id>", "Owner ID")
    .requiredOption("-p, --playbook <id>", "Playbook ID")
    .option("-i, --incident <id>", "Incident ID")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((remediationId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      const config = {
        remediationId,
        ownerId: opts.owner,
        playbookId: opts.playbook,
      };
      if (opts.incident) config.incidentId = opts.incident;
      if (opts.metadata) config.metadata = JSON.parse(opts.metadata);
      console.log(JSON.stringify(submitRemediationV2(db, config), null, 2));
    });

  ops
    .command("remediation-v2 <remediation-id>")
    .description("Get V2 remediation record")
    .action((remediationId) => {
      const rec = getRemediationV2(remediationId);
      console.log(rec ? JSON.stringify(rec, null, 2) : "null");
    });

  ops
    .command("set-remediation-status-v2 <remediation-id> <status>")
    .description("Set remediation V2 status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON patch")
    .action((remediationId, status, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      const patch = {};
      if (opts.reason !== undefined) patch.reason = opts.reason;
      if (opts.metadata) patch.metadata = JSON.parse(opts.metadata);
      console.log(
        JSON.stringify(
          setRemediationStatusV2(db, remediationId, status, patch),
          null,
          2,
        ),
      );
    });

  ops
    .command("start-remediation <remediation-id>")
    .description("Transition remediation → executing")
    .option("-r, --reason <reason>", "Reason")
    .action((remediationId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      console.log(
        JSON.stringify(
          startRemediation(db, remediationId, opts.reason),
          null,
          2,
        ),
      );
    });

  ops
    .command("complete-remediation <remediation-id>")
    .description("Transition remediation → succeeded (terminal)")
    .option("-r, --reason <reason>", "Reason")
    .action((remediationId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      console.log(
        JSON.stringify(
          completeRemediation(db, remediationId, opts.reason),
          null,
          2,
        ),
      );
    });

  ops
    .command("fail-remediation <remediation-id>")
    .description("Transition remediation → failed (terminal)")
    .option("-r, --reason <reason>", "Reason")
    .action((remediationId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      console.log(
        JSON.stringify(
          failRemediation(db, remediationId, opts.reason),
          null,
          2,
        ),
      );
    });

  ops
    .command("abort-remediation <remediation-id>")
    .description("Transition remediation → aborted (terminal)")
    .option("-r, --reason <reason>", "Reason")
    .action((remediationId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      console.log(
        JSON.stringify(
          abortRemediation(db, remediationId, opts.reason),
          null,
          2,
        ),
      );
    });

  ops
    .command("auto-retire-stale-playbooks")
    .description("Bulk-flip stale playbooks → retired")
    .action((_opts, cmd) => {
      const db = _dbFromCtx(cmd);
      const flipped = autoRetireStalePlaybooks(db);
      console.log(JSON.stringify(flipped));
    });

  ops
    .command("auto-timeout-stuck-remediations")
    .description("Bulk-flip stuck executing remediations → failed")
    .action((_opts, cmd) => {
      const db = _dbFromCtx(cmd);
      const flipped = autoTimeoutStuckRemediations(db);
      console.log(JSON.stringify(flipped));
    });

  ops
    .command("stats-v2")
    .description("Show V2 AIOps stats (all-enum-key)")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = getAiOpsStatsV2();
      if (opts.json) console.log(JSON.stringify(s));
      else console.log(JSON.stringify(s, null, 2));
    });

  program.addCommand(ops);
}

// === Iter18 V2 governance overlay ===
export function registerAiopsgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "ops");
  if (!parent) return;
  const L = async () => await import("../lib/aiops.js");
  parent
    .command("aiopsgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.AIOPSGOV_PROFILE_MATURITY_V2,
            incidentLifecycle: m.AIOPSGOV_INCIDENT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("aiopsgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveAiopsgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingAiopsgovIncidentsPerProfileV2(),
            idleMs: m.getAiopsgovProfileIdleMsV2(),
            stuckMs: m.getAiopsgovIncidentStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("aiopsgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveAiopsgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aiopsgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingAiopsgovIncidentsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aiopsgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setAiopsgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aiopsgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setAiopsgovIncidentStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aiopsgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--mode <v>", "mode")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerAiopsgovProfileV2({ id, owner, mode: o.mode }),
          null,
          2,
        ),
      );
    });
  parent
    .command("aiopsgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateAiopsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleAiopsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveAiopsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchAiopsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getAiopsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listAiopsgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("aiopsgov-create-incident-v2 <id> <profileId>")
    .description("Create incident")
    .option("--summary <v>", "summary")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createAiopsgovIncidentV2({ id, profileId, summary: o.summary }),
          null,
          2,
        ),
      );
    });
  parent
    .command("aiopsgov-triaging-incident-v2 <id>")
    .description("Mark incident as triaging")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).triagingAiopsgovIncidentV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-complete-incident-v2 <id>")
    .description("Complete incident")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeIncidentAiopsgovV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-fail-incident-v2 <id> [reason]")
    .description("Fail incident")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failAiopsgovIncidentV2(id, reason), null, 2),
      );
    });
  parent
    .command("aiopsgov-cancel-incident-v2 <id> [reason]")
    .description("Cancel incident")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelAiopsgovIncidentV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("aiopsgov-get-incident-v2 <id>")
    .description("Get incident")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getAiopsgovIncidentV2(id), null, 2),
      );
    });
  parent
    .command("aiopsgov-list-incidents-v2")
    .description("List incidents")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listAiopsgovIncidentsV2(), null, 2),
      );
    });
  parent
    .command("aiopsgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleAiopsgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("aiopsgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck incidents")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckAiopsgovIncidentsV2(), null, 2),
      );
    });
  parent
    .command("aiopsgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getAiopsGovStatsV2(), null, 2));
    });
}
