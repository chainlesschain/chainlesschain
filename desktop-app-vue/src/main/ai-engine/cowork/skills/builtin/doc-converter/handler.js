/**
 * Document Converter Skill Handler
 *
 * Universal format conversion: DOCX, PDF, Markdown, HTML, TXT.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Format Detection ────────────────────────────────

const FORMAT_MAP = {
  ".docx": "docx",
  ".doc": "docx",
  ".pdf": "pdf",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".txt": "txt",
  ".text": "txt",
};

function detectFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return FORMAT_MAP[ext] || "unknown";
}

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

// ── Conversion Functions ────────────────────────────

async function docxToMarkdown(filePath) {
  const mammoth = require("mammoth");
  const result = await mammoth.convertToMarkdown({ path: filePath });
  return { content: result.value, warnings: result.messages.length };
}

async function docxToHtml(filePath) {
  const mammoth = require("mammoth");
  const result = await mammoth.convertToHtml({ path: filePath });
  return { content: result.value, warnings: result.messages.length };
}

async function docxToText(filePath) {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return { content: result.value, warnings: result.messages.length };
}

async function markdownToHtml(filePath) {
  const { marked } = require("marked");
  const md = fs.readFileSync(filePath, "utf-8");
  const html = marked(md);
  return { content: html, warnings: 0 };
}

async function pdfToText(filePath) {
  const pdfParse = require("pdf-parse");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return { content: data.text, warnings: 0, pages: data.numpages };
}

async function htmlToText(filePath) {
  const html = fs.readFileSync(filePath, "utf-8");
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { content: text, warnings: 0 };
}

async function htmlToMarkdown(filePath) {
  const html = fs.readFileSync(filePath, "utf-8");
  // Simple HTML to Markdown conversion
  let md = html;
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n");
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n");
  md = md.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b>(.*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em>(.*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i>(.*?)<\/i>/gi, "*$1*");
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return { content: md, warnings: 0 };
}

// ── Conversion Router ───────────────────────────────

const CONVERTERS = {
  "docx→markdown": docxToMarkdown,
  "docx→md": docxToMarkdown,
  "docx→html": docxToHtml,
  "docx→txt": docxToText,
  "docx→text": docxToText,
  "markdown→html": markdownToHtml,
  "md→html": markdownToHtml,
  "pdf→txt": pdfToText,
  "pdf→text": pdfToText,
  "html→txt": htmlToText,
  "html→text": htmlToText,
  "html→markdown": htmlToMarkdown,
  "html→md": htmlToMarkdown,
};

async function convert(filePath, targetFormat) {
  const sourceFormat = detectFormat(filePath);
  const key = `${sourceFormat}→${targetFormat}`;

  const converter = CONVERTERS[key];
  if (!converter) {
    return {
      content: null,
      error: `Conversion ${sourceFormat} → ${targetFormat} is not supported`,
      supported: Object.keys(CONVERTERS).map((k) => k.replace("→", " → ")),
    };
  }

  return await converter(filePath);
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[doc-converter] handler initialized for "${skill?.name || "doc-converter"}"`,
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
          "## Document Converter\n\nUsage:\n- `--convert <file> --to <format>` — Convert file\n- `--detect <file>` — Detect format\n- `--batch <dir> --to <format>` — Batch convert\n\nSupported formats: docx, pdf, md, html, txt",
      };
    }

    try {
      const toMatch = input.match(/--to\s+(\S+)/);
      const targetFormat = toMatch ? toMatch[1].toLowerCase() : null;

      // Detect action
      if (input.includes("--detect")) {
        const fileMatch = input.match(/--detect\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file specified",
            message: "Usage: --detect <file>",
          };
        }

        const filePath = resolvePath(fileMatch[1], projectRoot);
        const format = detectFormat(filePath);
        const exists = fs.existsSync(filePath);
        const size = exists ? fs.statSync(filePath).size : 0;

        return {
          success: true,
          result: { file: path.basename(filePath), format, exists, size },
          message: `**${path.basename(filePath)}**: ${format.toUpperCase()} format${exists ? ` (${(size / 1024).toFixed(1)} KB)` : " (file not found)"}`,
        };
      }

      if (input.includes("--batch")) {
        const dirMatch = input.match(/--batch\s+(\S+)/);
        if (!dirMatch || !targetFormat) {
          return {
            success: false,
            error: "Usage: --batch <dir> --to <format>",
            message: "Specify directory and target format.",
          };
        }

        const dir = resolvePath(dirMatch[1], projectRoot);
        if (!fs.existsSync(dir)) {
          return {
            success: false,
            error: "Directory not found",
            message: `Not found: ${dir}`,
          };
        }

        const files = fs.readdirSync(dir).filter((f) => {
          const fmt = detectFormat(f);
          return fmt !== "unknown" && fmt !== targetFormat;
        });

        const results = [];
        for (const file of files.slice(0, 20)) {
          const filePath = path.join(dir, file);
          const result = await convert(filePath, targetFormat);
          results.push({
            file,
            success: !result.error,
            chars: result.content ? result.content.length : 0,
          });
        }

        return {
          success: true,
          result: { dir: path.basename(dir), results, targetFormat },
          message: `## Batch Conversion to ${targetFormat.toUpperCase()}\n\n${results.map((r) => `- ${r.file}: ${r.success ? `${r.chars} chars` : "unsupported"}`).join("\n")}\n\n**${results.filter((r) => r.success).length}/${results.length}** converted successfully`,
        };
      }

      // Default: --convert
      const fileMatch =
        input.match(/--convert\s+(\S+)/) || input.match(/(\S+\.\w+)/);
      if (!fileMatch || !targetFormat) {
        return {
          success: false,
          error: "Usage: --convert <file> --to <format>",
          message: "Specify file and target format.",
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

      const result = await convert(filePath, targetFormat);
      if (result.error) {
        return {
          success: false,
          error: result.error,
          message: `${result.error}\n\nSupported conversions:\n${result.supported.map((s) => `- ${s}`).join("\n")}`,
        };
      }

      const sourceFormat = detectFormat(filePath);
      return {
        success: true,
        result: {
          source: path.basename(filePath),
          sourceFormat,
          targetFormat,
          contentLength: result.content.length,
          warnings: result.warnings,
          preview: result.content.substring(0, 1500),
        },
        message: `## Converted: ${sourceFormat.toUpperCase()} → ${targetFormat.toUpperCase()}\n\n**Source**: ${path.basename(filePath)}\n**Output**: ${result.content.length} characters\n${result.warnings > 0 ? `**Warnings**: ${result.warnings}\n` : ""}\n### Preview\n\`\`\`\n${result.content.substring(0, 1500)}${result.content.length > 1500 ? "\n... (truncated)" : ""}\n\`\`\``,
      };
    } catch (error) {
      logger.error(`[doc-converter] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Conversion failed: ${error.message}`,
      };
    }
  },
};
