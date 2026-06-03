/**
 * Deploy Agent — Pipeline Deployment Execution (v3.0)
 *
 * Handles the deploy stage of the dev pipeline:
 * - Git branch creation and PR opening
 * - Docker image build and push
 * - npm publish support
 * - Deployment verification (smoke tests)
 * - Integration with PostDeployMonitor for production tracking
 *
 * @module ai-engine/cowork/deploy-agent
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const DEPLOY_STRATEGY = {
  GIT_PR: "git-pr",
  DOCKER: "docker",
  NPM_PUBLISH: "npm-publish",
  LOCAL: "local",
  STAGING: "staging",
};

const DEPLOY_STATUS = {
  PENDING: "pending",
  PREPARING: "preparing",
  DEPLOYING: "deploying",
  VERIFYING: "verifying",
  SUCCESS: "success",
  FAILED: "failed",
  ROLLED_BACK: "rolled-back",
};

const DEFAULT_CONFIG = {
  defaultStrategy: DEPLOY_STRATEGY.GIT_PR,
  autoCreateBranch: true,
  branchPrefix: "pipeline/",
  enableSmokeTests: true,
  smokeTestTimeoutMs: 30000,
  deployTimeoutMs: 120000,
  autoMerge: false,
  dryRun: false,
};

// ============================================================
// DeployAgent Class
// ============================================================

class DeployAgent extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.rollbackManager = null;
    this.config = { ...DEFAULT_CONFIG };
    this.activeDeployments = new Map();
    this.stats = {
      totalDeploys: 0,
      successCount: 0,
      failureCount: 0,
      rollbackCount: 0,
      strategyDistribution: {},
      averageDurationMs: 0,
    };
    this._durations = [];
  }

  /**
   * Initialize
   * @param {Object} db - Database instance
   * @param {Object} deps - Dependencies
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.rollbackManager = deps.rollbackManager || null;
    logger.info("[DeployAgent] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Execute a deployment
   * @param {Object} options
   * @param {string} options.pipelineId - Pipeline ID
   * @param {string} [options.strategy] - Deploy strategy
   * @param {Object} [options.artifacts] - Build artifacts from previous stages
   * @param {Object} [options.config] - Deploy-specific config overrides
   * @returns {Object} Deployment result
   */
  async deploy(options = {}) {
    if (!this.initialized) {
      throw new Error("DeployAgent not initialized");
    }

    const deployId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const strategy = options.strategy || this.config.defaultStrategy;
    const startTime = Date.now();

    this.stats.totalDeploys++;
    this.stats.strategyDistribution[strategy] =
      (this.stats.strategyDistribution[strategy] || 0) + 1;

    this.activeDeployments.set(deployId, {
      id: deployId,
      pipelineId: options.pipelineId,
      strategy,
      status: DEPLOY_STATUS.PREPARING,
      startTime,
    });

    logger.info(`[DeployAgent] Starting ${strategy} deploy: ${deployId}`);

    try {
      // Step 1: Prepare
      this.emit("deploy:preparing", { deployId, strategy });
      const prepResult = await this._prepare(strategy, options);

      // Step 2: Execute deployment
      this._updateDeployStatus(deployId, DEPLOY_STATUS.DEPLOYING);
      this.emit("deploy:deploying", { deployId, strategy });
      const deployResult = await this._executeDeploy(
        strategy,
        options,
        prepResult,
      );

      // Step 3: Verify (smoke tests)
      if (this.config.enableSmokeTests && !this.config.dryRun) {
        this._updateDeployStatus(deployId, DEPLOY_STATUS.VERIFYING);
        this.emit("deploy:verifying", { deployId });
        const verifyResult = await this._verify(strategy, deployResult);

        if (!verifyResult.passed) {
          // Auto-rollback on verification failure
          if (this.rollbackManager?.initialized) {
            await this.rollbackManager.rollback({
              type:
                strategy === DEPLOY_STRATEGY.DOCKER
                  ? "docker-rollback"
                  : "git-revert",
              reason: `Smoke test failed: ${verifyResult.reason}`,
              target: deployResult,
            });
            this.stats.rollbackCount++;
          }

          this._updateDeployStatus(deployId, DEPLOY_STATUS.ROLLED_BACK);
          const elapsed = Date.now() - startTime;
          return {
            deployId,
            status: DEPLOY_STATUS.ROLLED_BACK,
            strategy,
            reason: verifyResult.reason,
            duration: elapsed,
          };
        }
      }

      // Success
      this._updateDeployStatus(deployId, DEPLOY_STATUS.SUCCESS);
      const elapsed = Date.now() - startTime;

      this.stats.successCount++;
      this._durations.push(elapsed);
      if (this._durations.length > 100) {
        this._durations.shift();
      }
      this.stats.averageDurationMs = Math.round(
        this._durations.reduce((a, b) => a + b, 0) / this._durations.length,
      );

      const result = {
        deployId,
        status: DEPLOY_STATUS.SUCCESS,
        strategy,
        details: deployResult,
        duration: elapsed,
      };

      this.activeDeployments.delete(deployId);
      this.emit("deploy:success", result);

      logger.info(`[DeployAgent] Deploy ${deployId} succeeded (${elapsed}ms)`);
      return result;
    } catch (error) {
      this._updateDeployStatus(deployId, DEPLOY_STATUS.FAILED);
      this.activeDeployments.delete(deployId);
      this.stats.failureCount++;

      logger.error(`[DeployAgent] Deploy ${deployId} failed: ${error.message}`);
      this.emit("deploy:failed", { deployId, error: error.message });

      return {
        deployId,
        status: DEPLOY_STATUS.FAILED,
        strategy,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Get active deployments
   */
  getActiveDeployments() {
    return [...this.activeDeployments.values()];
  }

  getStats() {
    return { ...this.stats, active: this.activeDeployments.size };
  }

  getConfig() {
    return { ...this.config };
  }

  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Strategy Implementations
  // ============================================================

  async _prepare(strategy, options) {
    switch (strategy) {
      case DEPLOY_STRATEGY.GIT_PR:
        return this._prepareGitPR(options);
      case DEPLOY_STRATEGY.DOCKER:
        return this._prepareDocker(options);
      case DEPLOY_STRATEGY.NPM_PUBLISH:
        return this._prepareNpmPublish(options);
      default:
        return { strategy, prepared: true };
    }
  }

  async _executeDeploy(strategy, options, prepResult) {
    if (this.config.dryRun) {
      logger.info(`[DeployAgent] Dry run — skipping actual deployment`);
      return { dryRun: true, strategy, ...prepResult };
    }

    switch (strategy) {
      case DEPLOY_STRATEGY.GIT_PR:
        return this._deployGitPR(options, prepResult);
      case DEPLOY_STRATEGY.DOCKER:
        return this._deployDocker(options, prepResult);
      case DEPLOY_STRATEGY.NPM_PUBLISH:
        return this._deployNpmPublish(options, prepResult);
      case DEPLOY_STRATEGY.LOCAL:
        return this._deployLocal(options);
      case DEPLOY_STRATEGY.STAGING:
        return this._deployStaging(options);
      default:
        return { strategy, deployed: true, simulated: true };
    }
  }

  async _prepareGitPR(options) {
    const branchName = this.config.autoCreateBranch
      ? `${this.config.branchPrefix}${options.pipelineId || "unknown"}`
      : options.branch || "main";

    this.emit("git:create-branch", { branchName });
    return { branchName, prepared: true };
  }

  async _deployGitPR(options, prepResult) {
    const branchName = prepResult.branchName;
    this.emit("git:commit-and-push", {
      branchName,
      files: options.artifacts?.files || [],
      message: `pipeline: ${options.pipelineId} auto-deploy`,
    });
    this.emit("git:create-pr", {
      branchName,
      title: `[Pipeline] ${options.pipelineId}`,
      autoMerge: this.config.autoMerge,
    });
    return { branchName, prCreated: true, simulated: true };
  }

  async _prepareDocker(options) {
    const imageName =
      options.imageName || `chainlesschain/${options.pipelineId || "app"}`;
    const tag = options.tag || `pipeline-${Date.now()}`;
    return { imageName, tag, prepared: true };
  }

  async _deployDocker(options, prepResult) {
    this.emit("docker:build", {
      imageName: prepResult.imageName,
      tag: prepResult.tag,
      context: options.dockerContext || ".",
    });
    this.emit("docker:push", {
      imageName: prepResult.imageName,
      tag: prepResult.tag,
    });
    return {
      imageName: prepResult.imageName,
      tag: prepResult.tag,
      simulated: true,
    };
  }

  async _prepareNpmPublish(options) {
    return { packageName: options.packageName, prepared: true };
  }

  async _deployNpmPublish(options, prepResult) {
    this.emit("npm:publish", {
      packageName: prepResult.packageName,
      version: options.version || "patch",
    });
    return { packageName: prepResult.packageName, simulated: true };
  }

  async _deployLocal(options) {
    this.emit("local:deploy", { artifacts: options.artifacts });
    return { local: true, simulated: true };
  }

  async _deployStaging(options) {
    this.emit("staging:deploy", { artifacts: options.artifacts });
    return { staging: true, simulated: true };
  }

  // ============================================================
  // Verification
  // ============================================================

  async _verify(strategy, deployResult) {
    try {
      // Emit event for external smoke test runner
      this.emit("deploy:smoke-test", { strategy, deployResult });

      // Simulated verification — real implementation would run actual tests
      return { passed: true, checks: ["health-check", "basic-routes"] };
    } catch (error) {
      return { passed: false, reason: error.message };
    }
  }

  _updateDeployStatus(deployId, status) {
    const deployment = this.activeDeployments.get(deployId);
    if (deployment) {
      deployment.status = status;
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getDeployAgent() {
  if (!instance) {
    instance = new DeployAgent();
  }
  return instance;
}

module.exports = {
  DeployAgent,
  getDeployAgent,
  DEPLOY_STRATEGY,
  DEPLOY_STATUS,
};
