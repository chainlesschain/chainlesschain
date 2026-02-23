/**
 * BenchmarkManager - Model Performance Benchmark Orchestrator
 *
 * Manages benchmark runs against LLM models, recording latency,
 * quality metrics, and comparison reports.
 *
 * @module benchmark/benchmark-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");
const { getSuite, listSuites } = require("./benchmark-suites.js");
const {
  calculateLatencyMetrics,
  calculateBLEU,
  calculateROUGEL,
  calculateThroughput,
  calculateOverallScore,
} = require("./metrics-calculator.js");

/**
 * Benchmark run status constants
 */
const RUN_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

class BenchmarkManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database manager instance
   * @param {Object} options.llmManager - LLM manager instance for chat calls
   */
  constructor({ database, llmManager } = {}) {
    super();
    this.database = database || null;
    this.llmManager = llmManager || null;
    this.activeRuns = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the benchmark system and create database tables
   * @param {Object} [database] - Optional database override
   */
  async initialize(database) {
    if (database) {
      this.database = database;
    }

    if (!this.database) {
      logger.warn("[BenchmarkManager] No database provided, skipping table creation");
      this.initialized = true;
      return;
    }

    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS benchmark_runs (
          id TEXT PRIMARY KEY,
          suite_id TEXT NOT NULL,
          model_provider TEXT NOT NULL,
          model_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
          total_prompts INTEGER DEFAULT 0,
          completed_prompts INTEGER DEFAULT 0,
          summary TEXT,
          config TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS benchmark_results (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          prompt_index INTEGER NOT NULL,
          input_text TEXT NOT NULL,
          output_text TEXT,
          expected_text TEXT,
          metrics TEXT,
          iteration INTEGER DEFAULT 1,
          latency_ms INTEGER,
          tokens_used INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE
        );
      `);

      logger.info("[BenchmarkManager] Database tables initialized");
      this.initialized = true;
    } catch (error) {
      logger.error("[BenchmarkManager] Failed to initialize tables:", error);
      throw error;
    }
  }

  /**
   * Run a benchmark suite against a specific model configuration
   * @param {string} suiteId - ID of the benchmark suite
   * @param {Object} modelConfig - Model configuration
   * @param {string} modelConfig.provider - LLM provider name
   * @param {string} modelConfig.model - Model name
   * @param {Object} [modelConfig.options] - Additional LLM options
   * @returns {Object} Run summary
   */
  async runBenchmark(suiteId, modelConfig) {
    const suite = getSuite(suiteId);
    if (!suite) {
      throw new Error(`Benchmark suite not found: ${suiteId}`);
    }

    if (!modelConfig || !modelConfig.provider || !modelConfig.model) {
      throw new Error("modelConfig must include provider and model");
    }

    const runId = uuidv4();
    const iterations = suite.iterations || 1;
    const totalPrompts = suite.prompts.length * iterations;
    const now = Date.now();

    // Create run record
    if (this.database) {
      const stmt = this.database.prepare(
        `INSERT INTO benchmark_runs (id, suite_id, model_provider, model_name, status, total_prompts, completed_prompts, config, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
      );
      stmt.run(
        runId,
        suiteId,
        modelConfig.provider,
        modelConfig.model,
        RUN_STATUS.PENDING,
        totalPrompts,
        JSON.stringify(modelConfig),
        now
      );
    }

    // Track active run
    this.activeRuns.set(runId, { cancelled: false });

    try {
      // Update status to running
      if (this.database) {
        const stmt = this.database.prepare(
          `UPDATE benchmark_runs SET status = ?, started_at = ? WHERE id = ?`
        );
        stmt.run(RUN_STATUS.RUNNING, Date.now(), runId);
      }

      const allLatencies = [];
      let totalTokens = 0;
      let completedCount = 0;
      const runStartTime = Date.now();

      for (let iteration = 1; iteration <= iterations; iteration++) {
        for (let promptIdx = 0; promptIdx < suite.prompts.length; promptIdx++) {
          // Check for cancellation
          const runState = this.activeRuns.get(runId);
          if (!runState || runState.cancelled) {
            if (this.database) {
              const stmt = this.database.prepare(
                `UPDATE benchmark_runs SET status = ?, completed_at = ? WHERE id = ?`
              );
              stmt.run(RUN_STATUS.CANCELLED, Date.now(), runId);
            }
            this.activeRuns.delete(runId);
            return this._buildRunSummary(runId, suiteId, modelConfig, RUN_STATUS.CANCELLED, completedCount, totalPrompts);
          }

          const prompt = suite.prompts[promptIdx];
          const resultId = uuidv4();

          try {
            const messages = [{ role: "user", content: prompt.input }];
            const startTime = Date.now();

            const response = await this.llmManager.chatWithMessages(messages, {
              provider: modelConfig.provider,
              model: modelConfig.model,
              ...(modelConfig.options || {}),
            });

            const latencyMs = Date.now() - startTime;
            const outputText = response.text || response.message?.content || "";
            const tokensUsed = response.tokens || response.usage?.total_tokens || 0;

            allLatencies.push(latencyMs);
            totalTokens += tokensUsed;

            // Calculate per-result metrics
            const metrics = { latency_ms: latencyMs };
            if (prompt.expected) {
              metrics.bleu = calculateBLEU(prompt.expected, outputText);
              metrics.rougeL = calculateROUGEL(prompt.expected, outputText);
            }

            // Store result
            if (this.database) {
              const stmt = this.database.prepare(
                `INSERT INTO benchmark_results (id, run_id, prompt_index, input_text, output_text, expected_text, metrics, iteration, latency_ms, tokens_used, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              );
              stmt.run(
                resultId,
                runId,
                promptIdx,
                prompt.input,
                outputText,
                prompt.expected || null,
                JSON.stringify(metrics),
                iteration,
                latencyMs,
                tokensUsed,
                Date.now()
              );
            }

            completedCount++;

            // Update progress
            if (this.database) {
              const stmt = this.database.prepare(
                `UPDATE benchmark_runs SET completed_prompts = ? WHERE id = ?`
              );
              stmt.run(completedCount, runId);
            }

            // Emit progress event
            this.emit("benchmark:progress", {
              runId,
              suiteId,
              completed: completedCount,
              total: totalPrompts,
              currentPrompt: prompt.input,
              latencyMs,
              iteration,
            });
          } catch (promptError) {
            logger.error(`[BenchmarkManager] Prompt ${promptIdx} iteration ${iteration} failed:`, promptError);

            // Store failed result
            if (this.database) {
              const stmt = this.database.prepare(
                `INSERT INTO benchmark_results (id, run_id, prompt_index, input_text, output_text, expected_text, metrics, iteration, latency_ms, tokens_used, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              );
              stmt.run(
                resultId,
                runId,
                promptIdx,
                prompt.input,
                null,
                prompt.expected || null,
                JSON.stringify({ error: promptError.message }),
                iteration,
                0,
                0,
                Date.now()
              );
            }

            completedCount++;

            if (this.database) {
              const stmt = this.database.prepare(
                `UPDATE benchmark_runs SET completed_prompts = ? WHERE id = ?`
              );
              stmt.run(completedCount, runId);
            }
          }
        }
      }

      // Calculate summary
      const totalTimeMs = Date.now() - runStartTime;
      const latencyMetrics = calculateLatencyMetrics(allLatencies);
      const throughput = calculateThroughput(totalTokens, totalTimeMs);

      const summary = {
        latency: latencyMetrics,
        throughput,
        totalTokens,
        totalTimeMs,
        completedPrompts: completedCount,
        totalPrompts,
        successRate: allLatencies.length / totalPrompts,
      };

      // Update run record
      if (this.database) {
        const stmt = this.database.prepare(
          `UPDATE benchmark_runs SET status = ?, summary = ?, completed_at = ?, completed_prompts = ? WHERE id = ?`
        );
        stmt.run(
          RUN_STATUS.COMPLETED,
          JSON.stringify(summary),
          Date.now(),
          completedCount,
          runId
        );
      }

      this.activeRuns.delete(runId);
      logger.info(`[BenchmarkManager] Benchmark run ${runId} completed`);

      return this._buildRunSummary(runId, suiteId, modelConfig, RUN_STATUS.COMPLETED, completedCount, totalPrompts, summary);
    } catch (error) {
      logger.error(`[BenchmarkManager] Benchmark run ${runId} failed:`, error);

      if (this.database) {
        const stmt = this.database.prepare(
          `UPDATE benchmark_runs SET status = ?, completed_at = ?, summary = ? WHERE id = ?`
        );
        stmt.run(RUN_STATUS.FAILED, Date.now(), JSON.stringify({ error: error.message }), runId);
      }

      this.activeRuns.delete(runId);
      throw error;
    }
  }

  /**
   * Run the same benchmark suite against multiple model configurations
   * @param {string} suiteId - ID of the benchmark suite
   * @param {Array<Object>} modelConfigs - Array of model configurations
   * @returns {Object} Comparison results
   */
  async runComparison(suiteId, modelConfigs) {
    if (!Array.isArray(modelConfigs) || modelConfigs.length < 2) {
      throw new Error("runComparison requires at least 2 model configurations");
    }

    const suite = getSuite(suiteId);
    if (!suite) {
      throw new Error(`Benchmark suite not found: ${suiteId}`);
    }

    const results = [];

    for (const modelConfig of modelConfigs) {
      try {
        const result = await this.runBenchmark(suiteId, modelConfig);
        results.push(result);
      } catch (error) {
        logger.error(`[BenchmarkManager] Comparison run failed for ${modelConfig.model}:`, error);
        results.push({
          runId: null,
          suiteId,
          model: modelConfig.model,
          provider: modelConfig.provider,
          status: RUN_STATUS.FAILED,
          error: error.message,
        });
      }
    }

    return {
      suiteId,
      suiteName: suite.name,
      comparedModels: modelConfigs.map((c) => `${c.provider}/${c.model}`),
      results,
      comparedAt: Date.now(),
    };
  }

  /**
   * Get the current status of a benchmark run
   * @param {string} runId - Run ID
   * @returns {Object|null} Run status
   */
  getRunStatus(runId) {
    if (!this.database) {
      return null;
    }

    const stmt = this.database.prepare(
      `SELECT id, suite_id, model_provider, model_name, status, total_prompts, completed_prompts, started_at, completed_at, created_at FROM benchmark_runs WHERE id = ?`
    );
    const row = stmt.get(runId);

    if (!row) {
      return null;
    }

    const isActive = this.activeRuns.has(runId);

    return {
      id: row.id,
      suiteId: row.suite_id,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      status: row.status,
      totalPrompts: row.total_prompts,
      completedPrompts: row.completed_prompts,
      progress: row.total_prompts > 0 ? row.completed_prompts / row.total_prompts : 0,
      isActive,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Cancel an active benchmark run
   * @param {string} runId - Run ID to cancel
   * @returns {boolean} Whether the cancellation was initiated
   */
  cancelRun(runId) {
    const runState = this.activeRuns.get(runId);
    if (!runState) {
      logger.warn(`[BenchmarkManager] Run ${runId} is not active, cannot cancel`);
      return false;
    }

    runState.cancelled = true;
    logger.info(`[BenchmarkManager] Cancellation requested for run ${runId}`);
    return true;
  }

  /**
   * Get all results for a benchmark run
   * @param {string} runId - Run ID
   * @returns {Array} Array of result records
   */
  getResults(runId) {
    if (!this.database) {
      return [];
    }

    const stmt = this.database.prepare(
      `SELECT id, run_id, prompt_index, input_text, output_text, expected_text, metrics, iteration, latency_ms, tokens_used, created_at
       FROM benchmark_results WHERE run_id = ? ORDER BY iteration ASC, prompt_index ASC`
    );
    const rows = stmt.all(runId);

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      promptIndex: row.prompt_index,
      inputText: row.input_text,
      outputText: row.output_text,
      expectedText: row.expected_text,
      metrics: row.metrics ? JSON.parse(row.metrics) : {},
      iteration: row.iteration,
      latencyMs: row.latency_ms,
      tokensUsed: row.tokens_used,
      createdAt: row.created_at,
    }));
  }

  /**
   * Generate a comparison report for a benchmark run
   * @param {string} runId - Run ID
   * @returns {Object} Detailed report
   */
  getReport(runId) {
    if (!this.database) {
      return null;
    }

    const runStmt = this.database.prepare(
      `SELECT * FROM benchmark_runs WHERE id = ?`
    );
    const run = runStmt.get(runId);

    if (!run) {
      return null;
    }

    const results = this.getResults(runId);
    const suite = getSuite(run.suite_id);

    // Compute aggregate metrics from individual results
    const latencies = results
      .filter((r) => r.latencyMs > 0)
      .map((r) => r.latencyMs);
    const latencyMetrics = calculateLatencyMetrics(latencies);

    const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
    const totalTimeMs = run.completed_at && run.started_at
      ? run.completed_at - run.started_at
      : 0;
    const throughput = calculateThroughput(totalTokens, totalTimeMs);

    // Quality metrics where expected text exists
    const qualityResults = results.filter((r) => r.expectedText);
    const bleuScores = qualityResults
      .filter((r) => r.metrics && r.metrics.bleu !== undefined)
      .map((r) => r.metrics.bleu);
    const rougeLScores = qualityResults
      .filter((r) => r.metrics && r.metrics.rougeL !== undefined)
      .map((r) => r.metrics.rougeL);

    const avgBleu = bleuScores.length > 0
      ? bleuScores.reduce((a, b) => a + b, 0) / bleuScores.length
      : null;
    const avgRougeL = rougeLScores.length > 0
      ? rougeLScores.reduce((a, b) => a + b, 0) / rougeLScores.length
      : null;

    const overallScore = calculateOverallScore({
      latency: latencyMetrics,
      avgBleu,
      avgRougeL,
      throughput,
      successRate: latencies.length / (results.length || 1),
    });

    const summary = run.summary ? JSON.parse(run.summary) : {};

    return {
      runId: run.id,
      suiteId: run.suite_id,
      suiteName: suite ? suite.name : run.suite_id,
      suiteDescription: suite ? suite.description : "",
      modelProvider: run.model_provider,
      modelName: run.model_name,
      status: run.status,
      config: run.config ? JSON.parse(run.config) : {},
      totalPrompts: run.total_prompts,
      completedPrompts: run.completed_prompts,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      metrics: {
        latency: latencyMetrics,
        throughput,
        totalTokens,
        totalTimeMs,
        avgBleu,
        avgRougeL,
        overallScore,
        successRate: latencies.length / (results.length || 1),
      },
      results,
      summary,
    };
  }

  /**
   * List past benchmark runs with pagination and optional filtering
   * @param {Object} [options]
   * @param {number} [options.limit=20] - Max runs to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.suiteId] - Filter by suite ID
   * @param {string} [options.status] - Filter by status
   * @param {string} [options.modelName] - Filter by model name
   * @returns {Object} { runs, total }
   */
  listRuns(options = {}) {
    if (!this.database) {
      return { runs: [], total: 0 };
    }

    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let whereClause = "1=1";
    const params = [];

    if (options.suiteId) {
      whereClause += " AND suite_id = ?";
      params.push(options.suiteId);
    }

    if (options.status) {
      whereClause += " AND status = ?";
      params.push(options.status);
    }

    if (options.modelName) {
      whereClause += " AND model_name = ?";
      params.push(options.modelName);
    }

    const countStmt = this.database.prepare(
      `SELECT COUNT(*) as total FROM benchmark_runs WHERE ${whereClause}`
    );
    const countResult = countStmt.get(...params);
    const total = countResult ? countResult.total : 0;

    const listStmt = this.database.prepare(
      `SELECT id, suite_id, model_provider, model_name, status, total_prompts, completed_prompts, summary, started_at, completed_at, created_at
       FROM benchmark_runs WHERE ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    );
    const rows = listStmt.all(...params, limit, offset);

    const runs = rows.map((row) => ({
      id: row.id,
      suiteId: row.suite_id,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      status: row.status,
      totalPrompts: row.total_prompts,
      completedPrompts: row.completed_prompts,
      summary: row.summary ? JSON.parse(row.summary) : null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    }));

    return { runs, total };
  }

  /**
   * Delete a benchmark run and all associated results
   * @param {string} runId - Run ID to delete
   * @returns {boolean} Whether the run was deleted
   */
  deleteRun(runId) {
    if (!this.database) {
      return false;
    }

    // Do not delete active runs
    if (this.activeRuns.has(runId)) {
      throw new Error("Cannot delete an active benchmark run. Cancel it first.");
    }

    // Delete results first (in case FK constraints are not enforced)
    const deleteResultsStmt = this.database.prepare(
      `DELETE FROM benchmark_results WHERE run_id = ?`
    );
    deleteResultsStmt.run(runId);

    const deleteRunStmt = this.database.prepare(
      `DELETE FROM benchmark_runs WHERE id = ?`
    );
    const result = deleteRunStmt.run(runId);

    const deleted = result.changes > 0;
    if (deleted) {
      logger.info(`[BenchmarkManager] Deleted benchmark run ${runId}`);
    }

    return deleted;
  }

  /**
   * Build a run summary object
   * @private
   */
  _buildRunSummary(runId, suiteId, modelConfig, status, completedPrompts, totalPrompts, summary = null) {
    return {
      runId,
      suiteId,
      model: modelConfig.model,
      provider: modelConfig.provider,
      status,
      completedPrompts,
      totalPrompts,
      summary,
    };
  }
}

module.exports = { BenchmarkManager, RUN_STATUS };
