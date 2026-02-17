/**
 * PDF Toolkit Skill Handler
 *
 * PDF processing: extract text, merge, split, OCR, info, watermark.
 * Uses pdf-parse for text extraction and tesseract.js for OCR.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

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

function parseFlags(input) {
  const flags = {};
  const actionMatch = input.match(/^--(\w[\w-]*)/);
  if (actionMatch) {
    flags.action = actionMatch[1];
  }

  const textMatch = input.match(/--text\s+"([^"]+)"/);
  if (textMatch) {
    flags.text = textMatch[1];
  }

  const pagesMatch = input.match(/--pages\s+(\S+)/);
  if (pagesMatch) {
    flags.pages = pagesMatch[1];
  }

  const outputMatch = input.match(/--output\s+(\S+)/);
  if (outputMatch) {
    flags.output = outputMatch[1];
  }

  // Collect file paths (non-flag arguments)
  const parts = input
    .replace(/--\w[\w-]*\s+"[^"]*"/g, "")
    .replace(/--\w[\w-]*\s+\S+/g, "")
    .replace(/^--\w[\w-]*/, "")
    .trim();
  flags.files = parts.split(/\s+/).filter((f) => f && !f.startsWith("--"));

  return flags;
}

// ── PDF Operations ──────────────────────────────────

async function extractText(filePath) {
  const pdfParse = require("pdf-parse");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  return {
    text: data.text,
    pages: data.numpages,
    metadata: {
      title: data.info?.Title || "",
      author: data.info?.Author || "",
      creator: data.info?.Creator || "",
      producer: data.info?.Producer || "",
      creationDate: data.info?.CreationDate || "",
    },
  };
}

async function getInfo(filePath) {
  const pdfParse = require("pdf-parse");
  const buffer = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  const data = await pdfParse(buffer);

  return {
    file: path.basename(filePath),
    fileSize: formatBytes(stat.size),
    pages: data.numpages,
    title: data.info?.Title || "(untitled)",
    author: data.info?.Author || "(unknown)",
    creator: data.info?.Creator || "",
    producer: data.info?.Producer || "",
    creationDate: data.info?.CreationDate || "",
    modDate: data.info?.ModDate || "",
    textLength: data.text.length,
  };
}

async function ocrFile(filePath) {
  try {
    const { createWorker } = require("tesseract.js");
    const worker = await createWorker("eng+chi_sim");
    const { data } = await worker.recognize(filePath);
    await worker.terminate();
    return { text: data.text, confidence: data.confidence };
  } catch (err) {
    return {
      text: "",
      confidence: 0,
      error: `OCR not available: ${err.message}. Install tesseract.js for OCR support.`,
    };
  }
}

async function mergeInfo(filePaths) {
  const pdfParse = require("pdf-parse");
  const results = [];
  let totalPages = 0;

  for (const fp of filePaths) {
    const buffer = fs.readFileSync(fp);
    const data = await pdfParse(buffer);
    totalPages += data.numpages;
    results.push({ file: path.basename(fp), pages: data.numpages });
  }

  return {
    files: results,
    totalPages,
    message: `Analyzed ${filePaths.length} PDFs (${totalPages} total pages). Use pdf-lib or similar tool to perform actual merge.`,
  };
}

