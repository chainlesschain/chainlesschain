'use strict';

/**
 * GGUF Quantizer - llama.cpp based model quantization
 *
 * Wraps the `llama-quantize` CLI tool to convert models into
 * GGUF format at various quantization levels (Q2_K through F32).
 * Parses stdout for progress and supports cancellation.
 *
 * @module quantization/gguf-quantizer
 * @version 1.0.0
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger.js');

// ============================================================
// Supported quantization levels
// ============================================================

const SUPPORTED_LEVELS = [
  { level: 'Q2_K', bits: 2, description: 'Smallest, lowest quality. ~2.5 bpw.' },
  { level: 'Q3_K_S', bits: 3, description: 'Very small, low quality.' },
  { level: 'Q3_K_M', bits: 3, description: 'Small, medium quality.' },
  { level: 'Q3_K_L', bits: 3, description: 'Small, higher quality than Q3_K_M.' },
  { level: 'Q4_0', bits: 4, description: 'Legacy 4-bit quantization.' },
  { level: 'Q4_K_S', bits: 4, description: 'Small, good quality. Recommended minimum.' },
  { level: 'Q4_K_M', bits: 4, description: 'Medium, good balance of size and quality.' },
  { level: 'Q5_0', bits: 5, description: 'Legacy 5-bit quantization.' },
  { level: 'Q5_K_S', bits: 5, description: 'Small, very good quality.' },
  { level: 'Q5_K_M', bits: 5, description: 'Medium, excellent quality.' },
  { level: 'Q6_K', bits: 6, description: 'Large, near-lossless quality.' },
  { level: 'Q8_0', bits: 8, description: 'Very large, nearly lossless.' },
  { level: 'F16', bits: 16, description: 'Half precision float. No quantization loss.' },
  { level: 'F32', bits: 32, description: 'Full precision float. Largest size.' },
];

const LEVEL_NAMES = SUPPORTED_LEVELS.map((l) => l.level);

// ============================================================
// GGUFQuantizer
// ============================================================

class GGUFQuantizer {
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
   * Start GGUF quantization by spawning llama-quantize
   *
   * @param {string} inputPath - Path to the input model file (GGUF or safetensors)
   * @param {string} outputPath - Path for the quantized output file
   * @param {string} level - Quantization level (e.g., 'Q4_K_M')
   * @returns {Promise<void>} Resolves when quantization completes
   */
  quantize(inputPath, outputPath, level) {
    return new Promise((resolve, reject) => {
      if (!LEVEL_NAMES.includes(level)) {
        const err = new Error(`Unsupported quantization level: ${level}. Supported: ${LEVEL_NAMES.join(', ')}`);
        this.onError(err);
        return reject(err);
      }

      this.cancelled = false;

      logger.info('[GGUFQuantizer] Starting quantization', {
        inputPath,
        outputPath,
        level,
      });

      const child = spawn('llama-quantize', [inputPath, outputPath, level], {
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
        stderrBuffer += data.toString();
        // llama.cpp may also emit progress info on stderr
        const progress = this._parseProgress(data.toString());
        if (progress !== null) {
          this.onProgress(progress);
        }
      });

      child.on('error', (err) => {
        logger.error('[GGUFQuantizer] Process spawn error', { error: err.message });
        this.childProcess = null;
        this.onError(err);
        reject(err);
      });

      child.on('close', (code) => {
        this.childProcess = null;

        if (this.cancelled) {
          const err = new Error('Quantization cancelled by user');
          this.onError(err);
          return reject(err);
        }

        if (code === 0) {
          logger.info('[GGUFQuantizer] Quantization completed successfully');
          this.onProgress(100);
          this.onComplete();
          resolve();
        } else {
          const errMsg = stderrBuffer.trim() || `llama-quantize exited with code ${code}`;
          const err = new Error(errMsg);
          logger.error('[GGUFQuantizer] Quantization failed', { code, stderr: stderrBuffer });
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
      logger.info('[GGUFQuantizer] Cancellation requested');
    }
  }

  /**
   * Parse progress from llama-quantize stdout/stderr output.
   * Recognizes patterns like [50/100], [ 50/100], 50%, (50/100)
   *
   * @param {string} text - Output text to parse
   * @returns {number|null} Progress percentage (0-100), or null if not found
   * @private
   */
  _parseProgress(text) {
    // Pattern: [current/total] or [ current/total]
    const bracketMatch = text.match(/\[\s*(\d+)\s*\/\s*(\d+)\s*\]/);
    if (bracketMatch) {
      const current = parseInt(bracketMatch[1], 10);
      const total = parseInt(bracketMatch[2], 10);
      if (total > 0) {
        return Math.min(100, Math.round((current / total) * 100));
      }
    }

    // Pattern: XX% or XX.X%
    const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      return Math.min(100, Math.round(parseFloat(percentMatch[1])));
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

    return null;
  }

  /**
   * Get supported quantization levels with descriptions
   * @returns {Array<{level: string, bits: number, description: string}>}
   */
  getSupportedLevels() {
    return [...SUPPORTED_LEVELS];
  }
}

module.exports = { GGUFQuantizer, SUPPORTED_LEVELS, LEVEL_NAMES };
