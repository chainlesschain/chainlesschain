/**
 * `cc pipeline` — CLI port of Phase 26 开发流水线编排.
 *
 * 7-stage pipeline (需求→架构→代码→测试→审查→部署→监控) with 4
 * templates (feature / bugfix / refactor / security-audit) and 6
 * deployment strategies. Gate approval at code-review & deploy stages.
 */

import { Command } from "commander";

import {
  PIPELINE_STATUS,
  STAGE_STATUS,
  DEPLOY_STRATEGY,
  DEPLOY_STATUS,
  ARTIFACT_TYPE,
  ensurePipelineTables,
  createPipeline,
  startPipeline,
  pausePipeline,
  resumePipeline,
  cancelPipeline,
  completeStage,
  failStage,
  retryStage,
  approveGate,
  rejectGate,
  addArtifact,
  listArtifacts,
  getPipeline,
  listPipelines,
  getStage,
  getTemplates,
  getConfig,
  recordDeploy,
  getDeploy,
  listDeploys,
  rollbackDeploy,
  recordMonitorEvent,
  listMonitorEvents,
  getMonitorStatus,
  exportPipeline,
  getStats,
} from "../lib/pipeline-orchestrator.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

function _json(v) {
  console.log(JSON.stringify(v, null, 2));
}

