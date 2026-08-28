/**
 * Image Generator Skill Handler
 *
 * AI image generation (text-to-image via Stable Diffusion / DALL-E)
 * and image enhancement (sharpen, denoise, upscale) using Sharp.
 * Modes: --generate, --enhance, --presets, --providers
 */

const {
  bundledSkillFs: fs,
  withBundledSkillFilesystem,
} = require("../../bundled-skill-filesystem-broker.js");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");
const {
  requireBundledSkillRuntimeNetworkBroker,
} = require("../../bundled-skill-egress-broker.js");
const {
  requireBundledSkillLocalServiceBroker,
} = require("../../bundled-skill-local-service-broker.js");
const {
  requireBundledSkillEnvironmentBroker,
} = require("../../bundled-skill-environment-broker.js");

// ── Size Presets ────────────────────────────────────────────────────

const PRESETS = {
  thumbnail: { width: 150, height: 150 },
  small: { width: 480, height: 320 },
  medium: { width: 1024, height: 768 },
  large: { width: 1920, height: 1080 },
  square_sm: { width: 512, height: 512 },
  square_md: { width: 1024, height: 1024 },
  portrait: { width: 768, height: 1024 },
  landscape: { width: 1024, height: 768 },
};

// ── AI Provider Configurations ──────────────────────────────────────

const AI_PROVIDERS = {
  "stable-diffusion": {
    name: "Stable Diffusion",
    authorityKey: "stable-diffusion-endpoint",
  },
  dalle: {
    name: "DALL-E",
    authorityKey: "openai-api-key",
    endpoint: "https://api.openai.com/v1/images/generations",
  },
};

const SUPPORTED_FORMATS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// ── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

function parseSize(sizeStr) {
  if (!sizeStr) {
    return null;
  }
  // Check preset name first
  const preset = PRESETS[sizeStr.toLowerCase()];
  if (preset) {
    return preset;
  }
  // Parse WxH format
  const match = sizeStr.match(/^(\d+)[xX](\d+)$/);
  if (match) {
    return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  }
  return null;
}

function getAvailableProviders(context) {
  const environment = requireBundledSkillEnvironmentBroker(
    context,
    "image-generator",
  );
  const providers = [];
  for (const [key, config] of Object.entries(AI_PROVIDERS)) {
    const configuredValue = environment.get(config.authorityKey);
    providers.push({
      id: key,
      name: config.name,
      configured: !!configuredValue,
      authorityKey: config.authorityKey,
      endpoint: config.endpoint || null,
    });
  }
  return providers;
}

function getDefaultProvider(context) {
  const environment = requireBundledSkillEnvironmentBroker(
    context,
    "image-generator",
  );
  for (const [key, config] of Object.entries(AI_PROVIDERS)) {
    if (environment.has(config.authorityKey)) {
      return key;
    }
  }
  return null;
}

// ── Generate via Stable Diffusion ───────────────────────────────────

