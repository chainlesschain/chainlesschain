/**
 * Image Editor Skill Handler
 *
 * Image editing and processing: resize, compress, format conversion,
 * thumbnail generation, rotation, cropping, and text watermark overlay.
 * Built on the Sharp library.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Constants ──────────────────────────────────────

const SUPPORTED_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
]);

const FORMAT_MAP = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  tiff: "tiff",
  gif: "gif",
};

// ── Helpers ─────────────────────────────────────────

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getOutputPath(original, suffix, newExt) {
  const dir = path.dirname(original);
  const base = path.basename(original, path.extname(original));
  const ext = newExt || path.extname(original);
  const dotExt = ext.startsWith(".") ? ext : `.${ext}`;
  return path.join(dir, `${base}${suffix}${dotExt}`);
}

function parseFlags(input) {
  const flags = {};

  const actionMatch = input.match(/^--(\w[\w-]*)/);
  if (actionMatch) {
    flags.action = actionMatch[1];
  }

  const widthMatch = input.match(/--width\s+(\d+)/);
  if (widthMatch) {
    flags.width = parseInt(widthMatch[1], 10);
  }

  const heightMatch = input.match(/--height\s+(\d+)/);
  if (heightMatch) {
    flags.height = parseInt(heightMatch[1], 10);
  }

  const qualityMatch = input.match(/--quality\s+(\d+)/);
  if (qualityMatch) {
    flags.quality = parseInt(qualityMatch[1], 10);
  }

  const toMatch = input.match(/--to\s+(\w+)/);
  if (toMatch) {
    flags.to = toMatch[1].toLowerCase();
  }

  const sizeMatch = input.match(/--size\s+(\d+)/);
  if (sizeMatch) {
    flags.size = parseInt(sizeMatch[1], 10);
  }

  const angleMatch = input.match(/--angle\s+(-?\d+)/);
  if (angleMatch) {
    flags.angle = parseInt(angleMatch[1], 10);
  }

  const leftMatch = input.match(/--left\s+(\d+)/);
  if (leftMatch) {
    flags.left = parseInt(leftMatch[1], 10);
  }

  const topMatch = input.match(/--top\s+(\d+)/);
  if (topMatch) {
    flags.top = parseInt(topMatch[1], 10);
  }

  const outputMatch = input.match(/--output\s+(\S+)/);
  if (outputMatch) {
    flags.output = outputMatch[1];
  }

  const textMatch = input.match(/--text\s+"([^"]+)"/);
  if (textMatch) {
    flags.text = textMatch[1];
  }

  // Extract file path: first non-flag argument after the action flag
  const cleaned = input
    .replace(/--\w[\w-]*\s+"[^"]*"/g, "")
    .replace(/--\w[\w-]*\s+\S+/g, "")
    .replace(/^--\w[\w-]*/, "")
    .trim();
  const fileParts = cleaned
    .split(/\s+/)
    .filter((f) => f && !f.startsWith("--"));
  if (fileParts.length > 0) {
    flags.file = fileParts[0];
  }

  return flags;
}

// ── Image Operations ────────────────────────────────

async function imageInfo(filePath) {
  const sharp = require("sharp");
  const meta = await sharp(filePath).metadata();
  const stat = fs.statSync(filePath);

  return {
    file: path.basename(filePath),
    width: meta.width,
    height: meta.height,
    format: meta.format,
    channels: meta.channels,
    space: meta.space,
    density: meta.density || null,
    hasAlpha: meta.hasAlpha,
    fileSize: stat.size,
    fileSizeFormatted: formatBytes(stat.size),
  };
}

async function imageResize(filePath, width, height, outputPath) {
  const sharp = require("sharp");
  const opts = {};
  if (width) {
    opts.width = width;
  }
  if (height) {
    opts.height = height;
  }

  await sharp(filePath).resize(opts).toFile(outputPath);

  const stat = fs.statSync(outputPath);
  const meta = await sharp(outputPath).metadata();
  return {
    file: path.basename(outputPath),
    width: meta.width,
    height: meta.height,
    fileSize: stat.size,
    fileSizeFormatted: formatBytes(stat.size),
  };
}

