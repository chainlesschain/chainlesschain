/**
 * Image Generation Module
 *
 * Unified exports for image generation capabilities:
 * - SDClient: Stable Diffusion client
 * - DALLEClient: OpenAI DALL-E client
 * - ImageGenManager: Unified interface
 * - IPC Handlers
 *
 * @module image-gen
 * @version 1.0.0
 */

const { SDClient, SDAPIType } = require('./sd-client.js');
const { DALLEClient, DALLEModel, ImageSizes, ImageQuality, ImageStyle } = require('./dalle-client.js');
const { ImageGenManager, getImageGenManager, ImageProvider } = require('./image-gen-manager.js');
const { registerImageGenIPC } = require('./image-gen-ipc.js');

module.exports = {
  // Stable Diffusion
  SDClient,
  SDAPIType,

  // DALL-E
  DALLEClient,
  DALLEModel,
  ImageSizes,
  ImageQuality,
  ImageStyle,

  // Manager
  ImageGenManager,
  getImageGenManager,
  ImageProvider,

  // IPC
  registerImageGenIPC,
};