async function generateSD(prompt, size, context) {
  const broker = requireBundledSkillLocalServiceBroker(
    context,
    "image-generator",
    "stable-diffusion",
  );
  const response = await broker.request({
    path: "/sdapi/v1/txt2img",
    method: "POST",
    body: {
      prompt: prompt,
      width: size.width,
      height: size.height,
      steps: 30,
      cfg_scale: 7,
      sampler_name: "Euler a",
    },
    timeout: 120000,
    maxResponseBytes: 32 * 1024 * 1024,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Stable Diffusion returned status ${response.status}`);
  }
  const data = JSON.parse(response.body);

  if (data && data.images && data.images.length > 0) {
    return Buffer.from(data.images[0], "base64");
  }
  throw new Error("No image returned from Stable Diffusion");
}

// ── Generate via DALL-E ─────────────────────────────────────────────

async function generateDALLE(prompt, size, apiKey, context) {
  const sizeStr = size.width + "x" + size.height;
  const validSizes = [
    "256x256",
    "512x512",
    "1024x1024",
    "1024x1792",
    "1792x1024",
  ];
  const requestSize = validSizes.includes(sizeStr) ? sizeStr : "1024x1024";

  const broker = requireBundledSkillRuntimeNetworkBroker(
    context,
    "image-generator",
  );
  const response = await broker.request({
    url: AI_PROVIDERS.dalle.endpoint,
    method: "POST",
    body: {
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: requestSize,
      response_format: "b64_json",
    },
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    timeout: 120000,
    maxResponseBytes: 32 * 1024 * 1024,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`DALL-E returned status ${response.status}`);
  }
  const data = JSON.parse(response.body);

  if (data && data.data && data.data.length > 0) {
    return Buffer.from(data.data[0].b64_json, "base64");
  }
  throw new Error("No image returned from DALL-E");
}

// ── Image Enhancement ───────────────────────────────────────────────

async function enhanceImage(filePath, operations, outputPath) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (_err) {
    // sharp may be unavailable in packaged builds
  }
  let pipeline = sharp(filePath);

  for (const op of operations) {
    switch (op.type) {
      case "sharpen":
        pipeline = pipeline.sharpen();
        break;
      case "denoise":
        pipeline = pipeline.median(3);
        break;
      case "upscale": {
        const meta = await sharp(filePath).metadata();
        const factor = Math.min(Math.max(op.factor || 2, 1), 4);
        pipeline = pipeline.resize(
          Math.round(meta.width * factor),
          Math.round(meta.height * factor),
          { fit: "fill", kernel: "lanczos3" },
        );
        break;
      }
    }
  }

  await pipeline.toFile(outputPath);

  const stat = fs.statSync(outputPath);
  const meta = await sharp(outputPath).metadata();
  return {
    path: outputPath,
    fileName: path.basename(outputPath),
    width: meta.width,
    height: meta.height,
    format: meta.format,
    fileSize: stat.size,
    fileSizeFormatted: formatBytes(stat.size),
  };
}

// ── Action Handlers ─────────────────────────────────────────────────

async function handleGenerate(input, projectRoot, context) {
  const promptMatch =
    input.match(/--generate\s+"([^"]+)"/i) ||
    input.match(/--generate\s+'([^']+)'/i) ||
    input.match(/--generate\s+(\S+)/i);

  if (!promptMatch) {
    return {
      success: false,
      error: "No prompt provided",
      message:
        'Usage: /image-generator --generate "<prompt>" [--size WxH] [--provider stable-diffusion|dalle] [--output file.png]',
    };
  }

  const prompt = promptMatch[1];
  const providerMatch = input.match(/--provider\s+(\S+)/i);
  const sizeMatch = input.match(/--size\s+(\S+)/i);
  const outputMatch = input.match(/--output\s+(\S+)/i);

  const requestedProvider = providerMatch
    ? providerMatch[1].toLowerCase()
    : getDefaultProvider(context);

  if (!requestedProvider) {
    const providers = getAvailableProviders(context);
    const configHints = providers
      .map(function (p) {
        return "  - " + p.name + ": configure " + p.authorityKey;
      })
      .join("\n");
    return {
      success: false,
      error: "No AI image provider configured",
      message:
        "No AI image provider configured.\n\nTo use image generation, configure one of:\n" +
        configHints +
        "\n\nProvider configuration must be approved by the trusted host.",
    };
  }

  if (!AI_PROVIDERS[requestedProvider]) {
    return {
      success: false,
      error: "Unknown provider: " + requestedProvider,
      message:
        "Unknown provider: " +
        requestedProvider +
        ". Available: " +
        Object.keys(AI_PROVIDERS).join(", "),
    };
  }

  const size = parseSize(sizeMatch ? sizeMatch[1] : null) || {
    width: 1024,
    height: 1024,
  };

  const safePromptName = prompt
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")
    .substring(0, 40);
  const outputFile = outputMatch
    ? resolvePath(outputMatch[1], projectRoot)
    : path.join(projectRoot, "generated_" + safePromptName + ".png");

  const providerConfig = AI_PROVIDERS[requestedProvider];
  const providerValue = requireBundledSkillEnvironmentBroker(
    context,
    "image-generator",
  ).get(providerConfig.authorityKey);

  if (!providerValue) {
    return {
      success: false,
      error: providerConfig.name + " not configured",
      message:
        providerConfig.name +
        " requires approved trusted-host provider configuration.",
    };
  }

  let imageBuffer;
  if (requestedProvider === "stable-diffusion") {
    imageBuffer = await generateSD(prompt, size, context);
  } else if (requestedProvider === "dalle") {
    imageBuffer = await generateDALLE(prompt, size, providerValue, context);
  }

  fs.writeFileSync(outputFile, imageBuffer);
  const stat = fs.statSync(outputFile);

  return {
    success: true,
    result: {
      action: "generate",
      prompt: prompt,
      provider: requestedProvider,
      providerName: providerConfig.name,
      size: size,
      outputFile: outputFile,
      fileName: path.basename(outputFile),
      fileSize: stat.size,
      fileSizeFormatted: formatBytes(stat.size),
    },
    message:
      "Generated image saved to " +
      path.basename(outputFile) +
      " (" +
      size.width +
      "x" +
      size.height +
      ")\nProvider: " +
      providerConfig.name +
      "\nPrompt: " +
      prompt +
      "\nSize: " +
      formatBytes(stat.size),
  };
}

async function handleEnhance(input, projectRoot) {
  const fileMatch = input.match(/--enhance\s+(\S+)/i);
  if (!fileMatch) {
    return {
      success: false,
      error: "No file provided",
      message:
        "Usage: /image-generator --enhance <file> [--sharpen] [--denoise] [--upscale <factor>]",
    };
  }

  const filePath = resolvePath(fileMatch[1], projectRoot);
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: "File not found: " + filePath,
      message: "File not found: " + filePath,
    };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS.has(ext)) {
    return {
      success: false,
      error: "Unsupported format: " + ext,
      message:
        "Unsupported format: " +
        ext +
        ". Supported: " +
        Array.from(SUPPORTED_FORMATS).join(", "),
    };
  }

  const operations = [];
  if (/--sharpen/i.test(input)) {
    operations.push({ type: "sharpen" });
  }
  if (/--denoise/i.test(input)) {
    operations.push({ type: "denoise" });
  }
  const upscaleMatch = input.match(/--upscale\s+(\d+)/i);
  if (upscaleMatch) {
    operations.push({ type: "upscale", factor: parseInt(upscaleMatch[1], 10) });
  }

  if (operations.length === 0) {
    return {
      success: false,
      error: "No enhancement operations specified",
      message:
        "Specify at least one operation: --sharpen, --denoise, or --upscale <factor>\n\n" +
        "Examples:\n" +
        "  /image-generator --enhance photo.jpg --sharpen\n" +
        "  /image-generator --enhance photo.jpg --denoise --sharpen\n" +
        "  /image-generator --enhance photo.jpg --upscale 2",
    };
  }

  const outputMatch = input.match(/--output\s+(\S+)/i);
  const baseName = path.basename(filePath, ext);
  const opSuffix = operations
    .map(function (o) {
      return o.type;
    })
    .join("_");
  const outputPath = outputMatch
    ? resolvePath(outputMatch[1], projectRoot)
    : path.join(path.dirname(filePath), baseName + "_" + opSuffix + ext);

  const result = await enhanceImage(filePath, operations, outputPath);
  const opNames = operations
    .map(function (o) {
      return o.type === "upscale" ? "upscale " + o.factor + "x" : o.type;
    })
    .join(", ");

  return {
    success: true,
    result: {
      action: "enhance",
      sourceFile: filePath,
      outputFile: result.path,
      operations: operations,
      width: result.width,
      height: result.height,
      format: result.format,
      fileSize: result.fileSize,
      fileSizeFormatted: result.fileSizeFormatted,
    },
    message:
      "Enhanced image saved: " +
      result.fileName +
      "\nOperations: " +
      opNames +
      "\nDimensions: " +
      result.width +
      "x" +
      result.height +
      "\nFormat: " +
      result.format +
      "\nSize: " +
      result.fileSizeFormatted,
  };
}

function handlePresets() {
  const lines = Object.entries(PRESETS)
    .map(function (entry) {
      return "  " + entry[0] + ": " + entry[1].width + "x" + entry[1].height;
    })
    .join("\n");

  return {
    success: true,
    result: { action: "presets", presets: PRESETS },
    message:
      "Available Size Presets\n" +
      "=".repeat(30) +
      "\n" +
      lines +
      '\n\nUsage: /image-generator --generate "prompt" --size <preset-name-or-WxH>',
  };
}

function handleProviders(context) {
  const providers = getAvailableProviders(context);
  const lines = providers
    .map(function (p) {
      const status = p.configured ? "configured" : "not configured";
      return (
        "  " +
        p.name +
        " (" +
        p.id +
        "): " +
        status +
        " [" +
        p.authorityKey +
        "]"
      );
    })
    .join("\n");

  return {
    success: true,
    result: { action: "providers", providers: providers },
    message:
      "AI Image Providers\n" +
      "=".repeat(30) +
      "\n" +
      lines +
      "\n\nConfigure through the trusted host to enable generation.",
  };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[image-generator] init: " + (_skill?.name || "image-generator"),
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    if (!input) {
      return {
        success: true,
        result: { usage: true },
        message:
          "## Image Generator\n\n" +
          "Usage:\n" +
          '  /image-generator --generate "<prompt>" [--size WxH] [--provider stable-diffusion|dalle] [--output file.png]\n' +
          "  /image-generator --enhance <file> [--sharpen] [--denoise] [--upscale <factor>]\n" +
          "  /image-generator --presets\n" +
          "  /image-generator --providers\n\n" +
          "Examples:\n" +
          '  /image-generator --generate "a beautiful sunset over mountains"\n' +
          "  /image-generator --enhance photo.jpg --sharpen --denoise\n" +
          "  /image-generator --enhance photo.jpg --upscale 2",
      };
    }

    try {
      if (/--presets/i.test(input)) {
        return handlePresets();
      }

      if (/--providers/i.test(input)) {
        return handleProviders(context);
      }

      if (/--generate/i.test(input)) {
        return await handleGenerate(input, projectRoot, context);
      }

      if (/--enhance/i.test(input)) {
        return await handleEnhance(input, projectRoot);
      }

      return {
        success: false,
        error: "Unknown action",
        message:
          "Unknown action. Use --generate, --enhance, --presets, or --providers.\n" +
          'Example: /image-generator --generate "a sunset"',
      };
    } catch (err) {
      logger.error("[image-generator] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Image generator failed: " + err.message,
      };
    }
  },
};

module.exports = withBundledSkillFilesystem("image-generator", module.exports);
