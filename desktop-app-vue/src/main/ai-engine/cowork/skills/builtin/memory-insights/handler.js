/**
 * Memory Insights Skill Handler
 *
 * Knowledge base analytics and health monitoring. Scans
 * .chainlesschain/memory/ for overviews, health scores,
 * keywords, trends, gaps, and comprehensive reports.
 */
const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "that",
  "this",
  "was",
  "are",
  "be",
  "has",
  "had",
  "have",
  "not",
  "no",
  "do",
  "does",
  "did",
  "will",
  "can",
  "could",
  "would",
  "should",
  "may",
  "might",
  "its",
  "as",
  "if",
  "then",
  "than",
  "so",
  "up",
  "out",
  "about",
  "into",
  "over",
  "after",
  "before",
  "between",
  "under",
  "above",
  "each",
  "every",
  "all",
  "any",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "only",
  "own",
  "same",
  "very",
  "just",
  "also",
  "now",
  "here",
  "there",
  "when",
  "where",
  "how",
  "what",
  "which",
  "who",
  "whom",
  "why",
  "been",
  "being",
  "were",
  "he",
  "she",
  "they",
  "we",
  "you",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "our",
  "their",
  "true",
  "false",
  "null",
  "undefined",
  "new",
  "var",
  "let",
  "const",
  "function",
  "return",
  "class",
  "import",
  "export",
  "require",
  "module",
  "use",
  "get",
  "set",
]);
const EXPECTED_DIRS = ["daily"];

function memRoot(projectRoot) {
  return path.join(projectRoot, ".chainlesschain", "memory");
}

function collectFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  (function walk(d, depth) {
    if (depth > 5) {
      return;
    }
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      try {
        const s = fs.statSync(full);
        out.push({
          path: full,
          name: e.name,
          ext: path.extname(e.name).toLowerCase(),
          size: s.size,
          mtimeMs: s.mtimeMs,
          mtime: s.mtime,
          ctimeMs: s.ctimeMs,
        });
      } catch {
        /* skip */
      }
    }
  })(dir, 0);
  return out;
}

function fmtBytes(b) {
  if (b === 0) {
    return "0 B";
  }
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
}
function fmtDate(d) {
  return d.toISOString().split("T")[0];
}
function readText(p) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

// ── overview ─────────────────────────────────────────────────────────
function analyzeOverview(root) {
  const files = collectFiles(root);
  const exists = fs.existsSync(root);
  if (!files.length) {
    return {
      totalFiles: 0,
      totalSizeFormatted: "0 B",
      typeDistribution: {},
      lastModified: null,
      oldestFile: null,
      directoryExists: exists,
    };
  }
  const types = {};
  let sz = 0,
    newestMs = 0,
    oldestMs = Infinity,
    newest = null,
    oldest = null;
  for (const f of files) {
    sz += f.size;
    types[f.ext || "(none)"] = (types[f.ext || "(none)"] || 0) + 1;
    if (f.mtimeMs > newestMs) {
      newestMs = f.mtimeMs;
      newest = f;
    }
    if (f.mtimeMs < oldestMs) {
      oldestMs = f.mtimeMs;
      oldest = f;
    }
  }
  const ref = (f) =>
    f ? { file: path.basename(f.path), date: fmtDate(f.mtime) } : null;
  return {
    totalFiles: files.length,
    totalSizeFormatted: fmtBytes(sz),
    typeDistribution: types,
    lastModified: ref(newest),
    oldestFile: ref(oldest),
    directoryExists: true,
  };
}

