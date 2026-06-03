/**
 * Document Comparator Skill Handler
 *
 * Compare documents: text diff, structural comparison, change summary.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Content Extraction ──────────────────────────────

async function extractContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".docx":
    case ".doc": {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    case ".pdf": {
      const pdfParse = require("pdf-parse");
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    }
    case ".html":
    case ".htm": {
      const html = fs.readFileSync(filePath, "utf-8");
      return html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    default:
      return fs.readFileSync(filePath, "utf-8");
  }
}

// ── Diff Algorithm ──────────────────────────────────

function computeDiff(text1, text2) {
  const lines1 = text1.split("\n");
  const lines2 = text2.split("\n");

  const changes = [];
  let i = 0;
  let j = 0;

  // Simple LCS-based diff
  const lcsMatrix = [];
  for (let a = 0; a <= lines1.length; a++) {
    lcsMatrix[a] = [];
    for (let b = 0; b <= lines2.length; b++) {
      if (a === 0 || b === 0) {
        lcsMatrix[a][b] = 0;
      } else if (lines1[a - 1] === lines2[b - 1]) {
        lcsMatrix[a][b] = lcsMatrix[a - 1][b - 1] + 1;
      } else {
        lcsMatrix[a][b] = Math.max(lcsMatrix[a - 1][b], lcsMatrix[a][b - 1]);
      }
    }
  }

  // Backtrack to find diff
  i = lines1.length;
  j = lines2.length;
  const result = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
      result.unshift({
        type: "equal",
        line: lines1[i - 1],
        lineNum1: i,
        lineNum2: j,
      });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || lcsMatrix[i][j - 1] >= lcsMatrix[i - 1][j])
    ) {
      result.unshift({ type: "added", line: lines2[j - 1], lineNum2: j });
      j--;
    } else if (i > 0) {
      result.unshift({ type: "deleted", line: lines1[i - 1], lineNum1: i });
      i--;
    }
  }

  return result;
}

function computeStats(diff) {
  const added = diff.filter((d) => d.type === "added").length;
  const deleted = diff.filter((d) => d.type === "deleted").length;
  const equal = diff.filter((d) => d.type === "equal").length;
  const total = added + deleted + equal;
  const similarity = total > 0 ? ((equal / total) * 100).toFixed(1) : 100;

  return { added, deleted, equal, total, similarity: parseFloat(similarity) };
}

// ── Output Formatters ───────────────────────────────

function formatTextDiff(diff, stats) {
  const lines = diff.map((d) => {
    if (d.type === "added") {
      return `+ ${d.line}`;
    }
    if (d.type === "deleted") {
      return `- ${d.line}`;
    }
    return `  ${d.line}`;
  });

  // Only show changed lines with context
  const contextLines = [];
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type !== "equal") {
      const start = Math.max(0, i - 2);
      const end = Math.min(diff.length, i + 3);
      for (let k = start; k < end; k++) {
        if (!contextLines.includes(k)) {
          contextLines.push(k);
        }
      }
    }
  }

  if (contextLines.length === 0) {
    return "No differences found.";
  }

  const output = [];
  let lastIdx = -1;
  for (const idx of contextLines) {
    if (lastIdx >= 0 && idx - lastIdx > 1) {
      output.push("...");
    }
    output.push(lines[idx]);
    lastIdx = idx;
  }

  return output.join("\n");
}

function formatJsonDiff(diff, stats) {
  return JSON.stringify(
    {
      stats,
      changes: diff.filter((d) => d.type !== "equal").slice(0, 100),
    },
    null,
    2,
  );
}

function formatHtmlDiff(diff) {
  const lines = diff.map((d) => {
    if (d.type === "added") {
      return `<div style="background:#e6ffe6;">+ ${escapeHtml(d.line)}</div>`;
    }
    if (d.type === "deleted") {
      return `<div style="background:#ffe6e6;">- ${escapeHtml(d.line)}</div>`;
    }
    return `<div>  ${escapeHtml(d.line)}</div>`;
  });
  return `<pre style="font-family:monospace;">${lines.join("\n")}</pre>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[doc-comparator] handler initialized for "${skill?.name || "doc-comparator"}"`,
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
          "## Document Comparator\n\nUsage:\n- `--compare <file1> <file2> [--format text|json|html]`\n- `--summary <file1> <file2>`\n\nSupported: txt, md, docx, pdf, html",
      };
    }

    try {
      const formatMatch = input.match(/--format\s+(\S+)/);
      const outputFormat = formatMatch ? formatMatch[1] : "text";

      // Extract file paths
      const cleaned = input
        .replace(/--compare|--summary|--format\s+\S+/g, "")
        .trim();
      const files = cleaned
        .split(/\s+/)
        .filter((f) => f && !f.startsWith("--"));

      if (files.length < 2) {
        return {
          success: false,
          error: "Two files required",
          message: "Please provide two files to compare.",
        };
      }

      const file1 = resolvePath(files[0], projectRoot);
      const file2 = resolvePath(files[1], projectRoot);

      if (!fs.existsSync(file1)) {
        return {
          success: false,
          error: "File not found",
          message: `Not found: ${file1}`,
        };
      }
      if (!fs.existsSync(file2)) {
        return {
          success: false,
          error: "File not found",
          message: `Not found: ${file2}`,
        };
      }

      const text1 = await extractContent(file1);
      const text2 = await extractContent(file2);

      const diff = computeDiff(text1, text2);
      const stats = computeStats(diff);

      let formatted;
      switch (outputFormat) {
        case "json":
          formatted = formatJsonDiff(diff, stats);
          break;
        case "html":
          formatted = formatHtmlDiff(diff);
          break;
        default:
          formatted = formatTextDiff(diff, stats);
      }

      return {
        success: true,
        result: {
          stats,
          file1: path.basename(file1),
          file2: path.basename(file2),
        },
        message: `## Document Comparison\n\n**${path.basename(file1)}** vs **${path.basename(file2)}**\n\n| Metric | Value |\n|--------|-------|\n| Added | +${stats.added} lines |\n| Deleted | -${stats.deleted} lines |\n| Unchanged | ${stats.equal} lines |\n| Similarity | ${stats.similarity}% |\n\n### Diff\n\`\`\`diff\n${formatted.substring(0, 3000)}${formatted.length > 3000 ? "\n... (truncated)" : ""}\n\`\`\``,
      };
    } catch (error) {
      logger.error(`[doc-comparator] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Comparison failed: ${error.message}`,
      };
    }
  },
};
