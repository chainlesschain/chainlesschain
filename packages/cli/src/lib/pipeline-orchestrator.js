/**
 * Pipeline Orchestrator — CLI port of Phase 26 开发流水线编排
 * (docs/design/modules/26_开发流水线编排.md).
 *
 * Desktop ships a 1,180-line PipelineOrchestrator + DeployAgent +
 * PostDeployMonitor that drive a 7-stage AI development pipeline
 * (requirement → architecture → code-gen → testing → code-review →
 * deploy → monitoring) across 4 project templates (feature / bugfix /
 * refactor / security-audit) with 6 deployment strategies and manual
 * gate approval at the review/deploy boundaries.
 *
 * CLI port is headless and single-process:
 * - Stage *execution* is caller-driven: `completeStage` records the
 *   output + artifacts and advances to the next stage. The CLI does
 *   NOT itself run the AI requirement parser / code generator / test
 *   runner — it's a bookkeeping + state-machine engine.
 * - Deployments are recorded (strategy + status + result) but the CLI
 *   does NOT perform real git/docker/npm actions. Rollback flips the
 *   stored status only.
 * - Post-deploy monitoring is log-only (append event rows). No real
 *   timers or HTTP health checks.
 */

import crypto from "crypto";

/* ── Constants ───────────────────────────────────────────── */

export const STAGE = Object.freeze({
  REQUIREMENT: "requirement",
  ARCHITECTURE: "architecture",
  CODE_GENERATION: "code-generation",
  TESTING: "testing",
  CODE_REVIEW: "code-review",
  DEPLOY: "deploy",
  MONITORING: "monitoring",
});

export const PIPELINE_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const STAGE_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  GATE_WAITING: "gate-waiting",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const DEPLOY_STRATEGY = Object.freeze({
  GIT_PR: "git-pr",
  DOCKER: "docker",
  NPM_PUBLISH: "npm-publish",
  LOCAL: "local",
  STAGING: "staging",
  CUSTOM: "custom",
});

export const DEPLOY_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  ROLLED_BACK: "rolled-back",
});

export const ARTIFACT_TYPE = Object.freeze({
  DOCUMENT: "document",
  CODE: "code",
  REPORT: "report",
  CONFIG: "config",
  DEPLOY_RESULT: "deploy-result",
});

export const GATE_STAGES = Object.freeze(
  new Set([STAGE.CODE_REVIEW, STAGE.DEPLOY]),
);

export const PIPELINE_TEMPLATES = Object.freeze({
  feature: {
    name: "feature",
    description: "完整的新功能开发流水线 (7 stages)",
    stages: [
      STAGE.REQUIREMENT,
      STAGE.ARCHITECTURE,
      STAGE.CODE_GENERATION,
      STAGE.TESTING,
      STAGE.CODE_REVIEW,
      STAGE.DEPLOY,
      STAGE.MONITORING,
    ],
  },
  bugfix: {
    name: "bugfix",
    description: "Bug 修复流水线 (跳过架构+部署+监控)",
    stages: [
      STAGE.REQUIREMENT,
      STAGE.CODE_GENERATION,
      STAGE.TESTING,
      STAGE.CODE_REVIEW,
    ],
  },
  refactor: {
    name: "refactor",
    description: "代码重构流水线 (无需求解析)",
    stages: [
      STAGE.ARCHITECTURE,
      STAGE.CODE_GENERATION,
      STAGE.TESTING,
      STAGE.CODE_REVIEW,
    ],
  },
  "security-audit": {
    name: "security-audit",
    description: "安全审计流水线 (仅代码/测试/审查)",
    stages: [STAGE.CODE_GENERATION, STAGE.TESTING, STAGE.CODE_REVIEW],
  },
});

/* ── Schema ──────────────────────────────────────────────── */

