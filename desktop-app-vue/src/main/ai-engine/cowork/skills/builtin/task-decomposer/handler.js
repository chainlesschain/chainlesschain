/**
 * Task Decomposer Skill Handler
 *
 * Intelligently decomposes complex user requests into ordered sub-tasks,
 * maps each to the best-matching built-in skill, resolves dependency order,
 * and optionally orchestrates execution with progress tracking.
 *
 * Modes:
 *   --analyze   Decompose only (default behaviour)
 *   --execute   Decompose then run all sub-tasks in dependency order
 *   --status    Check progress of a previous decomposition by ID
 */

const { logger } = require("../../../../../utils/logger.js");

// ── In-memory store for decomposition results ──────────────────────
const decompositions = new Map();

// ── Keyword → Skill mapping table ──────────────────────────────────
const SKILL_ROUTES = [
  {
    keywords: ["test", "spec", "unit test", "jest", "vitest", "mocha"],
    skill: "test-generator",
    effort: "medium",
  },
  {
    keywords: [
      "page",
      "component",
      "scaffold",
      "create",
      "boilerplate",
      "template",
    ],
    skill: "project-scaffold",
    effort: "medium",
  },
  {
    keywords: ["database", "schema", "migration", "table", "sql", "model"],
    skill: "db-migration",
    effort: "high",
  },
  {
    keywords: ["docs", "document", "readme", "guide", "jsdoc", "typedoc"],
    skill: "doc-generator",
    effort: "low",
  },
  {
    keywords: ["review", "inspect", "quality", "code review"],
    skill: "code-review",
    effort: "medium",
  },
  {
    keywords: ["deploy", "ci", "cd", "pipeline", "docker", "kubernetes", "k8s"],
    skill: "devops-automation",
    effort: "high",
  },
  {
    keywords: ["security", "audit", "vulnerability", "cve", "owasp"],
    skill: "security-audit",
    effort: "medium",
  },
  {
    keywords: ["lint", "format", "eslint", "prettier", "style"],
    skill: "lint-and-fix",
    effort: "low",
  },
  {
    keywords: [
      "performance",
      "optimize",
      "speed",
      "memory",
      "profil",
      "benchmark",
    ],
    skill: "performance-optimizer",
    effort: "medium",
  },
  {
    keywords: ["refactor", "restructure", "clean up", "reorganize", "simplify"],
    skill: "refactor",
    effort: "medium",
  },
  {
    keywords: ["api", "endpoint", "rest", "graphql", "http", "request"],
    skill: "api-tester",
    effort: "medium",
  },
  {
    keywords: ["explain", "understand", "walkthrough", "annotate"],
    skill: "explain-code",
    effort: "low",
  },
  {
    keywords: ["dependency", "package", "outdated", "upgrade", "npm audit"],
    skill: "dependency-analyzer",
    effort: "low",
  },
];

// ── Skill priority for dependency ordering (lower = earlier) ───────
const SKILL_PRIORITY = {
  "project-scaffold": 10,
  "db-migration": 20,
  refactor: 30,
  "api-tester": 40,
  "test-generator": 50,
  "lint-and-fix": 55,
  "performance-optimizer": 60,
  "code-review": 70,
  "doc-generator": 75,
  "security-audit": 80,
  "explain-code": 85,
  "dependency-analyzer": 90,
  "devops-automation": 100,
};

// ── Implicit dependency rules: skill → depends-on skills ───────────
const IMPLICIT_DEPS = {
  "test-generator": ["project-scaffold", "db-migration", "refactor"],
  "code-review": ["refactor", "test-generator", "lint-and-fix"],
  "doc-generator": ["project-scaffold", "refactor", "api-tester"],
  "security-audit": ["refactor", "test-generator"],
  "lint-and-fix": ["project-scaffold", "refactor"],
  "performance-optimizer": ["refactor"],
  "devops-automation": ["test-generator", "code-review", "security-audit"],
  "api-tester": ["project-scaffold", "db-migration"],
};

// ── Helpers ────────────────────────────────────────────────────────

function generateId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-4);
  return prefix + "-" + ts + rand;
}

/**
 * Parse input string to extract mode and task description.
 */
