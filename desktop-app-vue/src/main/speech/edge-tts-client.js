/**
 * Edge TTS Client
 *
 * Uses Microsoft Edge's free TTS service for speech synthesis.
 * No API key required, supports multiple languages and voices.
 *
 * @module edge-tts-client
 * @version 1.0.0
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { logger } = require('../utils/logger.js');

/**
 * Available Edge TTS voices (commonly used)
 */
const EDGE_VOICES = {
  // Chinese
  'zh-CN-XiaoxiaoNeural': { language: 'zh-CN', gender: 'Female', name: 'Xiaoxiao' },
  'zh-CN-YunxiNeural': { language: 'zh-CN', gender: 'Male', name: 'Yunxi' },
  'zh-CN-YunyangNeural': { language: 'zh-CN', gender: 'Male', name: 'Yunyang' },
  'zh-CN-XiaoyiNeural': { language: 'zh-CN', gender: 'Female', name: 'Xiaoyi' },

  // English US
  'en-US-JennyNeural': { language: 'en-US', gender: 'Female', name: 'Jenny' },
  'en-US-GuyNeural': { language: 'en-US', gender: 'Male', name: 'Guy' },
  'en-US-AriaNeural': { language: 'en-US', gender: 'Female', name: 'Aria' },
  'en-US-DavisNeural': { language: 'en-US', gender: 'Male', name: 'Davis' },

  // English UK
  'en-GB-SoniaNeural': { language: 'en-GB', gender: 'Female', name: 'Sonia' },
  'en-GB-RyanNeural': { language: 'en-GB', gender: 'Male', name: 'Ryan' },

  // Japanese
  'ja-JP-NanamiNeural': { language: 'ja-JP', gender: 'Female', name: 'Nanami' },
  'ja-JP-KeitaNeural': { language: 'ja-JP', gender: 'Male', name: 'Keita' },

  // Korean
  'ko-KR-SunHiNeural': { language: 'ko-KR', gender: 'Female', name: 'SunHi' },
  'ko-KR-InJoonNeural': { language: 'ko-KR', gender: 'Male', name: 'InJoon' },
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  defaultVoice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  volume: '+0%',
  pitch: '+0Hz',
  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
  cacheEnabled: true,
  cacheDir: null, // Set during initialization
  pythonPath: 'python',
};

/**
 * Edge TTS Client
 */
class EdgeTTSClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.available = false;
    this.voices = { ...EDGE_VOICES };

    // Cache for generated audio
    this.cache = new Map();

    logger.info('[EdgeTTSClient] Initialized');
  }

  /**
   * Initialize client
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    if (options.cacheDir) {
      this.config.cacheDir = options.cacheDir;
      await fs.mkdir(options.cacheDir, { recursive: true }).catch(() => {});
    }

    // Check if edge-tts is available
    await this.checkStatus();
  }

  /**
   * Check if edge-tts is available
   * @returns {Promise<Object>} Status object
   */
  async checkStatus() {
    try {
      await this._runCommand(['--version']);
      this.available = true;

      // Try to get voice list
      try {
        const voicesOutput = await this._runCommand(['--list-voices']);
        this._parseVoiceList(voicesOutput);
      } catch (e) {
        // Use default voice list
      }

      return {
        available: true,
        voiceCount: Object.keys(this.voices).length,
        defaultVoice: this.config.defaultVoice,
      };
    } catch (error) {
      this.available = false;
      logger.warn('[EdgeTTSClient] Not available:', error.message);
      return {
        available: false,
        error: error.message,
        installHint: 'Install edge-tts: pip install edge-tts',
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
        throw new Error('Edge TTS is not available. ' + (status.installHint || ''));
      }
    }

    if (!text || typeof text !== 'string') {
      throw new Error('Please provide text to synthesize');
    }

    const voice = options.voice || this.config.defaultVoice;
    const rate = options.rate || this.config.rate;
    const volume = options.volume || this.config.volume;
    const pitch = options.pitch || this.config.pitch;

    // Check cache
    const cacheKey = this._getCacheKey(text, { voice, rate, volume, pitch });
    if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
      return {
        success: true,
        audio: this.cache.get(cacheKey),
        fromCache: true,
        voice,
      };
    }

    this.emit('synthesis-start', { text: text.slice(0, 50), voice });

    try {
      const startTime = Date.now();

      // Create temp output file
      const tempFile = path.join(
        this.config.cacheDir || os.tmpdir(),
        `edge_tts_${Date.now()}.mp3`
      );

      // Build command arguments
      const args = [
        '--text', text,
        '--voice', voice,
        '--rate', rate,
        '--volume', volume,
        '--pitch', pitch,
        '--write-media', tempFile,
      ];

      await this._runCommand(args);

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

      this.emit('synthesis-complete', { duration, voice });

      return {
        success: true,
        audio: base64Audio,
        format: 'mp3',
        mimeType: 'audio/mpeg',
        voice,
        duration,
        textLength: text.length,
        filePath: this.config.cacheEnabled ? tempFile : null,
      };
    } catch (error) {
      this.emit('synthesis-error', { error: error.message, voice });
      throw new Error(`Synthesis failed: ${error.message}`);
    }
  }

  /**
   * Synthesize text to file
   * @param {string} text - Text to synthesize
   * @param {string} outputPath - Output file path
   * @param {Object} options - Synthesis options
   * @returns {Promise<Object>} Result
   */
  async synthesizeToFile(text, outputPath, options = {}) {
    if (!this.available) {
      throw new Error('Edge TTS is not available');
    }

    const voice = options.voice || this.config.defaultVoice;
    const rate = options.rate || this.config.rate;
    const volume = options.volume || this.config.volume;
    const pitch = options.pitch || this.config.pitch;

    const args = [
      '--text', text,
      '--voice', voice,
      '--rate', rate,
      '--volume', volume,
      '--pitch', pitch,
      '--write-media', outputPath,
    ];

    if (options.includeSubtitles) {
      const subtitlePath = outputPath.replace(/\.[^.]+$/, '.vtt');
      args.push('--write-subtitles', subtitlePath);
    }

    await this._runCommand(args);

    return {
      success: true,
      filePath: outputPath,
      voice,
    };
  }

  /**
   * Get available voices
   * @param {string} language - Filter by language code (optional)
   * @returns {Object} Available voices
   */
  getVoices(language = null) {
    if (!language) {
      return this.voices;
    }

    const filtered = {};
    for (const [id, info] of Object.entries(this.voices)) {
      if (info.language.startsWith(language)) {
        filtered[id] = info;
      }
    }
    return filtered;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  // ========== Private Methods ==========

  /**
   * Run edge-tts command
   * @private
   */
  _runCommand(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.pythonPath, ['-m', 'edge_tts', ...args], {
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Parse voice list output
   * @private
   */
  _parseVoiceList(output) {
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        // Format: "Name: zh-CN-XiaoxiaoNeural, Gender: Female"
        const match = line.match(/Name:\s*(\S+),\s*Gender:\s*(\S+)/);
        if (match) {
          const [, name, gender] = match;
          const lang = name.split('-').slice(0, 2).join('-');
          this.voices[name] = {
            language: lang,
            gender,
            name: name.split('-').pop().replace('Neural', ''),
          };
        }
      }
    } catch (error) {
      logger.warn('[EdgeTTSClient] Failed to parse voice list');
    }
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
  EdgeTTSClient,
  EDGE_VOICES,
};
