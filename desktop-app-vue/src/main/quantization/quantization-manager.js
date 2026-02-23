"use strict";

/**
 * Quantization Manager - Local Model Quantization Tool (F5)
 *
 * Orchestrates GGUF (llama.cpp) and GPTQ (AutoGPTQ) quantization jobs.
 * Tracks jobs in SQLite, supports cancellation, progress events, and
 * importing quantized GGUF models into Ollama.
 *
 * @module quantization/quantization-manager
 * @version 1.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const { GGUFQuantizer, SUPPORTED_LEVELS } = require("./gguf-quantizer.js");
const { GPTQQuantizer } = require("./gptq-quantizer.js");

/** Testability shim – override in tests to inject mocks. */
const _deps = { uuidv4, fs };

// ============================================================
// Constants
// ============================================================

const OLLAMA_API_BASE = process.env.OLLAMA_HOST || "http://localhost:11434";

// ============================================================
// QuantizationManager
// ============================================================

class QuantizationManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.database] - Database instance
   */
  constructor({ database } = {}) {
    super();
    this.database = database || null;
    this.initialized = false;

    /** @type {Map<string, {quantizer: GGUFQuantizer|GPTQQuantizer, type: string}>} */
    this.runningJobs = new Map();
  }

  /**
   * Initialize the manager and ensure the database table exists
   * @param {Object} [database] - Optional database instance (overrides constructor arg)
   */
  async initialize(database) {
    if (database) {
      this.database = database;
    }

    if (!this.database) {
      throw new Error("Database is required for QuantizationManager");
    }

    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS quantization_jobs (
          id TEXT PRIMARY KEY,
          input_path TEXT NOT NULL,
          output_path TEXT NOT NULL,
          quant_type TEXT NOT NULL CHECK(quant_type IN ('gguf','gptq')),
          quant_level TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
          progress REAL DEFAULT 0,
          file_size_bytes INTEGER DEFAULT 0,
          error_message TEXT,
          config TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_quantization_jobs_status ON quantization_jobs(status);
      `);
      this.initialized = true;
      logger.info("[QuantizationManager] Initialized successfully");
    } catch (err) {
      logger.error("[QuantizationManager] Failed to initialize", {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Start a GGUF quantization job
   *
   * @param {string} inputPath - Path to the source model file
   * @param {string} outputPath - Path for the quantized output file
   * @param {string} level - Quantization level (e.g., 'Q4_K_M')
   * @param {Object} [options] - Additional options stored as config
   * @returns {Object} The created job record
   */
  async startGGUF(inputPath, outputPath, level, options = {}) {
    this._ensureInitialized();

    const jobId = _deps.uuidv4();
    const now = Date.now();

    const job = {
      id: jobId,
      input_path: inputPath,
      output_path: outputPath,
      quant_type: "gguf",
      quant_level: level,
      status: "pending",
      progress: 0,
      file_size_bytes: 0,
      error_message: null,
      config: JSON.stringify(options),
      started_at: null,
      completed_at: null,
      created_at: now,
    };

    this.database.run(
      `INSERT INTO quantization_jobs (id, input_path, output_path, quant_type, quant_level, status, progress, file_size_bytes, error_message, config, started_at, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.input_path,
        job.output_path,
        job.quant_type,
        job.quant_level,
        job.status,
        job.progress,
        job.file_size_bytes,
        job.error_message,
        job.config,
        job.started_at,
        job.completed_at,
        job.created_at,
      ],
    );

    logger.info("[QuantizationManager] Created GGUF job", {
      jobId,
      level,
      inputPath,
    });

    // Start quantization asynchronously
    this._runGGUFJob(job);

    return job;
  }

  /**
   * Start a GPTQ quantization job
   *
   * @param {string} inputPath - Path to the source model directory
   * @param {string} outputPath - Path for the quantized output directory
   * @param {Object} [options] - GPTQ options (bits, groupSize, descAct, dataset, numSamples)
   * @returns {Object} The created job record
   */
  async startGPTQ(inputPath, outputPath, options = {}) {
    this._ensureInitialized();

    const jobId = _deps.uuidv4();
    const now = Date.now();

    const job = {
      id: jobId,
      input_path: inputPath,
      output_path: outputPath,
      quant_type: "gptq",
      quant_level: `${options.bits || 4}bit-g${options.groupSize || 128}`,
      status: "pending",
      progress: 0,
      file_size_bytes: 0,
      error_message: null,
      config: JSON.stringify(options),
      started_at: null,
      completed_at: null,
      created_at: now,
    };

    this.database.run(
      `INSERT INTO quantization_jobs (id, input_path, output_path, quant_type, quant_level, status, progress, file_size_bytes, error_message, config, started_at, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.input_path,
        job.output_path,
        job.quant_type,
        job.quant_level,
        job.status,
        job.progress,
        job.file_size_bytes,
        job.error_message,
        job.config,
        job.started_at,
        job.completed_at,
        job.created_at,
      ],
    );

    logger.info("[QuantizationManager] Created GPTQ job", { jobId, inputPath });

    // Start quantization asynchronously
    this._runGPTQJob(job, options);

    return job;
  }

  /**
   * Get the status and progress of a job
   *
   * @param {string} jobId - Job identifier
   * @returns {Object|null} Job record or null if not found
   */
  getStatus(jobId) {
    this._ensureInitialized();

    const row = this.database.get(
      "SELECT * FROM quantization_jobs WHERE id = ?",
      [jobId],
    );

    if (!row) {
      return null;
    }

    // Parse config JSON back to object
    if (row.config) {
      try {
        row.config = JSON.parse(row.config);
      } catch (_e) {
        // Leave as string if unparseable
      }
    }

    return row;
  }

  /**
   * Cancel a running job by killing its child process
   *
   * @param {string} jobId - Job identifier
   * @returns {boolean} True if the job was cancelled, false otherwise
   */
  cancelJob(jobId) {
    this._ensureInitialized();

    const entry = this.runningJobs.get(jobId);
    if (!entry) {
      logger.warn(
        "[QuantizationManager] No running job found for cancellation",
        { jobId },
      );
      return false;
    }

    entry.quantizer.cancel();
    this.runningJobs.delete(jobId);

    this.database.run(
      "UPDATE quantization_jobs SET status = ?, completed_at = ? WHERE id = ?",
      ["cancelled", Date.now(), jobId],
    );

    this.emit("job:cancelled", { jobId });
    logger.info("[QuantizationManager] Job cancelled", { jobId });

    return true;
  }

  /**
   * List all quantized models from the database
   *
   * @param {Object} [options] - Filter options
   * @param {string} [options.status] - Filter by status
   * @param {string} [options.quantType] - Filter by quant type ('gguf' or 'gptq')
   * @param {number} [options.limit=50] - Max results
   * @param {number} [options.offset=0] - Pagination offset
   * @returns {Array<Object>} Array of job records
   */
  listModels(options = {}) {
    this._ensureInitialized();

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    let sql = "SELECT * FROM quantization_jobs";
    const params = [];
    const conditions = [];

    if (options.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }

    if (options.quantType) {
      conditions.push("quant_type = ?");
      params.push(options.quantType);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = this.database.all(sql, params);

    return rows.map((row) => {
      if (row.config) {
        try {
          row.config = JSON.parse(row.config);
        } catch (_e) {
          // Leave as string
        }
      }
      return row;
    });
  }

  /**
   * Delete a quantized model record and its output files
   *
   * @param {string} jobId - Job identifier
   * @returns {boolean} True if deleted successfully
   */
  deleteModel(jobId) {
    this._ensureInitialized();

    const job = this.database.get(
      "SELECT * FROM quantization_jobs WHERE id = ?",
      [jobId],
    );

    if (!job) {
      logger.warn("[QuantizationManager] Job not found for deletion", {
        jobId,
      });
      return false;
    }

    // Cancel if still running
    if (this.runningJobs.has(jobId)) {
      this.cancelJob(jobId);
    }

    // Remove output file if it exists
    try {
      if (job.output_path && _deps.fs.existsSync(job.output_path)) {
        const stat = _deps.fs.statSync(job.output_path);
        if (stat.isDirectory()) {
          _deps.fs.rmSync(job.output_path, { recursive: true, force: true });
        } else {
          _deps.fs.unlinkSync(job.output_path);
        }
        logger.info("[QuantizationManager] Deleted output file", {
          path: job.output_path,
        });
      }
    } catch (err) {
      logger.warn("[QuantizationManager] Failed to delete output file", {
        path: job.output_path,
        error: err.message,
      });
    }

    // Remove DB record
    this.database.run("DELETE FROM quantization_jobs WHERE id = ?", [jobId]);

    this.emit("job:deleted", { jobId });
    logger.info("[QuantizationManager] Job deleted", { jobId });

    return true;
  }

  /**
   * Import a quantized GGUF model into Ollama
   *
   * Creates a Modelfile and calls the Ollama API to register the model.
   *
   * @param {string} modelPath - Absolute path to the GGUF file
   * @param {string} modelName - Name for the Ollama model
   * @returns {Promise<Object>} Ollama API response
   */
  async importToOllama(modelPath, modelName) {
    if (!modelPath || !modelName) {
      throw new Error("Both modelPath and modelName are required");
    }

    const modelfile = `FROM ${modelPath}`;

    logger.info("[QuantizationManager] Importing model to Ollama", {
      modelPath,
      modelName,
    });

    const url = `${OLLAMA_API_BASE}/api/create`;

    // Use dynamic import for fetch (Node 18+) or fallback
    let fetchFn;
    try {
      fetchFn = globalThis.fetch || (await import("node-fetch")).default;
    } catch (_e) {
      fetchFn = globalThis.fetch;
    }

    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: modelName,
        modelfile: modelfile,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${text}`);
    }

    const result = await response.json();

    logger.info("[QuantizationManager] Model imported to Ollama", {
      modelName,
      status: result.status,
    });

    return result;
  }

  /**
   * Get all supported GGUF quantization levels
   *
   * @returns {Array<{level: string, bits: number, description: string}>}
   */
  getQuantLevels() {
    return [...SUPPORTED_LEVELS];
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Ensure the manager is initialized
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error(
        "QuantizationManager is not initialized. Call initialize() first.",
      );
    }
  }

  /**
   * Run a GGUF quantization job asynchronously
   * @param {Object} job - Job record
   * @private
   */
  _runGGUFJob(job) {
    const quantizer = new GGUFQuantizer({
      onProgress: (progress) => {
        this.database.run(
          "UPDATE quantization_jobs SET progress = ? WHERE id = ?",
          [progress, job.id],
        );
        this.emit("job:progress", { jobId: job.id, progress });
      },
      onComplete: () => {
        this.runningJobs.delete(job.id);
        let fileSize = 0;
        try {
          if (_deps.fs.existsSync(job.output_path)) {
            const stat = _deps.fs.statSync(job.output_path);
            fileSize = stat.size;
          }
        } catch (_e) {
          // Ignore stat errors
        }
        this.database.run(
          "UPDATE quantization_jobs SET status = ?, progress = 100, file_size_bytes = ?, completed_at = ? WHERE id = ?",
          ["completed", fileSize, Date.now(), job.id],
        );
        this.emit("job:completed", {
          jobId: job.id,
          outputPath: job.output_path,
          fileSize,
        });
        logger.info("[QuantizationManager] GGUF job completed", {
          jobId: job.id,
        });
      },
      onError: (err) => {
        this.runningJobs.delete(job.id);
        this.database.run(
          "UPDATE quantization_jobs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?",
          ["failed", err.message, Date.now(), job.id],
        );
        this.emit("job:failed", { jobId: job.id, error: err.message });
        logger.error("[QuantizationManager] GGUF job failed", {
          jobId: job.id,
          error: err.message,
        });
      },
    });

    // Mark as running
    this.database.run(
      "UPDATE quantization_jobs SET status = ?, started_at = ? WHERE id = ?",
      ["running", Date.now(), job.id],
    );

    this.runningJobs.set(job.id, { quantizer, type: "gguf" });
    this.emit("job:started", { jobId: job.id, type: "gguf" });

    // Fire and forget — the callbacks handle completion/error
    quantizer
      .quantize(job.input_path, job.output_path, job.quant_level)
      .catch(() => {
        // Error already handled by onError callback
      });
  }

  /**
   * Run a GPTQ quantization job asynchronously
   * @param {Object} job - Job record
   * @param {Object} options - GPTQ options
   * @private
   */
  _runGPTQJob(job, options) {
    const quantizer = new GPTQQuantizer({
      onProgress: (progress) => {
        this.database.run(
          "UPDATE quantization_jobs SET progress = ? WHERE id = ?",
          [progress, job.id],
        );
        this.emit("job:progress", { jobId: job.id, progress });
      },
      onComplete: () => {
        this.runningJobs.delete(job.id);
        let fileSize = 0;
        try {
          if (_deps.fs.existsSync(job.output_path)) {
            const stat = _deps.fs.statSync(job.output_path);
            if (stat.isDirectory()) {
              // Sum up all files in the output directory
              const files = _deps.fs.readdirSync(job.output_path);
              for (const file of files) {
                try {
                  const fileStat = _deps.fs.statSync(
                    path.join(job.output_path, file),
                  );
                  if (fileStat.isFile()) {
                    fileSize += fileStat.size;
                  }
                } catch (_e) {
                  // Skip files that can't be stat'd
                }
              }
            } else {
              fileSize = stat.size;
            }
          }
        } catch (_e) {
          // Ignore stat errors
        }
        this.database.run(
          "UPDATE quantization_jobs SET status = ?, progress = 100, file_size_bytes = ?, completed_at = ? WHERE id = ?",
          ["completed", fileSize, Date.now(), job.id],
        );
        this.emit("job:completed", {
          jobId: job.id,
          outputPath: job.output_path,
          fileSize,
        });
        logger.info("[QuantizationManager] GPTQ job completed", {
          jobId: job.id,
        });
      },
      onError: (err) => {
        this.runningJobs.delete(job.id);
        this.database.run(
          "UPDATE quantization_jobs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?",
          ["failed", err.message, Date.now(), job.id],
        );
        this.emit("job:failed", { jobId: job.id, error: err.message });
        logger.error("[QuantizationManager] GPTQ job failed", {
          jobId: job.id,
          error: err.message,
        });
      },
    });

    // Mark as running
    this.database.run(
      "UPDATE quantization_jobs SET status = ?, started_at = ? WHERE id = ?",
      ["running", Date.now(), job.id],
    );

    this.runningJobs.set(job.id, { quantizer, type: "gptq" });
    this.emit("job:started", { jobId: job.id, type: "gptq" });

    // Fire and forget — the callbacks handle completion/error
    quantizer.quantize(job.input_path, job.output_path, options).catch(() => {
      // Error already handled by onError callback
    });
  }
}

module.exports = { QuantizationManager, _deps };
