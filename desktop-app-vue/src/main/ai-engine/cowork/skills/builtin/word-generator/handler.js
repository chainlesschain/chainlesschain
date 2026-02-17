/**
 * Word Generator Skill Handler
 *
 * Generates Word (DOCX) documents from Markdown, inline content, or templates.
 * Uses the docx library for writing and mammoth for reading.
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

function parseInlineFormatting(text) {
  const runs = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m[2]) {
      runs.push({ text: m[2], bold: true });
    } else if (m[3]) {
      runs.push({ text: m[3], italics: true });
    } else if (m[4]) {
      runs.push({ text: m[4] });
    }
  }
  if (runs.length === 0 && text) {
    runs.push({ text });
  }
  return runs;
}

// ── Markdown Parser ─────────────────────────────────

function parseMarkdownToElements(text) {
  const lines = text.split("\n");
  const elements = [];
  let tableRows = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      elements.push({ type: "table", rows: tableRows });
      tableRows = [];
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushTable();
      continue;
    }
    if (/^\|[\s\-:|]+\|$/.test(t)) {
      continue;
    } // table separator
    if (t.startsWith("|") && t.endsWith("|")) {
      tableRows.push(
        t
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim()),
      );
      continue;
    }
    flushTable();
    if (t.startsWith("### ")) {
      elements.push({ type: "heading", level: 3, text: t.substring(4) });
    } else if (t.startsWith("## ")) {
      elements.push({ type: "heading", level: 2, text: t.substring(3) });
    } else if (t.startsWith("# ")) {
      elements.push({ type: "heading", level: 1, text: t.substring(2) });
    } else if (/^[-*]\s/.test(t)) {
      elements.push({ type: "bullet", text: t.replace(/^[-*]\s+/, "") });
    } else if (/^\d+\.\s/.test(t)) {
      elements.push({ type: "numbered", text: t.replace(/^\d+\.\s+/, "") });
    } else {
      elements.push({ type: "paragraph", text: t });
    }
  }
  flushTable();
  return elements;
}

// ── DOCX Generation ─────────────────────────────────

const HEADING_MAP = { 1: "HEADING_1", 2: "HEADING_2", 3: "HEADING_3" };

function toRuns(text, TextRun) {
  return parseInlineFormatting(text).map(
    (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italics }),
  );
}

function buildDocxChildren(elements, docx) {
  const {
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = docx;
  const children = [];
  for (const el of elements) {
    if (el.type === "heading") {
      children.push(
        new Paragraph({
          heading:
            HeadingLevel[HEADING_MAP[el.level]] || HeadingLevel.HEADING_1,
          children: toRuns(el.text, TextRun),
        }),
      );
    } else if (el.type === "bullet") {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: toRuns(el.text, TextRun),
        }),
      );
    } else if (el.type === "numbered") {
      children.push(
        new Paragraph({
          numbering: { reference: "default-numbering", level: 0 },
          children: toRuns(el.text, TextRun),
        }),
      );
    } else if (el.type === "table") {
      const rows = el.rows.map(
        (cells) =>
          new TableRow({
            children: cells.map(
              (ct) =>
                new TableCell({
                  children: [new Paragraph({ children: toRuns(ct, TextRun) })],
                }),
            ),
          }),
      );
      children.push(
        new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
      );
    } else {
      children.push(new Paragraph({ children: toRuns(el.text, TextRun) }));
    }
  }
  return children;
}

async function generateDocx(elements, outputPath, title) {
  const docx = require("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
    docx;
  const docChildren = [];

  if (title) {
    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: title, bold: true, size: 56 })],
      }),
      new Paragraph({ children: [] }),
    );
  }
  docChildren.push(...buildDocxChildren(elements, docx));

  const doc = new Document({
    creator: "ChainlessChain AI",
    title: title || "Generated Document",
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [{ children: docChildren }],
  });

  const buffer = await Packer.toBuffer(doc);
  if (outputPath) {
    fs.writeFileSync(outputPath, buffer);
  }

  return {
    paragraphs: elements.length,
    headings: elements.filter((e) => e.type === "heading").length,
    bullets: elements.filter((e) => e.type === "bullet").length,
    numbered: elements.filter((e) => e.type === "numbered").length,
    tables: elements.filter((e) => e.type === "table").length,
    bufferSize: buffer.length,
  };
}

// ── Read DOCX ───────────────────────────────────────

async function readDocx(filePath) {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value;
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  const paragraphs = text
    .split(/\n\n+/)
    .filter((p) => p.trim().length > 0).length;
  return {
    text,
    wordCount: words,
    paragraphCount: paragraphs,
    warnings: result.messages.length,
  };
}

function formatStats(r) {
  return `${r.paragraphs} (${r.headings} headings, ${r.bullets} bullets, ${r.numbered} numbered, ${r.tables} tables)`;
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[word-generator] handler initialized for "${skill?.name || "word-generator"}"`,
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
          '## Word Generator\n\nUsage:\n- `--from-md <file.md> --output <file.docx>` — Markdown to Word\n- `--create --title "..." --content "..." --output <file.docx>` — Create from content\n- `--read <file.docx>` — Read Word document\n\nSupports: headings, paragraphs, bold, italic, bullet lists, numbered lists, tables.',
      };
    }

    try {
      // ── Read action ──────────────────────────────
      if (input.includes("--read")) {
        const fileMatch = input.match(/--read\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file specified",
            message: "Usage: --read <file.docx>",
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

        const result = await readDocx(filePath);
        const preview = result.text.substring(0, 2000);
        return {
          success: true,
          result: {
            file: path.basename(filePath),
            wordCount: result.wordCount,
            paragraphCount: result.paragraphCount,
            warnings: result.warnings,
            preview,
          },
          message: `## Read: ${path.basename(filePath)}\n\n- **Words**: ${result.wordCount}\n- **Paragraphs**: ${result.paragraphCount}${result.warnings > 0 ? `\n- **Warnings**: ${result.warnings}` : ""}\n\n### Preview\n\`\`\`\n${preview}${result.text.length > 2000 ? "\n... (truncated)" : ""}\n\`\`\``,
        };
      }

      // ── From-Markdown action ─────────────────────
      if (input.includes("--from-md")) {
        const fileMatch = input.match(/--from-md\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file specified",
            message: "Usage: --from-md <file.md> --output <file.docx>",
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

        const outputMatch = input.match(/--output\s+(\S+)/);
        const outputPath = outputMatch
          ? resolvePath(outputMatch[1], projectRoot)
          : resolvePath(
              path.basename(filePath, path.extname(filePath)) + ".docx",
              projectRoot,
            );

        const md = fs.readFileSync(filePath, "utf-8");
        const elements = parseMarkdownToElements(md);
        if (elements.length === 0) {
          return {
            success: false,
            error: "No content parsed",
            message:
              "Markdown file appears to be empty or contains no parseable content.",
          };
        }

        const result = await generateDocx(elements, outputPath, null);
        return {
          success: true,
          result: {
            source: path.basename(filePath),
            output: path.basename(outputPath),
            ...result,
          },
          message: `## Word Document Generated\n\n- **Source**: ${path.basename(filePath)}\n- **Output**: ${path.basename(outputPath)}\n- **Elements**: ${formatStats(result)}\n- **Size**: ${(result.bufferSize / 1024).toFixed(1)} KB`,
        };
      }

      // ── Create action ────────────────────────────
      if (input.includes("--create")) {
        const titleMatch = input.match(/--title\s+"([^"]+)"/);
        const contentMatch = input.match(/--content\s+"([^"]+)"/);
        const outputMatch = input.match(/--output\s+(\S+)/);
        const title = titleMatch ? titleMatch[1] : null;
        const content = contentMatch
          ? contentMatch[1].replace(/\\n/g, "\n")
          : null;

        if (!content && !title) {
          return {
            success: false,
            error: "No content provided",
            message:
              'Usage: --create --title "Title" --content "# Heading\\nText" --output file.docx',
          };
        }

        const outputPath = outputMatch
          ? resolvePath(outputMatch[1], projectRoot)
          : resolvePath("document.docx", projectRoot);
        const elements = content
          ? parseMarkdownToElements(content)
          : [{ type: "paragraph", text: "Empty document." }];
        const result = await generateDocx(elements, outputPath, title);
        return {
          success: true,
          result: {
            output: path.basename(outputPath),
            title: title || "(untitled)",
            ...result,
          },
          message: `## Word Document Created\n\n- **Title**: ${title || "(untitled)"}\n- **Output**: ${path.basename(outputPath)}\n- **Elements**: ${formatStats(result)}\n- **Size**: ${(result.bufferSize / 1024).toFixed(1)} KB`,
        };
      }

      return {
        success: false,
        error: "Unknown action",
        message:
          "Unknown action. Use --from-md, --create, or --read.\n\nRun without arguments for full usage.",
      };
    } catch (error) {
      logger.error(`[word-generator] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Word generation failed: ${error.message}`,
      };
    }
  },
};
