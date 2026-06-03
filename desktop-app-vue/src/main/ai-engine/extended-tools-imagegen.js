/**
 * Image Generation Tools Integration
 *
 * Registers image generation tools with the function caller:
 * - Text-to-image generation
 * - Image-to-image transformation
 * - Upscaling
 *
 * @module extended-tools-imagegen
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');

/**
 * Image Generation Tools Handler
 */
class ImageGenToolsHandler {
  constructor() {
    this.imageGenManager = null;
  }

  /**
   * Set ImageGenManager reference
   * @param {Object} imageGenManager - ImageGenManager instance
   */
  setImageGenManager(imageGenManager) {
    this.imageGenManager = imageGenManager;
    logger.info('[ImageGenTools] ImageGenManager reference set');
  }

  /**
   * Register all image generation tools
   * @param {FunctionCaller} functionCaller - Function caller instance
   */
  register(functionCaller) {
    const self = this;

    // ====== Text-to-Image ======

    functionCaller.registerTool(
      'image_generate',
      async (params, context) => {
        if (!self.imageGenManager) {
          throw new Error('Image generation not initialized');
        }

        const {
          prompt,
          negativePrompt,
          width = 1024,
          height = 1024,
          steps = 25,
          seed,
          provider,
        } = params;

        if (!prompt || typeof prompt !== 'string') {
          throw new Error('Please provide a valid prompt');
        }

        const result = await self.imageGenManager.generate(prompt, {
          negativePrompt,
          width,
          height,
          steps,
          seed,
          provider,
        });

        // Return summary (not full base64 to save tokens)
        return {
          success: result.success,
          imageCount: result.images?.length || 0,
          provider: result.provider,
          duration: result.duration,
          seed: result.seed,
          revisedPrompt: result.revisedPrompt,
          // Include first image preview if small
          hasImages: (result.images?.length || 0) > 0,
        };
      },
      {
        name: 'image_generate',
        description: 'Generate an image from a text prompt using AI. Supports Stable Diffusion (local) or DALL-E (cloud).',
        parameters: {
          prompt: {
            type: 'string',
            description: 'Text description of the image to generate',
            required: true,
          },
          negativePrompt: {
            type: 'string',
            description: 'Things to avoid in the image (SD only)',
            required: false,
          },
          width: {
            type: 'number',
            description: 'Image width in pixels (default: 1024)',
            default: 1024,
          },
          height: {
            type: 'number',
            description: 'Image height in pixels (default: 1024)',
            default: 1024,
          },
          steps: {
            type: 'number',
            description: 'Generation steps, higher = better quality (SD only, default: 25)',
            default: 25,
          },
          seed: {
            type: 'number',
            description: 'Random seed for reproducibility (-1 for random)',
            required: false,
          },
          provider: {
            type: 'string',
            description: 'Provider to use: "sd_local", "dalle", or "auto"',
            enum: ['sd_local', 'dalle', 'auto'],
            default: 'auto',
          },
        },
      }
    );

    // ====== Image-to-Image ======

    functionCaller.registerTool(
      'image_transform',
      async (params, context) => {
        if (!self.imageGenManager) {
          throw new Error('Image generation not initialized');
        }

        const {
          prompt,
          imageBase64,
          denoisingStrength = 0.75,
          width,
          height,
        } = params;

        if (!prompt || !imageBase64) {
          throw new Error('Please provide both prompt and image');
        }

        const result = await self.imageGenManager.img2img(prompt, imageBase64, {
          denoisingStrength,
          width,
          height,
        });

        return {
          success: result.success,
          imageCount: result.images?.length || 0,
          duration: result.duration,
          seed: result.seed,
        };
      },
      {
        name: 'image_transform',
        description: 'Transform an existing image based on a text prompt (img2img). Requires Stable Diffusion.',
        parameters: {
          prompt: {
            type: 'string',
            description: 'Text description of the transformation',
            required: true,
          },
          imageBase64: {
            type: 'string',
            description: 'Base64 encoded input image',
            required: true,
          },
          denoisingStrength: {
            type: 'number',
            description: 'How much to change the image (0-1, default: 0.75)',
            default: 0.75,
          },
          width: {
            type: 'number',
            description: 'Output width in pixels',
            required: false,
          },
          height: {
            type: 'number',
            description: 'Output height in pixels',
            required: false,
          },
        },
      }
    );

    // ====== Upscale ======

    functionCaller.registerTool(
      'image_upscale',
      async (params, context) => {
        if (!self.imageGenManager) {
          throw new Error('Image generation not initialized');
        }

        const { imageBase64, scale = 2, upscaler } = params;

        if (!imageBase64) {
          throw new Error('Please provide an image to upscale');
        }

        const result = await self.imageGenManager.upscale(imageBase64, {
          scale,
          upscaler,
        });

        return {
          success: result.success,
          hasImage: !!result.image,
        };
      },
      {
        name: 'image_upscale',
        description: 'Upscale an image to higher resolution. Requires Stable Diffusion.',
        parameters: {
          imageBase64: {
            type: 'string',
            description: 'Base64 encoded image to upscale',
            required: true,
          },
          scale: {
            type: 'number',
            description: 'Upscale factor (default: 2)',
            default: 2,
          },
          upscaler: {
            type: 'string',
            description: 'Upscaler model to use (e.g., "R-ESRGAN 4x+")',
            required: false,
          },
        },
      }
    );

    // ====== Status ======

    functionCaller.registerTool(
      'image_gen_status',
      async (params, context) => {
        if (!self.imageGenManager) {
          return {
            available: false,
            error: 'Image generation not initialized',
          };
        }

        const status = await self.imageGenManager.checkProviders();
        const stats = self.imageGenManager.getStats();

        return {
          available: status.sd_local || status.dalle,
          providers: {
            sdLocal: status.sd_local,
            dalle: status.dalle,
          },
          preferredProvider: status.preferredProvider,
          totalGenerations: stats.totalGenerations,
          cacheHits: stats.cacheHits,
        };
      },
      {
        name: 'image_gen_status',
        description: 'Check image generation system status and available providers.',
        parameters: {},
      }
    );

    logger.info('[ImageGenTools] 4 image generation tools registered');
  }
}

// Singleton instance
let imageGenToolsInstance = null;

/**
 * Get Image Generation Tools Handler singleton
 * @returns {ImageGenToolsHandler}
 */
function getImageGenTools() {
  if (!imageGenToolsInstance) {
    imageGenToolsInstance = new ImageGenToolsHandler();
  }
  return imageGenToolsInstance;
}

module.exports = {
  ImageGenToolsHandler,
  getImageGenTools,
};
