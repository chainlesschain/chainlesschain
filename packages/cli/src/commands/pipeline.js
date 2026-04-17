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

  program.addCommand(pipeline);
}
