/**
 * Multi-Agent Coordinator — decomposes tasks, selects agents, and aggregates results.
 *
 * Provides task decomposition based on keyword matching, agent selection by
 * capability, subtask assignment tracking, and result aggregation.
 */

import crypto from "crypto";

/**
 * Keyword map for agent type detection.
 */
export const AGENT_TYPE_KEYWORDS = {
  "code-generation": [
    "code",
    "generate",
    "implement",
    "function",
    "class",
    "module",
    "develop",
    "build",
  ],
  "code-review": [
    "review",
    "audit",
    "inspect",
    "check",
    "lint",
    "quality",
    "pull request",
  ],
  "data-analysis": [
    "data",
    "analyze",
    "statistics",
    "chart",
    "graph",
    "csv",
    "report",
    "dashboard",
    "visualization",
  ],
  document: [
    "document",
    "documentation",
    "readme",
    "guide",
    "write",
    "article",
    "tutorial",
    "markdown",
  ],
  testing: [
    "test",
    "unit test",
    "integration",
    "e2e",
    "jest",
    "vitest",
    "coverage",
    "mock",
    "spec",
  ],
};

/**
 * Generate a short unique id.
 */
function generateId() {
  return crypto.randomUUID().slice(0, 12);
}

/**
 * Decompose a task description into subtasks based on keyword matching.
 *
 * @param {string} task - Task description
 * @returns {{ taskId: string, subtasks: Array<{ id: string, agentType: string, description: string, status: string }> }}
 */
export function decomposeTask(task) {
  if (!task || typeof task !== "string") {
    return { taskId: generateId(), subtasks: [] };
  }

  const lower = task.toLowerCase();
  const subtasks = [];

  for (const [agentType, keywords] of Object.entries(AGENT_TYPE_KEYWORDS)) {
    const matched = keywords.filter((kw) => lower.includes(kw));
    if (matched.length > 0) {
      subtasks.push({
        id: generateId(),
        agentType,
        description: `${agentType}: ${matched.join(", ")} — from "${task.substring(0, 80)}"`,
        status: "pending",
      });
    }
  }

  // If nothing matched, create a generic subtask
  if (subtasks.length === 0) {
    subtasks.push({
      id: generateId(),
      agentType: "general",
      description: task.substring(0, 200),
      status: "pending",
    });
  }

  return {
    taskId: generateId(),
    subtasks,
  };
}

/**
 * Select the best matching agent for a subtask from available agents.
 *
 * @param {{ agentType: string }} subtask
 * @param {Array<{ id: string, capabilities: string[] }>} availableAgents
 * @returns {{ id: string, capabilities: string[] } | null}
 */
export function selectAgent(subtask, availableAgents) {
  if (
    !subtask ||
    !Array.isArray(availableAgents) ||
    availableAgents.length === 0
  ) {
    return null;
  }

  // Direct capability match
  for (const agent of availableAgents) {
    if (
      Array.isArray(agent.capabilities) &&
      agent.capabilities.includes(subtask.agentType)
    ) {
      return agent;
    }
  }

  // Partial match — check if any capability keyword overlaps
  const keywords = AGENT_TYPE_KEYWORDS[subtask.agentType] || [];
  let bestAgent = null;
  let bestScore = 0;

  for (const agent of availableAgents) {
    if (!Array.isArray(agent.capabilities)) continue;
    let score = 0;
    for (const cap of agent.capabilities) {
      if (keywords.some((kw) => cap.includes(kw) || kw.includes(cap))) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return bestAgent;
}

/**
 * Assign a subtask to an agent and record in the database.
 *
 * @param {object} db - Database instance (better-sqlite3 API)
 * @param {string} subtaskId
 * @param {string} agentId
 * @returns {{ subtaskId: string, agentId: string, status: string }}
 */
export function assignSubtask(db, subtaskId, agentId) {
  if (db) {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO agent_assignments (id, subtask_id, agent_id, status, assigned_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    );
    stmt.run(generateId(), subtaskId, agentId, "assigned");
  }

  return {
    subtaskId,
    agentId,
    status: "assigned",
  };
}

/**
 * Aggregate results from completed subtasks.
 *
 * @param {Array<{ id: string, agentType: string, status: string, result?: any }>} subtasks
 * @returns {{ taskId: string, status: string, results: any[], summary: string }}
 */
export function aggregateResults(subtasks) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return {
      taskId: "",
      status: "empty",
      results: [],
      summary: "No subtasks to aggregate",
    };
  }

  const results = subtasks.map((s) => ({
    id: s.id,
    agentType: s.agentType,
    status: s.status,
    result: s.result || null,
  }));

  const completed = subtasks.filter((s) => s.status === "completed").length;
  const failed = subtasks.filter((s) => s.status === "failed").length;
  const total = subtasks.length;

  let status = "completed";
  if (failed > 0 && completed === 0) status = "failed";
  else if (failed > 0) status = "partial";
  else if (completed < total) status = "in-progress";

  return {
    taskId: subtasks[0]?.taskId || generateId(),
    status,
    results,
    summary: `${completed}/${total} subtasks completed, ${failed} failed`,
  };
}

/**
 * Return the list of all supported agent types.
 *
 * @returns {string[]}
 */
export function getAgentTypes() {
  return Object.keys(AGENT_TYPE_KEYWORDS);
}

/**
 * Estimate task complexity based on keyword count and description length.
 *
 * @param {string} task
 * @returns {{ complexity: "low" | "medium" | "high", estimatedSubtasks: number }}
 */
export function estimateComplexity(task) {
  if (!task || typeof task !== "string") {
    return { complexity: "low", estimatedSubtasks: 0 };
  }

  const lower = task.toLowerCase();
  let matchedTypes = 0;
  let totalKeywords = 0;

  for (const [, keywords] of Object.entries(AGENT_TYPE_KEYWORDS)) {
    const matched = keywords.filter((kw) => lower.includes(kw));
    if (matched.length > 0) {
      matchedTypes++;
      totalKeywords += matched.length;
    }
  }

  const lengthFactor = task.length > 200 ? 1 : task.length > 100 ? 0.5 : 0;

  const score = matchedTypes + totalKeywords * 0.3 + lengthFactor;

  let complexity;
  if (score >= 5) complexity = "high";
  else if (score >= 2) complexity = "medium";
  else complexity = "low";

  return {
    complexity,
    estimatedSubtasks: Math.max(1, matchedTypes),
  };
}