// ── health ───────────────────────────────────────────────────────────
function analyzeHealth(root) {
  if (!fs.existsSync(root)) {
    return {
      score: 0,
      issues: [
        {
          type: "missing-root",
          message: "Memory directory does not exist",
          penalty: -100,
        },
      ],
      recommendations: [
        "Create .chainlesschain/memory/ and start adding notes.",
      ],
    };
  }
  const files = collectFiles(root);
  let score = 100;
  const issues = [],
    recs = [];
  const now = Date.now(),
    D30 = 2592000000,
    D7 = 604800000;
  const stale = files.filter((f) => now - f.mtimeMs > D30);
  if (stale.length) {
    const p = Math.min(25, stale.length * 5);
    score -= p;
    issues.push({
      type: "stale-files",
      count: stale.length,
      files: stale.slice(0, 5).map((f) => f.name),
      message: stale.length + " file(s) not modified in 30+ days",
      penalty: -p,
    });
    recs.push("Review and update stale memory files or archive them.");
  }
  const empty = files.filter((f) => f.size === 0);
  if (empty.length) {
    const p = Math.min(30, empty.length * 10);
    score -= p;
    issues.push({
      type: "empty-files",
      count: empty.length,
      files: empty.map((f) => f.name),
      message: empty.length + " empty file(s) found",
      penalty: -p,
    });
    recs.push("Remove or populate empty memory files.");
  }
  for (const dir of EXPECTED_DIRS) {
    if (!fs.existsSync(path.join(root, dir))) {
      score -= 10;
      issues.push({
        type: "missing-directory",
        directory: dir,
        message: "Expected directory '" + dir + "/' is missing",
        penalty: -10,
      });
    }
  }
  if (files.length < 3) {
    score -= 15;
    issues.push({
      type: "low-file-count",
      count: files.length,
      message: "Fewer than 3 memory files (found " + files.length + ")",
      penalty: -15,
    });
    recs.push(
      "Add more notes and knowledge entries to build your memory base.",
    );
  }
  const recent = files.filter((f) => now - f.mtimeMs < D7);
  if (recent.length) {
    score = Math.min(100, score + 10);
    issues.push({
      type: "recent-activity",
      count: recent.length,
      message: recent.length + " file(s) modified in the last 7 days",
      penalty: 10,
    });
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
    recommendations: recs,
  };
}

// ── keywords ─────────────────────────────────────────────────────────
function extractKeywords(root, topN) {
  const files = collectFiles(root),
    freq = {};
  const textExts = new Set([".md", ".txt", ".json"]);
  const scannable = files.filter((f) => textExts.has(f.ext));
  for (const f of scannable) {
    const c = readText(f.path);
    if (!c) {
      continue;
    }
    for (const w of c.match(/[a-zA-Z\u4e00-\u9fff]{2,}/g) || []) {
      const lw = w.toLowerCase();
      if (!STOP_WORDS.has(lw) && lw.length >= 3) {
        freq[lw] = (freq[lw] || 0) + 1;
      }
    }
  }
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  return {
    totalUniqueWords: Object.keys(freq).length,
    topKeywords: sorted.map(([word, count]) => ({ word, count })),
    filesScanned: scannable.length,
  };
}

// ── trends ───────────────────────────────────────────────────────────
function analyzeTrends(root) {
  const files = collectFiles(root),
    now = Date.now(),
    W = 604800000;
  const weeks = [];
  for (let i = 0; i < 5; i++) {
    const s = now - (i + 1) * W,
      e = now - i * W;
    weeks.push({
      label:
        "Week " +
        (i + 1) +
        " (" +
        fmtDate(new Date(s)) +
        " - " +
        fmtDate(new Date(e)) +
        ")",
      start: s,
      end: e,
      created: 0,
      modified: 0,
    });
  }
  for (const f of files) {
    for (const w of weeks) {
      if (f.ctimeMs >= w.start && f.ctimeMs < w.end) {
        w.created++;
      }
      if (f.mtimeMs >= w.start && f.mtimeMs < w.end) {
        w.modified++;
      }
    }
  }
  weeks.reverse();
  const tc = weeks.reduce((s, w) => s + w.created, 0),
    tm = weeks.reduce((s, w) => s + w.modified, 0);
  return {
    period: "Last 30 days",
    weeks: weeks.map((w) => ({
      label: w.label,
      created: w.created,
      modified: w.modified,
    })),
    summary: {
      totalCreated: tc,
      totalModified: tm,
      activeFiles: files.filter((f) => now - f.mtimeMs < 2592000000).length,
      totalFiles: files.length,
    },
  };
}

