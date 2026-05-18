/**
 * Architect Mode Skill Handler
 *
 * Two-phase architecture mode: Plan first, then edit.
 * Separates reasoning from code modification to improve accuracy
 * on complex multi-file changes.
 *
 * Modes:
 *   default      - plan + review + execute
 *   --plan-only  - generate plan, stop before execution
 *   --execute    - execute a previously generated plan by ID
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { logger } = require("../../../../../utils/logger.js");

// -- Constants ---------------------------------------------------------------

const CODE_EXTS = new Set([
  ".js",
  ".mjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".py",
  ".java",
  ".kt",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".h",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".sql",
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
  ".vite",
  "vendor",
  "target",
]);

const MAX_SCAN_FILES = 200;
const MAX_FILE_SIZE = 256 * 1024; // 256 KB

/** In-memory plan store (keyed by plan ID). */
const planStore = new Map();

// -- Exports -----------------------------------------------------------------

module.exports = {
  async init(skill) {
    logger.info(
      `[architect-mode] handler initialized for "${skill?.name || "architect-mode"}"`,
    );
  },

  async execute(task, context = {}, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.args ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    const { mode, taskDescription, planId } = parseInput(input);

    logger.info(
      `[architect-mode] mode=${mode}, task="${taskDescription}", planId=${planId || "N/A"}`,
    );

    try {
      switch (mode) {
        case "plan-only":
          return await handlePlanOnly(taskDescription, projectRoot);
        case "execute":
          return await handleExecute(planId, projectRoot);
        default:
          return await handleFull(taskDescription, projectRoot);
      }
    } catch (error) {
      logger.error(`[architect-mode] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Architect mode failed: ${error.message}`,
      };
    }
  },
};

// -- Input Parsing -----------------------------------------------------------

function parseInput(input) {
  const parts = (input || "").trim().split(/\s+/);
  let mode = "full";
  let taskDescription = "";
  let planId = null;

  const rest = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--plan-only") {
      mode = "plan-only";
    } else if (p === "--execute") {
      mode = "execute";
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        planId = parts[++i];
      }
    } else {
      rest.push(p);
    }
  }

  taskDescription = rest
    .join(" ")
    .replace(/^['"]|['"]$/g, "")
    .trim();

  return { mode, taskDescription, planId };
}

// -- Mode Handlers -----------------------------------------------------------

async function handlePlanOnly(taskDescription, projectRoot) {
  if (!taskDescription) {
    return {
      success: false,
      message: "Usage: /architect-mode --plan-only <task description>",
    };
  }

  const plan = await generatePlan(taskDescription, projectRoot);
  planStore.set(plan.id, plan);

  const report = formatPlanReport(plan);
  return {
    success: true,
    result: { plan, status: "awaiting-review" },
    message:
      report +
      "\n\nPlan saved. Execute with: /architect-mode --execute " +
      plan.id,
  };
}

async function handleExecute(planId, projectRoot) {
  if (!planId) {
    return {
      success: false,
      message: "Usage: /architect-mode --execute <plan-id>",
    };
  }

  const plan = planStore.get(planId);
  if (!plan) {
    return {
      success: false,
      message: `Plan "${planId}" not found. Available plans: ${[...planStore.keys()].join(", ") || "(none)"}`,
    };
  }

  const result = await executePlan(plan, projectRoot);
  return result;
}

async function handleFull(taskDescription, projectRoot) {
  if (!taskDescription) {
    return {
      success: false,
      message:
        "Usage: /architect-mode <task description>\n" +
        "       /architect-mode --plan-only <task description>\n" +
        "       /architect-mode --execute <plan-id>",
    };
  }

  // Phase 1: Generate plan
  const plan = await generatePlan(taskDescription, projectRoot);
  planStore.set(plan.id, plan);

  // Phase 2: Execute plan
  const execResult = await executePlan(plan, projectRoot);

  const report = formatPlanReport(plan);
  return {
    success: execResult.success,
    result: {
      plan,
      edits: execResult.result?.edits || [],
      status: "completed",
    },
    message: report + "\n\n" + execResult.message,
  };
}

// -- Plan Generation ---------------------------------------------------------

async function generatePlan(taskDescription, projectRoot) {
  const planId = "plan-" + crypto.randomBytes(4).toString("hex");
  logger.info(
    `[architect-mode] Generating plan ${planId} for: "${taskDescription}"`,
  );

  const keywords = extractKeywords(taskDescription);
  const allFiles = collectFiles(projectRoot);
  const relevantFiles = rankFilesByRelevance(allFiles, keywords, projectRoot);
  const fileAnalysis = analyzeFiles(relevantFiles.slice(0, 30), projectRoot);
  const phases = buildPhases(
    taskDescription,
    keywords,
    fileAnalysis,
    projectRoot,
  );
  const estimate = computeEstimate(phases);

  const plan = {
    id: planId,
    task: taskDescription,
    keywords,
    createdAt: new Date().toISOString(),
    phases,
    estimate,
    relevantFilesScanned: relevantFiles.length,
    totalFilesScanned: allFiles.length,
  };

  logger.info(
    `[architect-mode] Plan ${planId}: ${estimate.totalFiles} files ` +
      `(${estimate.filesToCreate} create, ${estimate.filesToModify} modify, ${estimate.filesToDelete} delete)`,
  );

  return plan;
}

function extractKeywords(text) {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "must",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "and",
    "but",
    "or",
    "nor",
    "not",
    "so",
    "yet",
    "both",
    "either",
    "add",
    "create",
    "make",
    "build",
    "implement",
    "update",
    "change",
    "modify",
    "use",
    "using",
    "support",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));

  return [...new Set(words)];
}