async function imageCompress(filePath, quality, outputPath) {
  const sharp = require("sharp");
  const meta = await sharp(filePath).metadata();
  const format = meta.format || "jpeg";
  const q = Math.max(1, Math.min(100, quality));

  let pipeline = sharp(filePath);
  if (format === "jpeg" || format === "jpg") {
    pipeline = pipeline.jpeg({ quality: q });
  } else if (format === "png") {
    pipeline = pipeline.png({ quality: q });
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality: q });
  } else if (format === "tiff") {
    pipeline = pipeline.tiff({ quality: q });
  } else {
    pipeline = pipeline.jpeg({ quality: q });
  }

  await pipeline.toFile(outputPath);

  const origStat = fs.statSync(filePath);
  const newStat = fs.statSync(outputPath);
  const reduction = ((1 - newStat.size / origStat.size) * 100).toFixed(1);

  return {
    file: path.basename(outputPath),
    originalSize: formatBytes(origStat.size),
    compressedSize: formatBytes(newStat.size),
    reduction: `${reduction}%`,
  };
}

async function imageConvert(filePath, targetFormat, outputPath) {
  const sharp = require("sharp");
  const sharpFormat = FORMAT_MAP[targetFormat];
  if (!sharpFormat) {
    throw new Error(
      `Unsupported target format: ${targetFormat}. Supported: ${Object.keys(FORMAT_MAP).join(", ")}`,
    );
  }

  await sharp(filePath).toFormat(sharpFormat).toFile(outputPath);

  const stat = fs.statSync(outputPath);
  return {
    file: path.basename(outputPath),
    format: sharpFormat,
    fileSize: stat.size,
    fileSizeFormatted: formatBytes(stat.size),
  };
}

async function imageThumbnail(filePath, size, outputPath) {
  const sharp = require("sharp");

  await sharp(filePath).resize(size, size, { fit: "cover" }).toFile(outputPath);

  const stat = fs.statSync(outputPath);
  return {
    file: path.basename(outputPath),
    size: `${size}x${size}`,
    fileSize: stat.size,
    fileSizeFormatted: formatBytes(stat.size),
  };
}

async function imageRotate(filePath, angle, outputPath) {
  const sharp = require("sharp");

  await sharp(filePath).rotate(angle).toFile(outputPath);

  const stat = fs.statSync(outputPath);
  const meta = await sharp(outputPath).metadata();
  return {
    file: path.basename(outputPath),
    angle,
    width: meta.width,
    height: meta.height,
    fileSize: stat.size,
    fileSizeFormatted: formatBytes(stat.size),
  };
}

