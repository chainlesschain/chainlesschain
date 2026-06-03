/**
 * Planning with Files Skill Handler
 *
 * Manus-style persistent markdown planning with 3-file pattern.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const DEFAULT_PLAN_DIR = ".planning";

module.exports = {
  async init(skill) {
    logger.info("[PlanningWithFiles] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);
    const planDir = resolvePlanDir(context);

    logger.info(`[PlanningWithFiles] Action: ${parsed.action}, Dir: ${planDir}`);

    try {
      switch (parsed.action) {
        case "create":
          return handleCreate(planDir, parsed.description);
        case "update":
          return handleUpdate(planDir, parsed.phase, parsed.status);
        case "status":
          return handleStatus(planDir);
        case "finding":
          return handleFinding(planDir, parsed.text);
        case "progress":
          return handleProgress(planDir, parsed.text);
        case "recover":
          return handleRecover(planDir);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use create, update, status, finding, progress, or recover.`,
          };
      }
    } catch (error) {
      logger.error("[PlanningWithFiles] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "status" };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "status").toLowerCase();

  // Extract quoted text
  const quotedMatch = trimmed.match(/"([^"]+)"/);
  const text = quotedMatch ? quotedMatch[1] : parts.slice(1).join(" ");

  if (action === "update") {
    return {
      action,
      phase: parts[1] || "1",
      status: parts[2] || "completed",
    };
  }

  return { action, description: text, text, phase: parts[1], status: parts[2] };
}

function resolvePlanDir(context) {
  const projectRoot = context.projectRoot || context.cwd || process.cwd();
  return path.join(projectRoot, DEFAULT_PLAN_DIR);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function handleCreate(planDir, description) {
  ensureDir(planDir);

  const title = description || "Untitled Task";
  const timestamp = new Date().toISOString();

  // task_plan.md
  const planContent = `# Task Plan: ${title}

## Objective
${description || "[Define the objective]"}

## Phases
- [ ] Phase 1: Research & Discovery
- [ ] Phase 2: Design & Architecture
- [ ] Phase 3: Implementation
- [ ] Phase 4: Testing & Validation
- [ ] Phase 5: Review & Cleanup

## Current Phase: 1
## Status: IN_PROGRESS

## Created: ${timestamp}
`;

  // findings.md
  const findingsContent = `# Findings: ${title}

## Research Notes

_Created: ${timestamp}_

---

`;

  // progress.md
  const progressContent = `# Progress Log: ${title}

## Session Log

### ${timestamp}
- Plan created
- Starting Phase 1: Research & Discovery

---

`;

  const planFile = path.join(planDir, "task_plan.md");
  const findingsFile = path.join(planDir, "findings.md");
  const progressFile = path.join(planDir, "progress.md");

  fs.writeFileSync(planFile, planContent, "utf8");
  fs.writeFileSync(findingsFile, findingsContent, "utf8");
  fs.writeFileSync(progressFile, progressContent, "utf8");

  return {
    success: true,
    action: "create",
    planDir,
    files: ["task_plan.md", "findings.md", "progress.md"],
    title,
    message: `Plan created in ${planDir}/ with 3 files.`,
  };
}

function handleUpdate(planDir, phase, status) {
  const planFile = path.join(planDir, "task_plan.md");
  if (!fs.existsSync(planFile)) {
    return { success: false, error: "No plan found. Create one first." };
  }

  let content = fs.readFileSync(planFile, "utf8");
  const phaseNum = parseInt(phase, 10) || 1;

  // Update checkbox for the phase
  const phaseRegex = new RegExp(
    `- \\[[ x]\\] Phase ${phaseNum}:`,
    "i",
  );

  if (status === "completed" || status === "done") {
    content = content.replace(phaseRegex, `- [x] Phase ${phaseNum}:`);
    // Move to next phase
    const nextPhase = phaseNum + 1;
    content = content.replace(
      /## Current Phase: \d+/,
      `## Current Phase: ${nextPhase}`,
    );
  } else if (status === "in-progress" || status === "active") {
    content = content.replace(
      /## Current Phase: \d+/,
      `## Current Phase: ${phaseNum}`,
    );
    content = content.replace(/## Status: \w+/, "## Status: IN_PROGRESS");
  }

  fs.writeFileSync(planFile, content, "utf8");

  // Also log to progress
  appendToProgress(planDir, `Phase ${phaseNum} marked as ${status}`);

  return {
    success: true,
    action: "update",
    phase: phaseNum,
    status,
    message: `Phase ${phaseNum} updated to ${status}.`,
  };
}

function handleStatus(planDir) {
  const planFile = path.join(planDir, "task_plan.md");
  if (!fs.existsSync(planFile)) {
    return {
      success: true,
      action: "status",
      exists: false,
      message: "No plan found. Use 'create' to start one.",
    };
  }

  const content = fs.readFileSync(planFile, "utf8");

  // Parse status
  const phaseMatch = content.match(/## Current Phase: (\d+)/);
  const statusMatch = content.match(/## Status: (\w+)/);
  const titleMatch = content.match(/# Task Plan: (.+)/);

  const phases = [];
  const phaseRegex = /- \[([ x])\] Phase (\d+): (.+)/g;
  let match;
  while ((match = phaseRegex.exec(content)) !== null) {
    phases.push({
      phase: parseInt(match[2], 10),
      name: match[3].trim(),
      completed: match[1] === "x",
    });
  }

  const completedCount = phases.filter((p) => p.completed).length;

  return {
    success: true,
    action: "status",
    exists: true,
    title: titleMatch ? titleMatch[1] : "Unknown",
    currentPhase: phaseMatch ? parseInt(phaseMatch[1], 10) : 1,
    status: statusMatch ? statusMatch[1] : "UNKNOWN",
    phases,
    progress: `${completedCount}/${phases.length} phases completed`,
    planDir,
  };
}

function handleFinding(planDir, text) {
  if (!text) {
    return { success: false, error: "No finding text provided." };
  }

  const findingsFile = path.join(planDir, "findings.md");
  if (!fs.existsSync(findingsFile)) {
    return { success: false, error: "No plan found. Create one first." };
  }

  const timestamp = new Date().toISOString();
  const entry = `\n### ${timestamp}\n${text}\n`;
  fs.appendFileSync(findingsFile, entry, "utf8");

  return {
    success: true,
    action: "finding",
    text,
    message: `Finding added to findings.md.`,
  };
}

function handleProgress(planDir, text) {
  if (!text) {
    return { success: false, error: "No progress note provided." };
  }

  appendToProgress(planDir, text);

  return {
    success: true,
    action: "progress",
    text,
    message: `Progress note added to progress.md.`,
  };
}

function handleRecover(planDir) {
  const files = ["task_plan.md", "findings.md", "progress.md"];
  const recovered = {};

  for (const file of files) {
    const filePath = path.join(planDir, file);
    if (fs.existsSync(filePath)) {
      recovered[file] = fs.readFileSync(filePath, "utf8");
    }
  }

  if (Object.keys(recovered).length === 0) {
    return {
      success: false,
      action: "recover",
      message: "No plan files found to recover.",
    };
  }

  // Parse current state from task_plan.md
  const plan = recovered["task_plan.md"] || "";
  const phaseMatch = plan.match(/## Current Phase: (\d+)/);
  const statusMatch = plan.match(/## Status: (\w+)/);
  const titleMatch = plan.match(/# Task Plan: (.+)/);

  return {
    success: true,
    action: "recover",
    title: titleMatch ? titleMatch[1] : "Unknown",
    currentPhase: phaseMatch ? parseInt(phaseMatch[1], 10) : 1,
    status: statusMatch ? statusMatch[1] : "UNKNOWN",
    filesRecovered: Object.keys(recovered),
    planDir,
    message: `Recovered ${Object.keys(recovered).length} plan file(s). Resume from Phase ${phaseMatch ? phaseMatch[1] : "?"}`,
  };
}

function appendToProgress(planDir, text) {
  const progressFile = path.join(planDir, "progress.md");
  if (fs.existsSync(progressFile)) {
    const timestamp = new Date().toISOString();
    const entry = `\n### ${timestamp}\n- ${text}\n`;
    fs.appendFileSync(progressFile, entry, "utf8");
  }
}
