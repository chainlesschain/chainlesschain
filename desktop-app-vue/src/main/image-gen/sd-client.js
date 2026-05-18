/**
 * Stable Diffusion Client
 *
 * Connects to local Stable Diffusion WebUI (AUTOMATIC1111) or ComfyUI
 * for image generation capabilities.
 *
 * @module sd-client
 * @version 1.0.0
 */

const EventEmitter = require('events');
const { logger } = require('../utils/logger.js');

/**
 * SD API Types
 */
const SDAPIType = {
  AUTOMATIC1111: 'automatic1111',
  COMFYUI: 'comfyui',
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  apiType: SDAPIType.AUTOMATIC1111,
  baseUrl: 'http://127.0.0.1:7860',
  timeout: 120000, // 2 minutes for image generation
  defaultModel: 'sd_xl_base_1.0',
  defaultSampler: 'DPM++ 2M Karras',
  defaultSteps: 25,
  defaultCfgScale: 7.0,
  defaultWidth: 1024,
  defaultHeight: 1024,
};

/**
 * Stable Diffusion Client
 */
class SDClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.available = false;
    this.currentModel = null;
    this.models = [];
    this.samplers = [];

    logger.info('[SDClient] Initialized with base URL:', this.config.baseUrl);
  }

  /**
   * Check if SD is available
   * @returns {Promise<Object>} Status object
   */
  async checkStatus() {
    try {
      const response = await this._fetch('/sdapi/v1/options', {
        method: 'GET',
        timeout: 5000,
      });

      this.available = true;
      this.currentModel = response.sd_model_checkpoint;

      // Get available models
      await this._loadModels();
      await this._loadSamplers();

      return {
        available: true,
        currentModel: this.currentModel,
        models: this.models,
        samplers: this.samplers,
        apiType: this.config.apiType,
      };
    } catch (error) {
      this.available = false;
      logger.warn('[SDClient] Status check failed:', error.message);
      return {
        available: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate image from text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image data
   */
  async txt2img(prompt, options = {}) {
    if (!this.available) {
      const status = await this.checkStatus();
      if (!status.available) {
        throw new Error('Stable Diffusion is not available');
      }
    }

    const params = {
      prompt: prompt,
      negative_prompt: options.negativePrompt || 'low quality, bad anatomy, blurry, watermark',
      width: options.width || this.config.defaultWidth,
      height: options.height || this.config.defaultHeight,
      steps: options.steps || this.config.defaultSteps,
      cfg_scale: options.cfgScale || this.config.defaultCfgScale,
      sampler_name: options.sampler || this.config.defaultSampler,
      seed: options.seed || -1,
      batch_size: options.batchSize || 1,
      n_iter: options.nIter || 1,
    };

    this.emit('generation-start', { type: 'txt2img', prompt });

    try {
      const startTime = Date.now();
      const response = await this._fetch('/sdapi/v1/txt2img', {
        method: 'POST',
        body: JSON.stringify(params),
        timeout: this.config.timeout,
      });

      const duration = Date.now() - startTime;

      // Response contains base64 images
      const images = response.images || [];
      const info = JSON.parse(response.info || '{}');

      this.emit('generation-complete', {
        type: 'txt2img',
        imageCount: images.length,
        duration,
      });

      return {
        success: true,
        images: images.map((img, i) => ({
          data: img,
          format: 'base64',
          mimeType: 'image/png',
          index: i,
        })),
        parameters: info,
        seed: info.seed,
        duration,
      };
    } catch (error) {
      this.emit('generation-error', { type: 'txt2img', error: error.message });
      throw error;
    }
  }

  /**
   * Generate image from image + prompt (img2img)
   * @param {string} prompt - Text prompt
   * @param {string} initImage - Base64 encoded initial image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image data
   */
  async img2img(prompt, initImage, options = {}) {
    if (!this.available) {
      const status = await this.checkStatus();
      if (!status.available) {
        throw new Error('Stable Diffusion is not available');
      }
    }

    const params = {
      prompt: prompt,
      negative_prompt: options.negativePrompt || 'low quality, bad anatomy, blurry',
      init_images: [initImage],
      denoising_strength: options.denoisingStrength || 0.75,
      width: options.width || this.config.defaultWidth,
      height: options.height || this.config.defaultHeight,
      steps: options.steps || this.config.defaultSteps,
      cfg_scale: options.cfgScale || this.config.defaultCfgScale,
      sampler_name: options.sampler || this.config.defaultSampler,
      seed: options.seed || -1,
    };

    this.emit('generation-start', { type: 'img2img', prompt });

    try {
      const startTime = Date.now();
      const response = await this._fetch('/sdapi/v1/img2img', {
        method: 'POST',
        body: JSON.stringify(params),
        timeout: this.config.timeout,
      });

      const duration = Date.now() - startTime;
      const images = response.images || [];
      const info = JSON.parse(response.info || '{}');

      this.emit('generation-complete', {
        type: 'img2img',
        imageCount: images.length,
        duration,
      });

      return {
        success: true,
        images: images.map((img, i) => ({
          data: img,
          format: 'base64',
          mimeType: 'image/png',
          index: i,
        })),
        parameters: info,
        seed: info.seed,
        duration,
      };
    } catch (error) {
      this.emit('generation-error', { type: 'img2img', error: error.message });
      throw error;
    }
  }

  /**
   * Upscale an image
   * @param {string} image - Base64 encoded image
   * @param {Object} options - Upscale options
   * @returns {Promise<Object>} Upscaled image data
   */
  async upscale(image, options = {}) {
    const params = {
      image: image,
      upscaler_1: options.upscaler || 'R-ESRGAN 4x+',
      upscaling_resize: options.scale || 2,
    };

    try {
      const response = await this._fetch('/sdapi/v1/extra-single-image', {
        method: 'POST',
        body: JSON.stringify(params),
        timeout: 60000,
      });

      return {
        success: true,
        image: {
          data: response.image,
          format: 'base64',
          mimeType: 'image/png',
        },
      };
    } catch (error) {
      throw new Error(`Upscale failed: ${error.message}`);
    }
  }

  /**
   * Get current generation progress
   * @returns {Promise<Object>} Progress info
   */
  async getProgress() {
    try {
      const response = await this._fetch('/sdapi/v1/progress', {
        method: 'GET',
        timeout: 5000,
      });

      return {
        progress: response.progress,
        etaRelative: response.eta_relative,
        state: response.state,
        currentImage: response.current_image,
      };
    } catch (error) {
      return { progress: 0, error: error.message };
    }
  }

  /**
   * Interrupt current generation
   * @returns {Promise<boolean>} Success
   */
  async interrupt() {
    try {
      await this._fetch('/sdapi/v1/interrupt', {
        method: 'POST',
        timeout: 5000,
      });
      return true;
    } catch (error) {
      logger.error('[SDClient] Interrupt failed:', error.message);
      return false;
    }
  }

  /**
   * Switch to a different model
   * @param {string} modelName - Model checkpoint name
   * @returns {Promise<boolean>} Success
   */
  async switchModel(modelName) {
    try {
      await this._fetch('/sdapi/v1/options', {
        method: 'POST',
        body: JSON.stringify({
          sd_model_checkpoint: modelName,
        }),
        timeout: 120000, // Model loading can take time
      });

      this.currentModel = modelName;
      return true;
    } catch (error) {
      logger.error('[SDClient] Model switch failed:', error.message);
      return false;
    }
  }

  /**
   * Load available models
   * @private
   */
  async _loadModels() {
    try {
      const response = await this._fetch('/sdapi/v1/sd-models', {
        method: 'GET',
        timeout: 10000,
      });

      this.models = response.map(m => ({
        name: m.model_name,
        title: m.title,
        hash: m.hash,
      }));
    } catch (error) {
      logger.warn('[SDClient] Failed to load models:', error.message);
      this.models = [];
    }
  }

  /**
   * Load available samplers
   * @private
   */
  async _loadSamplers() {
    try {
      const response = await this._fetch('/sdapi/v1/samplers', {
        method: 'GET',
        timeout: 5000,
      });

      this.samplers = response.map(s => s.name);
    } catch (error) {
      logger.warn('[SDClient] Failed to load samplers:', error.message);
      this.samplers = [];
    }
  }

  /**
   * HTTP fetch wrapper
   * @private
   */
  async _fetch(endpoint, options = {}) {
    const url = `${this.config.baseUrl}${endpoint}`;
    const timeout = options.timeout || this.config.timeout;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }
}

module.exports = {
  SDClient,
  SDAPIType,
};