async function imageCrop(filePath, left, top, width, height, outputPath) {
  const sharp = require("sharp");

  await sharp(filePath)
    .extract({ left, top, width, height })
    .toFile(outputPath);

  const stat = fs.statSync(outputPath);
  return {
    file: path.basename(outputPath),
    region: { left, top, width, height },
    fileSize: stat.size,
    fileSizeFormatted: formatBytes(stat.size),
  };
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[image-editor] handler initialized for "${skill?.name || "image-editor"}"`,
    );
  },

  async execute(task, context, skill) {
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
          "## Image Editor\n\nUsage:\n" +
          "- `--info <file>` -- Image metadata\n" +
          "- `--resize <file> --width W --height H` -- Resize\n" +
          "- `--compress <file> --quality Q` -- Compress (0-100)\n" +
          "- `--convert <file> --to <format>` -- Format conversion\n" +
          "- `--thumbnail <file> --size S` -- Thumbnail (default 200)\n" +
          "- `--rotate <file> --angle A` -- Rotate\n" +
          "- `--crop <file> --left L --top T --width W --height H` -- Crop\n\n" +
          "Supported: jpg, jpeg, png, webp, gif, bmp, tiff",
      };
    }

    try {
      const flags = parseFlags(input);
      const action = flags.action || "info";

      // Resolve file path
      if (!flags.file) {
        return {
          success: false,
          error: "No file specified",
          message: "Please provide an image file path.",
        };
      }

      const filePath = resolvePath(flags.file, projectRoot);

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found",
          message: `File not found: ${filePath}`,
        };
      }

      const ext = path.extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) {
        return {
          success: false,
          error: "Unsupported format",
          message: `Unsupported image format: ${ext}. Supported: ${[...SUPPORTED_EXTS].join(", ")}`,
        };
      }

      switch (action) {
        case "info": {
          const info = await imageInfo(filePath);
          return {
            success: true,
            result: info,
            message: `## Image Info: ${info.file}\n\n| Property | Value |\n|----------|-------|\n| Dimensions | ${info.width} x ${info.height} |\n| Format | ${info.format} |\n| Color Space | ${info.space} |\n| Channels | ${info.channels} |\n| DPI | ${info.density || "N/A"} |\n| Alpha | ${info.hasAlpha ? "Yes" : "No"} |\n| File Size | ${info.fileSizeFormatted} |`,
          };
        }

        case "resize": {
          if (!flags.width && !flags.height) {
            return {
              success: false,
              error: "Missing dimensions",
              message: "Provide --width and/or --height for resize.",
            };
          }
          const suffix = `_${flags.width || "auto"}x${flags.height || "auto"}`;
          const outPath = flags.output
            ? resolvePath(flags.output, projectRoot)
            : getOutputPath(filePath, suffix);
          const result = await imageResize(
            filePath,
            flags.width,
            flags.height,
            outPath,
          );
          return {
            success: true,
            result,
            message: `Resized image saved to **${result.file}** (${result.width}x${result.height}, ${result.fileSizeFormatted})`,
          };
        }

        case "compress": {
          const quality = flags.quality || 80;
          const outPath = flags.output
            ? resolvePath(flags.output, projectRoot)
            : getOutputPath(filePath, `_q${quality}`);
          const result = await imageCompress(filePath, quality, outPath);
          return {
            success: true,
            result,
            message: `Compressed image saved to **${result.file}** (${result.originalSize} -> ${result.compressedSize}, ${result.reduction} reduction)`,
          };
        }

        case "convert": {
          if (!flags.to) {
            return {
              success: false,
              error: "Missing target format",
              message: `Provide --to <format>. Supported: ${Object.keys(FORMAT_MAP).join(", ")}`,
            };
          }
          const targetExt = flags.to.startsWith(".")
            ? flags.to
            : `.${flags.to}`;
          const outPath = flags.output
            ? resolvePath(flags.output, projectRoot)
            : getOutputPath(filePath, "", targetExt);
          const result = await imageConvert(filePath, flags.to, outPath);
          return {
            success: true,
            result,
            message: `Converted **${path.basename(filePath)}** -> **${result.file}** (${result.format}, ${result.fileSizeFormatted})`,
          };
        }

        case "thumbnail": {
          const size = flags.size || 200;
          const outPath = flags.output
            ? resolvePath(flags.output, projectRoot)
            : getOutputPath(filePath, "_thumb");
          const result = await imageThumbnail(filePath, size, outPath);
          return {
            success: true,
            result,
            message: `Thumbnail generated: **${result.file}** (${result.size}, ${result.fileSizeFormatted})`,
          };
        }

        case "rotate": {
          const angle = flags.angle || 90;
          const outPath = flags.output
            ? resolvePath(flags.output, projectRoot)
            : getOutputPath(filePath, `_rot${angle}`);
          const result = await imageRotate(filePath, angle, outPath);
          return {
            success: true,
            result,
            message: `Rotated image saved to **${result.file}** (${result.angle} deg, ${result.width}x${result.height}, ${result.fileSizeFormatted})`,
          };
        }

        case "crop": {
          if (
            flags.left == null ||
            flags.top == null ||
            !flags.width ||
            !flags.height
          ) {
            return {
              success: false,
              error: "Missing crop parameters",
              message:
                "Provide --left L --top T --width W --height H for crop.",
            };
          }
          const outPath = flags.output
            ? resolvePath(flags.output, projectRoot)
            : getOutputPath(filePath, "_crop");
          const result = await imageCrop(
            filePath,
            flags.left,
            flags.top,
            flags.width,
            flags.height,
            outPath,
          );
          return {
            success: true,
            result,
            message: `Cropped image saved to **${result.file}** (${result.region.width}x${result.region.height}, ${result.fileSizeFormatted})`,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            message: `Unknown action: --${action}. Supported: info, resize, compress, convert, thumbnail, rotate, crop`,
          };
      }
    } catch (error) {
      logger.error(`[image-editor] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Image editing failed: ${error.message}`,
      };
    }
  },
};