function collectFiles(dir, depth = 0, maxDepth = 8) {
  const results = [];
  if (depth > maxDepth || results.length >= MAX_SCAN_FILES) {
    return results;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= MAX_SCAN_FILES) {
      break;
    }
    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, depth + 1, maxDepth));
    } else if (CODE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

function rankFilesByRelevance(files, keywords, projectRoot) {
  const scored = files.map((filePath) => {
    const rel = path
      .relative(projectRoot, filePath)
      .replace(/\\/g, "/")
      .toLowerCase();
    const parts = rel.split(/[/\-_.]/);
    let score = 0;

    for (const kw of keywords) {
      if (parts.includes(kw)) {
        score += 10;
      } else if (rel.includes(kw)) {
        score += 5;
      }
    }

    if (rel.includes("src/")) {
      score += 2;
    }
    if (rel.endsWith(".test.js") || rel.endsWith(".spec.js")) {
      score -= 3;
    }

    return { filePath, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.filePath);
}

function analyzeFiles(files, projectRoot) {
  const analysis = [];

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        continue;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const rel = path.relative(projectRoot, filePath).replace(/\\/g, "/");

      const fileExports = [];
      const fileImports = [];

      for (const line of lines) {
        const expMatch = line.match(
          /(?:module\.exports|export\s+(?:default\s+)?(?:class|function|const|let))\s*[={\s]*(\w+)?/,
        );
        if (expMatch) {
          fileExports.push(expMatch[1] || "(default)");
        }

        const impMatch = line.match(
          /(?:require|import)\s*\(?['"]([^'"]+)['"]\)?/,
        );
        if (impMatch) {
          fileImports.push(impMatch[1]);
        }
      }

      analysis.push({
        path: rel,
        lineCount: lines.length,
        exports: fileExports.slice(0, 10),
        imports: fileImports.slice(0, 20),
        ext: path.extname(filePath),
      });
    } catch {
      // Skip unreadable files
    }
  }

  return analysis;
}

// -- Phase Builder -----------------------------------------------------------

function buildPhases(taskDescription, keywords, fileAnalysis, projectRoot) {
  const phases = [];
  const filesInPlan = new Map();

  for (const file of fileAnalysis) {
    const fileParts = file.path.toLowerCase().split(/[/\-_.]/);
    let relevance = 0;
    const matchedKeywords = [];

    for (const kw of keywords) {
      if (fileParts.includes(kw)) {
        relevance += 10;
        matchedKeywords.push(kw);
      } else if (file.path.toLowerCase().includes(kw)) {
        relevance += 5;
        matchedKeywords.push(kw);
      }
    }

    for (const imp of file.imports) {
      for (const kw of keywords) {
        if (imp.toLowerCase().includes(kw)) {
          relevance += 3;
        }
      }
    }

    if (relevance >= 5) {
      filesInPlan.set(file.path, {
        action: "modify",
        reason: `Update for ${matchedKeywords.join(", ")} (relevance: ${relevance})`,
        estimatedLines: Math.min(Math.ceil(file.lineCount * 0.1), 50),
      });
    }
  }

  const newFiles = inferNewFiles(
    taskDescription,
    keywords,
    projectRoot,
    fileAnalysis,
  );
  for (const nf of newFiles) {
    filesInPlan.set(nf.path, {
      action: "create",
      reason: nf.reason,
      estimatedLines: nf.estimatedLines,
    });
  }

  const layerOrder = ["database", "main", "ipc", "renderer", "test"];
  const phaseMap = new Map();

  for (const [filePath, info] of filesInPlan) {
    let layer = "other";
    for (const l of layerOrder) {
      if (filePath.toLowerCase().includes(l)) {
        layer = l;
        break;
      }
    }
    if (!phaseMap.has(layer)) {
      phaseMap.set(layer, []);
    }
    phaseMap.get(layer).push({ path: filePath, ...info });
  }

  const layerDescriptions = {
    database: "Database schema and data layer changes",
    main: "Core backend / main process logic",
    ipc: "IPC handlers and communication layer",
    renderer: "Frontend UI components and pages",
    test: "Test files and test infrastructure",
    other: "Supporting files and configuration",
  };

  let order = 1;
  for (const layer of [...layerOrder, "other"]) {
    const files = phaseMap.get(layer);
    if (!files || files.length === 0) {
      continue;
    }

    phases.push({
      order: order++,
      description: layerDescriptions[layer] || `${layer} layer changes`,
      layer,
      files: files.sort((a, b) => {
        if (a.action !== b.action) {
          return a.action === "create" ? -1 : 1;
        }
        return a.path.localeCompare(b.path);
      }),
    });
  }

  if (phases.length === 0) {
    phases.push({
      order: 1,
      description: `Implement: ${taskDescription}`,
      layer: "other",
      files: [
        {
          path: `src/main/${keywords[0] || "feature"}/index.js`,
          action: "create",
          reason: `New module for: ${taskDescription}`,
          estimatedLines: 100,
        },
      ],
    });
  }

  return phases;
}

function inferNewFiles(taskDescription, keywords, projectRoot, existingFiles) {
  const newFiles = [];
  const existingPaths = new Set(existingFiles.map((f) => f.path.toLowerCase()));

  const moduleKeywords = keywords.filter(
    (kw) =>
      !["test", "fix", "bug", "refactor", "optimize", "performance"].includes(
        kw,
      ),
  );

  for (const kw of moduleKeywords.slice(0, 3)) {
    const mainPath = `src/main/${kw}/index.js`;
    if (!existingPaths.has(mainPath.toLowerCase())) {
      const hasExisting = [...existingPaths].some((p) => p.includes(`/${kw}`));
      if (!hasExisting) {
        newFiles.push({
          path: mainPath,
          reason: `New ${kw} module entry point`,
          estimatedLines: 80,
        });
      }
    }

    const ipcPath = `src/main/${kw}/${kw}-ipc.js`;
    if (!existingPaths.has(ipcPath.toLowerCase())) {
      const hasIpc = [...existingPaths].some(
        (p) => p.includes(kw) && p.includes("ipc"),
      );
      if (!hasIpc && newFiles.some((f) => f.path.includes(`/${kw}/`))) {
        newFiles.push({
          path: ipcPath,
          reason: `IPC handlers for ${kw}`,
          estimatedLines: 60,
        });
      }
    }
  }

  return newFiles;
}

// -- Estimate Computation ----------------------------------------------------

function computeEstimate(phases) {
  let filesToCreate = 0;
  let filesToModify = 0;
  let filesToDelete = 0;
  let linesAdded = 0;
  let linesModified = 0;
  let linesDeleted = 0;

  for (const phase of phases) {
    for (const file of phase.files) {
      switch (file.action) {
        case "create":
          filesToCreate++;
          linesAdded += file.estimatedLines || 50;
          break;
        case "modify":
          filesToModify++;
          linesModified += file.estimatedLines || 20;
          linesAdded += Math.ceil((file.estimatedLines || 20) * 0.5);
          break;
        case "delete":
          filesToDelete++;
          linesDeleted += file.estimatedLines || 0;
          break;
      }
    }
  }

  return {
    totalFiles: filesToCreate + filesToModify + filesToDelete,
    filesToCreate,
    filesToModify,
    filesToDelete,
    linesAdded,
    linesModified,
    linesDeleted,
  };
}

// -- Plan Execution ----------------------------------------------------------

async function executePlan(plan, projectRoot) {
  logger.info(
    `[architect-mode] Executing plan ${plan.id}: ${plan.estimate.totalFiles} files`,
  );

  const edits = [];
  let completed = 0;
  let failed = 0;
  const total = plan.estimate.totalFiles;
  const progressLines = [];

  for (const phase of plan.phases) {
    for (const file of phase.files) {
      const absPath = path.isAbsolute(file.path)
        ? file.path
        : path.resolve(projectRoot, file.path);

      completed++;
      const editEntry = {
        file: file.path,
        action: file.action,
        reason: file.reason,
        status: "pending",
        description: "",
      };

      try {
        switch (file.action) {
          case "create": {
            const dir = path.dirname(absPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            const content = generateFileTemplate(file, plan.task);
            fs.writeFileSync(absPath, content, "utf-8");
            const lineCount = content.split("\n").length;
            editEntry.status = "success";
            editEntry.description = `Created (${lineCount} lines)`;
            progressLines.push(
              `  [${completed}/${total}] Created ${file.path} (${lineCount} lines)`,
            );
            break;
          }

          case "modify": {
            if (!fs.existsSync(absPath)) {
              editEntry.status = "skipped";
              editEntry.description = "File not found, skipped";
              progressLines.push(
                `  [${completed}/${total}] Skipped ${file.path} (not found)`,
              );
              break;
            }
            const original = fs.readFileSync(absPath, "utf-8");
            const modified = applyModification(original, file, plan.task);
            fs.writeFileSync(absPath, modified, "utf-8");

            const origLines = original.split("\n").length;
            const modLines = modified.split("\n").length;
            const diff = modLines - origLines;
            editEntry.status = "success";
            editEntry.description = `Modified (${diff >= 0 ? "+" : ""}${diff} lines)`;
            progressLines.push(
              `  [${completed}/${total}] Modified ${file.path} (${diff >= 0 ? "+" : ""}${diff} lines)`,
            );
            break;
          }

          case "delete": {
            if (fs.existsSync(absPath)) {
              fs.unlinkSync(absPath);
              editEntry.status = "success";
              editEntry.description = "Deleted";
              progressLines.push(
                `  [${completed}/${total}] Deleted ${file.path}`,
              );
            } else {
              editEntry.status = "skipped";
              editEntry.description = "Already absent";
              progressLines.push(
                `  [${completed}/${total}] Skipped ${file.path} (already absent)`,
              );
            }
            break;
          }

          default:
            editEntry.status = "skipped";
            editEntry.description = `Unknown action: ${file.action}`;
        }
      } catch (err) {
        failed++;
        editEntry.status = "error";
        editEntry.description = err.message;
        progressLines.push(
          `  [${completed}/${total}] FAILED ${file.path}: ${err.message}`,
        );
        logger.error(
          `[architect-mode] Edit failed for ${file.path}: ${err.message}`,
        );
      }

      edits.push(editEntry);
    }
  }

  const successCount = edits.filter((e) => e.status === "success").length;
  const skipCount = edits.filter((e) => e.status === "skipped").length;

  const summary =
    `Executing plan ${plan.id}...\n` +
    progressLines.join("\n") +
    `\n\nResult: ${successCount}/${total} edits applied successfully.` +
    (skipCount > 0 ? ` ${skipCount} skipped.` : "") +
    (failed > 0 ? ` ${failed} failed.` : " 0 conflicts.");

  return {
    success: failed === 0,
    result: { planId: plan.id, edits, successCount, skipCount, failed },
    message: summary,
  };
}

// -- File Template Generation ------------------------------------------------

function generateFileTemplate(file, task) {
  const ext = path.extname(file.path);
  const moduleName = path.basename(file.path, ext);
  const header =
    "/**\n" +
    ` * ${moduleName}\n` +
    " *\n" +
    ` * Auto-generated by architect-mode for: ${task}\n` +
    ` * Reason: ${file.reason}\n` +
    " *\n" +
    " * TODO: Implement the actual logic\n" +
    " */\n\n";

  if (ext === ".js" || ext === ".mjs") {
    return (
      header +
      "'use strict';\n\n" +
      `// TODO: Implement ${file.reason}\n\n` +
      "module.exports = {\n" +
      "  // Export your public API here\n" +
      "};\n"
    );
  }

  if (ext === ".ts" || ext === ".tsx") {
    return (
      header +
      `// TODO: Implement ${file.reason}\n\n` +
      "export default {\n" +
      "  // Export your public API here\n" +
      "};\n"
    );
  }

  if (ext === ".vue") {
    return (
      `<template>\n  <div class="${moduleName}">\n` +
      `    <!-- TODO: ${file.reason} -->\n` +
      `    <h2>${moduleName}</h2>\n` +
      "  </div>\n</template>\n\n" +
      "<script setup>\n" +
      `// Auto-generated by architect-mode for: ${task}\n` +
      "// TODO: Implement component logic\n" +
      "</script>\n\n" +
      `<style scoped>\n.${moduleName} {\n  padding: 16px;\n}\n</style>\n`
    );
  }

  if (ext === ".py") {
    return (
      `"""\n${moduleName}\n\nAuto-generated by architect-mode for: ${task}\nReason: ${file.reason}\n"""\n\n` +
      `# TODO: Implement ${file.reason}\n`
    );
  }

  return header + `// TODO: Implement ${file.reason}\n`;
}

// -- File Modification -------------------------------------------------------

function applyModification(content, file, task) {
  const lines = content.split("\n");

  let insertIndex = 0;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (
      lines[i].startsWith(" *") ||
      lines[i].startsWith("//") ||
      lines[i].startsWith("/*") ||
      lines[i].trim() === ""
    ) {
      insertIndex = i + 1;
    } else {
      break;
    }
  }

  const marker = [
    "",
    `// [architect-mode] TODO: ${file.reason}`,
    `// Task: ${task}`,
    `// Action: ${file.action} -- implement changes below`,
    "",
  ];

  lines.splice(insertIndex, 0, ...marker);
  return lines.join("\n");
}

// -- Plan Formatting ---------------------------------------------------------

function formatPlanReport(plan) {
  const divider = "=".repeat(50);
  const lines = [
    `Architecture Plan: ${plan.id}`,
    divider,
    "",
    `Task: ${plan.task}`,
    `Keywords: ${plan.keywords.join(", ")}`,
    `Scanned: ${plan.relevantFilesScanned} relevant files (${plan.totalFilesScanned} total)`,
    "",
  ];

  for (const phase of plan.phases) {
    const fileCount = phase.files.length;
    lines.push(
      `Phase ${phase.order}: ${phase.description} (${fileCount} file${fileCount !== 1 ? "s" : ""})`,
    );

    for (const file of phase.files) {
      const tag = `[${file.action.toUpperCase()}]`;
      const est =
        file.action === "create"
          ? `(~${file.estimatedLines} lines)`
          : file.action === "modify"
            ? `(~${file.estimatedLines} lines modified)`
            : "";
      lines.push(`  ${tag} ${file.path} -- ${file.reason} ${est}`);
    }
    lines.push("");
  }

  const e = plan.estimate;
  lines.push(
    `Estimate: ${e.totalFiles} files ` +
      `(${e.filesToCreate} new, ${e.filesToModify} modified` +
      (e.filesToDelete > 0 ? `, ${e.filesToDelete} deleted` : "") +
      `), +${e.linesAdded} lines, ~${e.linesModified} lines modified` +
      (e.linesDeleted > 0 ? `, -${e.linesDeleted} lines deleted` : ""),
  );

  return lines.join("\n");
}
