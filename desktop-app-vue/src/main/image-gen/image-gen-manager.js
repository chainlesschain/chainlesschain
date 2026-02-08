/**
 * Image Generation Manager
 *
 * Unified interface for image generation supporting:
 * - Local: Stable Diffusion (AUTOMATIC1111, ComfyUI)
 * - Cloud: OpenAI DALL-E (2/3)
 *
 * Features:
 * - Provider fallback
 * - Generation caching
 * - Cost tracking
 *
 * @module image-gen-manager
 * @version 1.0.0
 */

const EventEmitter = require("events");
const path = require("path");
const fs = require("fs").promises;
const { logger } = require("../utils/logger.js");
const { SDClient } = require("./sd-client.js");
const { DALLEClient, DALLEModel } = require("./dalle-client.js");

/**
 * Image generation providers
 */
const ImageProvider = {
  SD_LOCAL: "sd_local",
  DALLE: "dalle",
  AUTO: "auto", // Auto-select based on availability
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  defaultProvider: ImageProvider.AUTO,
  fallbackEnabled: true,
  cacheEnabled: true,
  cacheMaxSize: 100,
  cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
  outputDir: null, // Set during initialization
  sdConfig: {},
  dalleConfig: {},
};

/**
 * Image Generation Manager
 */
class ImageGenManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    // Initialize clients
    this.sdClient = new SDClient(this.config.sdConfig);
    this.dalleClient = new DALLEClient(this.config.dalleConfig);

    // Provider status
    this.providerStatus = {
      [ImageProvider.SD_LOCAL]: false,
      [ImageProvider.DALLE]: false,
    };

    // Cache
    this.cache = new Map();
    this.cacheTimestamps = new Map();

    // Statistics
    this.stats = {
      totalGenerations: 0,
      byProvider: {},
      errors: 0,
      cacheHits: 0,
    };

    // Setup event forwarding
    this._setupEventForwarding();

    logger.info("[ImageGenManager] Initialized");
  }

  /**
   * Initialize the manager
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    const { outputDir, dalleApiKey } = options;

    if (outputDir) {
      this.config.outputDir = outputDir;
      await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
    }

    if (dalleApiKey) {
      this.dalleClient.setApiKey(dalleApiKey);
    }

    // Check provider availability
    await this.checkProviders();

    logger.info("[ImageGenManager] Initialization complete");
  }

  /**
   * Check availability of all providers
   * @returns {Promise<Object>} Provider status
   */
  async checkProviders() {
    // Check Stable Diffusion
    try {
      const sdStatus = await this.sdClient.checkStatus();
      this.providerStatus[ImageProvider.SD_LOCAL] = sdStatus.available;
    } catch (error) {
      this.providerStatus[ImageProvider.SD_LOCAL] = false;
    }

    // Check DALL-E
    const dalleStatus = this.dalleClient.checkStatus();
    this.providerStatus[ImageProvider.DALLE] = dalleStatus.available;

    logger.info("[ImageGenManager] Provider status:", this.providerStatus);

    return {
      ...this.providerStatus,
      preferredProvider: this._getPreferredProvider(),
    };
  }

  /**
   * Generate image from text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image(s)
   */
  async generate(prompt, options = {}) {
    const provider = options.provider || this.config.defaultProvider;
    const selectedProvider =
      provider === ImageProvider.AUTO ? this._getPreferredProvider() : provider;

    // Check cache
    if (this.config.cacheEnabled && !options.noCache) {
      const cached = this._getFromCache(prompt, options);
      if (cached) {
        this.stats.cacheHits++;
        return { ...cached, fromCache: true };
      }
    }

    this.stats.totalGenerations++;
    this.stats.byProvider[selectedProvider] =
      (this.stats.byProvider[selectedProvider] || 0) + 1;

    try {
      let result;

      switch (selectedProvider) {
        case ImageProvider.SD_LOCAL:
          result = await this._generateWithSD(prompt, options);
          break;

        case ImageProvider.DALLE:
          result = await this._generateWithDALLE(prompt, options);
          break;

        default:
          throw new Error(`Unknown provider: ${selectedProvider}`);
      }

      // Add to cache
      if (this.config.cacheEnabled && result.success) {
        this._addToCache(prompt, options, result);
      }

      // Save to disk if output dir configured
      if (this.config.outputDir && options.saveToDisk !== false) {
        await this._saveImages(result, prompt);
      }

      return result;
    } catch (error) {
      this.stats.errors++;

      // Try fallback if enabled
      if (this.config.fallbackEnabled && provider === ImageProvider.AUTO) {
        const fallbackProvider = this._getFallbackProvider(selectedProvider);
        if (fallbackProvider) {
          logger.warn(`[ImageGenManager] Falling back to ${fallbackProvider}`);
          return await this.generate(prompt, {
            ...options,
            provider: fallbackProvider,
          });
        }
      }

      throw error;
    }
  }

  /**
   * Generate image from image + prompt (img2img)
   * @param {string} prompt - Text prompt
   * @param {string} initImage - Base64 encoded initial image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image(s)
   */
  async img2img(prompt, initImage, options = {}) {
    const provider = options.provider || ImageProvider.SD_LOCAL;

    if (provider !== ImageProvider.SD_LOCAL) {
      throw new Error("img2img is only supported by Stable Diffusion");
    }

    if (!this.providerStatus[ImageProvider.SD_LOCAL]) {
      throw new Error("Stable Diffusion is not available");
    }

    return await this.sdClient.img2img(prompt, initImage, options);
  }

  /**
   * Upscale an image
   * @param {string} image - Base64 encoded image
   * @param {Object} options - Upscale options
   * @returns {Promise<Object>} Upscaled image
   */
  async upscale(image, options = {}) {
    if (!this.providerStatus[ImageProvider.SD_LOCAL]) {
      throw new Error("Upscaling requires Stable Diffusion");
    }

    return await this.sdClient.upscale(image, options);
  }

  /**
   * Create image variations (DALL-E 2 only)
   * @param {string} image - Base64 encoded image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Variations
   */
  async createVariations(image, options = {}) {
    if (!this.providerStatus[ImageProvider.DALLE]) {
      throw new Error("DALL-E is not available");
    }

    return await this.dalleClient.createVariation(image, {
      ...options,
      model: DALLEModel.DALLE_2, // Variations only work with DALL-E 2
    });
  }

  /**
   * Get generation progress (SD only)
   * @returns {Promise<Object>} Progress info
   */
  async getProgress() {
    if (this.providerStatus[ImageProvider.SD_LOCAL]) {
      return await this.sdClient.getProgress();
    }
    return { progress: 0, available: false };
  }

  /**
   * Interrupt current generation (SD only)
   * @returns {Promise<boolean>} Success
   */
  async interrupt() {
    if (this.providerStatus[ImageProvider.SD_LOCAL]) {
      return await this.sdClient.interrupt();
    }
    return false;
  }

  /**
   * Get available models (SD)
   * @returns {Promise<Array>} Available models
   */
  async getModels() {
    if (this.providerStatus[ImageProvider.SD_LOCAL]) {
      await this.sdClient.checkStatus();
      return this.sdClient.models;
    }
    return [];
  }

  /**
   * Switch SD model
   * @param {string} modelName - Model name
   * @returns {Promise<boolean>} Success
   */
  async switchModel(modelName) {
    if (!this.providerStatus[ImageProvider.SD_LOCAL]) {
      throw new Error("Stable Diffusion is not available");
    }
    return await this.sdClient.switchModel(modelName);
  }

  /**
   * Set DALL-E API key
   * @param {string} apiKey - OpenAI API key
   */
  setDALLEApiKey(apiKey) {
    this.dalleClient.setApiKey(apiKey);
    this.providerStatus[ImageProvider.DALLE] = !!apiKey;
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      providers: this.providerStatus,
      cacheSize: this.cache.size,
      sdStats: this.sdClient.available
        ? {
            currentModel: this.sdClient.currentModel,
            models: this.sdClient.models.length,
          }
        : null,
      dalleStats: this.dalleClient.getStats(),
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }

  // ========== Private Methods ==========

  /**
   * Generate with Stable Diffusion
   * @private
   */
  async _generateWithSD(prompt, options) {
    if (!this.providerStatus[ImageProvider.SD_LOCAL]) {
      throw new Error("Stable Diffusion is not available");
    }

    const result = await this.sdClient.txt2img(prompt, options);

    return {
      ...result,
      provider: ImageProvider.SD_LOCAL,
    };
  }

  /**
   * Generate with DALL-E
   * @private
   */
  async _generateWithDALLE(prompt, options) {
    if (!this.providerStatus[ImageProvider.DALLE]) {
      throw new Error("DALL-E is not available");
    }

    const result = await this.dalleClient.generate(prompt, options);

    return {
      ...result,
      provider: ImageProvider.DALLE,
    };
  }

  /**
   * Get preferred provider based on availability
   * @private
   */
  _getPreferredProvider() {
    // Prefer local SD if available (free)
    if (this.providerStatus[ImageProvider.SD_LOCAL]) {
      return ImageProvider.SD_LOCAL;
    }
    // Fall back to DALL-E
    if (this.providerStatus[ImageProvider.DALLE]) {
      return ImageProvider.DALLE;
    }
    return null;
  }

  /**
   * Get fallback provider
   * @private
   */
  _getFallbackProvider(failedProvider) {
    const providers = [ImageProvider.SD_LOCAL, ImageProvider.DALLE];
    for (const provider of providers) {
      if (provider !== failedProvider && this.providerStatus[provider]) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Get from cache
   * @private
   */
  _getFromCache(prompt, options) {
    const key = this._getCacheKey(prompt, options);
    const timestamp = this.cacheTimestamps.get(key);

    if (!timestamp || Date.now() - timestamp > this.config.cacheTTL) {
      this.cache.delete(key);
      this.cacheTimestamps.delete(key);
      return null;
    }

    return this.cache.get(key);
  }

  /**
   * Add to cache
   * @private
   */
  _addToCache(prompt, options, result) {
    const key = this._getCacheKey(prompt, options);

    // Evict if at max size
    if (this.cache.size >= this.config.cacheMaxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.cacheTimestamps.delete(oldestKey);
    }

    this.cache.set(key, result);
    this.cacheTimestamps.set(key, Date.now());
  }

  /**
   * Get cache key
   * @private
   */
  _getCacheKey(prompt, options) {
    const relevantOptions = {
      width: options.width,
      height: options.height,
      size: options.size,
      seed: options.seed,
    };
    return `${prompt}::${JSON.stringify(relevantOptions)}`;
  }

  /**
   * Save images to disk
   * @private
   */
  async _saveImages(result, prompt) {
    if (!this.config.outputDir || !result.images) {
      return;
    }

    const timestamp = Date.now();
    const safeName = prompt.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_");

    for (let i = 0; i < result.images.length; i++) {
      const image = result.images[i];
      if (image.data) {
        const filename = `${safeName}_${timestamp}_${i}.png`;
        const filepath = path.join(this.config.outputDir, filename);

        try {
          await fs.writeFile(filepath, Buffer.from(image.data, "base64"));
          image.savedPath = filepath;
          logger.info(`[ImageGenManager] Saved image: ${filename}`);
        } catch (error) {
          logger.warn(
            `[ImageGenManager] Failed to save image: ${error.message}`,
          );
        }
      }
    }
  }

  /**
   * Setup event forwarding from clients
   * @private
   */
  _setupEventForwarding() {
    this.sdClient.on("generation-start", (data) => {
      this.emit("generation-start", {
        ...data,
        provider: ImageProvider.SD_LOCAL,
      });
    });

    this.sdClient.on("generation-complete", (data) => {
      this.emit("generation-complete", {
        ...data,
        provider: ImageProvider.SD_LOCAL,
      });
    });

    this.sdClient.on("generation-error", (data) => {
      this.emit("generation-error", {
        ...data,
        provider: ImageProvider.SD_LOCAL,
      });
    });

    this.dalleClient.on("generation-start", (data) => {
      this.emit("generation-start", { ...data, provider: ImageProvider.DALLE });
    });

    this.dalleClient.on("generation-complete", (data) => {
      this.emit("generation-complete", {
        ...data,
        provider: ImageProvider.DALLE,
      });
    });

    this.dalleClient.on("generation-error", (data) => {
      this.emit("generation-error", { ...data, provider: ImageProvider.DALLE });
    });
  }
}

// Singleton instance
let imageGenManagerInstance = null;

/**
 * Get ImageGenManager singleton
 * @param {Object} config - Configuration
 * @returns {ImageGenManager}
 */
function getImageGenManager(config) {
  if (!imageGenManagerInstance) {
    imageGenManagerInstance = new ImageGenManager(config);
  }
  return imageGenManagerInstance;
}

module.exports = {
  ImageGenManager,
  getImageGenManager,
  ImageProvider,
};
