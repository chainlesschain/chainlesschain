/**
 * GitHookRunner - Git Hook 运行器
 *
 * 在 Git 操作的关键点执行技能流水线，提供预提交检查、
 * 影响分析和自动修复能力。
 *
 * @module hooks/git-hook-runner
 * @version 1.1.0
 */

const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class GitHookRunner extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.pipelineEngine - SkillPipelineEngine instance
   * @param {Object} options.skillRegistry - SkillRegistry instance
   * @param {Object} [options.hookSystem] - HookSystem instance
   */
  constructor(options = {}) {
    super();
    this.pipelineEngine = options.pipelineEngine;
    this.skillRegistry = options.skillRegistry;
    this.hookSystem = options.hookSystem || null;

    this.config = {
      preCommitEnabled: true,
      impactAnalysisEnabled: true,
      autoFixEnabled: false,
      maxAutoFixRetries: 3,
      preCommitSkills: ["lint-and-fix", "code-review", "security-audit"],
      impactSkills: ["impact-analyzer", "dependency-analyzer"],
      autoFixSkills: ["bugbot", "test-and-fix", "lint-and-fix"],
    };

    this.history = [];
    this._maxHistory = 100;

    logger.info("[GitHookRunner] Initialized");
  }

  /**
   * Register git-related hooks with the HookSystem
   * @param {Object} hookSystem - HookSystem instance
   */
  registerGitHooks(hookSystem) {
    this.hookSystem = hookSystem;

    if (!hookSystem) {
      logger.warn("[GitHookRunner] No HookSystem provided");
      return;
    }

    // Register pre-commit hook
    hookSystem.registry?.register({
      event: "PreGitCommit",
      name: "git-hook-runner-pre-commit",
      type: "async",
      priority: 100,
      handler: async (context) => {
        if (!this.config.preCommitEnabled) {
          return { allowed: true };
        }
        const result = await this.runPreCommit(
          context.changedFiles || [],
          context,
        );
        return { allowed: result.passed, result };
      },
      description: "Run pre-commit skill pipeline",
    });

    // Register post-commit hook
    hookSystem.registry?.register({
      event: "PostGitCommit",
      name: "git-hook-runner-post-commit",
      type: "async",
      priority: 500,
      handler: async (context) => {
        this.emit("post-commit", context);
      },
      description: "Post-commit notification",
    });

    logger.info("[GitHookRunner] Git hooks registered with HookSystem");
  }

  /**
   * Run pre-commit checks
   * @param {string[]} changedFiles - List of changed file paths
   * @param {Object} [options] - Additional options
   * @returns {Promise<Object>} { passed, issues[], autoFixes[], duration }
   */
  async runPreCommit(changedFiles, options = {}) {
    const startTime = Date.now();
    const result = {
      passed: true,
      issues: [],
      autoFixes: [],
      duration: 0,
      steps: [],
    };

    logger.info(
      `[GitHookRunner] Running pre-commit on ${changedFiles.length} files...`,
    );
    this.emit("pre-commit-started", { files: changedFiles });

    const skillsToRun = options.skills || this.config.preCommitSkills;

    for (const skillId of skillsToRun) {
      try {
        const skill = this.skillRegistry?.getSkill(skillId);
        if (!skill) {
          logger.warn(`[GitHookRunner] Skill not found: ${skillId}, skipping`);
          continue;
        }

        const stepStart = Date.now();
        const stepResult = await this.skillRegistry.executeSkill(
          skillId,
          {
            type: "git-pre-commit",
            files: changedFiles,
            autoFix: options.autoFix !== false,
          },
          { gitHook: true },
        );

        const stepDuration = Date.now() - stepStart;

        result.steps.push({
          skillId,
          success: stepResult?.success !== false,
          duration: stepDuration,
          issueCount: stepResult?.issues?.length || 0,
          fixCount: stepResult?.fixes?.length || 0,
        });

        // Collect issues
        if (stepResult?.issues && Array.isArray(stepResult.issues)) {
          for (const issue of stepResult.issues) {
            result.issues.push({
              ...issue,
              source: skillId,
              severity: issue.severity || "warning",
            });
          }
        }

        // Collect auto-fixes
        if (stepResult?.fixes && Array.isArray(stepResult.fixes)) {
          result.autoFixes.push(...stepResult.fixes);
        }

        // Check for blocking issues
        if (stepResult?.success === false && stepResult?.blocking) {
          result.passed = false;
        }
      } catch (error) {
        logger.error(
          `[GitHookRunner] Pre-commit skill ${skillId} failed: ${error.message}`,
        );
        result.steps.push({
          skillId,
          success: false,
          error: error.message,
          duration: 0,
        });
      }
    }

    // Check if any critical/error severity issues should block
    const blockingIssues = result.issues.filter(
      (i) => i.severity === "error" || i.severity === "critical",
    );
    if (blockingIssues.length > 0) {
      result.passed = false;
    }

    result.duration = Date.now() - startTime;

    // Record in history
    this._addHistory("pre-commit", result);

    this.emit("pre-commit-completed", result);
    logger.info(
      `[GitHookRunner] Pre-commit completed: ${result.passed ? "PASSED" : "FAILED"} (${result.duration}ms, ${result.issues.length} issues)`,
    );

    return result;
  }

  /**
   * Run impact analysis on changed files
   * @param {string[]} changedFiles - List of changed file paths
   * @returns {Promise<Object>} { affectedFiles[], suggestedTests[], riskScore }
   */
  async runImpactAnalysis(changedFiles) {
    const startTime = Date.now();
    const result = {
      affectedFiles: [],
      suggestedTests: [],
      riskScore: 0,
      duration: 0,
      steps: [],
    };

    logger.info(
      `[GitHookRunner] Running impact analysis on ${changedFiles.length} files...`,
    );
    this.emit("impact-started", { files: changedFiles });

    for (const skillId of this.config.impactSkills) {
      try {
        const skill = this.skillRegistry?.getSkill(skillId);
        if (!skill) {
          continue;
        }

        const stepStart = Date.now();
        const stepResult = await this.skillRegistry.executeSkill(
          skillId,
          {
            type: "impact-analysis",
            files: changedFiles,
          },
          { gitHook: true },
        );

        result.steps.push({
          skillId,
          success: true,
          duration: Date.now() - stepStart,
        });

        if (stepResult?.affectedFiles) {
          result.affectedFiles.push(...stepResult.affectedFiles);
        }
        if (stepResult?.suggestedTests) {
          result.suggestedTests.push(...stepResult.suggestedTests);
        }
        if (stepResult?.riskScore) {
          result.riskScore = Math.max(result.riskScore, stepResult.riskScore);
        }
      } catch (error) {
        logger.error(
          `[GitHookRunner] Impact analysis skill ${skillId} failed: ${error.message}`,
        );
        result.steps.push({ skillId, success: false, error: error.message });
      }
    }

    // Deduplicate
    result.affectedFiles = [...new Set(result.affectedFiles)];
    result.suggestedTests = [...new Set(result.suggestedTests)];
    result.duration = Date.now() - startTime;

    this._addHistory("impact-analysis", result);
    this.emit("impact-completed", result);
    logger.info(
      `[GitHookRunner] Impact analysis completed: ${result.affectedFiles.length} affected files, risk=${result.riskScore}`,
    );

    return result;
  }

  /**
   * Run auto-fix for failed tests/checks
   * @param {string[]} failedTests - List of failed test identifiers
   * @param {Object} [options]
   * @returns {Promise<Object>} { fixed[], remaining[], patchFiles[] }
   */
  async runAutoFix(failedTests, options = {}) {
    const startTime = Date.now();
    const result = {
      fixed: [],
      remaining: [],
      patchFiles: [],
      duration: 0,
      steps: [],
    };

    logger.info(
      `[GitHookRunner] Running auto-fix for ${failedTests.length} failures...`,
    );
    this.emit("autofix-started", { failures: failedTests });

    let remaining = [...failedTests];

    for (const skillId of this.config.autoFixSkills) {
      if (remaining.length === 0) {
        break;
      }

      try {
        const skill = this.skillRegistry?.getSkill(skillId);
        if (!skill) {
          continue;
        }

        const stepStart = Date.now();
        const stepResult = await this.skillRegistry.executeSkill(
          skillId,
          {
            type: "auto-fix",
            failures: remaining,
            maxRetries: options.maxRetries || this.config.maxAutoFixRetries,
          },
          { gitHook: true },
        );

        result.steps.push({
          skillId,
          success: true,
          duration: Date.now() - stepStart,
        });

        if (stepResult?.fixed && Array.isArray(stepResult.fixed)) {
          result.fixed.push(...stepResult.fixed);
          remaining = remaining.filter((f) => !stepResult.fixed.includes(f));
        }
        if (stepResult?.patches && Array.isArray(stepResult.patches)) {
          result.patchFiles.push(...stepResult.patches);
        }
      } catch (error) {
        logger.error(
          `[GitHookRunner] Auto-fix skill ${skillId} failed: ${error.message}`,
        );
        result.steps.push({ skillId, success: false, error: error.message });
      }
    }

    result.remaining = remaining;
    result.duration = Date.now() - startTime;

    this._addHistory("auto-fix", result);
    this.emit("autofix-completed", result);
    logger.info(
      `[GitHookRunner] Auto-fix completed: ${result.fixed.length} fixed, ${result.remaining.length} remaining`,
    );

    return result;
  }

  /**
   * Get current configuration
   * @returns {Object}
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param {Object} updates
   */
  setConfig(updates) {
    Object.assign(this.config, updates);
    this.emit("config-updated", this.config);
    logger.info("[GitHookRunner] Config updated");
  }

  /**
   * Get execution history
   * @param {number} [limit=20]
   * @returns {Object[]}
   */
  getHistory(limit = 20) {
    return this.history.slice(-limit);
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const total = this.history.length;
    const byType = {};
    let totalDuration = 0;
    let passCount = 0;

    for (const entry of this.history) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      totalDuration += entry.result?.duration || 0;
      if (entry.result?.passed !== false) {
        passCount++;
      }
    }

    return {
      totalRuns: total,
      byType,
      avgDurationMs: total > 0 ? Math.round(totalDuration / total) : 0,
      passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
    };
  }

  /** @private */
  _addHistory(type, result) {
    this.history.push({
      type,
      timestamp: Date.now(),
      result,
    });
    if (this.history.length > this._maxHistory) {
      this.history = this.history.slice(-this._maxHistory);
    }
  }
}

module.exports = { GitHookRunner };
