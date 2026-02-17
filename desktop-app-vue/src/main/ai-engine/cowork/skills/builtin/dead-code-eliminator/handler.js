/**
 * Dead Code Eliminator Skill Handler
 *
 * Scans for unused exports, unreferenced files, and unused variables.
 * Modes: --scan, --exports, --files, --variables
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

// ── File collection ─────────────────────────────────────────────────

function collectSourceFiles(dir) {
  const results = [];
  function walk(d, depth) {
    if (results.length >= MAX_FILES || depth > 10) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const ent of entries) {
      if (results.length >= MAX_FILES) {
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

// ── Export extraction ───────────────────────────────────────────────

function extractExports(content, filePath) {
  const exports = [];

  // module.exports = { a, b, c }
  const objExportMatch = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
  if (objExportMatch) {
    objExportMatch[1].split(",").forEach((item) => {
      const name = item.trim().split(":")[0].trim().split(" ")[0];
      if (name && /^\w+$/.test(name)) {
        const line = content
          .substring(0, content.indexOf(name))
          .split("\n").length;
        exports.push({ name, type: "cjs-object", line });
      }
    });
  }

  // module.exports = ClassName
  const singleExport = content.match(/module\.exports\s*=\s*(\w+)\s*;/);
  if (singleExport && !objExportMatch) {
    exports.push({
      name: singleExport[1],
      type: "cjs-default",
      line: content.substring(0, singleExport.index).split("\n").length,
    });
  }

  // exports.name = ...
  const exportsRe = /exports\.(\w+)\s*=/g;
  let m;
  while ((m = exportsRe.exec(content)) !== null) {
    exports.push({
      name: m[1],
      type: "cjs-named",
      line: content.substring(0, m.index).split("\n").length,
    });
  }

  // export const/function/class name
  const esmRe =
    /\bexport\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
  while ((m = esmRe.exec(content)) !== null) {
    exports.push({
      name: m[1],
      type: "esm-named",
      line: content.substring(0, m.index).split("\n").length,
    });
  }

  // export default
  if (/\bexport\s+default\b/.test(content)) {
    const defaultMatch = content.match(
      /\bexport\s+default\s+(?:class|function)?\s*(\w+)?/,
    );
    exports.push({
      name: defaultMatch?.[1] || "(default)",
      type: "esm-default",
      line: 1,
    });
  }

  return exports;
}

// ── Import extraction ───────────────────────────────────────────────

function extractImportedNames(content) {
  const imported = new Set();

  // require('...')
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = requireRe.exec(content)) !== null) {
    imported.add(m[1]);
  }

  // import ... from '...'
  const importRe =
    /import\s+(?:(?:\{([^}]+)\}|(\w+))\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content)) !== null) {
    imported.add(m[3]);
    if (m[1]) {
      m[1].split(",").forEach((n) => {
        const name = n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) {
          imported.add(name);
        }
      });
    }
    if (m[2]) {
      imported.add(m[2]);
    }
  }

  return imported;
}

function extractImportPaths(content) {
  const paths = [];
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importRe = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  for (const re of [requireRe, importRe, dynamicRe]) {
    const regex = new RegExp(re.source, re.flags);
    while ((m = regex.exec(content)) !== null) {
      if (m[1].startsWith(".")) {
        paths.push(m[1]);
      }
    }
  }
  return paths;
}

// ── Unused variable detection ───────────────────────────────────────

function findUnusedVariables(content, filePath) {
  const unused = [];
  const declarations = [];

  // const/let/var declarations
  const declRe = /\b(const|let|var)\s+(\w+)\s*=/g;
  let m;
  while ((m = declRe.exec(content)) !== null) {
    const name = m[2];
    if (name.startsWith("_") || /^(e|err|error|i|j|k|n)$/.test(name)) {
      continue;
    }
    declarations.push({
      name,
      line: content.substring(0, m.index).split("\n").length,
      index: m.index,
    });
  }

  // function declarations
  const funcRe = /\bfunction\s+(\w+)\s*\(/g;
  while ((m = funcRe.exec(content)) !== null) {
    declarations.push({
      name: m[1],
      line: content.substring(0, m.index).split("\n").length,
      index: m.index,
    });
  }

  // Check usage (simple: appears elsewhere in file beyond declaration)
  for (const decl of declarations) {
    const afterDecl = content.substring(decl.index + decl.name.length + 5);
    const beforeDecl = content.substring(0, decl.index);
    const nameRe = new RegExp(
      "\\b" + decl.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
    );
    if (
      !nameRe.test(afterDecl) &&
      !nameRe.test(beforeDecl.substring(0, Math.max(0, decl.index - 100)))
    ) {
      // Check if it's an export
      if (
        !content.includes("exports." + decl.name) &&
        !content.includes("export ")
      ) {
        unused.push({ name: decl.name, line: decl.line, file: filePath });
      }
    }
  }

  return unused;
}

// ── Resolve import path ─────────────────────────────────────────────

function resolveImportPath(fromDir, importPath) {
  const candidates = [
    importPath,
    importPath + ".js",
    importPath + ".ts",
    importPath + ".jsx",
    importPath + ".tsx",
    importPath + ".vue",
    importPath + "/index.js",
    importPath + "/index.ts",
  ];
  for (const c of candidates) {
    const full = path.resolve(fromDir, c);
    try {
      if (fs.statSync(full).isFile()) {
        return full;
      }
    } catch (_e) {
      /* skip */
    }
  }
  return null;
}

