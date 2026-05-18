/**
 * Impact Analyzer Skill Handler
 *
 * Predicts the blast radius of code changes by building a reverse
 * import graph, tracing transitive dependents (BFS, max depth 5),
 * mapping affected tests, and assigning risk scores.
 * Modes: --file, --function, --diff
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
]);
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "__pycache__",
  ".cache",
]);
const MAX_BFS_DEPTH = 5;
const MAX_FILES_SCAN = 2000;

// ── File collection ─────────────────────────────────────────────────

function collectSourceFiles(dir, maxFiles) {
  maxFiles = maxFiles || MAX_FILES_SCAN;
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

// ── Import parsing ──────────────────────────────────────────────────

const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_RE = /import\s+(?:[\w{},*\s]+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (_e) {
    return [];
  }
  const imports = [];
  const dir = path.dirname(filePath);
  for (const re of [REQUIRE_RE, IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    const regex = new RegExp(re.source, re.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const spec = match[1];
      if (spec.startsWith(".")) {
        const resolved = resolveImport(dir, spec);
        if (resolved) {
          imports.push(resolved);
        }
      }
    }
  }
  return imports;
}

function resolveImport(fromDir, spec) {
  const candidates = [
    spec,
    spec + ".js",
    spec + ".ts",
    spec + ".jsx",
    spec + ".tsx",
    spec + ".vue",
    spec + "/index.js",
    spec + "/index.ts",
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

// ── Reverse graph & helpers ──────────────────────────────────────

function git(cmd, cwd) {
  try {
    return execSync("git " + cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
  } catch (_e) {
    return "";
  }
}

function buildReverseGraph(allFiles) {
  const graph = new Map();
  for (const file of allFiles) {
    const imports = extractImports(file);
    for (const imp of imports) {
      if (!graph.has(imp)) {
        graph.set(imp, []);
      }
      graph.get(imp).push(file);
    }
  }
  return graph;
}

function findTransitiveDependents(targetFile, reverseGraph) {
  const directDeps = reverseGraph.get(targetFile) || [];
  const visited = new Set(directDeps.map((f) => f));
  const queue = [...directDeps.map((f) => ({ file: f, depth: 1 }))];
  const transitiveDeps = [];
  while (queue.length > 0) {
    const { file, depth } = queue.shift();
    if (depth >= MAX_BFS_DEPTH) {
      continue;
    }
    const next = reverseGraph.get(file) || [];
    for (const n of next) {
      if (!visited.has(n)) {
        visited.add(n);
        transitiveDeps.push(n);
        queue.push({ file: n, depth: depth + 1 });
      }
    }
  }
  return { directDeps, transitiveDeps };
}

function findTestFiles(targetFile, allFiles) {
  const base = path.basename(targetFile, path.extname(targetFile));
  const patterns = [base + ".test.", base + ".spec.", "__tests__/" + base];
  return allFiles.filter((f) => patterns.some((p) => f.includes(p)));
}

function detectIPCImpact(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const channels = [];
    const re = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(content)) !== null) {
      channels.push(match[1]);
    }
    return channels;
  } catch (_e) {
    return [];
  }
}

function findAffectedFrontend(ipcChannels, allFiles) {
  const affected = [];
  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      for (const ch of ipcChannels) {
        if (content.includes(ch)) {
          affected.push(file);
          break;
        }
      }
    } catch (_e) {
      /* skip */
    }
  }
  return affected;
}

function computeRisk(directCount, transitiveCount, testCount) {
  let riskScore = Math.min(10, directCount * 2 + transitiveCount * 0.5);
  if (testCount === 0) {
    riskScore = Math.min(10, riskScore + 3);
  }
  const riskLevel = riskScore >= 7 ? "HIGH" : riskScore >= 4 ? "MEDIUM" : "LOW";
  const recommendation =
    riskScore >= 7
      ? "High risk change. Review all dependents and run full test suite before merging."
      : riskScore >= 4
        ? "Medium risk. Run affected tests and review direct dependents."
        : "Low risk. Standard review process sufficient.";
  return {
    riskScore: Math.round(riskScore * 10) / 10,
    riskLevel,
    recommendation,
  };
}

// ── Analysis functions ──────────────────────────────────────────────

function analyzeFile(targetFile, projectRoot, allFiles, reverseGraph) {
  const { directDeps, transitiveDeps } = findTransitiveDependents(
    targetFile,
    reverseGraph,
  );
  const testFiles = findTestFiles(targetFile, allFiles);
  const ipcChannels = detectIPCImpact(targetFile);
  const frontendImpact =
    ipcChannels.length > 0 ? findAffectedFrontend(ipcChannels, allFiles) : [];
  const { riskScore, riskLevel, recommendation } = computeRisk(
    directDeps.length,
    transitiveDeps.length,
    testFiles.length,
  );
  const relTarget = path.relative(projectRoot, targetFile);
  const relDirect = directDeps.map((f) => path.relative(projectRoot, f));
  const relTransitive = transitiveDeps.map((f) =>
    path.relative(projectRoot, f),
  );
  const relTests = testFiles.map((f) => path.relative(projectRoot, f));
  const result = {
    targetFile: relTarget,
    directDependents: relDirect,
    transitiveDependents: relTransitive,
    affectedTests: relTests,
    ipcChannels,
    frontendImpact,
    riskScore,
    riskLevel,
    recommendation,
    totalDependents: directDeps.length + transitiveDeps.length,
  };
  const directList =
    relDirect.length > 0
      ? relDirect.map((f) => "  -> " + f).join("\n")
      : "  (none)";
  const transitiveList =
    relTransitive.length > 0
      ? relTransitive
          .slice(0, 10)
          .map((f) => "  -> " + f)
          .join("\n")
      : "  (none)";
  const testList =
    relTests.length > 0
      ? relTests.map((f) => "  -> " + f).join("\n")
      : "  (none -- consider adding tests!)";
  return {
    success: true,
    result,
    message:
      "Impact Analysis: " +
      relTarget +
      "\n" +
      "Direct dependents (" +
      directDeps.length +
      "):\n" +
      directList +
      "\n\n" +
      "Transitive dependents (" +
      transitiveDeps.length +
      "):\n" +
      transitiveList +
      "\n\n" +
      "Affected tests (" +
      testFiles.length +
      "):\n" +
      testList +
      "\n\n" +
      (ipcChannels.length > 0
        ? "IPC channels: " +
          ipcChannels.join(", ") +
          "\nFrontend impact: " +
          frontendImpact.length +
          " stores/pages\n\n"
        : "") +
      "Risk: " +
      riskLevel +
      " (score: " +
      riskScore +
      "/10)\nRecommendation: " +
      recommendation,
  };
}