export function ensurePipelineTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_pipelines (
      id TEXT PRIMARY KEY,
      name TEXT,
      template TEXT NOT NULL,
      config TEXT,
      status TEXT NOT NULL,
      current_stage INTEGER DEFAULT 0,
      result TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_pipeline_stages (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      stage_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      gate_required INTEGER DEFAULT 0,
      gate_approved INTEGER DEFAULT 0,
      gate_reject_reason TEXT,
      input TEXT,
      output TEXT,
      error_message TEXT,
      started_at INTEGER,
      completed_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_pipeline_artifacts (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      stage_index INTEGER NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_pipeline_deploys (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT,
      strategy TEXT NOT NULL,
      config TEXT,
      status TEXT NOT NULL,
      result TEXT,
      error_message TEXT,
      rolled_back_at INTEGER,
      rollback_reason TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_pipeline_monitor_events (
      id TEXT PRIMARY KEY,
      deploy_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      health_status TEXT,
      metrics TEXT,
      created_at INTEGER NOT NULL
    )
  `);
}

/* ── Internals ───────────────────────────────────────────── */

const _now = () => Date.now();
const _uid = (prefix) => `${prefix}-${crypto.randomBytes(6).toString("hex")}`;

function _parseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function _rowToPipeline(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    config: _parseJSON(row.config, {}),
    status: row.status,
    currentStage: row.current_stage,
    result: _parseJSON(row.result, null),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function _rowToStage(row) {
  if (!row) return null;
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageIndex: row.stage_index,
    name: row.name,
    status: row.status,
    gateRequired: !!row.gate_required,
    gateApproved: !!row.gate_approved,
    gateRejectReason: row.gate_reject_reason,
    input: _parseJSON(row.input, null),
    output: _parseJSON(row.output, null),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function _rowToArtifact(row) {
  if (!row) return null;
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageIndex: row.stage_index,
    type: row.type,
    name: row.name,
    content: row.content,
    metadata: _parseJSON(row.metadata, {}),
    createdAt: row.created_at,
  };
}

function _rowToDeploy(row) {
  if (!row) return null;
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    strategy: row.strategy,
    config: _parseJSON(row.config, {}),
    status: row.status,
    result: _parseJSON(row.result, null),
    errorMessage: row.error_message,
    rolledBackAt: row.rolled_back_at,
    rollbackReason: row.rollback_reason,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function _rowToMonitorEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    deployId: row.deploy_id,
    eventType: row.event_type,
    healthStatus: row.health_status,
    metrics: _parseJSON(row.metrics, {}),
    createdAt: row.created_at,
  };
}

function _getTemplate(templateName) {
  const tpl = PIPELINE_TEMPLATES[templateName];
  if (!tpl) {
    throw new Error(
      `Unknown template: ${templateName}. Valid: ${Object.keys(PIPELINE_TEMPLATES).join(", ")}`,
    );
  }
  return tpl;
}

function _getPipelineRow(db, pipelineId) {
  return db.prepare("SELECT * FROM dev_pipelines WHERE id = ?").get(pipelineId);
}

function _getStageRow(db, pipelineId, stageIndex) {
  return db
    .prepare(
      "SELECT * FROM dev_pipeline_stages WHERE pipeline_id = ? AND stage_index = ?",
    )
    .get(pipelineId, stageIndex);
}

function _getPipelineStages(db, pipelineId) {
  const rows = db
    .prepare(
      "SELECT * FROM dev_pipeline_stages WHERE pipeline_id = ? ORDER BY stage_index ASC",
    )
    .all(pipelineId);
  return rows.map(_rowToStage);
}

function _updatePipelineFields(db, pipelineId, fields) {
  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(fields)) {
    sets.push(`${col} = ?`);
    params.push(val);
  }
  sets.push("updated_at = ?");
  params.push(_now());
  params.push(pipelineId);
  db.prepare(`UPDATE dev_pipelines SET ${sets.join(", ")} WHERE id = ?`).run(
    ...params,
  );
}

function _updateStageFields(db, stageId, fields) {
  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(fields)) {
    sets.push(`${col} = ?`);
    params.push(val);
  }
  params.push(stageId);
  db.prepare(
    `UPDATE dev_pipeline_stages SET ${sets.join(", ")} WHERE id = ?`,
  ).run(...params);
}

/* ── Pipeline lifecycle ──────────────────────────────────── */

export function createPipeline(
  db,
  { template, name = null, config = {} } = {},
) {
  if (!template) throw new Error("template is required");
  const tpl = _getTemplate(template);

  const id = _uid("pipe");
  const now = _now();

  db.prepare(
    `INSERT INTO dev_pipelines (id, name, template, config, status, current_stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    template,
    JSON.stringify(config || {}),
    PIPELINE_STATUS.PENDING,
    0,
    now,
    now,
  );

  tpl.stages.forEach((stageName, idx) => {
    const stageId = _uid("stg");
    const gateRequired = GATE_STAGES.has(stageName) ? 1 : 0;
    db.prepare(
      `INSERT INTO dev_pipeline_stages (id, pipeline_id, stage_index, name, status, gate_required, gate_approved) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(stageId, id, idx, stageName, STAGE_STATUS.PENDING, gateRequired, 0);
  });

  return getPipeline(db, id);
}

export function startPipeline(db, pipelineId) {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
  if (pipeline.status !== PIPELINE_STATUS.PENDING) {
    throw new Error(
      `Cannot start pipeline in status ${pipeline.status} (must be pending)`,
    );
  }

  const now = _now();
  _updatePipelineFields(db, pipelineId, {
    status: PIPELINE_STATUS.RUNNING,
    started_at: now,
  });

  const firstStage = _getStageRow(db, pipelineId, 0);
  if (firstStage) {
    const nextStatus = firstStage.gate_required
      ? STAGE_STATUS.GATE_WAITING
      : STAGE_STATUS.RUNNING;
    _updateStageFields(db, firstStage.id, {
      status: nextStatus,
      started_at: now,
    });
  }

  return getPipeline(db, pipelineId);
}

export function pausePipeline(db, pipelineId) {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
  if (pipeline.status !== PIPELINE_STATUS.RUNNING) {
    throw new Error(
      `Cannot pause pipeline in status ${pipeline.status} (must be running)`,
    );
  }
  _updatePipelineFields(db, pipelineId, { status: PIPELINE_STATUS.PAUSED });
  return getPipeline(db, pipelineId);
}

export function resumePipeline(db, pipelineId) {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
  if (pipeline.status !== PIPELINE_STATUS.PAUSED) {
    throw new Error(
      `Cannot resume pipeline in status ${pipeline.status} (must be paused)`,
    );
  }
  _updatePipelineFields(db, pipelineId, { status: PIPELINE_STATUS.RUNNING });
  return getPipeline(db, pipelineId);
}

export function cancelPipeline(db, pipelineId, reason = "cancelled by user") {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
  if (
    pipeline.status === PIPELINE_STATUS.COMPLETED ||
    pipeline.status === PIPELINE_STATUS.CANCELLED
  ) {
    throw new Error(`Cannot cancel pipeline in status ${pipeline.status}`);
  }
  const now = _now();
  _updatePipelineFields(db, pipelineId, {
    status: PIPELINE_STATUS.CANCELLED,
    completed_at: now,
    error_message: reason,
  });
  return getPipeline(db, pipelineId);
}

/* ── Stage execution ─────────────────────────────────────── */

export function completeStage(
  db,
  pipelineId,
  { output = null, artifacts = [] } = {},
) {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
  if (pipeline.status !== PIPELINE_STATUS.RUNNING) {
    throw new Error(
      `Cannot complete stage: pipeline is ${pipeline.status} (must be running)`,
    );
  }

  const current = _getStageRow(db, pipelineId, pipeline.current_stage);
  if (!current) throw new Error("No current stage found");
  if (current.status === STAGE_STATUS.GATE_WAITING) {
    throw new Error(
      `Stage ${current.name} is a gate and awaiting approval — call approveGate first`,
    );
  }
  if (current.status !== STAGE_STATUS.RUNNING) {
    throw new Error(
      `Cannot complete stage in status ${current.status} (must be running)`,
    );
  }

  const now = _now();
  _updateStageFields(db, current.id, {
    status: STAGE_STATUS.COMPLETED,
    output: output ? JSON.stringify(output) : null,
    completed_at: now,
  });

  if (artifacts && artifacts.length) {
    for (const art of artifacts) {
      addArtifact(db, pipelineId, pipeline.current_stage, art);
    }
  }

  // Advance
  const stages = _getPipelineStages(db, pipelineId);
  const nextIdx = pipeline.current_stage + 1;

  if (nextIdx >= stages.length) {
    _updatePipelineFields(db, pipelineId, {
      status: PIPELINE_STATUS.COMPLETED,
      current_stage: pipeline.current_stage,
      completed_at: now,
    });
    return getPipeline(db, pipelineId);
  }

  const nextStage = _getStageRow(db, pipelineId, nextIdx);
  const nextStatus = nextStage.gate_required
    ? STAGE_STATUS.GATE_WAITING
    : STAGE_STATUS.RUNNING;
  _updateStageFields(db, nextStage.id, {
    status: nextStatus,
    started_at: now,
  });
  _updatePipelineFields(db, pipelineId, { current_stage: nextIdx });

  return getPipeline(db, pipelineId);
}

export function failStage(db, pipelineId, errorMessage = "stage failed") {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
  const current = _getStageRow(db, pipelineId, pipeline.current_stage);
  if (!current) throw new Error("No current stage found");

  const now = _now();
  _updateStageFields(db, current.id, {
    status: STAGE_STATUS.FAILED,
    error_message: errorMessage,
    completed_at: now,
  });
  _updatePipelineFields(db, pipelineId, {
    status: PIPELINE_STATUS.FAILED,
    error_message: errorMessage,
    completed_at: now,
  });
  return getPipeline(db, pipelineId);
}

export function retryStage(db, pipelineId, stageIndex) {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

  const stage = _getStageRow(db, pipelineId, stageIndex);
  if (!stage) throw new Error(`Stage ${stageIndex} not found`);

  const now = _now();
  const nextStatus = stage.gate_required
    ? STAGE_STATUS.GATE_WAITING
    : STAGE_STATUS.RUNNING;

  _updateStageFields(db, stage.id, {
    status: nextStatus,
    gate_approved: 0,
    gate_reject_reason: null,
    error_message: null,
    output: null,
    started_at: now,
    completed_at: null,
  });
  _updatePipelineFields(db, pipelineId, {
    status: PIPELINE_STATUS.RUNNING,
    current_stage: stageIndex,
    error_message: null,
    completed_at: null,
  });

  return getPipeline(db, pipelineId);
}

/* ── Gate approval ───────────────────────────────────────── */

export function approveGate(db, pipelineId) {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

  const current = _getStageRow(db, pipelineId, pipeline.current_stage);
  if (!current) throw new Error("No current stage found");
  if (!current.gate_required) {
    throw new Error(`Stage ${current.name} has no gate`);
  }
  if (current.status !== STAGE_STATUS.GATE_WAITING) {
    throw new Error(`Gate not waiting — stage is in status ${current.status}`);
  }

  _updateStageFields(db, current.id, {
    status: STAGE_STATUS.RUNNING,
    gate_approved: 1,
  });

  return getPipeline(db, pipelineId);
}

export function rejectGate(db, pipelineId, reason = "gate rejected") {
  const pipeline = _getPipelineRow(db, pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

  const current = _getStageRow(db, pipelineId, pipeline.current_stage);
  if (!current) throw new Error("No current stage found");
  if (!current.gate_required) {
    throw new Error(`Stage ${current.name} has no gate`);
  }
  if (current.status !== STAGE_STATUS.GATE_WAITING) {
    throw new Error(`Gate not waiting — stage is in status ${current.status}`);
  }

  const now = _now();
  _updateStageFields(db, current.id, {
    status: STAGE_STATUS.FAILED,
    gate_approved: 0,
    gate_reject_reason: reason,
    completed_at: now,
  });
  _updatePipelineFields(db, pipelineId, {
    status: PIPELINE_STATUS.FAILED,
    error_message: `Gate rejected at ${current.name}: ${reason}`,
    completed_at: now,
  });

  return getPipeline(db, pipelineId);
}

/* ── Artifacts ───────────────────────────────────────────── */

export function addArtifact(db, pipelineId, stageIndex, artifact) {
  if (!artifact || !artifact.name) {
    throw new Error("artifact.name is required");
  }
  const id = _uid("art");
  const now = _now();
  db.prepare(
    `INSERT INTO dev_pipeline_artifacts (id, pipeline_id, stage_index, type, name, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pipelineId,
    stageIndex,
    artifact.type || ARTIFACT_TYPE.DOCUMENT,
    artifact.name,
    artifact.content || "",
    JSON.stringify(artifact.metadata || {}),
    now,
  );
  return getArtifact(db, id);
}

export function getArtifact(db, artifactId) {
  const row = db
    .prepare("SELECT * FROM dev_pipeline_artifacts WHERE id = ?")
    .get(artifactId);
  return _rowToArtifact(row);
}

export function listArtifacts(db, pipelineId, stageIndex = null) {
  let rows;
  if (stageIndex != null) {
    rows = db
      .prepare(
        "SELECT * FROM dev_pipeline_artifacts WHERE pipeline_id = ? AND stage_index = ? ORDER BY created_at ASC",
      )
      .all(pipelineId, stageIndex);
  } else {
    rows = db
      .prepare(
        "SELECT * FROM dev_pipeline_artifacts WHERE pipeline_id = ? ORDER BY stage_index ASC, created_at ASC",
      )
      .all(pipelineId);
  }
  return rows.map(_rowToArtifact);
}

/* ── Queries ─────────────────────────────────────────────── */

export function getPipeline(db, pipelineId) {
  const row = _getPipelineRow(db, pipelineId);
  if (!row) return null;
  const pipeline = _rowToPipeline(row);
  pipeline.stages = _getPipelineStages(db, pipelineId);
  return pipeline;
}

export function listPipelines(db, { template, status, limit = 100 } = {}) {
  const wheres = [];
  const params = [];
  if (template) {
    wheres.push("template = ?");
    params.push(template);
  }
  if (status) {
    wheres.push("status = ?");
    params.push(status);
  }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM dev_pipelines ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(_rowToPipeline);
}

export function getStage(db, pipelineId, stageIndex) {
  return _rowToStage(_getStageRow(db, pipelineId, stageIndex));
}

export function getTemplates() {
  return Object.values(PIPELINE_TEMPLATES).map((t) => ({
    name: t.name,
    description: t.description,
    stages: [...t.stages],
    gateStages: t.stages.filter((s) => GATE_STAGES.has(s)),
  }));
}

export function getConfig() {
  return {
    stages: Object.values(STAGE),
    pipelineStatuses: Object.values(PIPELINE_STATUS),
    stageStatuses: Object.values(STAGE_STATUS),
    deployStrategies: Object.values(DEPLOY_STRATEGY),
    deployStatuses: Object.values(DEPLOY_STATUS),
    artifactTypes: Object.values(ARTIFACT_TYPE),
    gateStages: [...GATE_STAGES],
    templates: Object.keys(PIPELINE_TEMPLATES),
  };
}

/* ── Deployments ─────────────────────────────────────────── */

export function recordDeploy(
  db,
  {
    pipelineId = null,
    strategy,
    config = {},
    result = null,
    status = DEPLOY_STATUS.SUCCEEDED,
    errorMessage = null,
  } = {},
) {
  if (!strategy) throw new Error("strategy is required");
  const validStrategies = Object.values(DEPLOY_STRATEGY);
  if (!validStrategies.includes(strategy)) {
    throw new Error(
      `Unknown deploy strategy: ${strategy}. Valid: ${validStrategies.join(", ")}`,
    );
  }

  const id = _uid("dep");
  const now = _now();
  const completedAt =
    status === DEPLOY_STATUS.PENDING || status === DEPLOY_STATUS.RUNNING
      ? null
      : now;
  db.prepare(
    `INSERT INTO dev_pipeline_deploys (id, pipeline_id, strategy, config, status, result, error_message, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pipelineId,
    strategy,
    JSON.stringify(config || {}),
    status,
    result ? JSON.stringify(result) : null,
    errorMessage,
    now,
    completedAt,
  );
  return getDeploy(db, id);
}

export function getDeploy(db, deployId) {
  const row = db
    .prepare("SELECT * FROM dev_pipeline_deploys WHERE id = ?")
    .get(deployId);
  return _rowToDeploy(row);
}

export function listDeploys(
  db,
  { pipelineId, strategy, status, limit = 100 } = {},
) {
  const wheres = [];
  const params = [];
  if (pipelineId) {
    wheres.push("pipeline_id = ?");
    params.push(pipelineId);
  }
  if (strategy) {
    wheres.push("strategy = ?");
    params.push(strategy);
  }
  if (status) {
    wheres.push("status = ?");
    params.push(status);
  }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM dev_pipeline_deploys ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(_rowToDeploy);
}

export function rollbackDeploy(db, deployId, reason = "rollback requested") {
  const deploy = getDeploy(db, deployId);
  if (!deploy) throw new Error(`Deploy not found: ${deployId}`);
  if (deploy.status === DEPLOY_STATUS.ROLLED_BACK) {
    throw new Error("Deploy already rolled back");
  }
  if (deploy.status !== DEPLOY_STATUS.SUCCEEDED) {
    throw new Error(
      `Cannot roll back deploy in status ${deploy.status} (must be succeeded)`,
    );
  }
  const now = _now();
  db.prepare(
    `UPDATE dev_pipeline_deploys SET status = ?, rolled_back_at = ?, rollback_reason = ? WHERE id = ?`,
  ).run(DEPLOY_STATUS.ROLLED_BACK, now, reason, deployId);
  return getDeploy(db, deployId);
}

/* ── Monitoring ──────────────────────────────────────────── */

export function recordMonitorEvent(
  db,
  deployId,
  { eventType = "health-check", healthStatus = "healthy", metrics = {} } = {},
) {
  const deploy = getDeploy(db, deployId);
  if (!deploy) throw new Error(`Deploy not found: ${deployId}`);

  const id = _uid("mon");
  const now = _now();
  db.prepare(
    `INSERT INTO dev_pipeline_monitor_events (id, deploy_id, event_type, health_status, metrics, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, deployId, eventType, healthStatus, JSON.stringify(metrics), now);

  const row = db
    .prepare("SELECT * FROM dev_pipeline_monitor_events WHERE id = ?")
    .get(id);
  return _rowToMonitorEvent(row);
}

export function listMonitorEvents(db, deployId, { limit = 100 } = {}) {
  const rows = db
    .prepare(
      "SELECT * FROM dev_pipeline_monitor_events WHERE deploy_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(deployId, limit);
  return rows.map(_rowToMonitorEvent);
}

export function getMonitorStatus(db, deployId) {
  const events = listMonitorEvents(db, deployId, { limit: 1 });
  if (!events.length)
    return { deployId, healthStatus: "unknown", lastEvent: null };
  const latest = events[0];
  return {
    deployId,
    healthStatus: latest.healthStatus,
    lastEvent: latest,
    totalEvents: listMonitorEvents(db, deployId, { limit: 1000 }).length,
  };
}

/* ── Export / Stats ──────────────────────────────────────── */

export function exportPipeline(db, pipelineId) {
  const pipeline = getPipeline(db, pipelineId);
  if (!pipeline) return null;
  const artifacts = listArtifacts(db, pipelineId);
  const deploys = listDeploys(db, { pipelineId });
  return {
    exportedAt: _now(),
    pipeline,
    artifacts,
    deploys,
  };
}

export function getStats(db) {
  const pipelines = db.prepare("SELECT * FROM dev_pipelines").all();
  const stages = db.prepare("SELECT * FROM dev_pipeline_stages").all();
  const artifacts = db.prepare("SELECT * FROM dev_pipeline_artifacts").all();
  const deploys = db.prepare("SELECT * FROM dev_pipeline_deploys").all();

  const byTemplate = {};
  const byStatus = {};
  for (const p of pipelines) {
    byTemplate[p.template] = (byTemplate[p.template] || 0) + 1;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  }

  const deployByStrategy = {};
  for (const d of deploys) {
    deployByStrategy[d.strategy] = (deployByStrategy[d.strategy] || 0) + 1;
  }

  const stageByStatus = {};
  for (const s of stages) {
    stageByStatus[s.status] = (stageByStatus[s.status] || 0) + 1;
  }

  return {
    totalPipelines: pipelines.length,
    pipelinesByTemplate: byTemplate,
    pipelinesByStatus: byStatus,
    totalStages: stages.length,
    stagesByStatus: stageByStatus,
    totalArtifacts: artifacts.length,
    totalDeploys: deploys.length,
    deploysByStrategy: deployByStrategy,
  };
}

// ===== V2 Surface: Pipeline Orchestrator governance overlay (CLI v0.137.0) =====
export const PIPELINE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const PIPELINE_RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _pipTrans = new Map([
  [
    PIPELINE_MATURITY_V2.PENDING,
    new Set([PIPELINE_MATURITY_V2.ACTIVE, PIPELINE_MATURITY_V2.ARCHIVED]),
  ],
  [
    PIPELINE_MATURITY_V2.ACTIVE,
    new Set([PIPELINE_MATURITY_V2.PAUSED, PIPELINE_MATURITY_V2.ARCHIVED]),
  ],
  [
    PIPELINE_MATURITY_V2.PAUSED,
    new Set([PIPELINE_MATURITY_V2.ACTIVE, PIPELINE_MATURITY_V2.ARCHIVED]),
  ],
  [PIPELINE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pipTerminal = new Set([PIPELINE_MATURITY_V2.ARCHIVED]);
const _pipRunTrans = new Map([
  [
    PIPELINE_RUN_LIFECYCLE_V2.QUEUED,
    new Set([
      PIPELINE_RUN_LIFECYCLE_V2.RUNNING,
      PIPELINE_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PIPELINE_RUN_LIFECYCLE_V2.RUNNING,
    new Set([
      PIPELINE_RUN_LIFECYCLE_V2.COMPLETED,
      PIPELINE_RUN_LIFECYCLE_V2.FAILED,
      PIPELINE_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PIPELINE_RUN_LIFECYCLE_V2.COMPLETED, new Set()],
  [PIPELINE_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [PIPELINE_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _pips = new Map();
const _pipRuns = new Map();
let _pipMaxActivePerOwner = 10;
let _pipMaxPendingPerPip = 20;
let _pipIdleMs = 3 * 24 * 60 * 60 * 1000;
let _pipRunStuckMs = 10 * 60 * 1000;

function _pipPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActivePipelinesPerOwnerV2(n) {
  _pipMaxActivePerOwner = _pipPos(n, "maxActivePipelinesPerOwner");
}
export function getMaxActivePipelinesPerOwnerV2() {
  return _pipMaxActivePerOwner;
}
export function setMaxPendingPipelineRunsPerPipelineV2(n) {
  _pipMaxPendingPerPip = _pipPos(n, "maxPendingPipelineRunsPerPipeline");
}
export function getMaxPendingPipelineRunsPerPipelineV2() {
  return _pipMaxPendingPerPip;
}
export function setPipelineIdleMsV2(n) {
  _pipIdleMs = _pipPos(n, "pipelineIdleMs");
}
export function getPipelineIdleMsV2() {
  return _pipIdleMs;
}
export function setPipelineRunStuckMsV2(n) {
  _pipRunStuckMs = _pipPos(n, "pipelineRunStuckMs");
}
export function getPipelineRunStuckMsV2() {
  return _pipRunStuckMs;
}

export function _resetStatePipelineOrchestratorV2() {
  _pips.clear();
  _pipRuns.clear();
  _pipMaxActivePerOwner = 10;
  _pipMaxPendingPerPip = 20;
  _pipIdleMs = 3 * 24 * 60 * 60 * 1000;
  _pipRunStuckMs = 10 * 60 * 1000;
}

export function registerPipelineV2({ id, owner, name, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_pips.has(id)) throw new Error(`pipeline ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    name: name || id,
    status: PIPELINE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _pips.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _pipCheckP(from, to) {
  const a = _pipTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pipeline transition ${from} → ${to}`);
}
function _pipCountActive(owner) {
  let n = 0;
  for (const p of _pips.values())
    if (p.owner === owner && p.status === PIPELINE_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activatePipelineV2(id) {
  const p = _pips.get(id);
  if (!p) throw new Error(`pipeline ${id} not found`);
  _pipCheckP(p.status, PIPELINE_MATURITY_V2.ACTIVE);
  const recovery = p.status === PIPELINE_MATURITY_V2.PAUSED;
  if (!recovery) {
    const c = _pipCountActive(p.owner);
    if (c >= _pipMaxActivePerOwner)
      throw new Error(
        `max active pipelines per owner (${_pipMaxActivePerOwner}) reached for ${p.owner}`,
      );
  }
  const now = Date.now();
  p.status = PIPELINE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pausePipelineV2(id) {
  const p = _pips.get(id);
  if (!p) throw new Error(`pipeline ${id} not found`);
  _pipCheckP(p.status, PIPELINE_MATURITY_V2.PAUSED);
  p.status = PIPELINE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePipelineV2(id) {
  const p = _pips.get(id);
  if (!p) throw new Error(`pipeline ${id} not found`);
  _pipCheckP(p.status, PIPELINE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PIPELINE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPipelineV2(id) {
  const p = _pips.get(id);
  if (!p) throw new Error(`pipeline ${id} not found`);
  if (_pipTerminal.has(p.status))
    throw new Error(`cannot touch terminal pipeline ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPipelineV2(id) {
  const p = _pips.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPipelinesV2() {
  return [..._pips.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _pipCountPendingRuns(pid) {
  let n = 0;
  for (const r of _pipRuns.values())
    if (
      r.pipelineId === pid &&
      (r.status === PIPELINE_RUN_LIFECYCLE_V2.QUEUED ||
        r.status === PIPELINE_RUN_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createPipelineRunV2({
  id,
  pipelineId,
  trigger,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!pipelineId || typeof pipelineId !== "string")
    throw new Error("pipelineId is required");
  if (_pipRuns.has(id)) throw new Error(`pipeline run ${id} already exists`);
  if (!_pips.has(pipelineId))
    throw new Error(`pipeline ${pipelineId} not found`);
  const pending = _pipCountPendingRuns(pipelineId);
  if (pending >= _pipMaxPendingPerPip)
    throw new Error(
      `max pending pipeline runs per pipeline (${_pipMaxPendingPerPip}) reached for ${pipelineId}`,
    );
  const now = Date.now();
  const r = {
    id,
    pipelineId,
    trigger: trigger || "manual",
    status: PIPELINE_RUN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pipRuns.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
function _pipCheckR(from, to) {
  const a = _pipRunTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pipeline run transition ${from} → ${to}`);
}
export function startPipelineRunV2(id) {
  const r = _pipRuns.get(id);
  if (!r) throw new Error(`pipeline run ${id} not found`);
  _pipCheckR(r.status, PIPELINE_RUN_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  r.status = PIPELINE_RUN_LIFECYCLE_V2.RUNNING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function completePipelineRunV2(id) {
  const r = _pipRuns.get(id);
  if (!r) throw new Error(`pipeline run ${id} not found`);
  _pipCheckR(r.status, PIPELINE_RUN_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  r.status = PIPELINE_RUN_LIFECYCLE_V2.COMPLETED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function failPipelineRunV2(id, reason) {
  const r = _pipRuns.get(id);
  if (!r) throw new Error(`pipeline run ${id} not found`);
  _pipCheckR(r.status, PIPELINE_RUN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  r.status = PIPELINE_RUN_LIFECYCLE_V2.FAILED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.failReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelPipelineRunV2(id, reason) {
  const r = _pipRuns.get(id);
  if (!r) throw new Error(`pipeline run ${id} not found`);
  _pipCheckR(r.status, PIPELINE_RUN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = PIPELINE_RUN_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getPipelineRunV2(id) {
  const r = _pipRuns.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listPipelineRunsV2() {
  return [..._pipRuns.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}

export function autoPauseIdlePipelinesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pips.values())
    if (
      p.status === PIPELINE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pipIdleMs
    ) {
      p.status = PIPELINE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPipelineRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _pipRuns.values())
    if (
      r.status === PIPELINE_RUN_LIFECYCLE_V2.RUNNING &&
      r.startedAt != null &&
      t - r.startedAt >= _pipRunStuckMs
    ) {
      r.status = PIPELINE_RUN_LIFECYCLE_V2.FAILED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.failReason = "auto-fail-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}

export function getPipelineOrchestratorGovStatsV2() {
  const pipelinesByStatus = {};
  for (const s of Object.values(PIPELINE_MATURITY_V2)) pipelinesByStatus[s] = 0;
  for (const p of _pips.values()) pipelinesByStatus[p.status]++;
  const runsByStatus = {};
  for (const s of Object.values(PIPELINE_RUN_LIFECYCLE_V2)) runsByStatus[s] = 0;
  for (const r of _pipRuns.values()) runsByStatus[r.status]++;
  return {
    totalPipelinesV2: _pips.size,
    totalRunsV2: _pipRuns.size,
    maxActivePipelinesPerOwner: _pipMaxActivePerOwner,
    maxPendingPipelineRunsPerPipeline: _pipMaxPendingPerPip,
    pipelineIdleMs: _pipIdleMs,
    pipelineRunStuckMs: _pipRunStuckMs,
    pipelinesByStatus,
    runsByStatus,
  };
}

// === Iter28 V2 governance overlay: Pipogov ===
export const PIPOGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const PIPOGOV_RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  FINISHED: "finished",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _pipogovPTrans = new Map([
  [
    PIPOGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PIPOGOV_PROFILE_MATURITY_V2.ACTIVE,
      PIPOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PIPOGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PIPOGOV_PROFILE_MATURITY_V2.PAUSED,
      PIPOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PIPOGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      PIPOGOV_PROFILE_MATURITY_V2.ACTIVE,
      PIPOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PIPOGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pipogovPTerminal = new Set([PIPOGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _pipogovJTrans = new Map([
  [
    PIPOGOV_RUN_LIFECYCLE_V2.QUEUED,
    new Set([
      PIPOGOV_RUN_LIFECYCLE_V2.RUNNING,
      PIPOGOV_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PIPOGOV_RUN_LIFECYCLE_V2.RUNNING,
    new Set([
      PIPOGOV_RUN_LIFECYCLE_V2.FINISHED,
      PIPOGOV_RUN_LIFECYCLE_V2.FAILED,
      PIPOGOV_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PIPOGOV_RUN_LIFECYCLE_V2.FINISHED, new Set()],
  [PIPOGOV_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [PIPOGOV_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pipogovPsV2 = new Map();
const _pipogovJsV2 = new Map();
let _pipogovMaxActive = 8,
  _pipogovMaxPending = 20,
  _pipogovIdleMs = 2592000000,
  _pipogovStuckMs = 60 * 1000;
function _pipogovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _pipogovCheckP(from, to) {
  const a = _pipogovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pipogov profile transition ${from} → ${to}`);
}
function _pipogovCheckJ(from, to) {
  const a = _pipogovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pipogov run transition ${from} → ${to}`);
}
function _pipogovCountActive(owner) {
  let c = 0;
  for (const p of _pipogovPsV2.values())
    if (p.owner === owner && p.status === PIPOGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _pipogovCountPending(profileId) {
  let c = 0;
  for (const j of _pipogovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PIPOGOV_RUN_LIFECYCLE_V2.QUEUED ||
        j.status === PIPOGOV_RUN_LIFECYCLE_V2.RUNNING)
    )
      c++;
  return c;
}
export function setMaxActivePipoProfilesPerOwnerV2(n) {
  _pipogovMaxActive = _pipogovPos(n, "maxActivePipoProfilesPerOwner");
}
export function getMaxActivePipoProfilesPerOwnerV2() {
  return _pipogovMaxActive;
}
export function setMaxPendingPipoRunsPerProfileV2(n) {
  _pipogovMaxPending = _pipogovPos(n, "maxPendingPipoRunsPerProfile");
}
export function getMaxPendingPipoRunsPerProfileV2() {
  return _pipogovMaxPending;
}
export function setPipoProfileIdleMsV2(n) {
  _pipogovIdleMs = _pipogovPos(n, "pipogovProfileIdleMs");
}
export function getPipoProfileIdleMsV2() {
  return _pipogovIdleMs;
}
export function setPipoRunStuckMsV2(n) {
  _pipogovStuckMs = _pipogovPos(n, "pipogovRunStuckMs");
}
export function getPipoRunStuckMsV2() {
  return _pipogovStuckMs;
}
export function _resetStatePipogovV2() {
  _pipogovPsV2.clear();
  _pipogovJsV2.clear();
  _pipogovMaxActive = 8;
  _pipogovMaxPending = 20;
  _pipogovIdleMs = 2592000000;
  _pipogovStuckMs = 60 * 1000;
}
export function registerPipoProfileV2({ id, owner, pipeline, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pipogovPsV2.has(id))
    throw new Error(`pipogov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    pipeline: pipeline || "default",
    status: PIPOGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pipogovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePipoProfileV2(id) {
  const p = _pipogovPsV2.get(id);
  if (!p) throw new Error(`pipogov profile ${id} not found`);
  const isInitial = p.status === PIPOGOV_PROFILE_MATURITY_V2.PENDING;
  _pipogovCheckP(p.status, PIPOGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pipogovCountActive(p.owner) >= _pipogovMaxActive)
    throw new Error(`max active pipogov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = PIPOGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pausedPipoProfileV2(id) {
  const p = _pipogovPsV2.get(id);
  if (!p) throw new Error(`pipogov profile ${id} not found`);
  _pipogovCheckP(p.status, PIPOGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = PIPOGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePipoProfileV2(id) {
  const p = _pipogovPsV2.get(id);
  if (!p) throw new Error(`pipogov profile ${id} not found`);
  _pipogovCheckP(p.status, PIPOGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PIPOGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPipoProfileV2(id) {
  const p = _pipogovPsV2.get(id);
  if (!p) throw new Error(`pipogov profile ${id} not found`);
  if (_pipogovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal pipogov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPipoProfileV2(id) {
  const p = _pipogovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPipoProfilesV2() {
  return [..._pipogovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPipoRunV2({ id, profileId, runId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pipogovJsV2.has(id)) throw new Error(`pipogov run ${id} already exists`);
  if (!_pipogovPsV2.has(profileId))
    throw new Error(`pipogov profile ${profileId} not found`);
  if (_pipogovCountPending(profileId) >= _pipogovMaxPending)
    throw new Error(
      `max pending pipogov runs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    runId: runId || "",
    status: PIPOGOV_RUN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pipogovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function runningPipoRunV2(id) {
  const j = _pipogovJsV2.get(id);
  if (!j) throw new Error(`pipogov run ${id} not found`);
  _pipogovCheckJ(j.status, PIPOGOV_RUN_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = PIPOGOV_RUN_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRunPipoV2(id) {
  const j = _pipogovJsV2.get(id);
  if (!j) throw new Error(`pipogov run ${id} not found`);
  _pipogovCheckJ(j.status, PIPOGOV_RUN_LIFECYCLE_V2.FINISHED);
  const now = Date.now();
  j.status = PIPOGOV_RUN_LIFECYCLE_V2.FINISHED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPipoRunV2(id, reason) {
  const j = _pipogovJsV2.get(id);
  if (!j) throw new Error(`pipogov run ${id} not found`);
  _pipogovCheckJ(j.status, PIPOGOV_RUN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PIPOGOV_RUN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPipoRunV2(id, reason) {
  const j = _pipogovJsV2.get(id);
  if (!j) throw new Error(`pipogov run ${id} not found`);
  _pipogovCheckJ(j.status, PIPOGOV_RUN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PIPOGOV_RUN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPipoRunV2(id) {
  const j = _pipogovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPipoRunsV2() {
  return [..._pipogovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPausedIdlePipoProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pipogovPsV2.values())
    if (
      p.status === PIPOGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pipogovIdleMs
    ) {
      p.status = PIPOGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPipoRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _pipogovJsV2.values())
    if (
      j.status === PIPOGOV_RUN_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _pipogovStuckMs
    ) {
      j.status = PIPOGOV_RUN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getPipogovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PIPOGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _pipogovPsV2.values()) profilesByStatus[p.status]++;
  const runsByStatus = {};
  for (const v of Object.values(PIPOGOV_RUN_LIFECYCLE_V2)) runsByStatus[v] = 0;
  for (const j of _pipogovJsV2.values()) runsByStatus[j.status]++;
  return {
    totalPipoProfilesV2: _pipogovPsV2.size,
    totalPipoRunsV2: _pipogovJsV2.size,
    maxActivePipoProfilesPerOwner: _pipogovMaxActive,
    maxPendingPipoRunsPerProfile: _pipogovMaxPending,
    pipogovProfileIdleMs: _pipogovIdleMs,
    pipogovRunStuckMs: _pipogovStuckMs,
    profilesByStatus,
    runsByStatus,
  };
}