function _parseJsonArg(s, fallback) {
  if (s == null) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function registerPipelineCommand(program) {
  const pipeline = new Command("pipeline")
    .alias("pipe")
    .description(
      "Development Pipeline Orchestration (Phase 26) — 7-stage AI dev pipeline + gates + deploys",
    )
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensurePipelineTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  pipeline
    .command("config")
    .description("Show pipeline system config (stages, statuses, strategies)")
    .action(() => _json(getConfig()));

  pipeline
    .command("templates")
    .description(
      "List project templates (feature / bugfix / refactor / security-audit)",
    )
    .action(() => _json(getTemplates()));

  pipeline
    .command("stages")
    .description("List all 7 pipeline stage names")
    .action(() => _json(getConfig().stages));

  pipeline
    .command("deploy-strategies")
    .description("List 6 deployment strategies")
    .action(() => _json(Object.values(DEPLOY_STRATEGY)));

  pipeline
    .command("statuses")
    .description("List pipeline + stage status values")
    .action(() =>
      _json({
        pipeline: Object.values(PIPELINE_STATUS),
        stage: Object.values(STAGE_STATUS),
        deploy: Object.values(DEPLOY_STATUS),
      }),
    );

  /* ── Pipeline lifecycle ──────────────────────────── */

  pipeline
    .command("create")
    .description("Create a new pipeline from a template")
    .requiredOption(
      "-t, --template <name>",
      "Template (feature/bugfix/refactor/security-audit)",
    )
    .option("-n, --name <name>", "Pipeline display name")
    .option("-c, --config <json>", "Pipeline config as JSON")
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      const p = createPipeline(db, {
        template: opts.template,
        name: opts.name || null,
        config: _parseJsonArg(opts.config, {}),
      });
      _json(p);
    });

  pipeline
    .command("start <pipelineId>")
    .description("Start pipeline execution (advances to first stage)")
    .action((pipelineId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(startPipeline(db, pipelineId));
    });

  pipeline
    .command("pause <pipelineId>")
    .description("Pause running pipeline")
    .action((pipelineId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(pausePipeline(db, pipelineId));
    });

  pipeline
    .command("resume <pipelineId>")
    .description("Resume paused pipeline")
    .action((pipelineId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(resumePipeline(db, pipelineId));
    });

  pipeline
    .command("cancel <pipelineId>")
    .description("Cancel pipeline")
    .option("-r, --reason <text>", "Cancellation reason")
    .action((pipelineId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(cancelPipeline(db, pipelineId, opts.reason || "cancelled by user"));
    });

  /* ── Stage execution ─────────────────────────────── */

  pipeline
    .command("complete <pipelineId>")
    .description("Complete current stage with output and advance")
    .option("-o, --output <json>", "Stage output as JSON")
    .option("-a, --artifacts <json>", "Artifacts array as JSON")
    .action((pipelineId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        completeStage(db, pipelineId, {
          output: _parseJsonArg(opts.output, null),
          artifacts: _parseJsonArg(opts.artifacts, []),
        }),
      );
    });

  pipeline
    .command("fail <pipelineId>")
    .description("Fail current stage and pipeline")
    .option("-e, --error <message>", "Error message")
    .action((pipelineId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(failStage(db, pipelineId, opts.error || "stage failed"));
    });

  pipeline
    .command("retry <pipelineId>")
    .description("Retry a specific stage (reset to running)")
    .requiredOption("-s, --stage <index>", "Stage index (0-based)", (v) =>
      parseInt(v, 10),
    )
    .action((pipelineId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(retryStage(db, pipelineId, opts.stage));
    });

  /* ── Gate approval ───────────────────────────────── */

  pipeline
    .command("approve <pipelineId>")
    .description("Approve current gate (code-review / deploy)")
    .action((pipelineId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(approveGate(db, pipelineId));
    });

  pipeline
    .command("reject <pipelineId>")
    .description("Reject current gate (fails the pipeline)")
    .option("-r, --reason <text>", "Rejection reason")
    .action((pipelineId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(rejectGate(db, pipelineId, opts.reason || "gate rejected"));
    });

  /* ── Artifacts ───────────────────────────────────── */

  pipeline
    .command("artifact-add <pipelineId>")
    .description("Add an artifact to a stage")
    .requiredOption("-s, --stage <index>", "Stage index", (v) =>
      parseInt(v, 10),
    )
    .requiredOption("-n, --name <name>", "Artifact name")
    .option(
      "-t, --type <type>",
      "Artifact type (document/code/report/config/deploy-result)",
      ARTIFACT_TYPE.DOCUMENT,
    )
    .option("-c, --content <text>", "Artifact content (inline)")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((pipelineId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        addArtifact(db, pipelineId, opts.stage, {
          name: opts.name,
          type: opts.type,
          content: opts.content || "",
          metadata: _parseJsonArg(opts.metadata, {}),
        }),
      );
    });

  pipeline
    .command("artifacts <pipelineId>")
    .description("List artifacts for a pipeline")
    .option("-s, --stage <index>", "Filter by stage index", (v) =>
      parseInt(v, 10),
    )
    .action((pipelineId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        listArtifacts(db, pipelineId, opts.stage != null ? opts.stage : null),
      );
    });

  /* ── Queries ─────────────────────────────────────── */

  pipeline
    .command("show <pipelineId>")
    .description("Show pipeline with stages")
    .action((pipelineId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      const p = getPipeline(db, pipelineId);
      if (!p) return console.error(`Pipeline not found: ${pipelineId}`);
      _json(p);
    });

  pipeline
    .command("list")
    .description("List pipelines")
    .option("-t, --template <name>", "Filter by template")
    .option("-s, --status <name>", "Filter by status")
    .option("-l, --limit <n>", "Max rows", (v) => parseInt(v, 10), 100)
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        listPipelines(db, {
          template: opts.template,
          status: opts.status,
          limit: opts.limit,
        }),
      );
    });

  pipeline
    .command("stage <pipelineId> <stageIndex>")
    .description("Show a specific stage")
    .action((pipelineId, stageIndex, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(getStage(db, pipelineId, parseInt(stageIndex, 10)));
    });

  /* ── Deployments ─────────────────────────────────── */

  pipeline
    .command("deploy")
    .description("Record a deployment (CLI does not actually deploy)")
    .requiredOption(
      "-s, --strategy <name>",
      "Strategy (git-pr/docker/npm-publish/local/staging/custom)",
    )
    .option("-p, --pipeline <id>", "Associated pipeline ID")
    .option("-c, --config <json>", "Deploy config as JSON")
    .option("-r, --result <json>", "Deploy result as JSON")
    .option("--status <value>", "Initial status", DEPLOY_STATUS.SUCCEEDED)
    .option("-e, --error <msg>", "Error message (for failed status)")
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        recordDeploy(db, {
          pipelineId: opts.pipeline || null,
          strategy: opts.strategy,
          config: _parseJsonArg(opts.config, {}),
          result: _parseJsonArg(opts.result, null),
          status: opts.status,
          errorMessage: opts.error || null,
        }),
      );
    });

  pipeline
    .command("deploys")
    .description("List deployments")
    .option("-p, --pipeline <id>", "Filter by pipeline ID")
    .option("-s, --strategy <name>", "Filter by strategy")
    .option("--status <value>", "Filter by status")
    .option("-l, --limit <n>", "Max rows", (v) => parseInt(v, 10), 100)
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        listDeploys(db, {
          pipelineId: opts.pipeline,
          strategy: opts.strategy,
          status: opts.status,
          limit: opts.limit,
        }),
      );
    });

  pipeline
    .command("deploy-show <deployId>")
    .description("Show a deployment record")
    .action((deployId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(getDeploy(db, deployId));
    });

  pipeline
    .command("rollback <deployId>")
    .description("Rollback a succeeded deployment")
    .option("-r, --reason <text>", "Rollback reason")
    .action((deployId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(rollbackDeploy(db, deployId, opts.reason || "rollback requested"));
    });

  /* ── Monitoring ──────────────────────────────────── */

  pipeline
    .command("monitor-record <deployId>")
    .description("Record a post-deploy monitoring event (health check)")
    .option(
      "-t, --type <name>",
      "Event type (health-check/alert/rollback-trigger)",
      "health-check",
    )
    .option(
      "-s, --status <name>",
      "Health status (healthy/degraded/unhealthy)",
      "healthy",
    )
    .option("-m, --metrics <json>", "Metrics JSON", "{}")
    .action((deployId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        recordMonitorEvent(db, deployId, {
          eventType: opts.type,
          healthStatus: opts.status,
          metrics: _parseJsonArg(opts.metrics, {}),
        }),
      );
    });

  pipeline
    .command("monitor-events <deployId>")
    .description("List monitoring events for a deploy")
    .option("-l, --limit <n>", "Max rows", (v) => parseInt(v, 10), 100)
    .action((deployId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(listMonitorEvents(db, deployId, { limit: opts.limit }));
    });

  pipeline
    .command("monitor-status <deployId>")
    .description("Show latest monitoring status")
    .action((deployId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(getMonitorStatus(db, deployId));
    });

  /* ── Export / Stats ──────────────────────────────── */

  pipeline
    .command("export <pipelineId>")
    .description("Export pipeline + stages + artifacts + deploys as JSON")
    .action((pipelineId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(exportPipeline(db, pipelineId));
    });

  pipeline
    .command("stats")
    .description("Show pipeline system stats")
    .action((_opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(getStats(db));
    });

  _registerPipelineV2Commands(pipeline);
  program.addCommand(pipeline);
}
function _registerPipelineV2Commands(parent) {
  const L = async () => await import("../lib/pipeline-orchestrator.js");

  parent
    .command("enums-v2")
    .description("Show V2 enums (pipeline maturity + run lifecycle)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            pipelineMaturity: m.PIPELINE_MATURITY_V2,
            runLifecycle: m.PIPELINE_RUN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("config-v2")
    .description("Show V2 config thresholds")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActivePipelinesPerOwner: m.getMaxActivePipelinesPerOwnerV2(),
            maxPendingPipelineRunsPerPipeline:
              m.getMaxPendingPipelineRunsPerPipelineV2(),
            pipelineIdleMs: m.getPipelineIdleMsV2(),
            pipelineRunStuckMs: m.getPipelineRunStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("set-max-active-pipelines-v2 <n>")
    .description("Set max active pipelines per owner")
    .action(async (n) => {
      const m = await L();
      m.setMaxActivePipelinesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("set-max-pending-runs-v2 <n>")
    .description("Set max pending runs per pipeline")
    .action(async (n) => {
      const m = await L();
      m.setMaxPendingPipelineRunsPerPipelineV2(Number(n));
      console.log("ok");
    });
  parent
    .command("set-pipeline-idle-ms-v2 <n>")
    .description("Set pipeline idle threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setPipelineIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("set-run-stuck-ms-v2 <n>")
    .description("Set run stuck threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setPipelineRunStuckMsV2(Number(n));
      console.log("ok");
    });

  parent
    .command("register-pipeline-v2 <id> <owner>")
    .description("Register V2 pipeline")
    .option("--name <n>", "Pipeline name")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPipelineV2({ id, owner, name: o.name }),
          null,
          2,
        ),
      );
    });
  parent
    .command("activate-pipeline-v2 <id>")
    .description("Activate pipeline")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.activatePipelineV2(id), null, 2));
    });
  parent
    .command("pause-pipeline-v2 <id>")
    .description("Pause pipeline")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.pausePipelineV2(id), null, 2));
    });
  parent
    .command("archive-pipeline-v2 <id>")
    .description("Archive pipeline (terminal)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.archivePipelineV2(id), null, 2));
    });
  parent
    .command("touch-pipeline-v2 <id>")
    .description("Touch pipeline lastTouchedAt")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.touchPipelineV2(id), null, 2));
    });
  parent
    .command("get-pipeline-v2 <id>")
    .description("Get V2 pipeline")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getPipelineV2(id), null, 2));
    });
  parent
    .command("list-pipelines-v2")
    .description("List all V2 pipelines")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listPipelinesV2(), null, 2));
    });

  parent
    .command("create-run-v2 <id> <pipelineId>")
    .description("Create V2 pipeline run (queued)")
    .option("--trigger <t>", "Trigger", "manual")
    .action(async (id, pipelineId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPipelineRunV2({ id, pipelineId, trigger: o.trigger }),
          null,
          2,
        ),
      );
    });
  parent
    .command("start-run-v2 <id>")
    .description("Start run (queued→running)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.startPipelineRunV2(id), null, 2));
    });
  parent
    .command("complete-run-v2 <id>")
    .description("Complete run (running→completed)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.completePipelineRunV2(id), null, 2));
    });
  parent
    .command("fail-run-v2 <id> [reason]")
    .description("Fail run")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.failPipelineRunV2(id, reason), null, 2));
    });
  parent
    .command("cancel-run-v2 <id> [reason]")
    .description("Cancel run")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.cancelPipelineRunV2(id, reason), null, 2));
    });
  parent
    .command("get-run-v2 <id>")
    .description("Get V2 run")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getPipelineRunV2(id), null, 2));
    });
  parent
    .command("list-runs-v2")
    .description("List all V2 runs")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listPipelineRunsV2(), null, 2));
    });

  parent
    .command("auto-pause-idle-v2")
    .description("Auto-pause idle active pipelines")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoPauseIdlePipelinesV2(), null, 2));
    });
  parent
    .command("auto-fail-stuck-v2")
    .description("Auto-fail stuck running runs")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoFailStuckPipelineRunsV2(), null, 2));
    });

  parent
    .command("gov-stats-v2")
    .description("V2 governance aggregate stats")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(m.getPipelineOrchestratorGovStatsV2(), null, 2),
      );
    });
}