async function splitInfo(filePath, pageRange) {
  const pdfParse = require("pdf-parse");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  const [start, end] = pageRange.split("-").map(Number);
  const validStart = Math.max(1, start || 1);
  const validEnd = Math.min(data.numpages, end || data.numpages);

  return {
    file: path.basename(filePath),
    totalPages: data.numpages,
    requestedRange: `${validStart}-${validEnd}`,
    pagesInRange: validEnd - validStart + 1,
    message: `PDF has ${data.numpages} pages. Range ${validStart}-${validEnd} selected (${validEnd - validStart + 1} pages).`,
  };
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[pdf-toolkit] handler initialized for "${skill?.name || "pdf-toolkit"}"`,
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
          '## PDF Toolkit\n\nUsage:\n- `--extract <file>` — Extract text\n- `--info <file>` — Show metadata\n- `--merge <f1> <f2>` — Merge PDFs\n- `--split <file> --pages 1-3` — Split pages\n- `--ocr <file>` — OCR scanned PDF\n- `--watermark <file> --text "..."` — Add watermark',
      };
    }

    try {
      const flags = parseFlags(input);
      const action = flags.action || "extract";

      // Resolve first file
      const firstFile = flags.files[0];
      if (!firstFile && action !== "help") {
        return {
          success: false,
          error: "No file specified",
          message: "Please provide a PDF file path.",
        };
      }

      const filePath = firstFile ? resolvePath(firstFile, projectRoot) : "";

      if (filePath && !fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found",
          message: `File not found: ${filePath}`,
        };
      }

      switch (action) {
        case "extract": {
          const result = await extractText(filePath);
          const preview = result.text.substring(0, 2000);
          return {
            success: true,
            result,
            message: `## PDF Text Extraction: ${path.basename(filePath)}\n\n**Pages**: ${result.pages}\n**Author**: ${result.metadata.author || "N/A"}\n\n### Content Preview\n\`\`\`\n${preview}${result.text.length > 2000 ? "\n... (truncated)" : ""}\n\`\`\``,
          };
        }

        case "info": {
          const info = await getInfo(filePath);
          return {
            success: true,
            result: info,
            message: `## PDF Info: ${info.file}\n\n| Property | Value |\n|----------|-------|\n| Pages | ${info.pages} |\n| Title | ${info.title} |\n| Author | ${info.author} |\n| Creator | ${info.creator} |\n| Size | ${info.fileSize} |\n| Text chars | ${info.textLength} |\n| Created | ${info.creationDate} |`,
          };
        }

        case "ocr": {
          const ocrResult = await ocrFile(filePath);
          if (ocrResult.error) {
            return {
              success: false,
              error: ocrResult.error,
              message: ocrResult.error,
            };
          }
          return {
            success: true,
            result: ocrResult,
            message: `## OCR Result: ${path.basename(filePath)}\n\n**Confidence**: ${ocrResult.confidence.toFixed(1)}%\n\n\`\`\`\n${ocrResult.text.substring(0, 3000)}\n\`\`\``,
          };
        }

        case "merge": {
          const allFiles = flags.files.map((f) => resolvePath(f, projectRoot));
          const missing = allFiles.filter((f) => !fs.existsSync(f));
          if (missing.length > 0) {
            return {
              success: false,
              error: "Files not found",
              message: `Missing files: ${missing.join(", ")}`,
            };
          }
          const mergeResult = await mergeInfo(allFiles);
          return {
            success: true,
            result: mergeResult,
            message: `## PDF Merge Analysis\n\n${mergeResult.files.map((f) => `- **${f.file}**: ${f.pages} pages`).join("\n")}\n\n**Total**: ${mergeResult.totalPages} pages\n\n${mergeResult.message}`,
          };
        }

        case "split": {
          const pages = flags.pages || "1-1";
          const splitResult = await splitInfo(filePath, pages);
          return {
            success: true,
            result: splitResult,
            message: `## PDF Split: ${splitResult.file}\n\n- Total pages: ${splitResult.totalPages}\n- Selected range: ${splitResult.requestedRange}\n- Pages in range: ${splitResult.pagesInRange}\n\n${splitResult.message}`,
          };
        }

        case "watermark": {
          const text = flags.text || "DRAFT";
          return {
            success: true,
            result: { file: path.basename(filePath), watermarkText: text },
            message: `## Watermark\n\nWatermark text "${text}" prepared for ${path.basename(filePath)}. Use pdf-lib to apply watermark overlay.`,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            message: `Unknown action: --${action}`,
          };
      }
    } catch (error) {
      logger.error(`[pdf-toolkit] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `PDF operation failed: ${error.message}`,
      };
    }
  },
};
