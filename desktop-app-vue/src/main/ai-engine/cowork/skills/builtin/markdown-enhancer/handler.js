/**
 * Markdown Enhancer Skill Handler
 *
 * Markdown processing: TOC generation, link checking, table formatting,
 * statistics, lint, and HTML conversion.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert heading text to anchor slug */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Extract all headings from Markdown content */
function extractHeadings(content) {
  const headings = [];
  let inCode = false;
  content.split("\n").forEach((line, i) => {
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      return;
    }
    if (inCode) {
      return;
    }
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) {
      headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
    }
  });
  return headings;
}

function parseInput(input, root) {
  const parts = (input || "").split(/\s+/).filter(Boolean);
  let action = "toc",
    filePath = null,
    outputPath = null;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (
      [
        "--toc",
        "--stats",
        "--links",
        "--lint",
        "--format-tables",
        "--to-html",
      ].includes(p)
    ) {
      action = p.slice(2);
    } else if (
      p === "--output" &&
      parts[i + 1] &&
      !parts[i + 1].startsWith("-")
    ) {
      outputPath = path.resolve(root, parts[++i]);
    } else if (!p.startsWith("-")) {
      filePath = path.resolve(root, p);
    }
  }
  return { action, filePath, outputPath };
}

function readMd(fp) {
  if (!fp) {
    return { error: "No file specified. Usage: --<action> <file.md>" };
  }
  if (!fs.existsSync(fp)) {
    return { error: "File not found: " + fp };
  }
  try {
    return { content: fs.readFileSync(fp, "utf-8") };
  } catch (e) {
    return { error: "Cannot read: " + e.message };
  }
}

// ── Actions ──────────────────────────────────────────────────────────

function handleToc(content, fp) {
  const hs = extractHeadings(content);
  if (!hs.length) {
    return {
      success: true,
      result: { headings: [], toc: "" },
      message: "No headings found in " + path.basename(fp),
    };
  }

  const min = Math.min(...hs.map((h) => h.level));
  const toc = hs
    .map(
      (h) =>
        "  ".repeat(h.level - min) +
        "- [" +
        h.text +
        "](#" +
        slugify(h.text) +
        ")",
    )
    .join("\n");

  const byLevel = {};
  hs.forEach((h) => {
    byLevel["H" + h.level] = (byLevel["H" + h.level] || 0) + 1;
  });
  const sum = Object.entries(byLevel)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([l, c]) => c + " " + l)
    .join(", ");

  return {
    success: true,
    result: { headings: hs, toc, byLevel },
    message:
      "Table of Contents\n" +
      "=".repeat(30) +
      "\nGenerated TOC with " +
      hs.length +
      " headings (" +
      sum +
      ")\n\n" +
      toc,
  };
}