// ── gaps ─────────────────────────────────────────────────────────────
function analyzeGaps(root) {
  const files = collectFiles(root),
    mentions = {};
  const textFiles = files.filter((f) => f.ext === ".md" || f.ext === ".txt");
  for (const f of textFiles) {
    const c = readText(f.path);
    if (!c) {
      continue;
    }
    for (const w of c.match(/[a-zA-Z]{3,}/g) || []) {
      const lw = w.toLowerCase();
      if (STOP_WORDS.has(lw) || lw.length < 4) {
        continue;
      }
      if (!mentions[lw]) {
        mentions[lw] = { count: 0, files: new Set() };
      }
      mentions[lw].count++;
      mentions[lw].files.add(f.name);
    }
  }
  const names = files.map((f) =>
    path.basename(f.path, path.extname(f.path)).toLowerCase(),
  );
  const gaps = [];
  for (const [topic, d] of Object.entries(mentions)) {
    if (d.count < 5 || d.files.size < 2) {
      continue;
    }
    if (!names.some((n) => n.includes(topic) || topic.includes(n))) {
      gaps.push({
        topic,
        mentions: d.count,
        acrossFiles: d.files.size,
        fileList: [...d.files].slice(0, 5),
      });
    }
  }
  gaps.sort((a, b) => b.mentions - a.mentions);
  return {
    totalGaps: gaps.length,
    gaps: gaps.slice(0, 20),
    totalTopicsAnalyzed: Object.keys(mentions).length,
    filesAnalyzed: textFiles.length,
  };
}

// ── report ───────────────────────────────────────────────────────────
function generateReport(root, outputFile) {
  const ov = analyzeOverview(root),
    hl = analyzeHealth(root),
    kw = extractKeywords(root, 20),
    tr = analyzeTrends(root),
    gp = analyzeGaps(root);
  const ts = new Date().toISOString();
  let t = "# Memory Insights Report\nGenerated: " + ts + "\n\n";
  t +=
    "## Overview\n- Total files: " +
    ov.totalFiles +
    "\n- Total size: " +
    ov.totalSizeFormatted +
    "\n";
  t +=
    "- File types: " +
    Object.entries(ov.typeDistribution)
      .map(([k, v]) => k + " (" + v + ")")
      .join(", ") +
    "\n";
  if (ov.lastModified) {
    t +=
      "- Last modified: " +
      ov.lastModified.file +
      " (" +
      ov.lastModified.date +
      ")\n";
  }
  t += "\n## Health Score: " + hl.score + "/100\n";
  for (const i of hl.issues) {
    t += "- " + (i.penalty > 0 ? "[+] " : "[-] ") + i.message + "\n";
  }
  if (hl.recommendations.length) {
    t += "\nRecommendations:\n";
    for (const r of hl.recommendations) {
      t += "  - " + r + "\n";
    }
  }
  t += "\n## Top Keywords\n";
  for (const k of kw.topKeywords.slice(0, 15)) {
    t += "- " + k.word + " (" + k.count + ")\n";
  }
  t += "\n## Activity Trends (Last 30 Days)\n";
  for (const w of tr.weeks) {
    t +=
      "- " +
      w.label +
      ": " +
      w.created +
      " created, " +
      w.modified +
      " modified\n";
  }
  t += "\n## Knowledge Gaps\n";
  if (!gp.gaps.length) {
    t += "No significant gaps detected.\n";
  } else {
    for (const g of gp.gaps.slice(0, 10)) {
      t +=
        "- '" +
        g.topic +
        "': " +
        g.mentions +
        " mentions across " +
        g.acrossFiles +
        " files\n";
    }
  }
  const report = {
    title: "Memory Insights Report",
    generated: ts,
    overview: ov,
    health: hl,
    keywords: kw,
    trends: tr,
    gaps: gp,
    text: t,
  };
  if (outputFile) {
    try {
      const p = path.isAbsolute(outputFile)
        ? outputFile
        : path.join(root, outputFile);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, t, "utf-8");
      report.outputFile = p;
    } catch (e) {
      report.outputError = "Failed to write report: " + e.message;
    }
  }
  return report;
}