// ── Analysis functions ──────────────────────────────────────────────

function findUnusedExports(allFiles, projectRoot) {
  // Build: file → exports map
  const fileExports = new Map();
  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const exports = extractExports(content, file);
      if (exports.length > 0) {
        fileExports.set(file, exports);
      }
    } catch (_e) {
      /* skip */
    }
  }

  // Build: all imported names across all files
  const allImportedNames = new Set();
  const allImportedPaths = new Set();
  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      extractImportedNames(content).forEach((n) => allImportedNames.add(n));
      const importPaths = extractImportPaths(content);
      for (const p of importPaths) {
        const resolved = resolveImportPath(path.dirname(file), p);
        if (resolved) {
          allImportedPaths.add(resolved);
        }
      }
    } catch (_e) {
      /* skip */
    }
  }

  // Find exports that are never imported
  const unused = [];
  for (const [file, exports] of fileExports) {
    // Skip entry points
    const relPath = path.relative(projectRoot, file);
    if (
      relPath.includes("index.js") ||
      relPath.includes("main.js") ||
      relPath.includes("index.ts")
    ) {
      continue;
    }

    for (const exp of exports) {
      if (exp.name === "(default)") {
        continue;
      }
      if (
        !allImportedNames.has(exp.name) &&
        !allImportedNames.has(path.basename(file, path.extname(file)))
      ) {
        unused.push({
          name: exp.name,
          file: relPath,
          line: exp.line,
          type: exp.type,
        });
      }
    }
  }

  return unused;
}

function findUnreferencedFiles(allFiles, projectRoot) {
  // Build set of files that are imported by at least one other file
  const referenced = new Set();
  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const importPaths = extractImportPaths(content);
      for (const p of importPaths) {
        const resolved = resolveImportPath(path.dirname(file), p);
        if (resolved) {
          referenced.add(resolved);
        }
      }
    } catch (_e) {
      /* skip */
    }
  }

  // Files not referenced by anyone
  const unreferenced = [];
  for (const file of allFiles) {
    const relPath = path.relative(projectRoot, file);
    // Skip entry points, tests, configs
    if (/\b(index|main|app|server)\.(js|ts)$/.test(relPath)) {
      continue;
    }
    if (/\.(test|spec|config|d)\.(js|ts)$/.test(relPath)) {
      continue;
    }
    if (/\b(tests?|__tests__)\b/.test(relPath)) {
      continue;
    }

    if (!referenced.has(file)) {
      const lines = fs.readFileSync(file, "utf-8").split("\n").length;
      unreferenced.push({ file: relPath, lines });
    }
  }

  return unreferenced;
}

