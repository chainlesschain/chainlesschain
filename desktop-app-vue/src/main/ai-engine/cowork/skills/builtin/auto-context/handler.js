/**
 * Auto Context Skill Handler
 *
 * Automatically detects relevant files, functions, and context
 * for a given query, with token budget management.
 * Modes: --detect, --budget, --files
 */

const { execSync } = require("child_process");
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
]);
const DEFAULT_BUDGET = 4096;

// ── Keyword mappings ────────────────────────────────────────────────

const KEYWORD_MAPPINGS = {
  // Feature keywords → directory/file patterns
  webrtc: ["webrtc", "p2p", "signaling", "ice", "data-channel"],
  auth: [
    "auth",
    "sso",
    "login",
    "token",
    "session",
    "identity",
    "oauth",
    "saml",
  ],
  permission: ["permission", "rbac", "role", "access", "team", "delegation"],
  database: ["database", "sqlite", "db", "migration", "schema", "query"],
  rag: ["rag", "search", "embedding", "vector", "bm25", "hybrid"],
  skill: ["skill", "cowork", "handler", "builtin", "SKILL.md"],
  mcp: ["mcp", "protocol", "server-builder", "community-registry"],
  hook: ["hook", "middleware", "event", "trigger"],
  browser: ["browser", "automation", "puppeteer", "element", "locator"],
  llm: ["llm", "ai", "model", "prompt", "conversation", "context"],
  memory: ["memory", "permanent", "daily", "clawdbot"],
  ui: ["vue", "component", "page", "store", "pinia", "renderer"],
  ipc: ["ipc", "handler", "electron", "main-process"],
  test: ["test", "spec", "vitest", "jest", "mock", "coverage"],
  security: ["security", "audit", "vulnerability", "owasp", "xss", "injection"],
  deploy: ["deploy", "docker", "ci", "cd", "pipeline", "release"],
  error: ["error", "bug", "fix", "crash", "exception", "debug"],
  config: ["config", "setting", "env", "environment"],
  audit: ["audit", "compliance", "gdpr", "soc2", "logging"],
  marketplace: ["marketplace", "plugin", "install", "update"],
  agent: ["agent", "coordinator", "template", "multi-agent"],
  "computer-use": [
    "computer-use",
    "desktop",
    "screenshot",
    "vision",
    "coordinate",
  ],
  p2p: ["p2p", "peer", "libp2p", "signal", "mesh"],
  did: ["did", "identity", "decentralized", "key"],
};

let tokenBudget = DEFAULT_BUDGET;

// ── Helpers ─────────────────────────────────────────────────────────

function estimateTokens(text) {
  // Rough estimation: ~4 chars per token for English, ~2 for Chinese
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = text.length - chinese;
  return Math.ceil(other / 4 + chinese / 2);
}

function extractQueryKeywords(query) {
  const words = query
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const expanded = new Set(words);

  // Expand via keyword mappings
  for (const word of words) {
    for (const [key, patterns] of Object.entries(KEYWORD_MAPPINGS)) {
      if (patterns.some((p) => word.includes(p) || p.includes(word))) {
        patterns.forEach((p) => expanded.add(p));
        expanded.add(key);
      }
    }
  }

  return [...expanded];
}

