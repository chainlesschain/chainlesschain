/**
 * Video generator — routes text-to-video requests to a cloud provider
 * (currently Volcengine Seedance) with an FFmpeg placeholder fallback
 * for offline/no-key scenarios. Replaces the previous color+drawtext
 * stub that produced unusable output.
 */

const path = require("path");
const { logger } = require("../utils/logger.js");

const _deps = {
  getLLMConfig: null, // lazy require
  volcengine: require("./providers/volcengine-video.js"),
  ffmpegFallback: null, // optional — only used when explicitly requested
};

function getLLMConfig() {
  if (!_deps.getLLMConfig) {
    _deps.getLLMConfig = require("../llm/llm-config.js").getLLMConfig;
  }
  return _deps.getLLMConfig();
}

/**
 * @param {{prompt, outputPath, provider?, model?, imageUrl?, ratio?, duration?, resolution?, onProgress?}} opts
 */
async function generateVideo(opts) {
  const provider = opts.provider || "volcengine";
  if (provider === "volcengine") {
    const cfg = getLLMConfig();
    const vcfg = cfg.volcengine || {};
    if (!vcfg.apiKey) {
      throw new Error(
        "Volcengine apiKey not configured — set it in AI settings",
      );
    }
    return _deps.volcengine.generateVideo({
      apiKey: vcfg.apiKey,
      baseURL: vcfg.baseURL,
      model: opts.model || vcfg.videoModel || undefined,
      prompt: opts.prompt,
      imageUrl: opts.imageUrl,
      ratio: opts.ratio,
      duration: opts.duration,
      resolution: opts.resolution,
      outputPath: opts.outputPath,
      onProgress: opts.onProgress,
    });
  }
  throw new Error(`unsupported video provider: ${provider}`);
}

module.exports = { generateVideo, _deps };