function scanAllVariables(allFiles, projectRoot) {
  const allUnused = [];
  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const unused = findUnusedVariables(
        content,
        path.relative(projectRoot, file),
      );
      allUnused.push(...unused);
    } catch (_e) {
      /* skip */
    }
  }
  return allUnused;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[dead-code-eliminator] init: " +
        (_skill?.name || "dead-code-eliminator"),
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
    const isScan = /--scan/i.test(input) || !input;
    const isExports = /--exports/i.test(input);
    const isFiles = /--files/i.test(input);
    const isVariables = /--variables/i.test(input);

    try {
      logger.info("[dead-code-eliminator] Scanning " + projectRoot);
      const allFiles = collectSourceFiles(projectRoot);
      logger.info(
        "[dead-code-eliminator] Found " + allFiles.length + " source files",
      );

      if (isExports) {
        const unused = findUnusedExports(allFiles, projectRoot);
        let msg = "Unused Exports\n" + "=".repeat(30) + "\n";
        msg += "Found " + unused.length + " potentially unused exports:\n";
        msg += unused
          .slice(0, 30)
          .map(
            (u) =>
              "  " +
              u.file +
              ":" +
              u.line +
              " — " +
              u.name +
              " (" +
              u.type +
              ")",
          )
          .join("\n");
        return {
          success: true,
          result: { deadCode: unused, count: unused.length },
          message: msg,
        };
      }

      if (isFiles) {
        const unreferenced = findUnreferencedFiles(allFiles, projectRoot);
        const totalLines = unreferenced.reduce((s, f) => s + f.lines, 0);
        let msg = "Unreferenced Files\n" + "=".repeat(30) + "\n";
        msg +=
          "Found " +
          unreferenced.length +
          " files not imported by any other source file:\n";
        msg += unreferenced
          .slice(0, 30)
          .map((f) => "  " + f.file + " (" + f.lines + " lines)")
          .join("\n");
        msg += "\n\nEstimated savings: " + totalLines + " lines";
        return {
          success: true,
          result: {
            deadCode: unreferenced,
            count: unreferenced.length,
            estimatedSavings: totalLines,
          },
          message: msg,
        };
      }

      if (isVariables) {
        const unused = scanAllVariables(allFiles, projectRoot);
        let msg = "Unused Variables\n" + "=".repeat(30) + "\n";
        msg += "Found " + unused.length + " potentially unused variables:\n";
        msg += unused
          .slice(0, 30)
          .map((u) => "  " + u.file + ":" + u.line + " — " + u.name)
          .join("\n");
        return {
          success: true,
          result: { deadCode: unused, count: unused.length },
          message: msg,
        };
      }

      // Full scan
      const unusedExports = findUnusedExports(allFiles, projectRoot);
      const unreferencedFiles = findUnreferencedFiles(allFiles, projectRoot);
      const unusedVars = scanAllVariables(allFiles, projectRoot);
      const totalLines = unreferencedFiles.reduce((s, f) => s + f.lines, 0);

      const summary = {
        unusedExports: unusedExports.length,
        unreferencedFiles: unreferencedFiles.length,
        unusedVariables: unusedVars.length,
        total:
          unusedExports.length + unreferencedFiles.length + unusedVars.length,
        estimatedSavings: totalLines,
        filesScanned: allFiles.length,
      };

      let msg = "Dead Code Scan\n" + "=".repeat(30) + "\n";
      msg += "Scanned " + allFiles.length + " files\n\n";
      msg += "Unused exports: " + unusedExports.length + "\n";
      msg += "Unreferenced files: " + unreferencedFiles.length + "\n";
      msg += "Unused variables: " + unusedVars.length + "\n";
      msg += "Total: " + summary.total + " dead code instances\n";
      msg += "Estimated savings: " + totalLines + " lines\n";

      if (unusedExports.length > 0) {
        msg +=
          "\nTop unused exports:\n" +
          unusedExports
            .slice(0, 10)
            .map((u) => "  " + u.file + ":" + u.line + " — " + u.name)
            .join("\n");
      }
      if (unreferencedFiles.length > 0) {
        msg +=
          "\nTop unreferenced files:\n" +
          unreferencedFiles
            .slice(0, 10)
            .map((f) => "  " + f.file + " (" + f.lines + " lines)")
            .join("\n");
      }

      return {
        success: true,
        result: {
          summary,
          unusedExports: unusedExports.slice(0, 50),
          unreferencedFiles: unreferencedFiles.slice(0, 50),
          unusedVariables: unusedVars.slice(0, 50),
        },
        message: msg,
      };
    } catch (err) {
      logger.error("[dead-code-eliminator] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Dead code scan failed: " + err.message,
      };
    }
  },
};
