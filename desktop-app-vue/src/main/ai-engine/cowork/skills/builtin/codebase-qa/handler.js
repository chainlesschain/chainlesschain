/**
 * Codebase Q&A Skill Handler
 *
 * Indexes source files, extracts symbols, and answers questions
 * about the codebase using keyword matching and TF-IDF ranking.
 * Modes: --ask, --index, --search
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const CODE_EXTS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".json",
  ".md",
]);
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".cache",
  ".next",
]);
const MAX_FILES = 2000;

// ── Index cache ─────────────────────────────────────────────────────

let cachedIndex = null;
let cachedRoot = null;

// ── Symbol extraction ───────────────────────────────────────────────

const SYMBOL_PATTERNS = [
  { type: "class", re: /\bclass\s+(\w+)/g },
  { type: "function", re: /\bfunction\s+(\w+)/g },
  {
    type: "const-fn",
    re: /\bconst\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(|=>)/g,
  },
  { type: "export", re: /\bmodule\.exports\s*=\s*\{([^}]+)\}/g },
  {
    type: "export-named",
    re: /\bexport\s+(?:const|function|class|let|var)\s+(\w+)/g,
  },
  { type: "method", re: /\b(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g },
];

function extractSymbols(content) {
  const symbols = [];
  for (const { type, re } of SYMBOL_PATTERNS) {
    const regex = new RegExp(re.source, re.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]?.trim();
      if (
        name &&
        name.length > 1 &&
        !/^(if|for|while|switch|catch|return|new|typeof|delete)$/.test(name)
      ) {
        const line = content.substring(0, match.index).split("\n").length;
        symbols.push({ name, type, line });
      }
    }
  }
  return symbols;
}

function extractFirstComment(content) {
  const blockMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (blockMatch) {
    return blockMatch[1]
      .replace(/^\s*\*\s?/gm, "")
      .trim()
      .substring(0, 200);
  }
  const lineMatch = content.match(/^\/\/\s*(.+)/m);
  return lineMatch ? lineMatch[1].trim().substring(0, 200) : "";
}

// ── File scanning ───────────────────────────────────────────────────

function collectFiles(dir, maxFiles) {
  maxFiles = maxFiles || MAX_FILES;
  const results = [];
  function walk(d, depth) {
    if (results.length >= maxFiles || depth > 10) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const ent of entries) {
      if (results.length >= maxFiles) {
        return;
      }
      if (IGNORE_DIRS.has(ent.name)) {
        continue;
      }
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (CODE_EXTS.has(path.extname(ent.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  walk(dir, 0);
  return results;
}

function buildIndex(projectRoot) {
  const files = collectFiles(projectRoot);
  const index = { files: [], totalSymbols: 0, totalFiles: files.length };

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (_e) {
      continue;
    }
    const relPath = path.relative(projectRoot, filePath);
    const symbols = extractSymbols(content);
    const comment = extractFirstComment(content);
    const lineCount = content.split("\n").length;

    index.files.push({
      path: relPath,
      symbols,
      comment,
      lineCount,
      keywords: extractKeywords(content, relPath),
    });
    index.totalSymbols += symbols.length;
  }

  cachedIndex = index;
  cachedRoot = projectRoot;
  return index;
}

function extractKeywords(content, filePath) {
  const words = new Set();
  // Add path segments
  filePath.split(/[/\\]/).forEach((seg) => {
    seg
      .replace(/[-_.]/g, " ")
      .split(/\s+/)
      .forEach((w) => {
        if (w.length > 2) {
          words.add(w.toLowerCase());
        }
      });
  });
  // Add identifiers from content
  const identifiers = content.match(/\b[a-zA-Z]\w{2,30}\b/g) || [];
  const freq = {};
  for (const id of identifiers) {
    const lower = id.toLowerCase();
    freq[lower] = (freq[lower] || 0) + 1;
  }
  // Top keywords by frequency
  Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([w]) => words.add(w));
  return [...words];
}

// ── Search & QA ─────────────────────────────────────────────────────

function searchIndex(index, query) {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const scored = [];

  for (const file of index.files) {
    let score = 0;
    const matchedSymbols = [];

    // Path matching
    for (const term of queryTerms) {
      if (file.path.toLowerCase().includes(term)) {
        score += 3;
      }
    }

    // Symbol matching
    for (const sym of file.symbols) {
      for (const term of queryTerms) {
        if (sym.name.toLowerCase().includes(term)) {
          score += 5;
          matchedSymbols.push(sym);
        }
      }
    }

    // Keyword matching
    for (const term of queryTerms) {
      if (file.keywords.includes(term)) {
        score += 1;
      }
    }

    // Comment matching
    if (file.comment) {
      for (const term of queryTerms) {
        if (file.comment.toLowerCase().includes(term)) {
          score += 2;
        }
      }
    }

    if (score > 0) {
      scored.push({
        file: file.path,
        score,
        symbols: matchedSymbols,
        comment: file.comment,
        lineCount: file.lineCount,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

function answerQuestion(index, question, projectRoot) {
  const results = searchIndex(index, question);
  const topResults = results.slice(0, 10);

  if (topResults.length === 0) {
    return {
      answer:
        "No relevant files found for your question. Try rephrasing or use --index to rebuild the index.",
      references: [],
      confidence: 0,
    };
  }

  // Build answer from top results
  const references = topResults.map((r) => ({
    file: r.file,
    score: r.score,
    symbols: r.symbols.map(
      (s) => s.name + " (" + s.type + ", L" + s.line + ")",
    ),
    preview: r.comment || "(no description)",
  }));

  // Read snippets from top 3 files
  const snippets = [];
  for (const r of topResults.slice(0, 3)) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, r.file), "utf-8");
      const lines = content.split("\n");
      // Find most relevant section
      const queryTerms = question.toLowerCase().split(/\s+/);
      let bestLine = 0;
      let bestScore = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineScore = queryTerms.reduce(
          (s, t) => s + (lines[i].toLowerCase().includes(t) ? 1 : 0),
          0,
        );
        if (lineScore > bestScore) {
          bestScore = lineScore;
          bestLine = i;
        }
      }
      const start = Math.max(0, bestLine - 2);
      const end = Math.min(lines.length, bestLine + 8);
      snippets.push({
        file: r.file,
        lines: lines
          .slice(start, end)
          .map((l, i) => "L" + (start + i + 1) + ": " + l)
          .join("\n"),
      });
    } catch (_e) {
      /* skip */
    }
  }

  const confidence = Math.min(1, topResults[0].score / 15);
  let answer = "Based on " + topResults.length + " relevant files:\n\n";
  answer +=
    "Key files:\n" +
    topResults
      .slice(0, 5)
      .map(
        (r) =>
          "  - " +
          r.file +
          " (relevance: " +
          r.score +
          ")" +
          (r.symbols.length > 0
            ? " — " + r.symbols.map((s) => s.name).join(", ")
            : ""),
      )
      .join("\n");
  if (snippets.length > 0) {
    answer +=
      "\n\nCode context:\n" +
      snippets.map((s) => "--- " + s.file + " ---\n" + s.lines).join("\n\n");
  }

  return { answer, references, confidence: Math.round(confidence * 100) / 100 };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info("[codebase-qa] init: " + (_skill?.name || "codebase-qa"));
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
    const askMatch = input.match(/--ask\s+(.+)/is);
    const searchMatch = input.match(/--search\s+(.+)/i);
    const isIndex = /--index/i.test(input);

    try {
      // Ensure index exists
      if (!cachedIndex || cachedRoot !== projectRoot) {
        logger.info("[codebase-qa] Building index for " + projectRoot);
        buildIndex(projectRoot);
      }

      if (isIndex) {
        const index = buildIndex(projectRoot);
        const classCount = index.files.reduce(
          (s, f) => s + f.symbols.filter((sym) => sym.type === "class").length,
          0,
        );
        const funcCount = index.totalSymbols - classCount;
        const result = {
          totalFiles: index.totalFiles,
          indexedFiles: index.files.length,
          totalSymbols: index.totalSymbols,
          classes: classCount,
          functions: funcCount,
        };
        return {
          success: true,
          result,
          message:
            "Index Built\n" +
            "=".repeat(20) +
            "\nIndexed " +
            index.files.length +
            " files, extracted " +
            index.totalSymbols +
            " symbols (" +
            classCount +
            " classes, " +
            funcCount +
            " functions).",
        };
      }

      if (searchMatch) {
        const query = searchMatch[1].trim();
        const results = searchIndex(cachedIndex, query);
        const top = results.slice(0, 15);
        let msg =
          "Search: " + query + "\n" + "=".repeat(20 + query.length) + "\n";
        if (top.length === 0) {
          msg += "No results found.";
        } else {
          msg +=
            "Found " +
            results.length +
            " matches:\n" +
            top
              .map(
                (r) =>
                  "  " +
                  r.file +
                  (r.symbols.length > 0
                    ? " — " +
                      r.symbols
                        .map((s) => s.name + " (L" + s.line + ")")
                        .join(", ")
                    : ""),
              )
              .join("\n");
        }
        return { success: true, result: top, message: msg };
      }

      if (askMatch) {
        const question = askMatch[1].trim();
        const qa = answerQuestion(cachedIndex, question, projectRoot);
        const msg =
          "Q: " +
          question +
          "\n" +
          "=".repeat(40) +
          "\n\n" +
          qa.answer +
          "\n\nConfidence: " +
          (qa.confidence * 100).toFixed(0) +
          "%";
        return { success: true, result: qa, message: msg };
      }

      // No mode - treat as question
      if (input) {
        const qa = answerQuestion(cachedIndex, input, projectRoot);
        const msg =
          "Q: " +
          input +
          "\n" +
          "=".repeat(40) +
          "\n\n" +
          qa.answer +
          "\n\nConfidence: " +
          (qa.confidence * 100).toFixed(0) +
          "%";
        return { success: true, result: qa, message: msg };
      }

      return {
        success: false,
        error:
          "No query provided. Usage: /codebase-qa --ask <question> | --search <query> | --index",
        message:
          "Usage: /codebase-qa --ask <question> | --search <query> | --index",
      };
    } catch (err) {
      logger.error("[codebase-qa] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Codebase Q&A failed: " + err.message,
      };
    }
  },
};
