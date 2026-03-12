/**
 * Code Knowledge Graph for CLI
 *
 * Builds a lightweight entity-relationship graph from source code:
 *   - Files, classes, functions, imports, exports
 *   - Dependency relationships
 */

import fs from "fs";
import path from "path";

const CODE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".kt",
  ".swift",
]);

/**
 * Build a knowledge graph from a file or directory
 *
 * @param {object} params
 * @param {string} params.targetPath - File or directory to analyze
 * @param {number} [params.maxFiles=50] - Max files to process
 * @returns {Promise<object>} Knowledge graph
 */
export async function buildKnowledgeGraph({ targetPath, maxFiles = 50 }) {
  const entities = [];
  const relationships = [];

  const stat = fs.statSync(targetPath);
  const files = stat.isDirectory()
    ? collectFiles(targetPath, maxFiles)
    : [targetPath];

  for (const filePath of files) {
    const ext = path.extname(filePath);
    if (!CODE_EXTENSIONS.has(ext)) continue;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const relativePath = path.relative(process.cwd(), filePath);

      entities.push({
        type: "file",
        name: relativePath,
        language: ext.slice(1),
        lines: content.split("\n").length,
      });

      // Extract imports
      const imports = extractImports(content, ext);
      for (const imp of imports) {
        relationships.push({
          from: relativePath,
          to: imp,
          type: "imports",
        });
      }

      // Extract exports / public APIs
      const exports = extractExports(content, ext);
      for (const exp of exports) {
        entities.push({
          type: "export",
          name: exp.name,
          kind: exp.kind,
          file: relativePath,
        });
      }

      // Extract classes/functions
      const definitions = extractDefinitions(content, ext);
      for (const def of definitions) {
        entities.push({
          type: def.kind,
          name: def.name,
          file: relativePath,
          line: def.line,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Build summary
  const fileCount = entities.filter((e) => e.type === "file").length;
  const exportCount = entities.filter((e) => e.type === "export").length;
  const defCount = entities.filter(
    (e) => e.type === "class" || e.type === "function",
  ).length;

  const summary = [
    `Code Knowledge Graph for: ${targetPath}`,
    `  Files analyzed: ${fileCount}`,
    `  Entities: ${entities.length} (${defCount} definitions, ${exportCount} exports)`,
    `  Relationships: ${relationships.length}`,
    "",
    "Top imports:",
    ...getTopImports(relationships).map((r) => `  ${r.to} (${r.count} refs)`),
  ].join("\n");

  return {
    entities,
    relationships,
    stats: {
      fileCount,
      exportCount,
      defCount,
      relationshipCount: relationships.length,
    },
    summary,
  };
}

function collectFiles(dir, maxFiles) {
  const files = [];
  const queue = [dir];

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift();
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(fullPath);
        } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
          files.push(fullPath);
          if (files.length >= maxFiles) break;
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  return files;
}

function extractImports(content, ext) {
  const imports = [];

  // ES6 imports
  const esImportRe = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = esImportRe.exec(content))) {
    imports.push(match[1]);
  }

  // CommonJS require
  const cjsRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = cjsRe.exec(content))) {
    imports.push(match[1]);
  }

  // Python imports
  if (ext === ".py") {
    const pyRe = /(?:from|import)\s+([\w.]+)/g;
    while ((match = pyRe.exec(content))) {
      imports.push(match[1]);
    }
  }

  return [...new Set(imports)];
}

function extractExports(content, ext) {
  const exports = [];

  // ES6 exports
  const esExportRe =
    /export\s+(?:default\s+)?(?:(?:async\s+)?function|class|const|let|var)\s+(\w+)/g;
  let match;
  while ((match = esExportRe.exec(content))) {
    exports.push({ name: match[1], kind: "named" });
  }

  // module.exports
  if (/module\.exports\s*=/.test(content)) {
    exports.push({ name: "default", kind: "cjs" });
  }

  return exports;
}

function extractDefinitions(content, ext) {
  const defs = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Class definitions
    const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
    if (classMatch) {
      defs.push({ kind: "class", name: classMatch[1], line: i + 1 });
    }

    // Function definitions
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      defs.push({ kind: "function", name: funcMatch[1], line: i + 1 });
    }
  }

  return defs;
}

function getTopImports(relationships) {
  const counts = {};
  for (const r of relationships) {
    if (r.type === "imports") {
      counts[r.to] = (counts[r.to] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([to, count]) => ({ to, count }));
}
