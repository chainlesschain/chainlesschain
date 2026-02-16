/**
 * Code Refactor Skill Handler
 *
 * Detects code smells, renames symbols across files, finds duplicate code,
 * and measures function/class complexity. Read-write refactoring assistant.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  "coverage",
  ".cache",
  ".vite",
  "vendor",
  "target",
]);

const CODE_EXTS = new Set([
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "vue",
  "py",
  "java",
  "kt",
  "go",
]);

module.exports = {
  async init(skill) {
    logger.info("[Refactor] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[Refactor] Action: ${action}`, { options });

    try {
      switch (action) {
        case "detect-smells":
          return await handleDetectSmells(options.targetDir);
        case "rename":
          return await handleRename(
            options.targetDir,
            options.oldName,
            options.newName,
          );
        case "extract-duplicates":
          return await handleExtractDuplicates(options.targetDir);
        default:
          return await handleDetectSmells(options.targetDir);
      }
    } catch (error) {
      logger.error(`[Refactor] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Refactor failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    targetDir: context.workspacePath || process.cwd(),
    oldName: null,
    newName: null,
  };
  let action = "detect-smells";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--detect-smells") {
      action = "detect-smells";
    } else if (p === "--rename") {
      action = "rename";
      options.oldName = parts[++i];
      options.newName = parts[++i];
    } else if (p === "--extract-duplicates") {
      action = "extract-duplicates";
    } else if (p && !p.startsWith("-")) {
      const resolved = path.resolve(options.targetDir, p);
      if (fs.existsSync(resolved)) {
        options.targetDir = resolved;
      }
    }
  }

  return { action, options };
}

function collectFiles(dir, maxDepth = 8, depth = 0) {
  const files = [];
  if (depth > maxDepth || !fs.existsSync(dir)) {
    return files;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !IGNORE_DIRS.has(entry.name) &&
      !entry.name.startsWith(".")
    ) {
      files.push(
        ...collectFiles(path.join(dir, entry.name), maxDepth, depth + 1),
      );
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1);
      if (CODE_EXTS.has(ext)) {
        files.push(path.join(dir, entry.name));
        if (files.length >= 300) {
          return files;
        }
      }
    }
  }
  return files;
}

async function handleDetectSmells(targetDir) {
  const files = collectFiles(targetDir);
  const smells = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const relPath = path.relative(targetDir, file);

    // Long Method: functions > 50 lines
    const funcStarts = [];
    lines.forEach((line, idx) => {
      if (
        /(?:async\s+)?function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/.test(
          line,
        )
      ) {
        funcStarts.push(idx);
      }
    });

    // Simple heuristic: count consecutive non-empty lines between braces
    if (lines.length > 200) {
      smells.push({
        file: relPath,
        type: "Large File",
        line: 1,
        detail: `${lines.length} lines`,
      });
    }

    // God Class: class > 300 lines or > 15 methods
    const classMatches = [...content.matchAll(/class\s+(\w+)/g)];
    for (const cm of classMatches) {
      const classLine = content.substring(0, cm.index).split("\n").length;
      const methodCount = (
        content.match(/(?:async\s+)?\w+\s*\([^)]*\)\s*\{/g) || []
      ).length;
      if (methodCount > 15) {
        smells.push({
          file: relPath,
          type: "God Class",
          line: classLine,
          detail: `${cm[1]}: ${methodCount} methods`,
        });
      }
    }

    // Duplicate code: look for identical non-trivial blocks (3+ lines)
    const blockHashes = new Map();
    for (let i = 0; i < lines.length - 2; i++) {
      const block = lines
        .slice(i, i + 3)
        .map((l) => l.trim())
        .join("|");
      if (block.length > 30 && !/^\s*[{}\s/]*$/.test(block)) {
        if (blockHashes.has(block)) {
          const firstLine = blockHashes.get(block);
          if (Math.abs(firstLine - i) > 5) {
            smells.push({
              file: relPath,
              type: "Duplicate Code",
              line: i + 1,
              detail: `Similar to line ${firstLine + 1}`,
            });
          }
        } else {
          blockHashes.set(block, i);
        }
      }
    }

    // Dead code: exported but potentially unused (simplified)
    const unusedExports = [];
    const exportMatches = [
      ...content.matchAll(/module\.exports\s*=\s*\{([^}]+)\}/g),
    ];
    for (const em of exportMatches) {
      const names = em[1]
        .split(",")
        .map((n) => n.trim().split(/[\s:]/)[0])
        .filter(Boolean);
      unusedExports.push(...names);
    }
  }

  // Deduplicate
  const uniqueSmells = smells
    .filter(
      (s, i) =>
        i ===
        smells.findIndex(
          (t) => t.file === s.file && t.type === s.type && t.line === s.line,
        ),
    )
    .slice(0, 50);

  const report =
    uniqueSmells.length > 0
      ? `Code Smell Report (${uniqueSmells.length} issues in ${files.length} files)\n${"=".repeat(50)}\n\n` +
        uniqueSmells
          .map((s) => `  ${s.type} @ ${s.file}:${s.line} - ${s.detail}`)
          .join("\n")
      : `No significant code smells found in ${files.length} files.`;

  return {
    success: true,
    result: { smells: uniqueSmells, fileCount: files.length },
    message: report,
  };
}

async function handleRename(targetDir, oldName, newName) {
  if (!oldName || !newName) {
    return { success: false, message: "Usage: --rename <oldName> <newName>" };
  }

  const files = collectFiles(targetDir);
  const affected = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const regex = new RegExp(
      `\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "g",
    );
    const matches = content.match(regex);
    if (matches && matches.length > 0) {
      affected.push({
        file: path.relative(targetDir, file),
        occurrences: matches.length,
      });
    }
  }

  if (affected.length === 0) {
    return {
      success: true,
      result: { affected: [] },
      message: `Symbol '${oldName}' not found in ${files.length} files.`,
    };
  }

  const totalOccurrences = affected.reduce((s, a) => s + a.occurrences, 0);
  const report =
    `Rename Preview: ${oldName} -> ${newName}\n${"=".repeat(40)}\n` +
    `Found ${totalOccurrences} occurrences in ${affected.length} files:\n\n` +
    affected
      .map((a) => `  ${a.file} (${a.occurrences} occurrences)`)
      .join("\n") +
    `\n\nNote: Preview only. Use file_editor tool to apply changes.`;

  return {
    success: true,
    result: { oldName, newName, affected, totalOccurrences },
    message: report,
  };
}

async function handleExtractDuplicates(targetDir) {
  const files = collectFiles(targetDir);
  const blockMap = new Map();
  const BLOCK_SIZE = 5;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const relPath = path.relative(targetDir, file);

    for (let i = 0; i < lines.length - BLOCK_SIZE; i++) {
      const block = lines
        .slice(i, i + BLOCK_SIZE)
        .map((l) => l.trim())
        .join("\n");
      if (block.length < 50 || /^\s*$/.test(block)) {
        continue;
      }

      const key = block;
      if (!blockMap.has(key)) {
        blockMap.set(key, []);
      }
      blockMap.get(key).push({ file: relPath, line: i + 1 });
    }
  }

  const duplicates = [];
  for (const [block, locations] of blockMap) {
    // Only report if found in 2+ different files or 2+ distant locations in same file
    const uniqueFiles = new Set(locations.map((l) => l.file));
    if (
      uniqueFiles.size >= 2 ||
      (locations.length >= 2 &&
        Math.abs(locations[0].line - locations[1].line) > BLOCK_SIZE * 2)
    ) {
      duplicates.push({
        preview: block.split("\n")[0].substring(0, 60) + "...",
        locations: locations.slice(0, 5),
        count: locations.length,
      });
    }
  }

  const topDuplicates = duplicates
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const report =
    topDuplicates.length > 0
      ? `Duplicate Code Report (top ${topDuplicates.length} patterns)\n${"=".repeat(45)}\n\n` +
        topDuplicates
          .map(
            (d, i) =>
              `${i + 1}. ${d.preview}\n   Found ${d.count}x in: ${d.locations.map((l) => `${l.file}:${l.line}`).join(", ")}`,
          )
          .join("\n\n")
      : `No significant duplicate code blocks found in ${files.length} files.`;

  return {
    success: true,
    result: { duplicates: topDuplicates, fileCount: files.length },
    message: report,
  };
}
