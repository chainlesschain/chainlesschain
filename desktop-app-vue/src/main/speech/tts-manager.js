/**
 * Text-to-Speech Manager
 *
 * Unified interface for TTS supporting:
 * - Edge TTS (Microsoft, free, requires internet)
 * - Piper (local, fast, offline)
 *
 * Features:
 * - Provider auto-selection
 * - Fallback support
 * - Audio caching
 *
 * @module tts-manager
 * @version 1.0.0
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../utils/logger.js');
const { EdgeTTSClient } = require('./edge-tts-client.js');
const { LocalTTSClient } = require('./local-tts-client.js');

/**
 * TTS providers
 */
const TTSProvider = {
  EDGE: 'edge',
  LOCAL: 'local',
  AUTO: 'auto',
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  defaultProvider: TTSProvider.AUTO,
  fallbackEnabled: true,
  cacheEnabled: true,
  cacheDir: null,
  preferOffline: false, // If true, prefer local over edge
  edgeConfig: {},
  localConfig: {},
};

/**
 * TTS Manager
 */
class TTSManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    // Initialize clients
    this.edgeClient = new EdgeTTSClient(this.config.edgeConfig);
    this.localClient = new LocalTTSClient(this.config.localConfig);

    // Provider status
    this.providerStatus = {
      [TTSProvider.EDGE]: false,
      [TTSProvider.LOCAL]: false,
    };

    // Statistics
    this.stats = {
      totalSyntheses: 0,
      byProvider: {},
      errors: 0,
      cacheHits: 0,
      totalCharacters: 0,
    };

    // Setup event forwarding
    this._setupEventForwarding();

    logger.info('[TTSManager] Initialized');
  }

  /**
   * Initialize the manager
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    const { cacheDir, piperPath, modelsDir } = options;

    if (cacheDir) {
      this.config.cacheDir = cacheDir;
      await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
    }

    // Initialize Edge TTS
    await this.edgeClient.initialize({
      cacheDir: cacheDir ? path.join(cacheDir, 'edge') : null,
    });

    // Initialize Local TTS
    await this.localClient.initialize({
      piperPath,
      modelsDir,
      cacheDir: cacheDir ? path.join(cacheDir, 'local') : null,
    });

    // Check provider availability
    await this.checkProviders();

    logger.info('[TTSManager] Initialization complete');
  }

  /**
   * Check availability of all providers
   * @returns {Promise<Object>} Provider status
   */
  async checkProviders() {
    // Check Edge TTS
    const edgeStatus = await this.edgeClient.checkStatus();
    this.providerStatus[TTSProvider.EDGE] = edgeStatus.available;

    // Check Local TTS
    const localStatus = await this.localClient.checkStatus();
    this.providerStatus[TTSProvider.LOCAL] = localStatus.available;

    logger.info('[TTSManager] Provider status:', this.providerStatus);

    return {
      ...this.providerStatus,
      preferredProvider: this._getPreferredProvider(),
    };
  }

  /**
   * Synthesize text to speech
   * @param {string} text - Text to synthesize
   * @param {Object} options - Synthesis options
   * @returns {Promise<Object>} Audio data
   */
  async synthesize(text, options = {}) {
    const provider = options.provider || this.config.defaultProvider;
    const selectedProvider = provider === TTSProvider.AUTO
      ? this._getPreferredProvider()
      : provider;

    if (!selectedProvider) {
      throw new Error('No TTS provider available');
    }

    this.stats.totalSyntheses++;
    this.stats.totalCharacters += text.length;
    this.stats.byProvider[selectedProvider] = (this.stats.byProvider[selectedProvider] || 0) + 1;

    try {
      let result;

      switch (selectedProvider) {
        case TTSProvider.EDGE:
          result = await this._synthesizeWithEdge(text, options);
          break;

        case TTSProvider.LOCAL:
          result = await this._synthesizeWithLocal(text, options);
          break;

        default:
          throw new Error(`Unknown provider: ${selectedProvider}`);
      }

      return {
        ...result,
        provider: selectedProvider,
      };
    } catch (error) {
      this.stats.errors++;

      // Try fallback if enabled
      if (this.config.fallbackEnabled && provider === TTSProvider.AUTO) {
        const fallbackProvider = this._getFallbackProvider(selectedProvider);
        if (fallbackProvider) {
          logger.warn(`[TTSManager] Falling back to ${fallbackProvider}`);
          return await this.synthesize(text, {
            ...options,
            provider: fallbackProvider,
          });
        }
      }

      throw error;
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
    const provider = options.provider || this.config.defaultProvider;
    const selectedProvider = provider === TTSProvider.AUTO
      ? this._getPreferredProvider()
      : provider;

    if (selectedProvider === TTSProvider.EDGE) {
      return await this.edgeClient.synthesizeToFile(text, outputPath, options);
    } else if (selectedProvider === TTSProvider.LOCAL) {
      // Local client returns base64, we need to write it
      const result = await this.localClient.synthesize(text, options);
      await fs.writeFile(outputPath, Buffer.from(result.audio, 'base64'));
      return {
        success: true,
        filePath: outputPath,
        model: result.model,
      };
    }

    throw new Error(`Unknown provider: ${selectedProvider}`);
  }

  /**
   * Get available voices
   * @param {string} provider - Provider to get voices for
   * @param {string} language - Filter by language (optional)
   * @returns {Object} Available voices
   */
  getVoices(provider = null, language = null) {
    const voices = {};

    if (!provider || provider === TTSProvider.EDGE) {
      voices.edge = this.edgeClient.getVoices(language);
    }

    if (!provider || provider === TTSProvider.LOCAL) {
      const localModels = this.localClient.getModels();
      if (language) {
        voices.local = {};
        for (const [id, model] of Object.entries(localModels)) {
          if (model.language.startsWith(language)) {
            voices.local[id] = model;
          }
        }
      } else {
        voices.local = localModels;
      }
    }

    return voices;
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      providers: this.providerStatus,
      preferredProvider: this._getPreferredProvider(),
    };
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.edgeClient.clearCache();
    this.localClient.clearCache();
  }

  // ========== Private Methods ==========

  /**
   * Synthesize with Edge TTS
   * @private
   */
  async _synthesizeWithEdge(text, options) {
    if (!this.providerStatus[TTSProvider.EDGE]) {
      throw new Error('Edge TTS is not available');
    }

    const result = await this.edgeClient.synthesize(text, options);

    if (result.fromCache) {
      this.stats.cacheHits++;
    }

    return result;
  }

  /**
   * Synthesize with Local TTS
   * @private
   */
  async _synthesizeWithLocal(text, options) {
    if (!this.providerStatus[TTSProvider.LOCAL]) {
      throw new Error('Local TTS (Piper) is not available');
    }

    const result = await this.localClient.synthesize(text, options);

    if (result.fromCache) {
      this.stats.cacheHits++;
    }

    return result;
  }

  /**
   * Get preferred provider based on availability and config
   * @private
   */
  _getPreferredProvider() {
    if (this.config.preferOffline) {
      // Prefer local if available
      if (this.providerStatus[TTSProvider.LOCAL]) {
        return TTSProvider.LOCAL;
      }
      if (this.providerStatus[TTSProvider.EDGE]) {
        return TTSProvider.EDGE;
      }
    } else {
      // Prefer edge (better quality)
      if (this.providerStatus[TTSProvider.EDGE]) {
        return TTSProvider.EDGE;
      }
      if (this.providerStatus[TTSProvider.LOCAL]) {
        return TTSProvider.LOCAL;
      }
    }

    return null;
  }

  /**
   * Get fallback provider
   * @private
   */
  _getFallbackProvider(failedProvider) {
    const providers = [TTSProvider.EDGE, TTSProvider.LOCAL];
    for (const provider of providers) {
      if (provider !== failedProvider && this.providerStatus[provider]) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Setup event forwarding from clients
   * @private
   */
  _setupEventForwarding() {
    this.edgeClient.on('synthesis-start', (data) => {
      this.emit('synthesis-start', { ...data, provider: TTSProvider.EDGE });
    });

    this.edgeClient.on('synthesis-complete', (data) => {
      this.emit('synthesis-complete', { ...data, provider: TTSProvider.EDGE });
    });

    this.edgeClient.on('synthesis-error', (data) => {
      this.emit('synthesis-error', { ...data, provider: TTSProvider.EDGE });
    });

    this.localClient.on('synthesis-start', (data) => {
      this.emit('synthesis-start', { ...data, provider: TTSProvider.LOCAL });
    });

    this.localClient.on('synthesis-complete', (data) => {
      this.emit('synthesis-complete', { ...data, provider: TTSProvider.LOCAL });
    });

    this.localClient.on('synthesis-error', (data) => {
      this.emit('synthesis-error', { ...data, provider: TTSProvider.LOCAL });
    });
  }
}

// Singleton instance
let ttsManagerInstance = null;

/**
 * Get TTSManager singleton
 * @param {Object} config - Configuration
 * @returns {TTSManager}
 */
function getTTSManager(config) {
  if (!ttsManagerInstance) {
    ttsManagerInstance = new TTSManager(config);
  }
  return ttsManagerInstance;
}

module.exports = {
  TTSManager,
  getTTSManager,
  TTSProvider,
};
