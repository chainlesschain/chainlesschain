/**
 * DALL-E Client
 *
 * Connects to OpenAI DALL-E API for image generation.
 * Supports DALL-E 2 and DALL-E 3.
 *
 * @module dalle-client
 * @version 1.0.0
 */

const EventEmitter = require('events');
const { logger } = require('../utils/logger.js');

/**
 * DALL-E model versions
 */
const DALLEModel = {
  DALLE_2: 'dall-e-2',
  DALLE_3: 'dall-e-3',
};

/**
 * Image sizes by model
 */
const ImageSizes = {
  [DALLEModel.DALLE_2]: ['256x256', '512x512', '1024x1024'],
  [DALLEModel.DALLE_3]: ['1024x1024', '1792x1024', '1024x1792'],
};

/**
 * Quality options (DALL-E 3 only)
 */
const ImageQuality = {
  STANDARD: 'standard',
  HD: 'hd',
};

/**
 * Style options (DALL-E 3 only)
 */
const ImageStyle = {
  VIVID: 'vivid',
  NATURAL: 'natural',
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  apiKey: null,
  baseUrl: 'https://api.openai.com/v1',
  model: DALLEModel.DALLE_3,
  defaultSize: '1024x1024',
  defaultQuality: ImageQuality.STANDARD,
  defaultStyle: ImageStyle.VIVID,
  timeout: 120000,
};

/**
 * DALL-E Client
 */
class DALLEClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.available = false;

    // Statistics
    this.stats = {
      totalGenerations: 0,
      totalCost: 0,
    };

    logger.info('[DALLEClient] Initialized with model:', this.config.model);
  }

  /**
   * Set API key
   * @param {string} apiKey - OpenAI API key
   */
  setApiKey(apiKey) {
    this.config.apiKey = apiKey;
    this.available = !!apiKey;
  }

  /**
   * Check if DALL-E is available
   * @returns {Object} Status object
   */
  checkStatus() {
    return {
      available: !!this.config.apiKey,
      model: this.config.model,
      supportedSizes: ImageSizes[this.config.model],
      supportsEditing: this.config.model === DALLEModel.DALLE_2,
      supportsVariations: this.config.model === DALLEModel.DALLE_2,
    };
  }

  /**
   * Generate image from text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image data
   */
  async generate(prompt, options = {}) {
    if (!this.config.apiKey) {
      throw new Error('DALL-E API key not configured');
    }

    const model = options.model || this.config.model;
    const size = options.size || this.config.defaultSize;

    // Validate size for model
    if (!ImageSizes[model].includes(size)) {
      throw new Error(`Invalid size ${size} for model ${model}. Valid sizes: ${ImageSizes[model].join(', ')}`);
    }

    const params = {
      model: model,
      prompt: prompt,
      n: Math.min(options.count || 1, model === DALLEModel.DALLE_3 ? 1 : 10),
      size: size,
      response_format: options.responseFormat || 'b64_json',
    };

    // DALL-E 3 specific options
    if (model === DALLEModel.DALLE_3) {
      params.quality = options.quality || this.config.defaultQuality;
      params.style = options.style || this.config.defaultStyle;
    }

    this.emit('generation-start', { prompt, model });

    try {
      const startTime = Date.now();
      const response = await this._fetch('/images/generations', {
        method: 'POST',
        body: JSON.stringify(params),
      });

      const duration = Date.now() - startTime;

      this.stats.totalGenerations++;
      this._updateCost(model, size, params.n, params.quality);

      this.emit('generation-complete', {
        imageCount: response.data?.length || 0,
        duration,
        model,
      });

      return {
        success: true,
        images: (response.data || []).map((img, i) => ({
          data: img.b64_json || null,
          url: img.url || null,
          format: img.b64_json ? 'base64' : 'url',
          mimeType: 'image/png',
          index: i,
          revisedPrompt: img.revised_prompt, // DALL-E 3 may revise prompts
        })),
        model,
        duration,
        revisedPrompt: response.data?.[0]?.revised_prompt,
      };
    } catch (error) {
      this.emit('generation-error', { error: error.message, model });
      throw error;
    }
  }

  /**
   * Create image variations (DALL-E 2 only)
   * @param {string} image - Base64 encoded PNG image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated variations
   */
  async createVariation(image, options = {}) {
    if (this.config.model !== DALLEModel.DALLE_2) {
      throw new Error('Variations are only supported by DALL-E 2');
    }

    if (!this.config.apiKey) {
      throw new Error('DALL-E API key not configured');
    }

    // Convert base64 to blob for form data
    const imageBuffer = Buffer.from(image, 'base64');
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('image', blob, 'image.png');
    formData.append('n', String(options.count || 1));
    formData.append('size', options.size || '1024x1024');
    formData.append('response_format', options.responseFormat || 'b64_json');

    try {
      const response = await this._fetchFormData('/images/variations', formData);

      return {
        success: true,
        images: (response.data || []).map((img, i) => ({
          data: img.b64_json || null,
          url: img.url || null,
          format: img.b64_json ? 'base64' : 'url',
          mimeType: 'image/png',
          index: i,
        })),
      };
    } catch (error) {
      throw new Error(`Variation creation failed: ${error.message}`);
    }
  }

  /**
   * Edit image (DALL-E 2 only)
   * @param {string} image - Base64 encoded PNG image
   * @param {string} prompt - Edit prompt
   * @param {string} mask - Base64 encoded mask (transparent areas = edit)
   * @param {Object} options - Edit options
   * @returns {Promise<Object>} Edited image
   */
  async edit(image, prompt, mask, options = {}) {
    if (this.config.model !== DALLEModel.DALLE_2) {
      throw new Error('Image editing is only supported by DALL-E 2');
    }

    if (!this.config.apiKey) {
      throw new Error('DALL-E API key not configured');
    }

    const imageBuffer = Buffer.from(image, 'base64');
    const maskBuffer = Buffer.from(mask, 'base64');

    const formData = new FormData();
    formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), 'image.png');
    formData.append('mask', new Blob([maskBuffer], { type: 'image/png' }), 'mask.png');
    formData.append('prompt', prompt);
    formData.append('n', String(options.count || 1));
    formData.append('size', options.size || '1024x1024');
    formData.append('response_format', options.responseFormat || 'b64_json');

    try {
      const response = await this._fetchFormData('/images/edits', formData);

      return {
        success: true,
        images: (response.data || []).map((img, i) => ({
          data: img.b64_json || null,
          url: img.url || null,
          format: img.b64_json ? 'base64' : 'url',
          mimeType: 'image/png',
          index: i,
        })),
      };
    } catch (error) {
      throw new Error(`Image edit failed: ${error.message}`);
    }
  }

  /**
   * Get usage statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      model: this.config.model,
      available: !!this.config.apiKey,
    };
  }

  /**
   * Update cost estimate
   * @private
   */
  _updateCost(model, size, count, quality) {
    // Approximate pricing (as of 2024)
    const prices = {
      [DALLEModel.DALLE_2]: {
        '256x256': 0.016,
        '512x512': 0.018,
        '1024x1024': 0.020,
      },
      [DALLEModel.DALLE_3]: {
        '1024x1024': { standard: 0.040, hd: 0.080 },
        '1792x1024': { standard: 0.080, hd: 0.120 },
        '1024x1792': { standard: 0.080, hd: 0.120 },
      },
    };

    let cost = 0;
    if (model === DALLEModel.DALLE_2) {
      cost = (prices[model][size] || 0.02) * count;
    } else {
      const sizePrice = prices[model][size] || { standard: 0.04, hd: 0.08 };
      cost = (sizePrice[quality] || sizePrice.standard) * count;
    }

    this.stats.totalCost += cost;
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
        method: options.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...options.headers,
        },
        body: options.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * HTTP fetch with FormData
   * @private
   */
  async _fetchFormData(endpoint, formData) {
    const url = `${this.config.baseUrl}${endpoint}`;
    const timeout = this.config.timeout;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || `HTTP ${response.status}`);
      }

      return data;
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
  DALLEClient,
  DALLEModel,
  ImageSizes,
  ImageQuality,
  ImageStyle,
};