// ── Handler ──────────────────────────────────────────────────────────
module.exports = {
  async init(skill) {
    logger.info(
      "[memory-insights] init: " + (skill?.name || "memory-insights"),
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
    const root = memRoot(projectRoot);
    logger.info("[memory-insights] execute: input=" + input.substring(0, 80));
    try {
      const topN = (input.match(/--top\s+(\d+)/i) || [])[1]
        ? parseInt(RegExp.$1, 10)
        : 10;
      const outFile = (input.match(/--output\s+(\S+)/i) || [])[1] || null;

      if (/--health/i.test(input)) {
        const h = analyzeHealth(root);
        let m = "Health Score: " + h.score + "/100\n" + "=".repeat(30) + "\n";
        for (const i of h.issues) {
          m += (i.penalty > 0 ? "[+] " : "[-] ") + i.message + "\n";
        }
        if (h.recommendations.length) {
          m += "\nRecommendations:\n";
          for (const r of h.recommendations) {
            m += "  - " + r + "\n";
          }
        }
        return { success: true, result: h, message: m };
      }
      if (/--keywords/i.test(input)) {
        const k = extractKeywords(root, topN);
        let m = "Top " + topN + " Keywords\n" + "=".repeat(25) + "\n";
        if (!k.topKeywords.length) {
          m += "No keywords found. Memory directory may be empty.\n";
        } else {
          for (const i of k.topKeywords) {
            m += "  " + i.word + " (" + i.count + ")\n";
          }
        }
        m +=
          "\nScanned " +
          k.filesScanned +
          " files, " +
          k.totalUniqueWords +
          " unique words.";
        return { success: true, result: k, message: m };
      }
      if (/--trends/i.test(input)) {
        const tr = analyzeTrends(root);
        let m = "Activity Trends (" + tr.period + ")\n" + "=".repeat(40) + "\n";
        for (const w of tr.weeks) {
          m +=
            w.label +
            ": " +
            w.created +
            " created, " +
            w.modified +
            " modified\n";
        }
        m +=
          "\nSummary: " +
          tr.summary.totalCreated +
          " created, " +
          tr.summary.totalModified +
          " modified, " +
          tr.summary.activeFiles +
          "/" +
          tr.summary.totalFiles +
          " active.";
        return { success: true, result: tr, message: m };
      }
      if (/--gaps/i.test(input)) {
        const g = analyzeGaps(root);
        let m = "Knowledge Gaps Analysis\n" + "=".repeat(30) + "\n";
        if (!g.gaps.length) {
          m +=
            "No significant gaps detected in " + g.filesAnalyzed + " files.\n";
        } else {
          m += "Found " + g.totalGaps + " potential gaps:\n";
          for (const x of g.gaps.slice(0, 15)) {
            m +=
              "  '" +
              x.topic +
              "': " +
              x.mentions +
              " mentions across " +
              x.acrossFiles +
              " files\n";
          }
        }
        m +=
          "\nAnalyzed " +
          g.totalTopicsAnalyzed +
          " topics across " +
          g.filesAnalyzed +
          " files.";
        return { success: true, result: g, message: m };
      }
      if (/--report/i.test(input)) {
        const r = generateReport(root, outFile);
        let m = r.text;
        if (r.outputFile) {
          m += "\nReport saved to: " + r.outputFile;
        }
        if (r.outputError) {
          m += "\n" + r.outputError;
        }
        return { success: true, result: r, message: m };
      }
      // Default: --overview
      const ov = analyzeOverview(root);
      let m = "Memory Overview\n" + "=".repeat(25) + "\n";
      if (!ov.directoryExists) {
        m +=
          "Memory directory not found at: " +
          root +
          "\nCreate the directory to start using the memory system.";
        return { success: true, result: ov, message: m };
      }
      m +=
        "Total files: " +
        ov.totalFiles +
        "\nTotal size: " +
        ov.totalSizeFormatted +
        "\nFile types:\n";
      for (const [ext, cnt] of Object.entries(ov.typeDistribution)) {
        m += "  " + ext + ": " + cnt + " file(s)\n";
      }
      if (ov.lastModified) {
        m +=
          "Last modified: " +
          ov.lastModified.file +
          " (" +
          ov.lastModified.date +
          ")\n";
      }
      if (ov.oldestFile) {
        m +=
          "Oldest file: " +
          ov.oldestFile.file +
          " (" +
          ov.oldestFile.date +
          ")\n";
      }
      return { success: true, result: ov, message: m };
    } catch (err) {
      logger.error("[memory-insights] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Memory insights failed: " + err.message,
      };
    }
  },
};
