"use strict";

/**
 * Fine-Tuning Manager - LoRA/QLoRA model fine-tuning orchestration
 *
 * Coordinates the end-to-end fine-tuning workflow: data preparation,
 * training job management (via Ollama or llama.cpp backends), adapter
 * lifecycle, and progress tracking.
 *
 * @module fine-tuning/fine-tuning-manager
 * @version 1.0.0
 */

const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { TrainingDataBuilder } = require("./training-data-builder.js");
const { AdapterRegistry } = require("./adapter-registry.js");

// Ollama default base URL
const OLLAMA_DEFAULT_URL = "http://localhost:11434";

class FineTuningManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database manager instance
   */
  constructor({ database } = {}) {
    super();
    this.database = database || null;
    this.dataBuilder = new TrainingDataBuilder({ database: this.database });
    this.adapterRegistry = new AdapterRegistry({ database: this.database });
    this.initialized = false;
    this.runningProcesses = new Map(); // jobId -> child_process
    this.ollamaBaseUrl = process.env.OLLAMA_HOST || OLLAMA_DEFAULT_URL;
  }

  /**
   * Initialize the manager and ensure database tables exist.
   *
   * @param {Object} [database] - Optionally override the database reference
   */
  async initialize(database) {
    if (database) {
      this.database = database;
      this.dataBuilder = new TrainingDataBuilder({ database });
      this.adapterRegistry = new AdapterRegistry({ database });
    }

    this._ensureTables();
    this.initialized = true;
    logger.info("[FineTuning] Manager initialized");
  }

  /**
   * Create required database tables if they do not exist.
   * @private
   */
  _ensureTables() {
    if (!this.database) {
      return;
    }

    const db = this.database.db || this.database;

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS fine_tuning_jobs (
          id TEXT PRIMARY KEY,
          base_model TEXT NOT NULL,
          adapter_name TEXT NOT NULL,
          data_path TEXT,
          backend TEXT NOT NULL DEFAULT 'ollama' CHECK(backend IN ('ollama','llama-cpp')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
          progress REAL DEFAULT 0,
          config TEXT,
          metrics TEXT,
          error_message TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS lora_adapters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          base_model TEXT NOT NULL,
          adapter_path TEXT NOT NULL,
          size_bytes INTEGER DEFAULT 0,
          training_job_id TEXT,
          description TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (training_job_id) REFERENCES fine_tuning_jobs(id) ON DELETE SET NULL
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fine_tuning_jobs_status ON fine_tuning_jobs(status)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_lora_adapters_base_model ON lora_adapters(base_model)
      `);

      logger.info("[FineTuning] Database tables ensured");
    } catch (error) {
      logger.error("[FineTuning] Failed to create tables:", error.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Data Preparation
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Prepare training data from the knowledge base.
   *
   * @param {Object} options
   * @param {string} options.source - Data source: 'conversations', 'notes', or 'custom'
   * @param {string} [options.format='jsonl'] - Output format: 'jsonl' or 'alpaca'
   * @param {string} options.outputPath - Destination file path
   * @param {Object} [options.filters={}] - Source-specific filters
   * @returns {Promise<{recordCount: number, outputPath: string, format: string}>}
   */
  async prepareData(options) {
    const { source, format = "jsonl", outputPath, filters = {} } = options;

    if (!source || !outputPath) {
      throw new Error("source and outputPath are required");
    }

    logger.info(
      `[FineTuning] Preparing data from "${source}" in ${format} format`,
    );

    let data = [];

    switch (source) {
      case "conversations":
        data = this.dataBuilder.extractFromConversations(filters);
        break;
      case "notes":
        data = this.dataBuilder.extractFromNotes(filters);
        break;
      case "custom":
        if (filters.data && Array.isArray(filters.data)) {
          data = filters.data;
        } else {
          throw new Error("Custom source requires filters.data array");
        }
        break;
      default:
        throw new Error(`Unsupported source: ${source}`);
    }

    if (data.length === 0) {
      logger.warn("[FineTuning] No data extracted from source");
      return { recordCount: 0, outputPath, format };
    }

    let result;
    if (format === "alpaca") {
      result = this.dataBuilder.formatAsAlpaca(data, outputPath);
    } else {
      result = this.dataBuilder.formatAsJSONL(data, outputPath);
    }

    return {
      recordCount: result.recordCount,
      outputPath: result.path,
      format,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Training Jobs
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Start a fine-tuning training job.
   *
   * @param {Object} config
   * @param {string} config.baseModel - Base model name (e.g. 'llama2', 'mistral')
   * @param {string} config.adapterName - Name for the resulting adapter
   * @param {string} config.dataPath - Path to the training data file
   * @param {string} [config.backend='ollama'] - Backend: 'ollama' or 'llama-cpp'
   * @param {number} [config.epochs=3] - Number of training epochs
   * @param {number} [config.batchSize=4] - Training batch size
   * @param {number} [config.learningRate=0.0002] - Learning rate
   * @param {number} [config.loraRank=16] - LoRA rank dimension
   * @param {number} [config.loraAlpha=32] - LoRA alpha scaling
   * @param {string} [config.quantization] - Quantization mode (e.g. '4bit', '8bit')
   * @returns {Promise<Object>} The created job record
   */
  async startTraining(config) {
    const {
      baseModel,
      adapterName,
      dataPath,
      backend = "ollama",
      epochs = 3,
      batchSize = 4,
      learningRate = 0.0002,
      loraRank = 16,
      loraAlpha = 32,
      quantization = null,
    } = config;

    if (!baseModel || !adapterName || !dataPath) {
      throw new Error("baseModel, adapterName, and dataPath are required");
    }

    const jobId = uuidv4();
    const now = Date.now();

    const jobConfig = {
      baseModel,
      adapterName,
      dataPath,
      backend,
      epochs,
      batchSize,
      learningRate,
      loraRank,
      loraAlpha,
      quantization,
    };

    // Persist the job record
    this._insertJob({
      id: jobId,
      baseModel,
      adapterName,
      dataPath,
      backend,
      config: jobConfig,
      createdAt: now,
    });

    logger.info(
      `[FineTuning] Created job ${jobId} (${backend}) for model ${baseModel}`,
    );

    // Launch the actual training asynchronously
    if (backend === "ollama") {
      this._startOllamaTraining(jobId, jobConfig);
    } else if (backend === "llama-cpp") {
      this._startLlamaCppTraining(jobId, jobConfig);
    } else {
      this._updateJobStatus(jobId, "failed", {
        errorMessage: `Unsupported backend: ${backend}`,
      });
    }

    return this.getStatus(jobId);
  }

  /**
   * Start training via the Ollama backend.
   *
   * Constructs a Modelfile with FROM, ADAPTER, and PARAMETER lines,
   * then calls POST /api/create to register the fine-tuned model.
   *
   * @private
   * @param {string} jobId
   * @param {Object} config
   */
  async _startOllamaTraining(jobId, config) {
    try {
      this._updateJobStatus(jobId, "running", { startedAt: Date.now() });
      this.emit("progress", { jobId, status: "running", progress: 0 });

      // Build the Modelfile content
      const modelfileLines = [
        `FROM ${config.baseModel}`,
        `ADAPTER ${config.dataPath}`,
        `PARAMETER num_epochs ${config.epochs}`,
        `PARAMETER learning_rate ${config.learningRate}`,
        `PARAMETER lora_rank ${config.loraRank}`,
        `PARAMETER lora_alpha ${config.loraAlpha}`,
        `PARAMETER batch_size ${config.batchSize}`,
      ];

      if (config.quantization) {
        modelfileLines.push(`PARAMETER quantization ${config.quantization}`);
      }

      const modelfile = modelfileLines.join("\n");

      logger.info(`[FineTuning] Ollama Modelfile:\n${modelfile}`);

      // Simulate incremental progress (Ollama /api/create is blocking)
      this._updateJobProgress(jobId, 10);
      this.emit("progress", { jobId, status: "running", progress: 10 });

      // Call Ollama API to create the model
      const axios = require("axios");
      const response = await axios.post(
        `${this.ollamaBaseUrl}/api/create`,
        {
          name: config.adapterName,
          modelfile: modelfile,
          stream: false,
        },
        {
          timeout: 600000, // 10 min timeout for model creation
        },
      );

      if (response.status === 200) {
        this._updateJobProgress(jobId, 100);
        this._updateJobStatus(jobId, "completed", {
          completedAt: Date.now(),
          metrics: { backend: "ollama", modelName: config.adapterName },
        });
        this.emit("progress", { jobId, status: "completed", progress: 100 });

        // Register the adapter
        const adapterPath = `ollama://${config.adapterName}`;
        this.adapterRegistry.register({
          name: config.adapterName,
          baseModel: config.baseModel,
          adapterPath,
          sizeBytes: 0,
          trainingJobId: jobId,
          description: `Fine-tuned from ${config.baseModel} via Ollama`,
        });

        logger.info(`[FineTuning] Ollama job ${jobId} completed successfully`);
      } else {
        throw new Error(`Ollama API returned status ${response.status}`);
      }
    } catch (error) {
      logger.error(`[FineTuning] Ollama job ${jobId} failed:`, error.message);
      this._updateJobStatus(jobId, "failed", { errorMessage: error.message });
      this.emit("progress", {
        jobId,
        status: "failed",
        progress: 0,
        error: error.message,
      });
    }
  }

  /**
   * Start training via the llama.cpp backend.
   *
   * Spawns the `llama-finetune` CLI process and parses stdout for
   * progress updates.
   *
   * @private
   * @param {string} jobId
   * @param {Object} config
   */
  _startLlamaCppTraining(jobId, config) {
    try {
      this._updateJobStatus(jobId, "running", { startedAt: Date.now() });
      this.emit("progress", { jobId, status: "running", progress: 0 });

      const args = [
        "--model",
        config.baseModel,
        "--lora-out",
        config.adapterName,
        "--train-data",
        config.dataPath,
        "--epochs",
        String(config.epochs),
        "--batch",
        String(config.batchSize),
        "--learning-rate",
        String(config.learningRate),
        "--lora-r",
        String(config.loraRank),
        "--lora-alpha",
        String(config.loraAlpha),
      ];

      if (config.quantization) {
        args.push("--quantize", config.quantization);
      }

      logger.info(
        `[FineTuning] Spawning llama-finetune with args: ${args.join(" ")}`,
      );

      const child = spawn("llama-finetune", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.runningProcesses.set(jobId, child);

      let stderrBuffer = "";

      child.stdout.on("data", (data) => {
        const text = data.toString("utf8");
        const progress = this._parseLlamaCppProgress(text);
        if (progress !== null) {
          this._updateJobProgress(jobId, progress);
          this.emit("progress", { jobId, status: "running", progress });
        }
      });

      child.stderr.on("data", (data) => {
        stderrBuffer += data.toString("utf8");
      });

      child.on("close", (code) => {
        this.runningProcesses.delete(jobId);

        if (code === 0) {
          this._updateJobProgress(jobId, 100);
          this._updateJobStatus(jobId, "completed", {
            completedAt: Date.now(),
            metrics: { backend: "llama-cpp", exitCode: 0 },
          });
          this.emit("progress", { jobId, status: "completed", progress: 100 });

          // Register the adapter if the output file exists
          const adapterPath = config.adapterName;
          try {
            const sizeBytes = fs.existsSync(adapterPath)
              ? fs.statSync(adapterPath).size
              : 0;
            this.adapterRegistry.register({
              name: path.basename(adapterPath, path.extname(adapterPath)),
              baseModel: config.baseModel,
              adapterPath,
              sizeBytes,
              trainingJobId: jobId,
              description: `Fine-tuned from ${config.baseModel} via llama.cpp`,
            });
          } catch (regError) {
            logger.warn(
              `[FineTuning] Adapter registration after llama-cpp job failed: ${regError.message}`,
            );
          }

          logger.info(
            `[FineTuning] llama-cpp job ${jobId} completed successfully`,
          );
        } else {
          const errorMsg =
            stderrBuffer.trim() || `llama-finetune exited with code ${code}`;
          this._updateJobStatus(jobId, "failed", { errorMessage: errorMsg });
          this.emit("progress", {
            jobId,
            status: "failed",
            progress: 0,
            error: errorMsg,
          });
          logger.error(
            `[FineTuning] llama-cpp job ${jobId} failed: ${errorMsg}`,
          );
        }
      });

      child.on("error", (err) => {
        this.runningProcesses.delete(jobId);
        this._updateJobStatus(jobId, "failed", { errorMessage: err.message });
        this.emit("progress", {
          jobId,
          status: "failed",
          progress: 0,
          error: err.message,
        });
        logger.error(
          `[FineTuning] llama-cpp process error for job ${jobId}:`,
          err.message,
        );
      });
    } catch (error) {
      logger.error(
        `[FineTuning] Failed to start llama-cpp job ${jobId}:`,
        error.message,
      );
      this._updateJobStatus(jobId, "failed", { errorMessage: error.message });
      this.emit("progress", {
        jobId,
        status: "failed",
        progress: 0,
        error: error.message,
      });
    }
  }

  /**
   * Parse progress percentage from llama.cpp stdout text.
   *
   * Looks for patterns like "progress: 45.2%" or "[epoch 2/5]" and
   * converts them to a 0-100 number.
   *
   * @private
   * @param {string} text - Raw stdout text
   * @returns {number|null} Progress 0-100 or null if no match
   */
  _parseLlamaCppProgress(text) {
    // Try "progress: XX.X%" pattern
    const percentMatch = text.match(/progress[:\s]+(\d+(?:\.\d+)?)\s*%/i);
    if (percentMatch) {
      return Math.min(100, parseFloat(percentMatch[1]));
    }

    // Try "[epoch X/Y]" pattern
    const epochMatch = text.match(/\[?\s*epoch\s+(\d+)\s*\/\s*(\d+)\s*\]?/i);
    if (epochMatch) {
      const current = parseInt(epochMatch[1], 10);
      const total = parseInt(epochMatch[2], 10);
      if (total > 0) {
        return Math.min(100, Math.round((current / total) * 100));
      }
    }

    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Job Management
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Get the current status and progress of a training job.
   *
   * @param {string} jobId
   * @returns {Object|null} Job record or null if not found
   */
  getStatus(jobId) {
    const db = this._db();
    if (!db) {
      return null;
    }

    try {
      const stmt = db.prepare("SELECT * FROM fine_tuning_jobs WHERE id = ?");
      const row = stmt.get(jobId);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        baseModel: row.base_model,
        adapterName: row.adapter_name,
        dataPath: row.data_path,
        backend: row.backend,
        status: row.status,
        progress: row.progress,
        config: row.config ? JSON.parse(row.config) : null,
        metrics: row.metrics ? JSON.parse(row.metrics) : null,
        errorMessage: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
      };
    } catch (error) {
      logger.error("[FineTuning] Failed to get job status:", error.message);
      return null;
    }
  }

  /**
   * Cancel a running training job.
   *
   * Kills the child process (for llama-cpp) or marks the job as
   * cancelled (for Ollama, which does not support mid-flight cancel).
   *
   * @param {string} jobId
   * @returns {{ success: boolean, message: string }}
   */
  cancelJob(jobId) {
    const job = this.getStatus(jobId);
    if (!job) {
      return { success: false, message: "Job not found" };
    }

    if (job.status !== "running" && job.status !== "pending") {
      return {
        success: false,
        message: `Job is not cancellable (status: ${job.status})`,
      };
    }

    // Kill the child process if one is tracked
    const childProcess = this.runningProcesses.get(jobId);
    if (childProcess) {
      try {
        childProcess.kill("SIGTERM");
      } catch (killErr) {
        logger.warn(
          `[FineTuning] Error killing process for job ${jobId}:`,
          killErr.message,
        );
      }
      this.runningProcesses.delete(jobId);
    }

    this._updateJobStatus(jobId, "cancelled", { completedAt: Date.now() });
    this.emit("progress", {
      jobId,
      status: "cancelled",
      progress: job.progress,
    });

    logger.info(`[FineTuning] Job ${jobId} cancelled`);
    return { success: true, message: "Job cancelled" };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Adapter Operations
  // ──────────────────────────────────────────────────────────────────────

  /**
   * List all LoRA adapters.
   *
   * @param {Object} [options] - Passed to AdapterRegistry.listAdapters
   * @returns {Array<Object>}
   */
  listAdapters(options) {
    return this.adapterRegistry.listAdapters(options);
  }

  /**
   * Delete an adapter record and optionally its files.
   *
   * @param {string} adapterId
   * @returns {{ success: boolean, message: string }}
   */
  deleteAdapter(adapterId) {
    const adapter = this.adapterRegistry.getAdapter(adapterId);
    if (!adapter) {
      return { success: false, message: "Adapter not found" };
    }

    // Try to remove the file from disk (ignore errors for virtual paths)
    if (adapter.adapterPath && !adapter.adapterPath.startsWith("ollama://")) {
      try {
        if (fs.existsSync(adapter.adapterPath)) {
          fs.unlinkSync(adapter.adapterPath);
          logger.info(
            `[FineTuning] Deleted adapter file: ${adapter.adapterPath}`,
          );
        }
      } catch (fsErr) {
        logger.warn(
          `[FineTuning] Could not delete adapter file: ${fsErr.message}`,
        );
      }
    }

    const deleted = this.adapterRegistry.unregister(adapterId);
    if (deleted) {
      logger.info(`[FineTuning] Adapter ${adapterId} deleted`);
      return { success: true, message: "Adapter deleted" };
    }

    return {
      success: false,
      message: "Failed to delete adapter from database",
    };
  }

  /**
   * Load an adapter onto a target model.
   *
   * For Ollama: creates a new Modelfile with FROM base + ADAPTER path,
   * then calls POST /api/create to register the merged model.
   *
   * @param {string} adapterId
   * @param {string} targetModel - The base model to apply the adapter to
   * @returns {Promise<{ success: boolean, modelName: string }>}
   */
  async loadAdapter(adapterId, targetModel) {
    const adapter = this.adapterRegistry.getAdapter(adapterId);
    if (!adapter) {
      throw new Error("Adapter not found");
    }

    const modelName = `${targetModel}-${adapter.name}`;

    logger.info(
      `[FineTuning] Loading adapter ${adapter.name} onto ${targetModel} as ${modelName}`,
    );

    // Build the Modelfile
    const modelfile = [
      `FROM ${targetModel}`,
      `ADAPTER ${adapter.adapterPath}`,
    ].join("\n");

    try {
      const axios = require("axios");
      const response = await axios.post(
        `${this.ollamaBaseUrl}/api/create`,
        {
          name: modelName,
          modelfile: modelfile,
          stream: false,
        },
        {
          timeout: 300000,
        },
      );

      if (response.status === 200) {
        logger.info(
          `[FineTuning] Model ${modelName} created with adapter ${adapter.name}`,
        );
        return { success: true, modelName };
      }

      throw new Error(`Ollama returned status ${response.status}`);
    } catch (error) {
      logger.error(`[FineTuning] Failed to load adapter:`, error.message);
      throw error;
    }
  }

  /**
   * Export training data for a given job.
   *
   * Reads the job's data_path and returns its contents, optionally
   * converting between formats.
   *
   * @param {string} jobId
   * @param {string} [format='jsonl'] - Desired export format
   * @returns {{ data: Array, format: string, recordCount: number }}
   */
  exportData(jobId, format = "jsonl") {
    const job = this.getStatus(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    if (!job.dataPath || !fs.existsSync(job.dataPath)) {
      throw new Error("Training data file not found");
    }

    try {
      const raw = fs.readFileSync(job.dataPath, "utf-8").trim();
      let data;

      // Detect if the file is JSONL or JSON array
      if (raw.startsWith("[")) {
        data = JSON.parse(raw);
      } else {
        data = raw
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line));
      }

      logger.info(
        `[FineTuning] Exported ${data.length} records for job ${jobId}`,
      );

      return {
        data,
        format,
        recordCount: data.length,
      };
    } catch (error) {
      logger.error(
        `[FineTuning] Failed to export data for job ${jobId}:`,
        error.message,
      );
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Unwrap the database handle.
   * @private
   */
  _db() {
    if (!this.database) {
      return null;
    }
    return this.database.db || this.database;
  }

  /**
   * Insert a new job record into the database.
   * @private
   */
  _insertJob({
    id,
    baseModel,
    adapterName,
    dataPath,
    backend,
    config,
    createdAt,
  }) {
    const db = this._db();
    if (!db) {
      return;
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO fine_tuning_jobs (id, base_model, adapter_name, data_path, backend, status, progress, config, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `);
      stmt.run(
        id,
        baseModel,
        adapterName,
        dataPath,
        backend,
        JSON.stringify(config),
        createdAt,
      );
    } catch (error) {
      logger.error("[FineTuning] Failed to insert job:", error.message);
    }
  }

  /**
   * Update the status (and optional fields) of a job.
   * @private
   */
  _updateJobStatus(jobId, status, extras = {}) {
    const db = this._db();
    if (!db) {
      return;
    }

    try {
      const sets = ["status = ?"];
      const params = [status];

      if (extras.startedAt !== undefined) {
        sets.push("started_at = ?");
        params.push(extras.startedAt);
      }
      if (extras.completedAt !== undefined) {
        sets.push("completed_at = ?");
        params.push(extras.completedAt);
      }
      if (extras.errorMessage !== undefined) {
        sets.push("error_message = ?");
        params.push(extras.errorMessage);
      }
      if (extras.metrics !== undefined) {
        sets.push("metrics = ?");
        params.push(JSON.stringify(extras.metrics));
      }

      params.push(jobId);

      const stmt = db.prepare(
        `UPDATE fine_tuning_jobs SET ${sets.join(", ")} WHERE id = ?`,
      );
      stmt.run(...params);
    } catch (error) {
      logger.error("[FineTuning] Failed to update job status:", error.message);
    }
  }

  /**
   * Update just the progress value of a job.
   * @private
   */
  _updateJobProgress(jobId, progress) {
    const db = this._db();
    if (!db) {
      return;
    }

    try {
      const stmt = db.prepare(
        "UPDATE fine_tuning_jobs SET progress = ? WHERE id = ?",
      );
      stmt.run(progress, jobId);
    } catch (error) {
      logger.error(
        "[FineTuning] Failed to update job progress:",
        error.message,
      );
    }
  }
}

module.exports = { FineTuningManager };
