/**
 * OCR Scanner Skill Handler
 *
 * Extract text from images using Tesseract.js OCR engine.
 * Supports multiple languages, batch processing, and confidence scoring.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Constants ───────────────────────────────────────

const DEFAULT_LANG = "eng+chi_sim";
const BATCH_LIMIT = 20;

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".tiff",
  ".tif",
  ".gif",
]);

const SUPPORTED_LANGUAGES = [
  { code: "eng", name: "English" },
  { code: "chi_sim", name: "Simplified Chinese" },
  { code: "chi_tra", name: "Traditional Chinese" },
  { code: "jpn", name: "Japanese" },
  { code: "kor", name: "Korean" },
  { code: "fra", name: "French" },
  { code: "deu", name: "German" },
  { code: "spa", name: "Spanish" },
  { code: "por", name: "Portuguese" },
  { code: "ita", name: "Italian" },
  { code: "rus", name: "Russian" },
  { code: "ara", name: "Arabic" },
  { code: "hin", name: "Hindi" },
  { code: "tha", name: "Thai" },
  { code: "vie", name: "Vietnamese" },
  { code: "nld", name: "Dutch" },
  { code: "pol", name: "Polish" },
  { code: "tur", name: "Turkish" },
  { code: "ukr", name: "Ukrainian" },
  { code: "swe", name: "Swedish" },
];

// ── Helpers ─────────────────────────────────────────

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

// ── OCR Engine ──────────────────────────────────────

async function recognizeImage(filePath, lang) {
  const Tesseract = require("tesseract.js");
  const worker = await Tesseract.createWorker();

  try {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);

    const {
      data: { text, confidence, blocks },
    } = await worker.recognize(filePath);

    return {
      text: text.trim(),
      confidence: Math.round(confidence * 100) / 100,
      blocks: blocks ? blocks.length : 0,
      language: lang,
    };
  } finally {
    await worker.terminate();
  }
}

async function recognizeBatch(dirPath, lang) {
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => isImageFile(f))
    .slice(0, BATCH_LIMIT);

  if (files.length === 0) {
    return { files: [], total: 0, error: "No image files found in directory" };
  }

  const Tesseract = require("tesseract.js");
  const worker = await Tesseract.createWorker();

  try {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);

    const results = [];
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const {
          data: { text, confidence },
        } = await worker.recognize(filePath);

        results.push({
          file,
          text: text.trim(),
          confidence: Math.round(confidence * 100) / 100,
          size: fs.statSync(filePath).size,
        });
      } catch (err) {
        results.push({
          file,
          text: "",
          confidence: 0,
          error: err.message,
        });
      }
    }

    return { files: results, total: results.length };
  } finally {
    await worker.terminate();
  }
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[ocr-scanner] handler initialized for "${skill?.name || "ocr-scanner"}"`,
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
          "## OCR Scanner\n\nUsage:\n- `--recognize <file>` — Extract text from image\n- `--recognize <file> --lang chi_sim+eng` — Specify language(s)\n- `--batch <dir>` — Batch recognize all images in directory\n- `--languages` — List supported languages\n\nDefault language: `eng+chi_sim` (English + Simplified Chinese)\nSupported formats: JPG, PNG, BMP, TIFF, GIF",
      };
    }

    try {
      // ── Languages ──────────────────────────────────
      if (input.includes("--languages")) {
        const langList = SUPPORTED_LANGUAGES.map(
          (l) => `| \`${l.code}\` | ${l.name} |`,
        ).join("\n");

        return {
          success: true,
          result: { languages: SUPPORTED_LANGUAGES },
          message: `## Supported OCR Languages\n\n| Code | Language |\n|------|----------|\n${langList}\n\nUse \`+\` to combine: \`--lang eng+chi_sim+jpn\``,
        };
      }

      // ── Parse language flag ────────────────────────
      const langMatch = input.match(/--lang\s+(\S+)/);
      const lang = langMatch ? langMatch[1] : DEFAULT_LANG;

      // ── Batch mode ─────────────────────────────────
      if (input.includes("--batch")) {
        const dirMatch = input.match(/--batch\s+(\S+)/);
        if (!dirMatch) {
          return {
            success: false,
            error: "No directory specified",
            message: "Usage: --batch <directory>",
          };
        }

        const dirPath = resolvePath(dirMatch[1], projectRoot);
        if (!fs.existsSync(dirPath)) {
          return {
            success: false,
            error: "Directory not found",
            message: `Not found: ${dirPath}`,
          };
        }

        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: "Not a directory",
            message: `Not a directory: ${dirPath}`,
          };
        }

        const batchResult = await recognizeBatch(dirPath, lang);
        if (batchResult.error) {
          return {
            success: false,
            error: batchResult.error,
            message: batchResult.error,
          };
        }

        const avgConfidence =
          batchResult.files.length > 0
            ? Math.round(
                (batchResult.files.reduce((s, f) => s + f.confidence, 0) /
                  batchResult.files.length) *
                  100,
              ) / 100
            : 0;

        const fileSummaries = batchResult.files
          .slice(0, 10)
          .map(
            (f) =>
              `- **${f.file}**: ${f.error ? `Error: ${f.error}` : `${f.confidence}% confidence, ${f.text.length} chars`}`,
          )
          .join("\n");

        return {
          success: true,
          result: {
            dir: path.basename(dirPath),
            total: batchResult.total,
            avgConfidence,
            files: batchResult.files,
          },
          message: `## Batch OCR: ${path.basename(dirPath)}\n\n**Files processed**: ${batchResult.total} (max ${BATCH_LIMIT})\n**Language**: ${lang}\n**Average confidence**: ${avgConfidence}%\n\n### Results\n${fileSummaries}${batchResult.files.length > 10 ? `\n- ... and ${batchResult.files.length - 10} more` : ""}`,
        };
      }

      // ── Single file recognize ──────────────────────
      const fileMatch =
        input.match(/--recognize\s+(\S+)/) || input.match(/(\S+\.\w+)/);
      if (!fileMatch) {
        return {
          success: false,
          error: "No file specified",
          message: "Usage: --recognize <image-file> [--lang <language>]",
        };
      }

      const filePath = resolvePath(fileMatch[1], projectRoot);
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found",
          message: `Not found: ${filePath}`,
        };
      }

      if (!isImageFile(filePath)) {
        return {
          success: false,
          error: "Unsupported format",
          message: `Unsupported image format: ${path.extname(filePath)}. Supported: ${[...IMAGE_EXTS].join(", ")}`,
        };
      }

      const stat = fs.statSync(filePath);
      const result = await recognizeImage(filePath, lang);

      return {
        success: true,
        result: {
          file: path.basename(filePath),
          text: result.text,
          confidence: result.confidence,
          blocks: result.blocks,
          language: result.language,
          fileSize: stat.size,
        },
        message: `## OCR Result: ${path.basename(filePath)}\n\n| Property | Value |\n|----------|-------|\n| File | ${path.basename(filePath)} |\n| Size | ${formatBytes(stat.size)} |\n| Language | ${result.language} |\n| Confidence | ${result.confidence}% |\n| Paragraphs | ${result.blocks} |\n| Characters | ${result.text.length} |\n\n### Extracted Text\n\n\`\`\`\n${result.text.substring(0, 3000)}${result.text.length > 3000 ? "\n... (truncated)" : ""}\n\`\`\``,
      };
    } catch (error) {
      logger.error(`[ocr-scanner] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `OCR recognition failed: ${error.message}`,
      };
    }
  },
};