// === Iter28 V2 governance overlay: Pipogov ===
export function registerPipoV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "pipeline");
  if (!parent) return;
  const L = async () => await import("../lib/pipeline-orchestrator.js");
  parent
    .command("pipogov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PIPOGOV_PROFILE_MATURITY_V2,
            runLifecycle: m.PIPOGOV_RUN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pipogov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePipoProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPipoRunsPerProfileV2(),
            idleMs: m.getPipoProfileIdleMsV2(),
            stuckMs: m.getPipoRunStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pipogov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePipoProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pipogov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPipoRunsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pipogov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPipoProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pipogov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPipoRunStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pipogov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--pipeline <v>", "pipeline")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPipoProfileV2({ id, owner, pipeline: o.pipeline }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pipogov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePipoProfileV2(id), null, 2),
      );
    });
  parent
    .command("pipogov-paused-v2 <id>")
    .description("Paused profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).pausedPipoProfileV2(id), null, 2));
    });
  parent
    .command("pipogov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePipoProfileV2(id), null, 2),
      );
    });
  parent
    .command("pipogov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchPipoProfileV2(id), null, 2));
    });
  parent
    .command("pipogov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPipoProfileV2(id), null, 2));
    });
  parent
    .command("pipogov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPipoProfilesV2(), null, 2));
    });
  parent
    .command("pipogov-create-run-v2 <id> <profileId>")
    .description("Create run")
    .option("--runId <v>", "runId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPipoRunV2({ id, profileId, runId: o.runId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pipogov-running-run-v2 <id>")
    .description("Mark run as running")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).runningPipoRunV2(id), null, 2));
    });
  parent
    .command("pipogov-complete-run-v2 <id>")
    .description("Complete run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeRunPipoV2(id), null, 2));
    });
  parent
    .command("pipogov-fail-run-v2 <id> [reason]")
    .description("Fail run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPipoRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("pipogov-cancel-run-v2 <id> [reason]")
    .description("Cancel run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPipoRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("pipogov-get-run-v2 <id>")
    .description("Get run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPipoRunV2(id), null, 2));
    });
  parent
    .command("pipogov-list-runs-v2")
    .description("List runs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPipoRunsV2(), null, 2));
    });
  parent
    .command("pipogov-auto-paused-idle-v2")
    .description("Auto-paused idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPausedIdlePipoProfilesV2(), null, 2),
      );
    });
  parent
    .command("pipogov-auto-fail-stuck-v2")
    .description("Auto-fail stuck runs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPipoRunsV2(), null, 2),
      );
    });
  parent
    .command("pipogov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getPipogovStatsV2(), null, 2));
    });
}
