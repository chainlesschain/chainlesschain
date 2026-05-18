/**
 * Dependency Analyzer Skill Handler
 *
 * Builds import/require graphs, detects circular dependencies,
 * performs change impact analysis, and checks npm audit vulnerabilities.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
]);
const CODE_EXTS = new Set(["js", "mjs", "ts", "tsx", "jsx", "vue"]);

module.exports = {
  async init(skill) {
    logger.info("[DependencyAnalyzer] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[DependencyAnalyzer] Action: ${action}`, { options });

    try {
      switch (action) {
        case "impact":
          return await handleImpact(options.targetPath, options.targetDir);
        case "circular":
          return await handleCircular(options.targetDir);
        case "vulnerabilities":
          return await handleVulnerabilities(options.targetDir);
        case "licenses":
          return await handleLicenses(options.targetDir);
        default:
          return await handleGraph(options.targetDir);
      }
    } catch (error) {
      logger.error(`[DependencyAnalyzer] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Dependency analysis failed: ${error.message}`,
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
  let action = "graph";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--impact") {
      action = "impact";
    } else if (p === "--circular") {
      action = "circular";
    } else if (p === "--graph") {
      action = "graph";
    } else if (p === "--vulnerabilities") {
      action = "vulnerabilities";
    } else if (p === "--licenses") {
      action = "licenses";
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
      if (files.length >= 500) {
        return files;
      }
    }
  }
  return files;
}

function extractImports(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const imports = [];

  // ES6 imports: import ... from '...'
  const esRe = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = esRe.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // CommonJS require: require('...')
  const cjsRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsRe.exec(content)) !== null) {
    imports.push(m[1]);
  }

  return imports;
}

function resolveImport(importPath, fromFile, baseDir) {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null;
  } // npm package

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);

  // Try extensions
  const exts = [
    ".js",
    ".ts",
    ".mjs",
    ".jsx",
    ".tsx",
    ".vue",
    "/index.js",
    "/index.ts",
  ];
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return resolved;
  }
  for (const ext of exts) {
    if (fs.existsSync(resolved + ext)) {
      return resolved + ext;
    }
  }
  return null;
}

function buildImportGraph(files, baseDir) {
  const graph = new Map(); // file -> [imported files]
  const reverseGraph = new Map(); // file -> [files that import it]

  for (const file of files) {
    const imports = extractImports(file);
    const resolvedImports = [];

    for (const imp of imports) {
      const resolved = resolveImport(imp, file, baseDir);
      if (resolved && files.includes(resolved)) {
        resolvedImports.push(resolved);
        if (!reverseGraph.has(resolved)) {
          reverseGraph.set(resolved, []);
        }
        reverseGraph.get(resolved).push(file);
      }
    }

    graph.set(file, resolvedImports);
  }

  return { graph, reverseGraph };
}

async function handleGraph(targetDir) {
  const files = collectFiles(targetDir);
  const { graph } = buildImportGraph(files, targetDir);

  const edges = [];
  for (const [file, imports] of graph) {
    for (const imp of imports) {
      edges.push({
        from: path.relative(targetDir, file),
        to: path.relative(targetDir, imp),
      });
    }
  }

  const fileCount = files.length;
  const edgeCount = edges.length;

  // Top files by import count
  const importCounts = {};
  for (const edge of edges) {
    importCounts[edge.to] = (importCounts[edge.to] || 0) + 1;
  }

  const topImported = Object.entries(importCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);

  const report =
    `Dependency Graph\n${"=".repeat(25)}\n` +
    `Files: ${fileCount}, Edges: ${edgeCount}\n\n` +
    `Most imported files:\n` +
    topImported
      .map(([file, count]) => `  ${file} (imported by ${count} files)`)
      .join("\n");

  return {
    success: true,
    result: { fileCount, edgeCount, topImported, edges: edges.slice(0, 100) },
    message: report,
  };
}

async function handleImpact(targetPath, targetDir) {
  if (!targetPath) {
    return { success: false, message: "Usage: --impact <file-path>" };
  }

  const files = collectFiles(targetDir);
  const { reverseGraph } = buildImportGraph(files, targetDir);

  // BFS for transitive dependents
  const visited = new Set();
  const queue = [targetPath];
  const directDeps = [];
  const transitiveDeps = [];
  let level = 0;

  while (queue.length > 0) {
    const size = queue.length;
    for (let i = 0; i < size; i++) {
      const current = queue.shift();
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const dependents = reverseGraph.get(current) || [];
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          if (level === 0) {
            directDeps.push(dep);
          } else {
            transitiveDeps.push(dep);
          }
          queue.push(dep);
        }
      }
    }
    level++;
    if (level > 10) {
      break;
    } // prevent infinite loops
  }

  const relTarget = path.relative(targetDir, targetPath);
  const report =
    `Impact Analysis: ${relTarget}\n${"=".repeat(40)}\n\n` +
    `Direct dependents: ${directDeps.length} files\n` +
    directDeps.map((f) => `  -> ${path.relative(targetDir, f)}`).join("\n") +
    `\n\nTransitive dependents: ${transitiveDeps.length} files\n` +
    transitiveDeps
      .slice(0, 20)
      .map((f) => `  -> ${path.relative(targetDir, f)}`)
      .join("\n") +
    `\n\nTotal affected: ${directDeps.length + transitiveDeps.length} files` +
    `\nRisk level: ${directDeps.length > 10 ? "HIGH" : directDeps.length > 5 ? "MEDIUM" : "LOW"}`;

  return {
    success: true,
    result: {
      target: relTarget,
      directDeps: directDeps.length,
      transitiveDeps: transitiveDeps.length,
    },
    message: report,
  };
}

async function handleCircular(targetDir) {
  const files = collectFiles(targetDir);
  const { graph } = buildImportGraph(files, targetDir);

  // Detect cycles using DFS
  const cycles = [];
  const visited = new Set();
  const inStack = new Set();
  const stackPath = [];

  function dfs(node) {
    if (inStack.has(node)) {
      const cycleStart = stackPath.indexOf(node);
      if (cycleStart >= 0) {
        const cycle = stackPath
          .slice(cycleStart)
          .map((f) => path.relative(targetDir, f));
        cycles.push(cycle);
      }
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    inStack.add(node);
    stackPath.push(node);

    const deps = graph.get(node) || [];
    for (const dep of deps) {
      dfs(dep);
    }

    inStack.delete(node);
    stackPath.pop();
  }

  for (const file of files) {
    if (!visited.has(file)) {
      dfs(file);
    }
  }

  const report =
    cycles.length > 0
      ? `Circular Dependencies Found: ${cycles.length}\n${"=".repeat(40)}\n\n` +
        cycles
          .slice(0, 10)
          .map((cycle, i) => `${i + 1}. ${cycle.join(" -> ")} -> ${cycle[0]}`)
          .join("\n\n")
      : `No circular dependencies found in ${files.length} files.`;

  return {
    success: true,
    result: { cycles: cycles.slice(0, 20), fileCount: files.length },
    message: report,
  };
}

async function handleVulnerabilities(targetDir) {
  let auditOutput;
  try {
    auditOutput = execSync("npm audit --json 2>/dev/null", {
      encoding: "utf-8",
      cwd: targetDir,
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    // npm audit returns non-zero when vulnerabilities exist
    auditOutput = err.stdout || "";
  }

  if (!auditOutput) {
    return {
      success: true,
      result: { vulnerabilities: [] },
      message: "npm audit returned no data. Ensure package-lock.json exists.",
    };
  }

  let audit;
  try {
    audit = JSON.parse(auditOutput);
  } catch {
    return {
      success: true,
      result: {},
      message: "Could not parse npm audit output.",
    };
  }

  const vulns = audit.vulnerabilities || {};
  const summary = audit.metadata || {};

  const vulnList = Object.entries(vulns).map(([pkg, info]) => ({
    package: pkg,
    severity: info.severity,
    via: Array.isArray(info.via)
      ? info.via.filter((v) => typeof v === "string")
      : [],
    fixAvailable: !!info.fixAvailable,
  }));

  const bySeverity = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const v of vulnList) {
    if (bySeverity[v.severity] !== undefined) {
      bySeverity[v.severity]++;
    }
  }

  const report =
    `Vulnerability Report\n${"=".repeat(25)}\n` +
    `Total: ${vulnList.length} vulnerable packages\n` +
    `Critical: ${bySeverity.critical}, High: ${bySeverity.high}, Moderate: ${bySeverity.moderate}, Low: ${bySeverity.low}\n\n` +
    vulnList
      .sort((a, b) => {
        const order = { critical: 0, high: 1, moderate: 2, low: 3 };
        return (order[a.severity] || 4) - (order[b.severity] || 4);
      })
      .slice(0, 30)
      .map(
        (v) =>
          `  ${v.severity.toUpperCase()} ${v.package}${v.fixAvailable ? " (fix available)" : ""}`,
      )
      .join("\n");

  return {
    success: true,
    result: { vulnerabilities: vulnList, bySeverity },
    message: report,
  };
}

async function handleLicenses(targetDir) {
  const pkgLockPath = path.join(targetDir, "node_modules");
  if (!fs.existsSync(pkgLockPath)) {
    return {
      success: false,
      message: "node_modules not found. Run npm install first.",
    };
  }

  const licenses = {};
  let entries;
  try {
    entries = fs.readdirSync(pkgLockPath, { withFileTypes: true });
  } catch {
    return { success: false, message: "Cannot read node_modules." };
  }

  let scanned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const pkgJsonPath = path.join(pkgLockPath, entry.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      continue;
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      const license = pkg.license || "UNKNOWN";
      licenses[license] = (licenses[license] || 0) + 1;
      scanned++;
    } catch {
      /* skip */
    }

    if (scanned >= 500) {
      break;
    }
  }

  const sorted = Object.entries(licenses).sort(([, a], [, b]) => b - a);
  const gplWarnings = sorted.filter(
    ([lic]) => /GPL/i.test(lic) && !/LGPL/i.test(lic),
  );

  const report =
    `License Report\n${"=".repeat(20)}\nPackages scanned: ${scanned}\n\n` +
    sorted.map(([lic, count]) => `  ${lic}: ${count} packages`).join("\n") +
    (gplWarnings.length > 0
      ? `\n\n GPL Warning: ${gplWarnings.map(([lic, count]) => `${lic} (${count})`).join(", ")} - may have copyleft requirements`
      : "");

  return {
    success: true,
    result: { licenses, scanned, gplWarnings: gplWarnings.map(([lic]) => lic) },
    message: report,
  };
}
