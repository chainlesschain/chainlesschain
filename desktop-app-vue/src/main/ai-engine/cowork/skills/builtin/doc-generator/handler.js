/**
 * Doc Generator Skill Handler
 *
 * Generates documentation from source code: JSDoc stubs, IPC handler reference,
 * changelog from git commits, and module README files.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

const CODE_EXTS = new Set(["js", "mjs", "ts", "tsx", "jsx", "vue"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
]);

module.exports = {
  async init(skill) {
    logger.info("[DocGenerator] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[DocGenerator] Action: ${action}`, { options });

    try {
      switch (action) {
        case "jsdoc":
          return await handleJSDoc(options.targetPath);
        case "ipc-reference":
          return await handleIPCReference(options.targetDir);
        case "changelog":
          return await handleChangelog(options.range, options.targetDir);
        case "readme":
          return await handleReadme(options.targetDir);
        default:
          return await handleJSDoc(options.targetPath);
      }
    } catch (error) {
      logger.error(`[DocGenerator] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Doc generation failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    targetDir: context.workspacePath || process.cwd(),
    targetPath: null,
    range: null,
  };
  let action = "jsdoc";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--jsdoc") {
      action = "jsdoc";
    } else if (p === "--ipc-reference") {
      action = "ipc-reference";
    } else if (p === "--changelog") {
      action = "changelog";
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) {
        options.range = parts[++i];
      }
    } else if (p === "--readme") {
      action = "readme";
    } else if (p && !p.startsWith("-")) {
      const resolved = path.resolve(options.targetDir, p);
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          options.targetDir = resolved;
        } else {
          options.targetPath = resolved;
        }
      }
    }
  }

  if (!options.targetPath) {
    options.targetPath = options.targetDir;
  }

  return { action, options };
}

function collectFiles(dir, maxDepth = 6, depth = 0) {
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
      }
      if (files.length >= 200) {
        return files;
      }
    }
  }
  return files;
}

async function handleJSDoc(targetPath) {
  const stat = fs.statSync(targetPath);
  const files = stat.isDirectory() ? collectFiles(targetPath) : [targetPath];
  const results = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const functions = extractFunctions(content);
    if (functions.length === 0) {
      continue;
    }

    const stubs = functions.map((fn) => {
      const params = fn.params.map((p) => ` * @param {*} ${p} -`).join("\n");
      return `/**\n * ${fn.name}\n${params}\n * @returns {*}\n */`;
    });

    results.push({
      file: path.basename(file),
      functions: functions.length,
      stubs,
    });
  }

  const totalFunctions = results.reduce((s, r) => s + r.functions, 0);
  const report =
    `JSDoc Stubs Generated\n${"=".repeat(30)}\n` +
    `Files analyzed: ${files.length}\n` +
    `Functions found: ${totalFunctions}\n\n` +
    results
      .map(
        (r) => `${r.file} (${r.functions} functions):\n${r.stubs.join("\n\n")}`,
      )
      .join("\n\n---\n\n");

  return {
    success: true,
    result: { fileCount: files.length, functionCount: totalFunctions, results },
    message: report,
  };
}

function extractFunctions(content) {
  const functions = [];

  // Named function declarations
  const funcRe = /(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = funcRe.exec(content)) !== null) {
    // Skip if already has JSDoc
    const before = content.substring(Math.max(0, m.index - 5), m.index);
    if (before.includes("*/")) {
      continue;
    }

    functions.push({
      name: m[1],
      params: m[2]
        .split(",")
        .map((p) => p.trim().split(/[=\s]/)[0])
        .filter(Boolean),
    });
  }

  // Arrow function exports: export const foo = (...) =>
  const arrowRe =
    /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
  while ((m = arrowRe.exec(content)) !== null) {
    const before = content.substring(Math.max(0, m.index - 5), m.index);
    if (before.includes("*/")) {
      continue;
    }

    functions.push({
      name: m[1],
      params: m[2]
        .split(",")
        .map((p) => p.trim().split(/[=\s]/)[0])
        .filter(Boolean),
    });
  }

  return functions;
}

async function handleIPCReference(targetDir) {
  const files = collectFiles(targetDir);
  const handlers = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // ipcMain.handle('channel', handler) and ipcMain.on('channel', handler)
    const handleRe = /ipcMain\.(?:handle|on)\s*\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = handleRe.exec(content)) !== null) {
      handlers.push({
        channel: m[1],
        type: content.substring(m.index, m.index + 20).includes("handle")
          ? "handle"
          : "on",
        file: path.relative(targetDir, file),
        line: content.substring(0, m.index).split("\n").length,
      });
    }
  }

  // Group by module (filename)
  const byModule = {};
  for (const h of handlers) {
    const moduleName = path.basename(h.file, path.extname(h.file));
    if (!byModule[moduleName]) {
      byModule[moduleName] = [];
    }
    byModule[moduleName].push(h);
  }

  const report =
    `IPC Handler Reference\n${"=".repeat(30)}\nTotal: ${handlers.length} handlers in ${Object.keys(byModule).length} modules\n\n` +
    Object.entries(byModule)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(
        ([mod, hs]) =>
          `### ${mod} (${hs.length} handlers)\n` +
          hs
            .map(
              (h) => `  - \`${h.channel}\` (${h.type}) @ ${h.file}:${h.line}`,
            )
            .join("\n"),
      )
      .join("\n\n");

  return {
    success: true,
    result: { totalHandlers: handlers.length, modules: byModule },
    message: report,
  };
}

