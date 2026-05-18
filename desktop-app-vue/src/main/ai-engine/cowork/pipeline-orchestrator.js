/**
 * Pipeline Orchestrator — Dev Pipeline Lifecycle Management (v3.0)
 *
 * Central orchestrator for 7-stage development pipelines:
 *   1. Requirement Parsing
 *   2. Architecture Design
 *   3. Code Generation
 *   4. Testing
 *   5. Code Review
 *   6. Deploy
 *   7. Monitoring
 *
 * Features:
 * - 7-stage state machine with configurable transitions
 * - Gate-based approval mechanism (manual / auto)
 * - Event bus for stage lifecycle notifications
 * - Pipeline templates (feature, bugfix, refactor, security-audit)
 * - Artifact management between stages
 * - Integration with Orchestrate, Verification Loop, Debate Review
 *
 * @module ai-engine/cowork/pipeline-orchestrator
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

// ============================================================
// Constants
// ============================================================

const PIPELINE_STATUS = {
  CREATED: "created",
  RUNNING: "running",
  PAUSED: "paused",
  GATE_WAITING: "gate-waiting",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const STAGE_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  GATE_WAITING: "gate-waiting",
  APPROVED: "approved",
  REJECTED: "rejected",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
};

const STAGE_NAMES = [
  "requirement-parsing",
  "architecture-design",
  "code-generation",
  "testing",
  "code-review",
  "deploy",
  "monitoring",
];

const ARTIFACT_TYPES = [
  "spec",
  "design-doc",
  "code",
  "test-report",
  "review-report",
  "deploy-log",
  "monitor-snapshot",
];

const PIPELINE_TEMPLATES = {
  feature: {
    name: "Feature Development",
    description: "Full 7-stage pipeline for new feature development",
    stages: STAGE_NAMES,
    defaultConfig: {
      autoApprove: false,
      skipStages: [],
      timeout: 7200000, // 2 hours
    },
  },
  bugfix: {
    name: "Bug Fix",
    description: "Streamlined pipeline for bug fixes (skip architecture)",
    stages: STAGE_NAMES.filter((s) => s !== "architecture-design"),
    defaultConfig: {
      autoApprove: true,
      skipStages: ["architecture-design"],
      timeout: 3600000, // 1 hour
    },
  },
  refactor: {
    name: "Refactoring",
    description: "Refactoring pipeline with emphasis on testing",
    stages: STAGE_NAMES.filter((s) => s !== "deploy" && s !== "monitoring"),
    defaultConfig: {
      autoApprove: false,
      skipStages: ["deploy", "monitoring"],
      timeout: 5400000, // 1.5 hours
    },
  },
  "security-audit": {
    name: "Security Audit",
    description: "Security-focused pipeline with mandatory review gates",
    stages: STAGE_NAMES,
    defaultConfig: {
      autoApprove: false,
      skipStages: [],
      timeout: 10800000, // 3 hours
      requireAllGates: true,
    },
  },
};

// ============================================================
// PipelineOrchestrator Class
// ============================================================

class PipelineOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // In-memory pipeline state
    this._pipelines = new Map(); // id → pipeline
    this._gateQueue = new Map(); // pipelineId → { stageId, waitingSince }
    this._stageHandlers = new Map(); // stageName → handler function

    // Dependencies (injected via initialize)
    this._requirementParser = null;
    this._orchestrateRunner = null;
    this._verificationLoop = null;
    this._debateReview = null;
    this._deployAgent = null;
    this._postDeployMonitor = null;

    // Config
    this._config = {
      maxConcurrentPipelines: 3,
      defaultTimeout: 7200000,
      autoApproveConfidenceThreshold: 0.85,
      gateTimeoutMs: 1800000, // 30 min gate timeout
    };
  }

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database instance
   * @param {Object} [deps] - Optional module dependencies
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    this._requirementParser = deps.requirementParser || null;
    this._orchestrateRunner = deps.orchestrateRunner || null;
    this._verificationLoop = deps.verificationLoop || null;
    this._debateReview = deps.debateReview || null;
    this._deployAgent = deps.deployAgent || null;
    this._postDeployMonitor = deps.postDeployMonitor || null;

    this._ensureTables();
    await this._loadActivePipelines();
    this._registerStageHandlers();

    this.initialized = true;
    logger.info(
      `[PipelineOrchestrator] Initialized: ${this._pipelines.size} active pipelines`,
    );
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Create a new development pipeline
   * @param {Object} options - Pipeline creation options
   * @returns {Object} Created pipeline
   */
  async createPipeline(options = {}) {
    const {
      name,
      template = "feature",
      requirement = "",
      config = {},
    } = options;

    if (!name) {
      throw new Error("Pipeline name is required");
    }

    const templateDef = PIPELINE_TEMPLATES[template];
    if (!templateDef) {
      throw new Error(
        `Unknown template: ${template}. Available: ${Object.keys(PIPELINE_TEMPLATES).join(", ")}`,
      );
    }

    const pipelineId = `pipe-${uuidv4().slice(0, 12)}`;
    const mergedConfig = { ...templateDef.defaultConfig, ...config };

    const pipeline = {
      id: pipelineId,
      name,
      template,
      requirement,
      specJson: {},
      status: PIPELINE_STATUS.CREATED,
      currentStage: null,
      config: mergedConfig,
      metrics: {
        startedAt: null,
        stageMetrics: [],
        humanInterventions: 0,
        autoApprovals: 0,
      },
      createdBy: options.createdBy || "system",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    // Create stages
    const stages = templateDef.stages.map((stageName, index) => ({
      id: `stage-${uuidv4().slice(0, 8)}`,
      pipelineId,
      stageName,
      stageOrder: index,
      status: STAGE_STATUS.PENDING,
      input: {},
      output: {},
      agentId: null,
      gateApprover: null,
      gateComment: null,
      startedAt: null,
      completedAt: null,
    }));

    // Persist
    this._savePipeline(pipeline);
    stages.forEach((stage) => this._saveStage(stage));

    // Cache
    this._pipelines.set(pipelineId, { ...pipeline, stages });

    this.emit("pipeline:created", { pipeline, stages });
    logger.info(
      `[PipelineOrchestrator] Pipeline created: ${pipelineId} (${template}) — ${stages.length} stages`,
    );

    return { id: pipelineId, status: pipeline.status, stages };
  }

  /**
   * Start pipeline execution
   * @param {string} pipelineId
   * @returns {Object} Updated status
   */
  async startPipeline(pipelineId) {
    const pipeline = this._getPipeline(pipelineId);

    if (
      pipeline.status !== PIPELINE_STATUS.CREATED &&
      pipeline.status !== PIPELINE_STATUS.PAUSED
    ) {
      throw new Error(`Cannot start pipeline in status: ${pipeline.status}`);
    }

    // Check concurrent limit
    const runningCount = [...this._pipelines.values()].filter(
      (p) => p.status === PIPELINE_STATUS.RUNNING,
    ).length;
    if (runningCount >= this._config.maxConcurrentPipelines) {
      throw new Error(
        `Concurrent pipeline limit reached (${this._config.maxConcurrentPipelines})`,
      );
    }

    pipeline.status = PIPELINE_STATUS.RUNNING;
    pipeline.metrics.startedAt =
      pipeline.metrics.startedAt || new Date().toISOString();
    pipeline.updatedAt = new Date().toISOString();

    // Find first pending stage
    const firstStage = pipeline.stages.find(
      (s) => s.status === STAGE_STATUS.PENDING,
    );
    if (firstStage) {
      pipeline.currentStage = firstStage.stageName;
      this._updatePipelineDB(pipeline);
      this.emit("pipeline:started", { pipelineId });
      // Execute stage asynchronously
      this._executeStage(pipelineId, firstStage.id).catch((err) => {
        logger.error(
          `[PipelineOrchestrator] Stage execution error: ${err.message}`,
        );
        this._failPipeline(pipelineId, err.message);
      });
    }

    return {
      status: pipeline.status,
      currentStage: pipeline.currentStage,
    };
  }

  /**
   * Pause pipeline execution
   * @param {string} pipelineId
   */
  async pausePipeline(pipelineId) {
    const pipeline = this._getPipeline(pipelineId);

    if (pipeline.status !== PIPELINE_STATUS.RUNNING) {
      throw new Error(`Cannot pause pipeline in status: ${pipeline.status}`);
    }

    pipeline.status = PIPELINE_STATUS.PAUSED;
    pipeline.updatedAt = new Date().toISOString();
    this._updatePipelineDB(pipeline);
    this.emit("pipeline:paused", { pipelineId });

    return { status: pipeline.status };
  }

  /**
   * Resume paused pipeline
   * @param {string} pipelineId
   */
  async resumePipeline(pipelineId) {
    return this.startPipeline(pipelineId);
  }

  /**
   * Cancel pipeline execution
   * @param {string} pipelineId
   * @param {string} [reason]
   */
  async cancelPipeline(pipelineId, reason = "") {
    const pipeline = this._getPipeline(pipelineId);

    if (
      pipeline.status === PIPELINE_STATUS.COMPLETED ||
      pipeline.status === PIPELINE_STATUS.CANCELLED
    ) {
      throw new Error(`Cannot cancel pipeline in status: ${pipeline.status}`);
    }

    pipeline.status = PIPELINE_STATUS.CANCELLED;
    pipeline.updatedAt = new Date().toISOString();
    pipeline.completedAt = new Date().toISOString();
    this._updatePipelineDB(pipeline);
    this._gateQueue.delete(pipelineId);
    this.emit("pipeline:cancelled", { pipelineId, reason });

    logger.info(
      `[PipelineOrchestrator] Pipeline cancelled: ${pipelineId} — ${reason}`,
    );
    return { status: pipeline.status };
  }

  /**
   * Get pipeline status
   * @param {string} pipelineId
   * @returns {Object} Pipeline status with stage details
   */
  getStatus(pipelineId) {
    const pipeline = this._getPipeline(pipelineId);
    return {
      id: pipeline.id,
      name: pipeline.name,
      template: pipeline.template,
      status: pipeline.status,
      currentStage: pipeline.currentStage,
      stages: pipeline.stages.map((s) => ({
        id: s.id,
        name: s.stageName,
        order: s.stageOrder,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
      metrics: pipeline.metrics,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
      completedAt: pipeline.completedAt,
    };
  }

  /**
   * Get all pipelines (with optional filter)
   * @param {Object} [filter] - Filter options
   * @returns {Array} List of pipeline summaries
   */
  getAllPipelines(filter = {}) {
    let pipelines = [...this._pipelines.values()];

    if (filter.status) {
      pipelines = pipelines.filter((p) => p.status === filter.status);
    }
    if (filter.template) {
      pipelines = pipelines.filter((p) => p.template === filter.template);
    }

    return pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      template: p.template,
      status: p.status,
      currentStage: p.currentStage,
      stageCount: p.stages.length,
      completedStages: p.stages.filter(
        (s) => s.status === STAGE_STATUS.COMPLETED,
      ).length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Get detailed info for a specific stage
   * @param {string} pipelineId
   * @param {string} stageId
   * @returns {Object} Stage details with artifacts
   */
  getStageDetail(pipelineId, stageId) {
    const pipeline = this._getPipeline(pipelineId);
    const stage = pipeline.stages.find((s) => s.id === stageId);
    if (!stage) {
      throw new Error(`Stage not found: ${stageId}`);
    }

    const artifacts = this._getArtifacts(pipelineId, stageId);
    return { ...stage, artifacts };
  }

  /**
   * Approve a gate-waiting stage
   * @param {string} pipelineId
   * @param {string} stageId
   * @param {Object} [options] - Approval options
   */
  async approveGate(pipelineId, stageId, options = {}) {
    const pipeline = this._getPipeline(pipelineId);
    const stage = pipeline.stages.find((s) => s.id === stageId);

    if (!stage || stage.status !== STAGE_STATUS.GATE_WAITING) {
      throw new Error(
        `Stage ${stageId} is not waiting for approval (status: ${stage?.status})`,
      );
    }

    stage.status = STAGE_STATUS.APPROVED;
    stage.gateApprover = options.approver || "manual";
    stage.gateComment = options.comment || "";
    stage.completedAt = new Date().toISOString();
    this._updateStageDB(stage);

    pipeline.metrics.humanInterventions++;
    pipeline.status = PIPELINE_STATUS.RUNNING;
    pipeline.updatedAt = new Date().toISOString();
    this._updatePipelineDB(pipeline);

    this._gateQueue.delete(pipelineId);
    this.emit("pipeline:gate-approved", { pipelineId, stageId });

    logger.info(
      `[PipelineOrchestrator] Gate approved: ${pipelineId}/${stage.stageName}`,
    );

    // Advance to next stage
    const nextStage = this._getNextStage(pipeline, stage);
    if (nextStage) {
      this._executeStage(pipelineId, nextStage.id).catch((err) => {
        this._failPipeline(pipelineId, err.message);
      });
      return { status: "approved", nextStage: nextStage.stageName };
    }

    // Pipeline complete
    this._completePipeline(pipelineId);
    return { status: "approved", nextStage: null, pipelineCompleted: true };
  }

  /**
   * Reject a gate-waiting stage
   * @param {string} pipelineId
   * @param {string} stageId
   * @param {Object} [options] - Rejection options
   */
  async rejectGate(pipelineId, stageId, options = {}) {
    const pipeline = this._getPipeline(pipelineId);
    const stage = pipeline.stages.find((s) => s.id === stageId);

    if (!stage || stage.status !== STAGE_STATUS.GATE_WAITING) {
      throw new Error(`Stage ${stageId} is not waiting for approval`);
    }

    stage.status = STAGE_STATUS.REJECTED;
    stage.gateApprover = options.approver || "manual";
    stage.gateComment = options.reason || "Rejected without reason";
    stage.completedAt = new Date().toISOString();
    this._updateStageDB(stage);

    this._gateQueue.delete(pipelineId);
    this.emit("pipeline:gate-rejected", { pipelineId, stageId });

    // Fail the pipeline on rejection
    this._failPipeline(
      pipelineId,
      `Gate rejected at ${stage.stageName}: ${options.reason || "no reason"}`,
    );

    return { status: "rejected" };
  }

  /**
   * Get artifacts for a pipeline (optionally filtered by stage)
   * @param {string} pipelineId
   * @param {string} [stageId]
   * @returns {Array} Artifacts
   */
  getArtifacts(pipelineId, stageId) {
    this._getPipeline(pipelineId); // validate exists
    return this._getArtifacts(pipelineId, stageId);
  }

  /**
   * Get pipeline execution metrics
   * @param {string} pipelineId
   * @returns {Object} Metrics
   */
  getMetrics(pipelineId) {
    const pipeline = this._getPipeline(pipelineId);
    const now = new Date();
    const startedAt = pipeline.metrics.startedAt
      ? new Date(pipeline.metrics.startedAt)
      : null;
    const completedAt = pipeline.completedAt
      ? new Date(pipeline.completedAt)
      : null;

    return {
      pipelineId,
      totalTime: completedAt
        ? completedAt - startedAt
        : startedAt
          ? now - startedAt
          : 0,
      stageMetrics: pipeline.stages.map((s) => ({
        name: s.stageName,
        status: s.status,
        duration:
          s.startedAt && s.completedAt
            ? new Date(s.completedAt) - new Date(s.startedAt)
            : null,
      })),
      humanInterventions: pipeline.metrics.humanInterventions,
      autoApprovals: pipeline.metrics.autoApprovals,
      completedStages: pipeline.stages.filter(
        (s) =>
          s.status === STAGE_STATUS.COMPLETED ||
          s.status === STAGE_STATUS.APPROVED,
      ).length,
      totalStages: pipeline.stages.length,
    };
  }

  /**
   * Get available pipeline templates
   * @returns {Array} Template definitions
   */
  getTemplates() {
    return Object.entries(PIPELINE_TEMPLATES).map(([key, value]) => ({
      id: key,
      name: value.name,
      description: value.description,
      stageCount: value.stages.length,
      stages: value.stages,
      defaultConfig: value.defaultConfig,
    }));
  }

  /**
   * Get current configuration
   * @returns {Object} Config
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} config - Partial config to merge
   */
  configure(config = {}) {
    const allowed = [
      "maxConcurrentPipelines",
      "defaultTimeout",
      "autoApproveConfidenceThreshold",
      "gateTimeoutMs",
    ];
    for (const key of allowed) {
      if (config[key] !== undefined) {
        this._config[key] = config[key];
      }
    }
    logger.info("[PipelineOrchestrator] Config updated");
    return this.getConfig();
  }

  // ============================================================
  // Stage Execution
  // ============================================================

  /**
   * Execute a pipeline stage
   * @private
   */
  async _executeStage(pipelineId, stageId) {
    const pipeline = this._getPipeline(pipelineId);
    const stage = pipeline.stages.find((s) => s.id === stageId);

    if (!stage) {
      throw new Error(`Stage not found: ${stageId}`);
    }

    // Check if pipeline is still running
    if (
      pipeline.status !== PIPELINE_STATUS.RUNNING &&
      pipeline.status !== PIPELINE_STATUS.GATE_WAITING
    ) {
      return;
    }

    // Check if stage should be skipped
    if (pipeline.config.skipStages?.includes(stage.stageName)) {
      stage.status = STAGE_STATUS.SKIPPED;
      stage.completedAt = new Date().toISOString();
      this._updateStageDB(stage);

      const nextStage = this._getNextStage(pipeline, stage);
      if (nextStage) {
        return this._executeStage(pipelineId, nextStage.id);
      }
      return this._completePipeline(pipelineId);
    }

    // Mark stage as running
    stage.status = STAGE_STATUS.RUNNING;
    stage.startedAt = new Date().toISOString();
    pipeline.currentStage = stage.stageName;
    this._updateStageDB(stage);
    this._updatePipelineDB(pipeline);
    this.emit("pipeline:stage-started", {
      pipelineId,
      stageId,
      stageName: stage.stageName,
    });

    logger.info(
      `[PipelineOrchestrator] Stage started: ${pipelineId}/${stage.stageName}`,
    );

    try {
      // Get previous stage output as input
      const prevStage = this._getPreviousStage(pipeline, stage);
      if (prevStage) {
        stage.input = prevStage.output || {};
      } else {
        stage.input = {
          requirement: pipeline.requirement,
          specJson: pipeline.specJson,
        };
      }

      // Execute stage handler
      const handler = this._stageHandlers.get(stage.stageName);
      if (handler) {
        const result = await handler(pipeline, stage);
        stage.output = result || {};
      } else {
        // Default: pass through with note
        stage.output = {
          ...stage.input,
          _note: `Stage ${stage.stageName} has no handler — passed through`,
        };
      }

      // Save artifact
      const artifactType = this._getArtifactTypeForStage(stage.stageName);
      if (artifactType && stage.output) {
        this._saveArtifact({
          id: `art-${uuidv4().slice(0, 8)}`,
          pipelineId,
          stageId: stage.id,
          artifactType,
          content: JSON.stringify(stage.output),
          metadata: {},
        });
      }

      // Check if gate approval is needed
      if (this._needsGateApproval(pipeline, stage)) {
        stage.status = STAGE_STATUS.GATE_WAITING;
        pipeline.status = PIPELINE_STATUS.GATE_WAITING;
        this._gateQueue.set(pipelineId, {
          stageId: stage.id,
          waitingSince: new Date().toISOString(),
        });
        this._updateStageDB(stage);
        this._updatePipelineDB(pipeline);
        this.emit("pipeline:gate-waiting", {
          pipelineId,
          stageId,
          stageName: stage.stageName,
        });
        logger.info(
          `[PipelineOrchestrator] Gate waiting: ${pipelineId}/${stage.stageName}`,
        );
        return;
      }

      // Auto-approve and advance
      stage.status = STAGE_STATUS.COMPLETED;
      stage.completedAt = new Date().toISOString();
      pipeline.metrics.autoApprovals++;
      this._updateStageDB(stage);

      this.emit("pipeline:stage-completed", {
        pipelineId,
        stageId,
        stageName: stage.stageName,
      });

      // Advance to next stage
      const nextStage = this._getNextStage(pipeline, stage);
      if (nextStage) {
        return this._executeStage(pipelineId, nextStage.id);
      }

      // All stages complete
      this._completePipeline(pipelineId);
    } catch (error) {
      stage.status = STAGE_STATUS.FAILED;
      stage.completedAt = new Date().toISOString();
      stage.output = { error: error.message };
      this._updateStageDB(stage);

      this.emit("pipeline:stage-failed", {
        pipelineId,
        stageId,
        stageName: stage.stageName,
        error: error.message,
      });

      this._failPipeline(pipelineId, error.message);
    }
  }

  /**
   * Register default stage handlers
   * @private
   */
  _registerStageHandlers() {
    // Stage 1: Requirement Parsing
    this._stageHandlers.set("requirement-parsing", async (pipeline, _stage) => {
      if (this._requirementParser) {
        const spec = await this._requirementParser.parse(pipeline.requirement);
        pipeline.specJson = spec;
        this._updatePipelineDB(pipeline);
        return { spec };
      }
      return {
        spec: { raw: pipeline.requirement },
        _note: "RequirementParser not available, using raw requirement",
      };
    });

    // Stage 2: Architecture Design
    this._stageHandlers.set("architecture-design", async (pipeline, stage) => {
      if (this._orchestrateRunner) {
        const result = await this._orchestrateRunner.run("feature", {
          description: `Design architecture for: ${pipeline.name}`,
          spec: stage.input.spec || pipeline.specJson,
          agentTemplate: "planner",
        });
        return { design: result };
      }
      return {
        design: { description: pipeline.requirement },
        _note: "Orchestrate not available",
      };
    });

    // Stage 3: Code Generation
    this._stageHandlers.set("code-generation", async (pipeline, stage) => {
      if (this._orchestrateRunner) {
        const result = await this._orchestrateRunner.run("feature", {
          description: `Generate code for: ${pipeline.name}`,
          spec: pipeline.specJson,
          design: stage.input.design,
          agentTemplate: "coder",
        });
        return { code: result };
      }
      return { code: null, _note: "Orchestrate not available" };
    });

    // Stage 4: Testing
    this._stageHandlers.set("testing", async (_pipeline, stage) => {
      if (this._verificationLoop) {
        const result = await this._verificationLoop.run({
          target: stage.input.code,
          stages: ["build", "typecheck", "lint", "test"],
        });
        return { testReport: result };
      }
      return { testReport: null, _note: "VerificationLoop not available" };
    });

    // Stage 5: Code Review
    this._stageHandlers.set("code-review", async (_pipeline, stage) => {
      if (this._debateReview) {
        const result = await this._debateReview.startReview({
          target: stage.input.code,
          perspectives: ["performance", "security", "maintainability"],
        });
        return { reviewReport: result };
      }
      return { reviewReport: null, _note: "DebateReview not available" };
    });

    // Stage 6: Deploy
    this._stageHandlers.set("deploy", async (pipeline, _stage) => {
      if (this._deployAgent) {
        const result = await this._deployAgent.deploy({
          pipelineId: pipeline.id,
          target: pipeline.config.deployTarget || "staging",
          rollbackOnError: pipeline.config.rollbackOnError,
        });
        return { deployLog: result };
      }
      return { deployLog: null, _note: "DeployAgent not available" };
    });

    // Stage 7: Monitoring
    this._stageHandlers.set("monitoring", async (pipeline, _stage) => {
      if (this._postDeployMonitor) {
        const result = await this._postDeployMonitor.startMonitoring({
          pipelineId: pipeline.id,
          duration: 300000, // 5 minutes
        });
        return { monitorSnapshot: result };
      }
      return {
        monitorSnapshot: null,
        _note: "PostDeployMonitor not available",
      };
    });
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  _getPipeline(pipelineId) {
    const pipeline = this._pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    return pipeline;
  }

  _getNextStage(pipeline, currentStage) {
    const nextOrder = currentStage.stageOrder + 1;
    return pipeline.stages.find((s) => s.stageOrder === nextOrder);
  }

  _getPreviousStage(pipeline, currentStage) {
    const prevOrder = currentStage.stageOrder - 1;
    return pipeline.stages.find((s) => s.stageOrder === prevOrder);
  }

  _needsGateApproval(pipeline, stage) {
    // Always gate code-review and deploy stages unless autoApprove is on
    if (pipeline.config.autoApprove) {
      return false;
    }
    const gateStages = ["code-review", "deploy"];
    if (pipeline.config.requireAllGates) {
      return true; // All stages require approval in security-audit mode
    }
    return gateStages.includes(stage.stageName);
  }

  _getArtifactTypeForStage(stageName) {
    const mapping = {
      "requirement-parsing": "spec",
      "architecture-design": "design-doc",
      "code-generation": "code",
      testing: "test-report",
      "code-review": "review-report",
      deploy: "deploy-log",
      monitoring: "monitor-snapshot",
    };
    return mapping[stageName] || null;
  }

  _completePipeline(pipelineId) {
    const pipeline = this._getPipeline(pipelineId);
    pipeline.status = PIPELINE_STATUS.COMPLETED;
    pipeline.completedAt = new Date().toISOString();
    pipeline.updatedAt = new Date().toISOString();
    this._updatePipelineDB(pipeline);
    this.emit("pipeline:completed", { pipelineId });
    logger.info(`[PipelineOrchestrator] Pipeline completed: ${pipelineId}`);
  }

  _failPipeline(pipelineId, errorMessage) {
    const pipeline = this._pipelines.get(pipelineId);
    if (!pipeline) {
      return;
    }
    pipeline.status = PIPELINE_STATUS.FAILED;
    pipeline.completedAt = new Date().toISOString();
    pipeline.updatedAt = new Date().toISOString();
    pipeline.metrics.failureReason = errorMessage;
    this._updatePipelineDB(pipeline);
    this.emit("pipeline:failed", { pipelineId, error: errorMessage });
    logger.error(
      `[PipelineOrchestrator] Pipeline failed: ${pipelineId} — ${errorMessage}`,
    );
  }

  // ============================================================
  // Database Operations
  // ============================================================

  _ensureTables() {
    // Tables are created by database.js — just verify they exist
    try {
      this.db.prepare(`SELECT 1 FROM dev_pipelines LIMIT 0`).get();
      this.db.prepare(`SELECT 1 FROM dev_pipeline_stages LIMIT 0`).get();
      this.db.prepare(`SELECT 1 FROM dev_pipeline_artifacts LIMIT 0`).get();
    } catch {
      logger.warn(
        "[PipelineOrchestrator] Tables not found — run database migration",
      );
    }
  }

  async _loadActivePipelines() {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM dev_pipelines WHERE status IN ('created', 'running', 'paused', 'gate-waiting') ORDER BY created_at DESC`,
        )
        .all();

      for (const row of rows) {
        const stages = this.db
          .prepare(
            `SELECT * FROM dev_pipeline_stages WHERE pipeline_id = ? ORDER BY stage_order`,
          )
          .all(row.id);

        const pipeline = {
          ...row,
          specJson: JSON.parse(row.spec_json || "{}"),
          config: JSON.parse(row.config || "{}"),
          metrics: JSON.parse(row.metrics || "{}"),
          stages: stages.map((s) => ({
            id: s.id,
            pipelineId: s.pipeline_id,
            stageName: s.stage_name,
            stageOrder: s.stage_order,
            status: s.status,
            input: JSON.parse(s.input || "{}"),
            output: JSON.parse(s.output || "{}"),
            agentId: s.agent_id,
            gateApprover: s.gate_approver,
            gateComment: s.gate_comment,
            startedAt: s.started_at,
            completedAt: s.completed_at,
          })),
        };

        this._pipelines.set(row.id, pipeline);
      }
    } catch (error) {
      logger.warn(
        `[PipelineOrchestrator] Failed to load pipelines: ${error.message}`,
      );
    }
  }

  _savePipeline(pipeline) {
    try {
      this.db
        .prepare(
          `INSERT INTO dev_pipelines (id, name, template, requirement, spec_json, status, current_stage, config, metrics, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          pipeline.id,
          pipeline.name,
          pipeline.template,
          pipeline.requirement,
          JSON.stringify(pipeline.specJson),
          pipeline.status,
          pipeline.currentStage,
          JSON.stringify(pipeline.config),
          JSON.stringify(pipeline.metrics),
          pipeline.createdBy,
          pipeline.createdAt,
          pipeline.updatedAt,
        );
    } catch (error) {
      logger.error(
        `[PipelineOrchestrator] Save pipeline error: ${error.message}`,
      );
    }
  }

  _updatePipelineDB(pipeline) {
    try {
      this.db
        .prepare(
          `UPDATE dev_pipelines SET status = ?, current_stage = ?, spec_json = ?, config = ?, metrics = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
        )
        .run(
          pipeline.status,
          pipeline.currentStage,
          JSON.stringify(pipeline.specJson),
          JSON.stringify(pipeline.config),
          JSON.stringify(pipeline.metrics),
          pipeline.updatedAt,
          pipeline.completedAt,
          pipeline.id,
        );
    } catch (error) {
      logger.error(
        `[PipelineOrchestrator] Update pipeline error: ${error.message}`,
      );
    }
  }

  _saveStage(stage) {
    try {
      this.db
        .prepare(
          `INSERT INTO dev_pipeline_stages (id, pipeline_id, stage_name, stage_order, status, input, output, agent_id, gate_approver, gate_comment, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          stage.id,
          stage.pipelineId,
          stage.stageName,
          stage.stageOrder,
          stage.status,
          JSON.stringify(stage.input),
          JSON.stringify(stage.output),
          stage.agentId,
          stage.gateApprover,
          stage.gateComment,
          stage.startedAt,
          stage.completedAt,
        );
    } catch (error) {
      logger.error(`[PipelineOrchestrator] Save stage error: ${error.message}`);
    }
  }

  _updateStageDB(stage) {
    try {
      this.db
        .prepare(
          `UPDATE dev_pipeline_stages SET status = ?, input = ?, output = ?, agent_id = ?, gate_approver = ?, gate_comment = ?, started_at = ?, completed_at = ? WHERE id = ?`,
        )
        .run(
          stage.status,
          JSON.stringify(stage.input),
          JSON.stringify(stage.output),
          stage.agentId,
          stage.gateApprover,
          stage.gateComment,
          stage.startedAt,
          stage.completedAt,
          stage.id,
        );
    } catch (error) {
      logger.error(
        `[PipelineOrchestrator] Update stage error: ${error.message}`,
      );
    }
  }

  _saveArtifact(artifact) {
    try {
      this.db
        .prepare(
          `INSERT INTO dev_pipeline_artifacts (id, pipeline_id, stage_id, artifact_type, content, file_path, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.id,
          artifact.pipelineId,
          artifact.stageId,
          artifact.artifactType,
          artifact.content,
          artifact.filePath || null,
          JSON.stringify(artifact.metadata || {}),
        );
    } catch (error) {
      logger.error(
        `[PipelineOrchestrator] Save artifact error: ${error.message}`,
      );
    }
  }

  _getArtifacts(pipelineId, stageId) {
    try {
      let query = `SELECT * FROM dev_pipeline_artifacts WHERE pipeline_id = ?`;
      const params = [pipelineId];
      if (stageId) {
        query += ` AND stage_id = ?`;
        params.push(stageId);
      }
      query += ` ORDER BY created_at`;
      return this.db
        .prepare(query)
        .all(...params)
        .map((row) => ({
          id: row.id,
          pipelineId: row.pipeline_id,
          stageId: row.stage_id,
          artifactType: row.artifact_type,
          content: row.content,
          filePath: row.file_path,
          metadata: JSON.parse(row.metadata || "{}"),
          createdAt: row.created_at,
        }));
    } catch (error) {
      logger.warn(
        `[PipelineOrchestrator] Get artifacts error: ${error.message}`,
      );
      return [];
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getPipelineOrchestrator() {
  if (!instance) {
    instance = new PipelineOrchestrator();
  }
  return instance;
}

module.exports = {
  PipelineOrchestrator,
  getPipelineOrchestrator,
  PIPELINE_STATUS,
  STAGE_STATUS,
  STAGE_NAMES,
  ARTIFACT_TYPES,
  PIPELINE_TEMPLATES,
};
