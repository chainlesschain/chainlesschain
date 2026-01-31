/**
 * Local TTS Client (Piper)
 *
 * Uses Piper for fast, high-quality local text-to-speech.
 * No internet connection required.
 *
 * @module local-tts-client
 * @version 1.0.0
 */

const EventEmitter = require('events');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { logger } = require('../utils/logger.js');

/**
 * Piper voice models
 */
const PIPER_MODELS = {
  // English
  'en_US-lessac-medium': {
    language: 'en-US',
    name: 'Lessac',
    quality: 'medium',
    sampleRate: 22050,
  },
  'en_US-amy-medium': {
    language: 'en-US',
    name: 'Amy',
    quality: 'medium',
    sampleRate: 22050,
  },
  'en_GB-alba-medium': {
    language: 'en-GB',
    name: 'Alba',
    quality: 'medium',
    sampleRate: 22050,
  },

  // Chinese
  'zh_CN-huayan-medium': {
    language: 'zh-CN',
    name: 'Huayan',
    quality: 'medium',
    sampleRate: 22050,
  },

  // Japanese
  'ja_JP-kokoro-medium': {
    language: 'ja-JP',
    name: 'Kokoro',
    quality: 'medium',
    sampleRate: 22050,
  },
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  piperPath: null, // Path to piper executable
  modelsDir: null, // Directory containing voice models
  defaultModel: 'en_US-lessac-medium',
  outputFormat: 'wav',
  speakerId: 0,
  lengthScale: 1.0, // Speed adjustment (lower = faster)
  noiseScale: 0.667,
  noiseW: 0.8,
  sentenceSilence: 0.2,
  cacheEnabled: true,
  cacheDir: null,
};

/**
 * Local TTS Client using Piper
 */
class LocalTTSClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.available = false;
    this.models = {};
    this.loadedModel = null;

    // Cache
    this.cache = new Map();

    logger.info('[LocalTTSClient] Initialized');
  }

  /**
   * Initialize client
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    if (options.piperPath) {
      this.config.piperPath = options.piperPath;
    }

    if (options.modelsDir) {
      this.config.modelsDir = options.modelsDir;
    }

    if (options.cacheDir) {
      this.config.cacheDir = options.cacheDir;
      await fs.mkdir(options.cacheDir, { recursive: true }).catch(() => {});
    }

    // Auto-detect piper path
    if (!this.config.piperPath) {
      this.config.piperPath = await this._detectPiperPath();
    }

    // Scan for models
    await this._scanModels();

    await this.checkStatus();
  }

  /**
   * Check if Piper is available
   * @returns {Promise<Object>} Status object
   */
  async checkStatus() {
    if (!this.config.piperPath) {
      this.available = false;
      return {
        available: false,
        error: 'Piper path not configured',
        downloadUrl: 'https://github.com/rhasspy/piper/releases',
      };
    }

    try {
      // Check if executable exists
      await fs.access(this.config.piperPath);

      // Try to run with --help
      const version = await this._runCommand(['--help'], 5000);
      this.available = version.includes('piper') || true;

      return {
        available: this.available,
        piperPath: this.config.piperPath,
        modelCount: Object.keys(this.models).length,
        defaultModel: this.config.defaultModel,
      };
    } catch (error) {
      this.available = false;
      logger.warn('[LocalTTSClient] Not available:', error.message);
      return {
        available: false,
        error: error.message,
      };
    }
  }

  /**
   * Synthesize text to speech
   * @param {string} text - Text to synthesize
   * @param {Object} options - Synthesis options
   * @returns {Promise<Object>} Audio data
   */
  async synthesize(text, options = {}) {
    if (!this.available) {
      const status = await this.checkStatus();
      if (!status.available) {
        throw new Error('Piper is not available');
      }
    }

    if (!text || typeof text !== 'string') {
      throw new Error('Please provide text to synthesize');
    }

    const model = options.model || this.config.defaultModel;
    const lengthScale = options.lengthScale || this.config.lengthScale;

    // Verify model exists
    const modelInfo = this.models[model];
    if (!modelInfo) {
      throw new Error(`Model not found: ${model}`);
    }

    // Check cache
    const cacheKey = this._getCacheKey(text, { model, lengthScale });
    if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
      return {
        success: true,
        audio: this.cache.get(cacheKey),
        fromCache: true,
        model,
      };
    }

    this.emit('synthesis-start', { text: text.slice(0, 50), model });

    try {
      const startTime = Date.now();

      // Create temp output file
      const tempFile = path.join(
        this.config.cacheDir || os.tmpdir(),
        `piper_tts_${Date.now()}.wav`
      );

      // Build command arguments
      const args = [
        '--model', modelInfo.path,
        '--output_file', tempFile,
        '--length_scale', String(lengthScale),
        '--noise_scale', String(this.config.noiseScale),
        '--noise_w', String(this.config.noiseW),
        '--sentence_silence', String(this.config.sentenceSilence),
      ];

      if (options.speakerId !== undefined) {
        args.push('--speaker', String(options.speakerId));
      }

      // Run piper with text input via stdin
      await this._synthesizeWithStdin(text, args, tempFile);

      // Read the generated file
      const audioData = await fs.readFile(tempFile);
      const base64Audio = audioData.toString('base64');

      // Clean up temp file if not caching
      if (!this.config.cacheEnabled) {
        await fs.unlink(tempFile).catch(() => {});
      }

      const duration = Date.now() - startTime;

      // Add to cache
      if (this.config.cacheEnabled) {
        this.cache.set(cacheKey, base64Audio);
      }

      this.emit('synthesis-complete', { duration, model });

      return {
        success: true,
        audio: base64Audio,
        format: 'wav',
        mimeType: 'audio/wav',
        model,
        duration,
        textLength: text.length,
        sampleRate: modelInfo.sampleRate || 22050,
        filePath: this.config.cacheEnabled ? tempFile : null,
      };
    } catch (error) {
      this.emit('synthesis-error', { error: error.message, model });
      throw new Error(`Synthesis failed: ${error.message}`);
    }
  }

  /**
   * Get available models
   * @returns {Object} Available models
   */
  getModels() {
    return this.models;
  }

  /**
   * Download a model
   * @param {string} modelId - Model ID to download
   * @returns {Promise<Object>} Download result
   */
  async downloadModel(modelId) {
    // Model download would typically be handled by a separate utility
    // This is a placeholder for the API
    throw new Error('Model download not implemented. Please download models manually from https://github.com/rhasspy/piper/releases');
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  // ========== Private Methods ==========

  /**
   * Detect Piper path
   * @private
   */
  async _detectPiperPath() {
    const possiblePaths = [
      // Windows
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'piper', 'piper.exe'),
      path.join(process.cwd(), 'piper', 'piper.exe'),
      // Linux/macOS
      '/usr/local/bin/piper',
      '/usr/bin/piper',
      path.join(os.homedir(), '.local', 'bin', 'piper'),
    ];

    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch {
        // Continue to next path
      }
    }

    return null;
  }

  /**
   * Scan for available models
   * @private
   */
  async _scanModels() {
    if (!this.config.modelsDir) {
      // Use default locations
      const defaultDirs = [
        path.join(process.cwd(), 'piper-models'),
        path.join(os.homedir(), '.local', 'share', 'piper', 'voices'),
      ];

      for (const dir of defaultDirs) {
        try {
          await fs.access(dir);
          this.config.modelsDir = dir;
          break;
        } catch {
          // Continue
        }
      }
    }

    if (!this.config.modelsDir) {
      return;
    }

    try {
      const files = await fs.readdir(this.config.modelsDir);

      for (const file of files) {
        if (file.endsWith('.onnx')) {
          const modelName = file.replace('.onnx', '');
          const modelPath = path.join(this.config.modelsDir, file);
          const configPath = path.join(this.config.modelsDir, `${modelName}.onnx.json`);

          // Check if config exists
          let config = {};
          try {
            const configData = await fs.readFile(configPath, 'utf-8');
            config = JSON.parse(configData);
          } catch {
            // Use defaults
          }

          this.models[modelName] = {
            path: modelPath,
            configPath,
            language: config.language || 'en-US',
            name: modelName,
            quality: config.quality || 'medium',
            sampleRate: config.audio?.sample_rate || 22050,
          };
        }
      }

      logger.info(`[LocalTTSClient] Found ${Object.keys(this.models).length} models`);
    } catch (error) {
      logger.warn('[LocalTTSClient] Failed to scan models:', error.message);
    }
  }

  /**
   * Run piper command
   * @private
   */
  _runCommand(args, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const proc = execFile(this.config.piperPath, args, {
        timeout,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Synthesize with text via stdin
   * @private
   */
  _synthesizeWithStdin(text, args, outputFile) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.piperPath, args, {
        windowsHide: true,
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        if (code === 0) {
          // Verify output file exists
          try {
            await fs.access(outputFile);
            resolve();
          } catch {
            reject(new Error('Output file not created'));
          }
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });

      // Write text to stdin
      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  /**
   * Get cache key
   * @private
   */
  _getCacheKey(text, options) {
    return `${text}::${JSON.stringify(options)}`;
  }
}

module.exports = {
  LocalTTSClient,
  PIPER_MODELS,
};
