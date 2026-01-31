/**
 * Text-to-Speech Tools Integration
 *
 * Registers TTS tools with the function caller:
 * - Text to speech synthesis
 * - Voice listing
 *
 * @module extended-tools-tts
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');

/**
 * TTS Tools Handler
 */
class TTSToolsHandler {
  constructor() {
    this.ttsManager = null;
  }

  /**
   * Set TTSManager reference
   * @param {Object} ttsManager - TTSManager instance
   */
  setTTSManager(ttsManager) {
    this.ttsManager = ttsManager;
    logger.info('[TTSTools] TTSManager reference set');
  }

  /**
   * Register all TTS tools
   * @param {FunctionCaller} functionCaller - Function caller instance
   */
  register(functionCaller) {
    const self = this;

    // ====== Speech Synthesis ======

    functionCaller.registerTool(
      'tts_synthesize',
      async (params, context) => {
        if (!self.ttsManager) {
          throw new Error('TTS not initialized');
        }

        const {
          text,
          voice,
          provider,
          rate,
          pitch,
        } = params;

        if (!text || typeof text !== 'string') {
          throw new Error('Please provide text to synthesize');
        }

        const result = await self.ttsManager.synthesize(text, {
          voice,
          provider,
          rate,
          pitch,
        });

        // Return summary (not full audio to save tokens)
        return {
          success: result.success,
          provider: result.provider,
          format: result.format,
          duration: result.duration,
          textLength: result.textLength,
          voice: result.voice || result.model,
          hasAudio: !!result.audio,
          fromCache: result.fromCache || false,
        };
      },
      {
        name: 'tts_synthesize',
        description: 'Convert text to speech audio. Returns audio in base64 format.',
        parameters: {
          text: {
            type: 'string',
            description: 'Text to convert to speech',
            required: true,
          },
          voice: {
            type: 'string',
            description: 'Voice ID to use (e.g., "zh-CN-XiaoxiaoNeural" for Edge, model name for Piper)',
            required: false,
          },
          provider: {
            type: 'string',
            description: 'TTS provider: "edge" (Microsoft), "local" (Piper), or "auto"',
            enum: ['edge', 'local', 'auto'],
            default: 'auto',
          },
          rate: {
            type: 'string',
            description: 'Speech rate adjustment (e.g., "+20%" or "-10%")',
            required: false,
          },
          pitch: {
            type: 'string',
            description: 'Pitch adjustment (e.g., "+5Hz" or "-5Hz")',
            required: false,
          },
        },
      }
    );

    // ====== Voice Listing ======

    functionCaller.registerTool(
      'tts_list_voices',
      async (params, context) => {
        if (!self.ttsManager) {
          throw new Error('TTS not initialized');
        }

        const { provider, language } = params;

        const voices = self.ttsManager.getVoices(provider, language);

        // Format for display
        const voiceList = {};

        if (voices.edge) {
          voiceList.edge = Object.entries(voices.edge).map(([id, info]) => ({
            id,
            name: info.name,
            language: info.language,
            gender: info.gender,
          }));
        }

        if (voices.local) {
          voiceList.local = Object.entries(voices.local).map(([id, info]) => ({
            id,
            name: info.name,
            language: info.language,
            quality: info.quality,
          }));
        }

        return {
          success: true,
          voices: voiceList,
          totalCount: (voiceList.edge?.length || 0) + (voiceList.local?.length || 0),
        };
      },
      {
        name: 'tts_list_voices',
        description: 'List available TTS voices.',
        parameters: {
          provider: {
            type: 'string',
            description: 'Filter by provider: "edge", "local", or null for all',
            enum: ['edge', 'local'],
            required: false,
          },
          language: {
            type: 'string',
            description: 'Filter by language code (e.g., "zh-CN", "en-US")',
            required: false,
          },
        },
      }
    );

    // ====== Status ======

    functionCaller.registerTool(
      'tts_status',
      async (params, context) => {
        if (!self.ttsManager) {
          return {
            available: false,
            error: 'TTS not initialized',
          };
        }

        const status = await self.ttsManager.checkProviders();
        const stats = self.ttsManager.getStats();

        return {
          available: status.edge || status.local,
          providers: {
            edge: status.edge,
            local: status.local,
          },
          preferredProvider: status.preferredProvider,
          totalSyntheses: stats.totalSyntheses,
          totalCharacters: stats.totalCharacters,
          cacheHits: stats.cacheHits,
        };
      },
      {
        name: 'tts_status',
        description: 'Check text-to-speech system status and available providers.',
        parameters: {},
      }
    );

    logger.info('[TTSTools] 3 TTS tools registered');
  }
}

// Singleton instance
let ttsToolsInstance = null;

/**
 * Get TTS Tools Handler singleton
 * @returns {TTSToolsHandler}
 */
function getTTSTools() {
  if (!ttsToolsInstance) {
    ttsToolsInstance = new TTSToolsHandler();
  }
  return ttsToolsInstance;
}

module.exports = {
  TTSToolsHandler,
  getTTSTools,
};
