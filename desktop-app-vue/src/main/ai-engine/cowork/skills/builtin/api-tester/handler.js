/**
 * API Tester Skill Handler
 *
 * Discovers IPC handlers from source code, generates test stubs,
 * and provides handler statistics.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
  "tests",
]);
const CODE_EXTS = new Set(["js", "mjs", "ts"]);

module.exports = {
  async init(skill) {
    logger.info("[APITester] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[APITester] Action: ${action}`, { options });

    try {
      switch (action) {
        case "discover":
          return await handleDiscover(options.targetDir);
        case "generate":
          return await handleGenerate(options.targetPath);
        case "health-check":
          return await handleHealthCheck(options.targetDir);
        default:
          return await handleDiscover(options.targetDir);
      }
    } catch (error) {
      logger.error(`[APITester] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `API test failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    targetDir: context.workspacePath || process.cwd(),
    targetPath: null,
  };
  let action = "discover";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--discover") {
      action = "discover";
    } else if (p === "--generate") {
      action = "generate";
    } else if (p === "--health-check") {
      action = "health-check";
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
      if (files.length >= 300) {
        return files;
      }
    }
  }
  return files;
}

function discoverHandlers(files, baseDir) {
  const handlers = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // ipcMain.handle('channel', (event, arg1, arg2) => { ... })
    const handleRe =
      /ipcMain\.handle\s*\(\s*['"]([^'"]+)['"],\s*(?:async\s*)?\(([^)]*)\)/g;
    let m;
    while ((m = handleRe.exec(content)) !== null) {
      const params = m[2]
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p && p !== "event" && p !== "_event" && p !== "_");
      handlers.push({
        channel: m[1],
        type: "handle",
        params,
        file: path.relative(baseDir, file),
        line: content.substring(0, m.index).split("\n").length,
      });
    }

    // ipcMain.on('channel', ...)
    const onRe =
      /ipcMain\.on\s*\(\s*['"]([^'"]+)['"],\s*(?:async\s*)?\(([^)]*)\)/g;
    while ((m = onRe.exec(content)) !== null) {
      const params = m[2]
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p && p !== "event" && p !== "_event" && p !== "_");
      handlers.push({
        channel: m[1],
        type: "on",
        params,
        file: path.relative(baseDir, file),
        line: content.substring(0, m.index).split("\n").length,
      });
    }
  }

  return handlers;
}

async function handleDiscover(targetDir) {
  const files = collectFiles(targetDir);
  const handlers = discoverHandlers(files, targetDir);

  // Group by module
  const byModule = {};
  for (const h of handlers) {
    const moduleName = path.basename(h.file, path.extname(h.file));
    if (!byModule[moduleName]) {
      byModule[moduleName] = [];
    }
    byModule[moduleName].push(h);
  }

  const sorted = Object.entries(byModule).sort(
    ([, a], [, b]) => b.length - a.length,
  );

  const report =
    `IPC Handler Discovery Report\n${"=".repeat(35)}\n` +
    `Total: ${handlers.length} handlers in ${sorted.length} modules\n` +
    `Files scanned: ${files.length}\n\n` +
    `By module:\n` +
    sorted
      .map(
        ([mod, hs]) =>
          `  ${mod}: ${hs.length} handlers (${hs.filter((h) => h.type === "handle").length} handle, ${hs.filter((h) => h.type === "on").length} on)`,
      )
      .join("\n") +
    `\n\nAll channels:\n` +
    handlers
      .map(
        (h) =>
          `  ${h.type === "handle" ? "H" : "E"} ${h.channel} @ ${h.file}:${h.line}`,
      )
      .join("\n");

  return {
    success: true,
    result: { totalHandlers: handlers.length, modules: byModule, handlers },
    message: report,
  };
}

async function handleGenerate(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return {
      success: false,
      message: "Please specify a valid file path for test generation.",
    };
  }

  const content = fs.readFileSync(targetPath, "utf-8");
  const baseDir = path.dirname(targetPath);
  const handlers = discoverHandlers([targetPath], baseDir);

  if (handlers.length === 0) {
    return {
      success: true,
      result: { tests: [] },
      message: "No IPC handlers found in this file.",
    };
  }

  const moduleName = path.basename(targetPath, path.extname(targetPath));
  const testLines = [
    `import { describe, it, expect, vi, beforeEach } from 'vitest';`,
    ``,
    `// Mock ipcMain`,
    `const handlers = {};`,
    `vi.mock('electron', () => ({`,
    `  ipcMain: {`,
    `    handle: (channel, fn) => { handlers[channel] = fn; },`,
    `    on: (channel, fn) => { handlers[channel] = fn; },`,
    `  },`,
    `}));`,
    ``,
    `describe('${moduleName} IPC handlers', () => {`,
  ];

  for (const h of handlers) {
    const paramStr =
      h.params.length > 0 ? h.params.map(() => "{}").join(", ") : "";
    testLines.push(
      `  it('${h.channel} should respond successfully', async () => {`,
    );
    testLines.push(`    const event = { sender: { send: vi.fn() } };`);
    if (h.type === "handle") {
      testLines.push(
        `    const result = await handlers['${h.channel}'](event${paramStr ? ", " + paramStr : ""});`,
      );
      testLines.push(`    expect(result).toBeDefined();`);
    } else {
      testLines.push(
        `    handlers['${h.channel}'](event${paramStr ? ", " + paramStr : ""});`,
      );
    }
    testLines.push(`  });`);
    testLines.push(``);
  }

  testLines.push(`});`);

  const testCode = testLines.join("\n");

  return {
    success: true,
    result: { moduleName, handlerCount: handlers.length, testCode },
    message: `Generated ${handlers.length} test stubs for ${moduleName}:\n\n\`\`\`javascript\n${testCode}\n\`\`\``,
  };
}

async function handleHealthCheck(targetDir) {
  const files = collectFiles(targetDir);
  const handlers = discoverHandlers(files, targetDir);

  // Group by prefix
  const byPrefix = {};
  for (const h of handlers) {
    const prefix = h.channel.split(":")[0] || "other";
    if (!byPrefix[prefix]) {
      byPrefix[prefix] = { total: 0, channels: [] };
    }
    byPrefix[prefix].total++;
    byPrefix[prefix].channels.push(h.channel);
  }

  const report =
    `IPC Health Check Summary\n${"=".repeat(30)}\n` +
    `Total registered handlers: ${handlers.length}\n\n` +
    `By namespace:\n` +
    Object.entries(byPrefix)
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([prefix, data]) => `  ${prefix}: ${data.total} handlers`)
      .join("\n") +
    `\n\nNote: Runtime health check requires running Electron app.` +
    ` Use 'tools:get-skill-manifest' IPC to verify at runtime.`;

  return {
    success: true,
    result: { totalHandlers: handlers.length, byPrefix },
    message: report,
  };
}
