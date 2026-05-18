/**
 * Context Loader Skill Handler
 *
 * Intelligently pre-loads relevant source files into AI context
 * based on user intent analysis and keyword matching.
 * Manages a token budget to avoid overloading the context window.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// Keyword → module mapping for ChainlessChain project
const INTENT_MAP = {
  session: {
    dir: "llm",
    files: ["session-manager.js", "session-compressor.js"],
  },
  会话: { dir: "llm", files: ["session-manager.js", "session-compressor.js"] },
  memory: {
    dir: "llm",
    files: ["permanent-memory-manager.js", "permanent-memory-ipc.js"],
  },
  记忆: {
    dir: "llm",
    files: ["permanent-memory-manager.js", "permanent-memory-ipc.js"],
  },
  search: {
    dir: "rag",
    files: ["hybrid-search-engine.js", "bm25-search.js", "rag-manager.js"],
  },
  搜索: { dir: "rag", files: ["hybrid-search-engine.js", "bm25-search.js"] },
  p2p: {
    dir: "p2p",
    files: [
      "signaling-handlers.js",
      "webrtc-data-channel.js",
      "mobile-bridge.js",
    ],
  },
  webrtc: {
    dir: "p2p",
    files: ["webrtc-data-channel.js", "signaling-handlers.js"],
  },
  permission: {
    dir: "permission",
    files: ["permission-engine.js", "team-manager.js", "delegation-manager.js"],
  },
  权限: {
    dir: "permission",
    files: ["permission-engine.js", "team-manager.js"],
  },
  browser: {
    dir: "browser",
    files: ["browser-engine.js", "computer-use-agent.js", "element-locator.js"],
  },
  浏览器: {
    dir: "browser",
    files: ["browser-engine.js", "element-locator.js"],
  },
  skill: {
    dir: "ai-engine/cowork/skills",
    files: [
      "index.js",
      "skill-loader.js",
      "skill-md-parser.js",
      "markdown-skill.js",
    ],
  },
  技能: {
    dir: "ai-engine/cowork/skills",
    files: ["index.js", "skill-loader.js", "markdown-skill.js"],
  },
  mcp: { dir: "mcp", files: ["mcp-tool-adapter.js", "community-registry.js"] },
  audit: {
    dir: "audit",
    files: ["enterprise-audit-logger.js", "compliance-manager.js"],
  },
  审计: { dir: "audit", files: ["enterprise-audit-logger.js"] },
  hook: {
    dir: "hooks",
    files: ["index.js", "hook-registry.js", "hook-executor.js"],
  },
  context: {
    dir: "llm",
    files: ["context-engineering.js", "context-engineering-ipc.js"],
  },
  上下文: { dir: "llm", files: ["context-engineering.js"] },
  database: { dir: "", files: ["database.js"] },
  数据库: { dir: "", files: ["database.js"] },
  agent: {
    dir: "ai-engine/agents",
    files: ["agent-templates.js", "agent-coordinator.js", "agent-registry.js"],
  },
  cowork: {
    dir: "ai-engine/cowork",
    files: ["team-tool.js", "sandbox-manager.js"],
  },
  tool: {
    dir: "ai-engine",
    files: [
      "unified-tool-registry.js",
      "tool-skill-mapper.js",
      "function-caller.js",
    ],
  },
  工具: {
    dir: "ai-engine",
    files: ["unified-tool-registry.js", "tool-skill-mapper.js"],
  },
  auth: {
    dir: "auth",
    files: ["sso-manager.js", "oauth-provider.js", "identity-bridge.js"],
  },
  认证: { dir: "auth", files: ["sso-manager.js"] },
  marketplace: {
    dir: "marketplace",
    files: ["marketplace-client.js", "plugin-installer.js"],
  },
};

let tokenBudget = 6000;
let loadedContext = [];

module.exports = {
  async init(skill) {
    logger.info("[ContextLoader] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, param } = parseInput(input);

    logger.info(`[ContextLoader] Action: ${action}`, { param });

    try {
      switch (action) {
        case "prime":
          return await handlePrime(param, context);
        case "budget":
          return handleBudget(param);
        case "status":
          return handleStatus();
        case "clear":
          return handleClear();
        default:
          if (param) {
            return await handlePrime(param, context);
          }
          return {
            success: true,
            message:
              "Usage: /context-loader prime <topic> | budget <n> | status | clear",
          };
      }
    } catch (error) {
      logger.error(`[ContextLoader] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Context loading failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input) {
  const parts = (input || "").trim().split(/\s+/);
  let action = "prime";
  let param = "";

  if (parts[0] === "prime") {
    action = "prime";
    param = parts
      .slice(1)
      .join(" ")
      .replace(/^["']|["']$/g, "");
  } else if (parts[0] === "budget") {
    action = "budget";
    param = parts[1] || "6000";
  } else if (parts[0] === "status") {
    action = "status";
  } else if (parts[0] === "clear") {
    action = "clear";
  } else {
    param = parts.join(" ").replace(/^["']|["']$/g, "");
  }

  return { action, param };
}

function estimateTokens(text) {
  // Rough estimate: ~4 chars per token for mixed Chinese/English
  return Math.ceil(text.length / 4);
}

function findMainDir(context) {
  // Try common locations for the main process source
  const candidates = [
    path.join(context.workspacePath || process.cwd(), "src", "main"),
    path.join(
      context.workspacePath || process.cwd(),
      "desktop-app-vue",
      "src",
      "main",
    ),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return context.workspacePath || process.cwd();
}

function scoreFile(filePath, keywords) {
  const fileName = path.basename(filePath).toLowerCase();
  const dirName = path.dirname(filePath).toLowerCase();
  let score = 0;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (fileName.includes(kwLower)) {
      score += 10;
    }
    if (dirName.includes(kwLower)) {
      score += 5;
    }
  }

  return score;
}

function searchFiles(dir, keywords, maxResults = 20) {
  const results = [];

  function walk(currentDir, depth) {
    if (depth > 5 || results.length >= maxResults * 3) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          !["node_modules", ".git", "dist", "build", "coverage"].includes(
            entry.name,
          )
        ) {
          walk(path.join(currentDir, entry.name), depth + 1);
        }
      } else if (entry.isFile() && /\.(js|ts|vue|md)$/.test(entry.name)) {
        const filePath = path.join(currentDir, entry.name);
        const score = scoreFile(filePath, keywords);
        if (score > 0) {
          results.push({ filePath, score });
        }
      }
    }
  }

  walk(dir, 0);
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

async function handlePrime(topic, context) {
  const keywords = topic.split(/[\s,，、]+/).filter(Boolean);
  const mainDir = findMainDir(context);
  const filesToLoad = [];

  // Phase 1: Intent-based matching
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (INTENT_MAP[kwLower]) {
      const mapping = INTENT_MAP[kwLower];
      const dir = path.join(mainDir, mapping.dir);
      for (const fileName of mapping.files) {
        const filePath = path.join(dir, fileName);
        if (fs.existsSync(filePath)) {
          filesToLoad.push({ filePath, score: 20, source: "intent" });
        }
      }
    }
  }

  // Phase 2: Filename/directory search
  const searchResults = searchFiles(mainDir, keywords);
  for (const result of searchResults) {
    if (!filesToLoad.some((f) => f.filePath === result.filePath)) {
      filesToLoad.push({ ...result, source: "search" });
    }
  }

  // Phase 3: Load files within token budget
  let usedTokens = 0;
  const loaded = [];

  for (const entry of filesToLoad) {
    if (usedTokens >= tokenBudget) {
      break;
    }
    try {
      const content = fs.readFileSync(entry.filePath, "utf-8");
      const tokens = estimateTokens(content);

      if (usedTokens + tokens <= tokenBudget) {
        loaded.push({
          file: path.relative(mainDir, entry.filePath),
          tokens,
          source: entry.source,
          score: entry.score,
        });
        usedTokens += tokens;
      } else if (usedTokens + 500 <= tokenBudget) {
        // Load truncated
        const truncated = content.substring(0, (tokenBudget - usedTokens) * 4);
        const truncTokens = estimateTokens(truncated);
        loaded.push({
          file: path.relative(mainDir, entry.filePath),
          tokens: truncTokens,
          source: entry.source,
          score: entry.score,
          truncated: true,
        });
        usedTokens += truncTokens;
      }
    } catch {
      // Skip unreadable files
    }
  }

  loadedContext = loaded;

  const lines = [
    `Context Loaded`,
    `==============`,
    `Topic: "${topic}"`,
    `Budget: ${tokenBudget} tokens (used: ${usedTokens})`,
    ``,
    `Files loaded:`,
  ];

  for (const f of loaded) {
    const trunc = f.truncated ? " [truncated]" : "";
    lines.push(`  📄 ${f.file} (${f.tokens} tokens)${trunc}`);
  }

  lines.push(``, `Remaining budget: ${tokenBudget - usedTokens} tokens`);

  return {
    success: true,
    result: { loaded, usedTokens, remaining: tokenBudget - usedTokens },
    message: lines.join("\n"),
  };
}

function handleBudget(param) {
  const newBudget = parseInt(param);
  if (isNaN(newBudget) || newBudget < 1000) {
    return { success: false, message: "Budget must be a number >= 1000" };
  }
  tokenBudget = newBudget;
  return {
    success: true,
    message: `Context budget set to ${tokenBudget} tokens.`,
  };
}

function handleStatus() {
  if (loadedContext.length === 0) {
    return {
      success: true,
      message:
        "No context loaded. Use `/context-loader prime <topic>` to load.",
    };
  }

  const totalTokens = loadedContext.reduce((s, f) => s + f.tokens, 0);
  const lines = [
    `Loaded Context: ${loadedContext.length} files, ${totalTokens}/${tokenBudget} tokens`,
    ...loadedContext.map((f) => `  📄 ${f.file} (${f.tokens} tokens)`),
  ];

  return { success: true, result: loadedContext, message: lines.join("\n") };
}

function handleClear() {
  const count = loadedContext.length;
  loadedContext = [];
  return { success: true, message: `Cleared ${count} loaded files.` };
}