function handleStats(content, fp) {
  const lines = content.split("\n");
  const hs = extractHeadings(content);
  const plain = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/!?\[.*?\]\(.*?\)/g, "")
    .replace(/[#*_~>`|-]/g, " ");
  const words = plain.split(/\s+/).filter((w) => w.length > 0).length;

  const byLvl = {};
  hs.forEach((h) => {
    byLvl["H" + h.level] = (byLvl["H" + h.level] || 0) + 1;
  });
  const codeBlocks = Math.floor((content.match(/^```/gm) || []).length / 2);
  const linkCount = (content.match(/\[[^\]]*\]\([^)]+\)/g) || []).length;
  const imageCount = (content.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;

  let tables = 0,
    inTbl = false;
  lines.forEach((l) => {
    if (/^\s*\|/.test(l)) {
      if (!inTbl) {
        tables++;
        inTbl = true;
      }
    } else {
      inTbl = false;
    }
  });
  const listItems = (content.match(/^[\s]*[-*+]\s|^[\s]*\d+\.\s/gm) || [])
    .length;

  const stats = {
    words,
    characters: content.length,
    lines: lines.length,
    headings: hs.length,
    headingsByLevel: byLvl,
    codeBlocks,
    links: linkCount,
    images: imageCount,
    tables,
    listItems,
  };
  const lvlStr = Object.keys(byLvl).length
    ? " (" +
      Object.entries(byLvl)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([l, c]) => l + "=" + c)
        .join(", ") +
      ")"
    : "";

  return {
    success: true,
    result: stats,
    message:
      "Markdown Statistics\n" +
      "=".repeat(30) +
      "\nFile: " +
      path.basename(fp) +
      "\nWords: " +
      words +
      " | Chars: " +
      content.length +
      " | Lines: " +
      lines.length +
      "\nHeadings: " +
      hs.length +
      lvlStr +
      "\nCode blocks: " +
      codeBlocks +
      " | Links: " +
      linkCount +
      " | Images: " +
      imageCount +
      "\nTables: " +
      tables +
      " | List items: " +
      listItems,
  };
}

function handleLinks(content, fp) {
  const dir = path.dirname(fp);
  const links = [];
  let m,
    re = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = re.exec(content)) !== null) {
    if (m.index > 0 && content[m.index - 1] === "!") {
      continue;
    }
    links.push({
      text: m[1],
      url: m[2],
      line: content.substring(0, m.index).split("\n").length,
    });
  }
  re = /<(https?:\/\/[^>]+)>/g;
  while ((m = re.exec(content)) !== null) {
    links.push({
      text: m[1],
      url: m[1],
      line: content.substring(0, m.index).split("\n").length,
    });
  }

  const localValid = [],
    localBroken = [],
    external = [];
  for (const lnk of links) {
    const u = lnk.url;
    if (u.startsWith("#")) {
      localValid.push({ ...lnk, status: "anchor" });
      continue;
    }
    if (/^https?:\/\//.test(u) || u.startsWith("//") || /^[a-z]+:/.test(u)) {
      external.push({ ...lnk, status: "external" });
      continue;
    }
    const lp = path.resolve(dir, u.split("#")[0]);
    if (fs.existsSync(lp)) {
      localValid.push({ ...lnk, status: "valid", resolvedPath: lp });
    } else {
      localBroken.push({ ...lnk, status: "broken", resolvedPath: lp });
    }
  }

  let msg =
    "Link Check Report\n" +
    "=".repeat(30) +
    "\nFile: " +
    path.basename(fp) +
    "\nTotal: " +
    links.length +
    " | Valid: " +
    localValid.length +
    " | Broken: " +
    localBroken.length +
    " | External: " +
    external.length;
  if (localBroken.length) {
    msg +=
      "\n\nBroken Links:\n" +
      localBroken
        .map((l) => "  - Line " + l.line + ": [" + l.text + "](" + l.url + ")")
        .join("\n");
  }
  if (external.length) {
    msg +=
      "\n\nExternal (not checked):\n" +
      external
        .slice(0, 20)
        .map((l) => "  - " + l.url)
        .join("\n") +
      (external.length > 20
        ? "\n  ... +" + (external.length - 20) + " more"
        : "");
  }

  return {
    success: true,
    result: { totalLinks: links.length, localValid, localBroken, external },
    message: msg,
  };
}

function handleLint(content, fp) {
  const lines = content.split("\n"),
    issues = [],
    seen = [];
  let prevLvl = 0,
    inCode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      ln = i + 1;
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      continue;
    }

    // Trailing whitespace
    if (/\s+$/.test(line) && line.trim().length) {
      issues.push({
        line: ln,
        rule: "no-trailing-spaces",
        message: "Trailing whitespace",
        severity: "warning",
      });
    }
    // Heading checks
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      const lvl = hm[1].length,
        txt = hm[2].trim();
      if (i > 0 && lines[i - 1].trim().length) {
        issues.push({
          line: ln,
          rule: "blanks-around-headings",
          message: "Missing blank line before heading",
          severity: "warning",
        });
      }
      if (prevLvl > 0 && lvl > prevLvl + 1) {
        issues.push({
          line: ln,
          rule: "heading-increment",
          message: "Heading level skipped: H" + prevLvl + " -> H" + lvl,
          severity: "error",
        });
      }
      prevLvl = lvl;
      if (seen.includes(txt)) {
        issues.push({
          line: ln,
          rule: "no-duplicate-heading",
          message: 'Duplicate heading: "' + txt + '"',
          severity: "warning",
        });
      }
      seen.push(txt);
    }
    // Images without alt text
    for (const img of [...line.matchAll(/!\[(.*?)\]\([^)]+\)/g)]) {
      if (!img[1]?.trim()) {
        issues.push({
          line: ln,
          rule: "no-alt-text",
          message: "Image without alt text",
          severity: "warning",
        });
      }
    }
    // Bare URLs
    for (const bare of [...line.matchAll(/(?<!\(|<)https?:\/\/\S+(?![)>])/g)]) {
      const before = line.substring(0, bare.index);
      if (!before.endsWith("](") && !before.endsWith("<")) {
        issues.push({
          line: ln,
          rule: "no-bare-urls",
          message: "Bare URL (use [text](url) or <url>)",
          severity: "info",
        });
      }
    }
  }

  const errs = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  let msg =
    "Markdown Lint Report\n" +
    "=".repeat(30) +
    "\nFile: " +
    path.basename(fp) +
    "\nIssues: " +
    issues.length +
    " (" +
    errs +
    " errors, " +
    warns +
    " warnings, " +
    infos +
    " info)";
  if (issues.length) {
    msg +=
      "\n\n" +
      issues
        .map(
          (i) =>
            "  Line " +
            i.line +
            " [" +
            i.severity.toUpperCase() +
            "] " +
            i.rule +
            ": " +
            i.message,
        )
        .join("\n");
  } else {
    msg += "\n\nNo issues found!";
  }

  return {
    success: true,
    result: { issues, errors: errs, warnings: warns, infos },
    message: msg,
  };
}

function handleFormatTables(content, fp) {
  const lines = content.split("\n"),
    result = [];
  let tblLines = [],
    count = 0;

  function flush() {
    if (tblLines.length < 2) {
      result.push(...tblLines);
      tblLines = [];
      return;
    }
    const rows = tblLines.map((l) =>
      l
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((c) => c.trim()),
    );
    const cols = Math.max(...rows.map((r) => r.length));
    const widths = new Array(cols).fill(3);
    rows.forEach((r) =>
      r.forEach((c, i) => {
        if (c.length > widths[i]) {
          widths[i] = c.length;
        }
      }),
    );

    rows.forEach((row) => {
      const isSep = row.every((c) => /^[-:]+$/.test(c));
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const val = row[c] || "";
        if (isSep) {
          const orig = val || "---";
          const la = orig.startsWith(":"),
            ra = orig.endsWith(":");
          cells.push(
            la && ra
              ? ":" + "-".repeat(widths[c] - 2) + ":"
              : la
                ? ":" + "-".repeat(widths[c] - 1)
                : ra
                  ? "-".repeat(widths[c] - 1) + ":"
                  : "-".repeat(widths[c]),
          );
        } else {
          cells.push(val + " ".repeat(widths[c] - val.length));
        }
      }
      result.push("| " + cells.join(" | ") + " |");
    });
    count++;
    tblLines = [];
  }

  lines.forEach((l) => {
    /^\s*\|/.test(l) ? tblLines.push(l) : (flush(), result.push(l));
  });
  flush();

  if (count > 0) {
    try {
      fs.writeFileSync(fp, result.join("\n"), "utf-8");
    } catch (e) {
      return {
        success: false,
        error: e.message,
        message: "Write failed: " + e.message,
      };
    }
  }
  return {
    success: true,
    result: { tablesFormatted: count, filePath: fp },
    message:
      "Table Formatting\n" +
      "=".repeat(30) +
      "\nFile: " +
      path.basename(fp) +
      "\nTables formatted: " +
      count +
      (count > 0 ? " (file updated)" : " (no tables found)"),
  };
}

function handleToHtml(content, fp, outputPath) {
  let marked;
  try {
    marked = require("marked");
  } catch {
    return {
      success: false,
      error: "marked not available",
      message: "Install marked: npm install marked",
    };
  }

  const title = path.basename(fp, path.extname(fp));
  const body =
    typeof marked.parse === "function"
      ? marked.parse(content)
      : typeof marked === "function"
        ? marked(content)
        : null;
  if (!body) {
    return {
      success: false,
      error: "marked API not recognized",
      message: "Incompatible marked version",
    };
  }

  const css =
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:900px;margin:0 auto;padding:2rem;line-height:1.6;color:#333}" +
    "pre{background:#f5f5f5;padding:1rem;border-radius:4px;overflow-x:auto}" +
    "code{background:#f0f0f0;padding:.2rem .4rem;border-radius:3px;font-size:.9em}pre code{background:none;padding:0}" +
    "table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #ddd;padding:.5rem .8rem;text-align:left}th{background:#f5f5f5}" +
    "blockquote{border-left:4px solid #ddd;margin:1rem 0;padding:.5rem 1rem;color:#666}img{max-width:100%}";

  const html =
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1.0">\n<title>' +
    title +
    "</title>\n<style>" +
    css +
    "</style>\n</head>\n<body>\n" +
    body +
    "\n</body>\n</html>\n";

  if (!outputPath) {
    outputPath = fp.replace(/\.(md|markdown|mdx)$/i, ".html");
  }
  try {
    fs.writeFileSync(outputPath, html, "utf-8");
  } catch (e) {
    return {
      success: false,
      error: e.message,
      message: "Write failed: " + e.message,
    };
  }

  return {
    success: true,
    result: { outputPath, htmlLength: html.length },
    message:
      "HTML Conversion\n" +
      "=".repeat(30) +
      "\nSource: " +
      path.basename(fp) +
      "\nOutput: " +
      path.basename(outputPath) +
      "\nSize: " +
      html.length +
      " bytes",
  };
}

// ── Handler ──────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[markdown-enhancer] init: " + (_skill?.name || "markdown-enhancer"),
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
    const { action, filePath, outputPath } = parseInput(input, projectRoot);

    logger.info("[markdown-enhancer] Action: " + action, {
      filePath,
      outputPath,
    });

    try {
      const file = readMd(filePath);
      if (file.error) {
        return { success: false, error: file.error, message: file.error };
      }
      switch (action) {
        case "toc":
          return handleToc(file.content, filePath);
        case "stats":
          return handleStats(file.content, filePath);
        case "links":
          return handleLinks(file.content, filePath);
        case "lint":
          return handleLint(file.content, filePath);
        case "format-tables":
          return handleFormatTables(file.content, filePath);
        case "to-html":
          return handleToHtml(file.content, filePath, outputPath);
        default:
          return {
            success: false,
            error: "Unknown action: " + action,
            message:
              "Unknown action: " +
              action +
              ". Available: --toc, --stats, --links, --lint, --format-tables, --to-html",
          };
      }
    } catch (err) {
      logger.error("[markdown-enhancer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Markdown enhancer failed: " + err.message,
      };
    }
  },
};