async function analyzeDiff(projectRoot, allFiles, reverseGraph) {
  const diffFiles = git("diff --name-only", projectRoot);
  const stagedFiles = git("diff --cached --name-only", projectRoot);
  const combined = [
    ...new Set([
      ...diffFiles.split("\n").filter(Boolean),
      ...stagedFiles.split("\n").filter(Boolean),
    ]),
  ];
  if (combined.length === 0) {
    return {
      success: true,
      result: { changedFiles: [], totalDependents: 0, riskLevel: "LOW" },
      message: "No changes in current diff.",
    };
  }
  const allDirect = new Set();
  const allTransitive = new Set();
  const allTests = new Set();
  const allIPC = [];
  for (const rel of combined) {
    const absPath = path.resolve(projectRoot, rel);
    const { directDeps, transitiveDeps } = findTransitiveDependents(
      absPath,
      reverseGraph,
    );
    directDeps.forEach((d) => allDirect.add(path.relative(projectRoot, d)));
    transitiveDeps.forEach((d) =>
      allTransitive.add(path.relative(projectRoot, d)),
    );
    findTestFiles(absPath, allFiles).forEach((t) =>
      allTests.add(path.relative(projectRoot, t)),
    );
    allIPC.push(...detectIPCImpact(absPath));
  }
  const { riskScore, riskLevel, recommendation } = computeRisk(
    allDirect.size,
    allTransitive.size,
    allTests.size,
  );
  return {
    success: true,
    result: {
      changedFiles: combined,
      directDependents: [...allDirect],
      transitiveDependents: [...allTransitive],
      affectedTests: [...allTests],
      ipcChannels: [...new Set(allIPC)],
      riskScore,
      riskLevel,
      recommendation,
      totalDependents: allDirect.size + allTransitive.size,
    },
    message:
      "Diff Impact (" +
      combined.length +
      " files): Direct=" +
      allDirect.size +
      " Transitive=" +
      allTransitive.size +
      " Tests=" +
      allTests.size +
      " Risk=" +
      riskLevel,
  };
}

function analyzeFunction(funcName, projectRoot, allFiles) {
  const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const references = [];
  for (const file of allFiles) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch (_e) {
      continue;
    }
    const regex = new RegExp("\b" + escaped + "\b", "g");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        references.push({
          file: path.relative(projectRoot, file),
          line: i + 1,
          snippet: lines[i].trim().substring(0, 120),
        });
        regex.lastIndex = 0;
        break;
      }
    }
  }
  return {
    success: true,
    result: {
      functionName: funcName,
      references,
      referenceCount: references.length,
    },
    message:
      funcName +
      " referenced in " +
      references.length +
      " files:\n" +
      references
        .slice(0, 20)
        .map((r) => "  " + r.file + ":" + r.line + " -- " + r.snippet)
        .join("\n"),
  };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      "[impact-analyzer] init: " + (skill?.name || "impact-analyzer"),
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
    const fileMatch = input.match(/--file\s+(\S+)/);
    const funcMatch = input.match(/--function\s+(\S+)/);
    const isDiff = /--diff/i.test(input);

    try {
      logger.info("[impact-analyzer] Scanning source files...");
      const allFiles = collectSourceFiles(projectRoot);
      logger.info(
        "[impact-analyzer] Found " + allFiles.length + " source files",
      );
      const reverseGraph = buildReverseGraph(allFiles);

      if (isDiff) {
        return await analyzeDiff(projectRoot, allFiles, reverseGraph);
      }
      if (funcMatch) {
        return analyzeFunction(funcMatch[1], projectRoot, allFiles);
      }

      let targetPath = fileMatch
        ? fileMatch[1]
        : input.replace(/^--\w+\s*/, "").trim();
      if (!targetPath) {
        return {
          success: false,
          error:
            "No target specified. Usage: /impact-analyzer --file <path> | --function <name> | --diff",
        };
      }
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.resolve(projectRoot, targetPath);
      }
      if (!fs.existsSync(targetPath)) {
        return { success: false, error: "File not found: " + targetPath };
      }
      return analyzeFile(targetPath, projectRoot, allFiles, reverseGraph);
    } catch (err) {
      logger.error("[impact-analyzer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Impact analysis failed: " + err.message,
      };
    }
  },
};