async function handleChangelog(range, targetDir) {
  const gitRange = range || "HEAD~20..HEAD";
  let logOutput;

  try {
    logOutput = execSync(
      `git log ${gitRange} --pretty=format:"%H|%s|%an|%ad" --date=short`,
      {
        encoding: "utf-8",
        cwd: targetDir,
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    return {
      success: false,
      message: "Failed to read git log. Ensure you are in a git repository.",
    };
  }

  if (!logOutput) {
    return {
      success: true,
      result: { entries: [] },
      message: "No commits found in range.",
    };
  }

  const commits = logOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, date] = line.split("|");
      const conventionalMatch = subject.match(/^(\w+)(?:\(([^)]*)\))?:\s*(.*)/);
      return {
        hash: (hash || "").substring(0, 7),
        type: conventionalMatch ? conventionalMatch[1] : "other",
        scope: conventionalMatch ? conventionalMatch[2] : null,
        message: conventionalMatch ? conventionalMatch[3] : subject,
        author,
        date,
      };
    });

  // Group by type
  const groups = {};
  for (const c of commits) {
    const type = c.type;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(c);
  }

  const typeLabels = {
    feat: "Features",
    fix: "Bug Fixes",
    docs: "Documentation",
    refactor: "Refactoring",
    test: "Tests",
    perf: "Performance",
    chore: "Chores",
    style: "Style",
    ci: "CI/CD",
  };

  const report =
    `Changelog\n${"=".repeat(30)}\nRange: ${gitRange} (${commits.length} commits)\n\n` +
    Object.entries(groups)
      .sort(([a], [b]) => {
        const order = [
          "feat",
          "fix",
          "refactor",
          "perf",
          "docs",
          "test",
          "chore",
        ];
        return order.indexOf(a) - order.indexOf(b);
      })
      .map(
        ([type, commits]) =>
          `### ${typeLabels[type] || type} (${commits.length})\n` +
          commits
            .map(
              (c) =>
                `- ${c.scope ? `**${c.scope}**: ` : ""}${c.message} (${c.hash})`,
            )
            .join("\n"),
      )
      .join("\n\n");

  return {
    success: true,
    result: { commits, groups },
    message: report,
  };
}

async function handleReadme(targetDir) {
  let entries;
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return { success: false, message: `Cannot read directory: ${targetDir}` };
  }

  const dirName = path.basename(targetDir);
  const jsFiles = entries.filter(
    (e) => e.isFile() && CODE_EXTS.has(path.extname(e.name).slice(1)),
  );
  const subDirs = entries.filter(
    (e) =>
      e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith("."),
  );

  // Analyze each file
  const fileDescriptions = [];
  for (const f of jsFiles) {
    const filePath = path.join(targetDir, f.name);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const firstComment = content.match(
      /\/\*\*?\s*\n?\s*\*?\s*(.*?)(?:\n|\*\/)/,
    );
    const exportCount = (content.match(/(?:module\.exports|export\s+)/g) || [])
      .length;
    const classCount = (content.match(/class\s+\w+/g) || []).length;
    const funcCount = (content.match(/(?:async\s+)?function\s+\w+/g) || [])
      .length;

    fileDescriptions.push({
      name: f.name,
      description: firstComment ? firstComment[1].trim() : "",
      exports: exportCount,
      classes: classCount,
      functions: funcCount,
      lines: content.split("\n").length,
    });
  }

  const readme =
    `# ${dirName}\n\n` +
    `## Files\n\n` +
    `| File | Lines | Classes | Functions | Description |\n` +
    `|------|-------|---------|-----------|-------------|\n` +
    fileDescriptions
      .map(
        (f) =>
          `| ${f.name} | ${f.lines} | ${f.classes} | ${f.functions} | ${f.description} |`,
      )
      .join("\n") +
    (subDirs.length > 0
      ? `\n\n## Subdirectories\n\n${subDirs.map((d) => `- \`${d.name}/\``).join("\n")}`
      : "") +
    `\n\n## Total\n\n- ${jsFiles.length} source files\n- ${fileDescriptions.reduce((s, f) => s + f.lines, 0)} total lines\n`;

  return {
    success: true,
    result: {
      dirName,
      files: fileDescriptions,
      subDirs: subDirs.map((d) => d.name),
    },
    message: readme,
  };
}
