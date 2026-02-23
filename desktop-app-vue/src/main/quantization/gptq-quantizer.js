'use strict';

/**
 * GPTQ Quantizer - AutoGPTQ based model quantization
 *
 * Wraps Python's AutoGPTQ library to perform GPTQ quantization
 * on transformer models. Spawns a Python child process and parses
 * stdout for progress updates.
 *
 * @module quantization/gptq-quantizer
 * @version 1.0.0
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger.js');

/** Testability shim – override in tests to inject mocks. */
const _deps = { spawn };

// ============================================================
// Default options
// ============================================================

const DEFAULT_OPTIONS = {
  bits: '4',
  groupSize: '128',
  descAct: false,
  dataset: 'c4',
  numSamples: 128,
};

// ============================================================
// GPTQQuantizer
// ============================================================

class GPTQQuantizer {
  /**
   * @param {Object} callbacks
   * @param {Function} [callbacks.onProgress] - Called with (progress: number 0-100)
   * @param {Function} [callbacks.onComplete] - Called when quantization finishes successfully
   * @param {Function} [callbacks.onError] - Called with (error: Error) on failure
   */
  constructor({ onProgress, onComplete, onError } = {}) {
    this.onProgress = onProgress || (() => {});
    this.onComplete = onComplete || (() => {});
    this.onError = onError || (() => {});
    this.childProcess = null;
    this.cancelled = false;
  }

  /**
   * Start GPTQ quantization by spawning a Python process with AutoGPTQ
   *
   * @param {string} inputPath - Path to the input model directory (HuggingFace format)
   * @param {string} outputPath - Path for the quantized output directory
   * @param {Object} [options] - Quantization options
   * @param {string} [options.bits='4'] - Number of bits (2, 3, 4, or 8)
   * @param {string} [options.groupSize='128'] - Group size for quantization
   * @param {boolean} [options.descAct=false] - Use desc_act ordering
   * @param {string} [options.dataset='c4'] - Calibration dataset name
   * @param {number} [options.numSamples=128] - Number of calibration samples
   * @returns {Promise<void>} Resolves when quantization completes
   */
  quantize(inputPath, outputPath, options = {}) {
    return new Promise((resolve, reject) => {
      const opts = { ...DEFAULT_OPTIONS, ...options };
      this.cancelled = false;

      logger.info('[GPTQQuantizer] Starting GPTQ quantization', {
        inputPath,
        outputPath,
        bits: opts.bits,
        groupSize: opts.groupSize,
      });

      const args = [
        '-m', 'auto_gptq.quantize',
        '--model', inputPath,
        '--output', outputPath,
        '--bits', String(opts.bits),
        '--group-size', String(opts.groupSize),
      ];

      if (opts.descAct) {
        args.push('--desc-act');
      }

      if (opts.dataset) {
        args.push('--dataset', String(opts.dataset));
      }

      if (opts.numSamples) {
        args.push('--num-samples', String(opts.numSamples));
      }

      const child = _deps.spawn('python', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.childProcess = child;

      let stderrBuffer = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        const progress = this._parseProgress(text);
        if (progress !== null) {
          this.onProgress(progress);
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderrBuffer += text;
        // Python tqdm and AutoGPTQ may print progress to stderr
        const progress = this._parseProgress(text);
        if (progress !== null) {
          this.onProgress(progress);
        }
      });

      child.on('error', (err) => {
        logger.error('[GPTQQuantizer] Process spawn error', { error: err.message });
        this.childProcess = null;
        this.onError(err);
        reject(err);
      });

      child.on('close', (code) => {
        this.childProcess = null;

        if (this.cancelled) {
          const err = new Error('GPTQ quantization cancelled by user');
          this.onError(err);
          return reject(err);
        }

        if (code === 0) {
          logger.info('[GPTQQuantizer] GPTQ quantization completed successfully');
          this.onProgress(100);
          this.onComplete();
          resolve();
        } else {
          const errMsg = stderrBuffer.trim() || `python auto_gptq exited with code ${code}`;
          const err = new Error(errMsg);
          logger.error('[GPTQQuantizer] GPTQ quantization failed', { code, stderr: stderrBuffer });
          this.onError(err);
          reject(err);
        }
      });
    });
  }

  /**
   * Cancel the running quantization process
   */
  cancel() {
    if (this.childProcess) {
      this.cancelled = true;
      this.childProcess.kill('SIGTERM');
      logger.info('[GPTQQuantizer] Cancellation requested');
    }
  }

  /**
   * Parse progress from Python AutoGPTQ output.
   * Recognizes patterns like 50%, [50/100], tqdm bars, etc.
   *
   * @param {string} text - Output text to parse
   * @returns {number|null} Progress percentage (0-100), or null if not found
   * @private
   */
  _parseProgress(text) {
    // Pattern: XX% (e.g., tqdm output "  50%|...")
    const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      return Math.min(100, Math.round(parseFloat(percentMatch[1])));
    }

    // Pattern: [current/total] or [ current/total]
    const bracketMatch = text.match(/\[\s*(\d+)\s*\/\s*(\d+)\s*\]/);
    if (bracketMatch) {
      const current = parseInt(bracketMatch[1], 10);
      const total = parseInt(bracketMatch[2], 10);
      if (total > 0) {
        return Math.min(100, Math.round((current / total) * 100));
      }
    }

    // Pattern: (current/total)
    const parenMatch = text.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
    if (parenMatch) {
      const current = parseInt(parenMatch[1], 10);
      const total = parseInt(parenMatch[2], 10);
      if (total > 0) {
        return Math.min(100, Math.round((current / total) * 100));
      }
    }

    // Pattern: "Step X of Y" or "Processing X/Y"
    const stepMatch = text.match(/(?:step|processing)\s+(\d+)\s*(?:of|\/)\s*(\d+)/i);
    if (stepMatch) {
      const current = parseInt(stepMatch[1], 10);
      const total = parseInt(stepMatch[2], 10);
      if (total > 0) {
        return Math.min(100, Math.round((current / total) * 100));
      }
    }

    return null;
  }
}

module.exports = { GPTQQuantizer, _deps };