function collectSourceFiles(dir) {
  const results = [];
  function walk(d, depth) {
    if (results.length >= 2000 || depth > 10) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const ent of entries) {
      if (results.length >= 2000) {
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

function getRecentlyModified(projectRoot) {
  try {
    const output = execSync(
      "git log --diff-filter=M --name-only --pretty=format: -n 20",
      {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 5000,
      },
    );
    return output
      .split("\n")
      .filter(Boolean)
      .map((f) => f.trim());
  } catch (_e) {
    return [];
  }
}

function scoreFile(filePath, keywords, recentFiles, projectRoot) {
  const relPath = path
    .relative(projectRoot, filePath)
    .replace(/\\/g, "/")
    .toLowerCase();
  let score = 0;

  // Path matching (high weight)
  for (const kw of keywords) {
    if (relPath.includes(kw)) {
      score += 3;
    }
  }

  // File name matching (highest weight)
  const fileName = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase();
  for (const kw of keywords) {
    if (fileName.includes(kw)) {
      score += 5;
    }
    if (fileName === kw) {
      score += 3;
    }
  }

  // Recently modified bonus
  if (recentFiles.some((f) => relPath.includes(f.toLowerCase()))) {
    score += 2;
  }

  // Content matching (scan first 100 lines)
  if (score > 0) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const head = content.split("\n").slice(0, 100).join(" ").toLowerCase();
      for (const kw of keywords) {
        const matches = (
          head.match(
            new RegExp(
              "\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
              "g",
            ),
          ) || []
        ).length;
        score += Math.min(matches, 3);
      }
    } catch (_e) {
      /* skip */
    }
  }

  return score;
}

function selectFilesWithinBudget(scoredFiles, budget, projectRoot) {
  const selected = [];
  let usedTokens = 0;

  for (const { filePath, score } of scoredFiles) {
    if (usedTokens >= budget) {
      break;
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const tokens = estimateTokens(content);
      if (usedTokens + tokens <= budget) {
        selected.push({
          file: path.relative(projectRoot, filePath).replace(/\\/g, "/"),
          score: Math.round(score * 10) / 10,
          tokens,
          lines: content.split("\n").length,
        });
        usedTokens += tokens;
      } else if (usedTokens + 500 <= budget) {
        // Include partial (first 500 tokens worth)
        const partialLines = Math.min(
          content.split("\n").length,
          Math.ceil((500 * 4) / 60),
        );
        selected.push({
          file: path.relative(projectRoot, filePath).replace(/\\/g, "/"),
          score: Math.round(score * 10) / 10,
          tokens: 500,
          lines: partialLines,
          partial: true,
        });
        usedTokens += 500;
      }
    } catch (_e) {
      /* skip */
    }
  }

  return { selected, usedTokens };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info("[auto-context] init: " + (_skill?.name || "auto-context"));
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
    const detectMatch = input.match(/--detect\s+(.+)/is);
    const budgetMatch = input.match(/--budget\s+(\d+)/i);
    const filesMatch = input.match(/--files\s+(.+)/is);

    try {
      if (budgetMatch) {
        const newBudget = parseInt(budgetMatch[1]);
        if (newBudget < 500) {
          return {
            success: false,
            message: "Budget too low. Minimum: 500 tokens.",
          };
        }
        if (newBudget > 100000) {
          return {
            success: false,
            message: "Budget too high. Maximum: 100,000 tokens.",
          };
        }
        tokenBudget = newBudget;
        return {
          success: true,
          result: { budget: tokenBudget },
          message: "Token budget set to " + tokenBudget + " tokens.",
        };
      }

      const query = detectMatch
        ? detectMatch[1].trim()
        : filesMatch
          ? filesMatch[1].trim()
          : input;
      if (!query) {
        return {
          success: false,
          error:
            "No query provided. Usage: /auto-context --detect <query> | --files <query> | --budget <tokens>",
          message:
            "Usage: /auto-context --detect <query> | --files <query> | --budget <tokens>",
        };
      }

      const keywords = extractQueryKeywords(query);
      const allFiles = collectSourceFiles(projectRoot);
      const recentFiles = getRecentlyModified(projectRoot);

      // Score all files
      const scored = allFiles
        .map((filePath) => ({
          filePath,
          score: scoreFile(filePath, keywords, recentFiles, projectRoot),
        }))
        .filter((f) => f.score > 0)
        .sort((a, b) => b.score - a.score);

      if (filesMatch) {
        // --files: just list files with scores
        const top = scored.slice(0, 20).map((f) => ({
          file: path.relative(projectRoot, f.filePath).replace(/\\/g, "/"),
          score: Math.round(f.score * 10) / 10,
        }));
        let msg = "Files for: " + query + "\n" + "=".repeat(30) + "\n";
        msg += "Keywords: " + keywords.slice(0, 10).join(", ") + "\n";
        msg += "Found " + scored.length + " relevant files:\n";
        msg += top
          .map((f) => "  " + f.file + " (score: " + f.score + ")")
          .join("\n");
        return {
          success: true,
          result: { files: top, keywords, totalMatches: scored.length },
          message: msg,
        };
      }

      // --detect: select files within budget
      const { selected, usedTokens } = selectFilesWithinBudget(
        scored,
        tokenBudget,
        projectRoot,
      );

      let msg = "Auto Context: " + query + "\n" + "=".repeat(30) + "\n";
      msg += "Keywords: " + keywords.slice(0, 10).join(", ") + "\n";
      msg += "Budget: " + tokenBudget + " tokens, used: " + usedTokens + "\n";
      msg += "Selected " + selected.length + " files:\n";
      msg += selected
        .map(
          (f) =>
            "  " +
            f.file +
            " (score: " +
            f.score +
            ", " +
            f.tokens +
            " tokens" +
            (f.partial ? ", partial" : "") +
            ")",
        )
        .join("\n");

      return {
        success: true,
        result: {
          files: selected,
          totalTokens: usedTokens,
          budget: tokenBudget,
          keywords,
          totalMatches: scored.length,
        },
        message: msg,
      };
    } catch (err) {
      logger.error("[auto-context] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Auto context failed: " + err.message,
      };
    }
  },
};
