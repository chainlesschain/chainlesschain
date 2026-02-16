/**
 * Repository Map Skill Handler
 *
 * Scans codebase to build AST-level symbol index: classes, functions,
 * exports, imports. Generates compressed codebase map for AI context.
 * Inspired by Aider's repository map technique.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const EXTENSIONS = {
  js: "javascript",
  mjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  vue: "vue",
  py: "python",
  java: "java",
  kt: "kotlin",
  go: "go",
  rs: "rust",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
};

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
  ".turbo",
  "vendor",
  "target",
]);

const MAX_FILES = 500;

module.exports = {
  async init(skill) {
    logger.info("[RepoMap] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { targetDir, options } = parseInput(input, context);

    logger.info(`[RepoMap] Scanning: ${targetDir}`, { options });

    try {
      if (options.find) {
        return await handleFind(targetDir, options.find);
      }

      const files = scanDirectory(targetDir, options.filter, options.depth);
      const symbols = [];

      for (const file of files) {
        try {
          const fileSymbols = extractSymbols(file);
          if (fileSymbols.length > 0) {
            symbols.push({
              file: path.relative(targetDir, file),
              symbols: fileSymbols,
            });
          }
        } catch {
          // Skip files that fail to parse
        }
      }

      const output =
        options.format === "flat"
          ? formatFlat(symbols, options.exportsOnly)
          : formatTree(symbols, targetDir, options.exportsOnly);

      return {
        success: true,
        result: {
          fileCount: files.length,
          symbolCount: symbols.reduce((s, f) => s + f.symbols.length, 0),
          symbols,
        },
        message: `Scanned ${files.length} files, found ${symbols.reduce((s, f) => s + f.symbols.length, 0)} symbols.\n\n${output}`,
      };
    } catch (error) {
      logger.error(`[RepoMap] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Repo map failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    exportsOnly: false,
    format: "tree",
    find: null,
    filter: null,
    depth: Infinity,
  };
  let targetDir = context.workspacePath || process.cwd();

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--exports") {
      options.exportsOnly = true;
    } else if (p === "--imports") {
      options.importsOnly = true;
    } else if (p === "--find") {
      options.find = parts[++i];
    } else if (p === "--format") {
      options.format = parts[++i] || "tree";
    } else if (p === "--filter") {
      options.filter = parts[++i];
    } else if (p === "--depth") {
      options.depth = parseInt(parts[++i]) || Infinity;
    } else if (p && !p.startsWith("-")) {
      const resolved = path.resolve(targetDir, p);
      if (fs.existsSync(resolved)) {
        targetDir = resolved;
      }
    }
  }

  return { targetDir, options };
}

function scanDirectory(dir, filter, maxDepth, currentDepth = 0) {
  const files = [];
  if (currentDepth > maxDepth || !fs.existsSync(dir)) {
    return files;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        files.push(
          ...scanDirectory(
            path.join(dir, entry.name),
            filter,
            maxDepth,
            currentDepth + 1,
          ),
        );
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1);
      if (EXTENSIONS[ext]) {
        if (
          !filter ||
          entry.name.match(new RegExp(filter.replace("*", ".*")))
        ) {
          files.push(path.join(dir, entry.name));
          if (files.length >= MAX_FILES) {
            return files;
          }
        }
      }
    }
  }

  return files;
}

function extractSymbols(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).slice(1);
  const lang = EXTENSIONS[ext];
  const symbols = [];

  if (lang === "javascript" || lang === "typescript") {
    extractJSSymbols(content, symbols);
  } else if (lang === "vue") {
    extractVueSymbols(content, symbols);
  } else if (lang === "python") {
    extractPythonSymbols(content, symbols);
  } else if (lang === "java" || lang === "kotlin") {
    extractJavaSymbols(content, symbols);
  }

  return symbols;
}

function extractJSSymbols(content, symbols) {
  // Classes
  const classRe = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    symbols.push({
      type: "class",
      name: m[1],
      extends: m[2] || null,
      line: getLine(content, m.index),
    });
  }

  // Functions (named declarations)
  const funcRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  while ((m = funcRe.exec(content)) !== null) {
    symbols.push({
      type: "function",
      name: m[1],
      line: getLine(content, m.index),
    });
  }

  // Arrow function exports: export const foo = (
  const arrowRe = /export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
  while ((m = arrowRe.exec(content)) !== null) {
    symbols.push({
      type: "export-fn",
      name: m[1],
      line: getLine(content, m.index),
    });
  }

  // module.exports
  const cjsRe = /module\.exports\s*=\s*\{([^}]+)\}/;
  m = cjsRe.exec(content);
  if (m) {
    const exports = m[1]
      .split(",")
      .map((e) => e.trim().split(/[:\s]/)[0])
      .filter(Boolean);
    for (const name of exports) {
      symbols.push({ type: "export", name, line: getLine(content, m.index) });
    }
  }

  // Named exports: export { a, b }
  const namedExportRe = /export\s*\{([^}]+)\}/g;
  while ((m = namedExportRe.exec(content)) !== null) {
    const names = m[1]
      .split(",")
      .map((e) =>
        e
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter(Boolean);
    for (const name of names) {
      symbols.push({ type: "export", name, line: getLine(content, m.index) });
    }
  }
}

function extractVueSymbols(content, symbols) {
  // Script section
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    extractJSSymbols(scriptMatch[1], symbols);
  }

  // defineEmits / defineProps
  const emitsMatch = content.match(/defineEmits\s*[<(]\s*\[?([^\]>)]*)/);
  if (emitsMatch) {
    symbols.push({
      type: "emits",
      name: "defineEmits",
      line: getLine(content, emitsMatch.index),
    });
  }
  const propsMatch = content.match(/defineProps\s*[<(]/);
  if (propsMatch) {
    symbols.push({
      type: "props",
      name: "defineProps",
      line: getLine(content, propsMatch.index),
    });
  }
}

function extractPythonSymbols(content, symbols) {
  const classRe = /^class\s+(\w+)(?:\(([^)]*)\))?:/gm;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    symbols.push({
      type: "class",
      name: m[1],
      extends: m[2] || null,
      line: getLine(content, m.index),
    });
  }

  const funcRe = /^(?:async\s+)?def\s+(\w+)\s*\(/gm;
  while ((m = funcRe.exec(content)) !== null) {
    if (!m[1].startsWith("_")) {
      symbols.push({
        type: "function",
        name: m[1],
        line: getLine(content, m.index),
      });
    }
  }
}

function extractJavaSymbols(content, symbols) {
  const classRe =
    /(?:public|private|protected)?\s*(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)/g;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    symbols.push({
      type: "class",
      name: m[1],
      line: getLine(content, m.index),
    });
  }

  const methodRe =
    /(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(/g;
  while ((m = methodRe.exec(content)) !== null) {
    symbols.push({
      type: "method",
      name: m[1],
      line: getLine(content, m.index),
    });
  }
}

function getLine(content, index) {
  return content.substring(0, index).split("\n").length;
}

function formatTree(fileSymbols, baseDir, exportsOnly) {
  const lines = [];
  for (const { file, symbols } of fileSymbols) {
    const filtered = exportsOnly
      ? symbols.filter((s) => s.type === "export" || s.type === "export-fn")
      : symbols;
    if (filtered.length === 0) {
      continue;
    }

    lines.push(`📄 ${file}`);
    for (const sym of filtered) {
      const prefix =
        sym.type === "class"
          ? "  ├── class "
          : sym.type === "function" || sym.type === "export-fn"
            ? "  ├── "
            : sym.type === "method"
              ? "  │   ├── "
              : "  ├── ";
      const suffix = sym.extends ? ` extends ${sym.extends}` : "";
      lines.push(`${prefix}${sym.name}${suffix} :${sym.line}`);
    }
  }
  return lines.join("\n");
}

function formatFlat(fileSymbols, exportsOnly) {
  const lines = [];
  for (const { file, symbols } of fileSymbols) {
    const filtered = exportsOnly
      ? symbols.filter((s) => s.type === "export" || s.type === "export-fn")
      : symbols;
    for (const sym of filtered) {
      lines.push(`${sym.type}\t${sym.name}\t${file}:${sym.line}`);
    }
  }
  return lines.join("\n");
}

async function handleFind(dir, symbolName) {
  const files = scanDirectory(dir, null, Infinity);
  const results = [];

  for (const file of files) {
    try {
      const symbols = extractSymbols(file);
      const matches = symbols.filter((s) =>
        s.name.toLowerCase().includes(symbolName.toLowerCase()),
      );
      if (matches.length > 0) {
        results.push({ file: path.relative(dir, file), matches });
      }
    } catch {
      // skip
    }
  }

  if (results.length === 0) {
    return {
      success: true,
      result: [],
      message: `Symbol '${symbolName}' not found in ${files.length} files.`,
    };
  }

  const lines = results.map(({ file, matches }) =>
    matches.map((m) => `  ${m.type} ${m.name} → ${file}:${m.line}`).join("\n"),
  );

  return {
    success: true,
    result: results,
    message: `Found '${symbolName}' in ${results.length} files:\n${lines.join("\n")}`,
  };
}