function parseInput(raw) {
  if (!raw || typeof raw !== "string") {
    return { mode: "analyze", task: "" };
  }
  const trimmed = raw.trim();

  if (trimmed.startsWith("--status")) {
    const id = trimmed.replace(/^--status\s*/, "").trim();
    return { mode: "status", task: id };
  }
  if (trimmed.startsWith("--execute")) {
    const t = trimmed
      .replace(/^--execute\s*/, "")
      .replace(/^["']/g, "")
      .replace(/["']$/g, "")
      .trim();
    return { mode: "execute", task: t };
  }
  if (trimmed.startsWith("--analyze")) {
    const t = trimmed
      .replace(/^--analyze\s*/, "")
      .replace(/^["']/g, "")
      .replace(/["']$/g, "")
      .trim();
    return { mode: "analyze", task: t };
  }

  // Default mode is analyze
  const t = trimmed.replace(/^["']/g, "").replace(/["']$/g, "").trim();
  return { mode: "analyze", task: t };
}

/**
 * Match task description keywords to skills.
 * Returns an array of { skill, description, effort } objects (de-duplicated).
 */
function matchSkills(taskDescription) {
  const lower = taskDescription.toLowerCase();
  const matched = new Map();

  for (const route of SKILL_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw) && !matched.has(route.skill)) {
        const desc = buildSubTaskDescription(route.skill, taskDescription);
        matched.set(route.skill, {
          skill: route.skill,
          description: desc,
          effort: route.effort,
        });
        break;
      }
    }
  }

  return Array.from(matched.values());
}

/**
 * Generate a contextual sub-task description.
 */
function buildSubTaskDescription(skill, originalTask) {
  const templates = {
    "test-generator": "Generate tests for",
    "project-scaffold": "Scaffold project structure for",
    "db-migration": "Create database migration for",
    "doc-generator": "Generate documentation for",
    "code-review": "Review code quality for",
    "devops-automation": "Set up CI/CD pipeline for",
    "security-audit": "Run security audit for",
    "lint-and-fix": "Lint and auto-fix code for",
    "performance-optimizer": "Optimize performance for",
    refactor: "Refactor code for",
    "api-tester": "Test API endpoints for",
    "explain-code": "Explain code related to",
    "dependency-analyzer": "Analyze dependencies for",
  };
  const prefix = templates[skill] || "Execute " + skill + " for";
  return prefix + ": " + originalTask;
}

/**
 * Resolve dependencies between matched sub-tasks.
 * Only includes dependencies that are themselves present in the matched set.
 */
function resolveDependencies(subTasks) {
  const presentSkills = new Set(subTasks.map((st) => st.skill));

  for (const st of subTasks) {
    const implicitDeps = IMPLICIT_DEPS[st.skill] || [];
    st.dependencies = implicitDeps.filter((dep) => presentSkills.has(dep));
  }

  return subTasks;
}

/**
 * Topological sort of sub-tasks by dependencies.
 * Falls back to priority ordering if no explicit deps exist.
 */
function computeExecutionOrder(subTasks) {
  const bySkill = new Map(subTasks.map((st) => [st.skill, st]));
  const visited = new Set();
  const order = [];

  function visit(skill) {
    if (visited.has(skill)) {
      return;
    }
    visited.add(skill);
    const st = bySkill.get(skill);
    if (!st) {
      return;
    }
    for (const dep of st.dependencies) {
      visit(dep);
    }
    order.push(st.id);
  }

  // Sort by priority first so ties are resolved deterministically
  const sorted = [...subTasks].sort(
    (a, b) => (SKILL_PRIORITY[a.skill] || 50) - (SKILL_PRIORITY[b.skill] || 50),
  );

  for (const st of sorted) {
    visit(st.skill);
  }

  return order;
}

/**
 * Compute aggregate effort from sub-task efforts.
 */
function aggregateEffort(subTasks) {
  const effortScore = { low: 1, medium: 2, high: 3 };
  const total = subTasks.reduce(
    (sum, st) => sum + (effortScore[st.effort] || 2),
    0,
  );
  if (total <= 2) {
    return "low";
  }
  if (total <= 5) {
    return "medium";
  }
  return "high";
}

// ── Core decomposition ─────────────────────────────────────────────

function decompose(taskDescription) {
  const id = generateId("td");
  const matched = matchSkills(taskDescription);

  if (matched.length === 0) {
    return {
      id,
      originalTask: taskDescription,
      subTasks: [],
      executionOrder: [],
      totalEstimatedEffort: "low",
      message:
        "No matching skills found for the given task description. Try including keywords like test, docs, deploy, refactor, etc.",
    };
  }

  // Assign IDs
  const subTasks = matched.map((m, idx) => ({
    id: id + "-st" + (idx + 1),
    skill: m.skill,
    description: m.description,
    dependencies: [],
    status: "pending",
    estimatedEffort: m.effort,
  }));

  // Resolve inter-task dependencies
  resolveDependencies(subTasks);

  // Compute topological execution order
  const executionOrder = computeExecutionOrder(subTasks);

  const result = {
    id,
    originalTask: taskDescription,
    subTasks,
    executionOrder,
    totalEstimatedEffort: aggregateEffort(subTasks),
  };

  // Persist for later --status queries
  decompositions.set(id, result);

  return result;
}

// ── Execute mode: run sub-tasks in order (simulated) ───────────────

async function executeDecomposition(decomposition) {
  const { subTasks, executionOrder } = decomposition;
  const byId = new Map(subTasks.map((st) => [st.id, st]));
  const results = [];

  for (const stId of executionOrder) {
    const st = byId.get(stId);
    if (!st) {
      continue;
    }

    // Check that all dependencies are completed
    const depsOk = st.dependencies.every((depSkill) => {
      const depTask = subTasks.find((s) => s.skill === depSkill);
      return depTask && depTask.status === "completed";
    });

    if (!depsOk) {
      st.status = "skipped";
      results.push({
        id: st.id,
        skill: st.skill,
        status: "skipped",
        reason: "Unmet dependency",
      });
      logger.warn(
        "[task-decomposer] Skipped " +
          st.id +
          " (" +
          st.skill +
          ") - unmet dependency",
      );
      continue;
    }

    st.status = "in-progress";
    logger.info(
      "[task-decomposer] Executing sub-task " + st.id + " (" + st.skill + ")",
    );

    try {
      // Simulated execution - in a real integration this would invoke the
      // skill via the SkillLoader / CoworkAgent.  For now we produce a
      // structured result so downstream consumers can act on it.
      st.status = "completed";
      results.push({
        id: st.id,
        skill: st.skill,
        status: "completed",
        output:
          "[simulated] " +
          st.skill +
          " completed successfully for: " +
          decomposition.originalTask,
      });
    } catch (err) {
      st.status = "failed";
      results.push({
        id: st.id,
        skill: st.skill,
        status: "failed",
        error: err.message,
      });
      logger.error("[task-decomposer] Sub-task " + st.id + " failed:", err);
    }
  }

  decomposition.executionResults = results;
  return results;
}

// ── Safe property access helpers ────────────────────────────────────

function getSkillName(skill) {
  return skill && skill.name ? skill.name : "task-decomposer";
}

function getTaskInput(task) {
  if (task && task.params && task.params.input) {
    return task.params.input;
  }
  if (task && task.input) {
    return task.input;
  }
  if (task && task.args) {
    return task.args;
  }
  if (task && task.action) {
    return task.action;
  }
  return "";
}

// ── Handler exports ────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      "[task-decomposer] Handler initialized for " +
        JSON.stringify(getSkillName(skill)),
    );
  },

  async execute(task, context, _skill) {
    if (!context) {
      context = {};
    }
    const rawInput = getTaskInput(task);
    const parsed = parseInput(rawInput);
    const mode = parsed.mode;
    const taskDescription = parsed.task;

    logger.info(
      "[task-decomposer] Mode: " +
        mode +
        ", Input: " +
        JSON.stringify(taskDescription.slice(0, 80)),
    );

    try {
      // ── Status mode ──────────────────────────────────────────
      if (mode === "status") {
        const id = taskDescription;
        const stored = decompositions.get(id);
        if (!stored) {
          return {
            success: false,
            error:
              "No decomposition found with ID " +
              JSON.stringify(id) +
              ". Use --analyze or --execute first.",
          };
        }

        const counts = {
          pending: 0,
          "in-progress": 0,
          completed: 0,
          failed: 0,
          skipped: 0,
        };
        for (const st of stored.subTasks) {
          counts[st.status] = (counts[st.status] || 0) + 1;
        }

        return {
          success: true,
          mode: "status",
          result: stored,
          progress: counts,
          message:
            "Task " +
            id +
            ": " +
            counts.completed +
            "/" +
            stored.subTasks.length +
            " completed, " +
            counts["in-progress"] +
            " in-progress, " +
            counts.pending +
            " pending, " +
            counts.failed +
            " failed, " +
            counts.skipped +
            " skipped.",
        };
      }

      // ── Validate task description ────────────────────────────
      if (!taskDescription) {
        return {
          success: false,
          error:
            "No task description provided. Usage: /task-decomposer <description> or /task-decomposer --execute <description>",
        };
      }

      // ── Analyze / Decompose ──────────────────────────────────
      const decomposition = decompose(taskDescription);

      if (decomposition.subTasks.length === 0) {
        return {
          success: true,
          mode: "analyze",
          result: decomposition,
          message: decomposition.message,
        };
      }

      // ── Execute mode ─────────────────────────────────────────
      if (mode === "execute") {
        const execResults = await executeDecomposition(decomposition);
        const completed = execResults.filter(
          (r) => r.status === "completed",
        ).length;
        const failed = execResults.filter((r) => r.status === "failed").length;

        return {
          success: failed === 0,
          mode: "execute",
          result: decomposition,
          executionResults: execResults,
          message:
            "Executed " +
            completed +
            "/" +
            decomposition.subTasks.length +
            " sub-tasks successfully." +
            (failed > 0 ? " " + failed + " failed." : "") +
            " Decomposition ID: " +
            decomposition.id,
        };
      }

      // ── Analyze mode (default) ──────────────────────────────
      const skillList = decomposition.subTasks
        .map((st, i) => i + 1 + ") " + st.skill)
        .join(", ");

      return {
        success: true,
        mode: "analyze",
        result: decomposition,
        message:
          "Decomposed into " +
          decomposition.subTasks.length +
          " sub-tasks: " +
          skillList +
          ". Total effort: " +
          decomposition.totalEstimatedEffort +
          ". Decomposition ID: " +
          decomposition.id,
      };
    } catch (err) {
      logger.error("[task-decomposer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Task decomposition failed: " + err.message,
      };
    }
  },
};
