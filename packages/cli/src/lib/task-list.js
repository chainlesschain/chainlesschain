/**
 * Background task listing utilities (ESM)
 * Mirrors Claude Code /tasks behavior
 * @module lib/task-list
 */

import { listBackgroundShellTasks } from "../runtime/agent-core.js";
import { formatBackgroundTasks } from "../repl/tasks-status.js";
import { logger } from "./logger.js";

/**
 * List all background tasks
 * @param {Object} options List options
 * @returns {Promise<Object>} task list result
 */
export async function listTasks(options = {}) {
  const tasks = listBackgroundShellTasks();
  const active = tasks.filter((t) => t.status === "running");
  const completed = tasks.filter((t) => t.status !== "running");

  if (tasks.length === 0) {
    logger.info("No background tasks");
    return { count: 0, active: 0, completed: 0, tasks: [] };
  }

  if (!options.quiet) {
    logger.info(formatBackgroundTasks(tasks));
  }

  logger.info(
    `  ${active.length} active, ${completed.length} completed (total: ${tasks.length})`,
  );

  return {
    count: tasks.length,
    active: active.length,
    completed: completed.length,
    tasks,
    formatted: formatBackgroundTasks(tasks),
  };
}

/**
 * Get a specific task by ID
 * @param {string} taskId
 * @returns {Object|null}
 */
export function getTask(taskId) {
  const tasks = listBackgroundShellTasks();
  return tasks.find((t) => t.id === taskId) || null;
}

export default { listTasks, getTask };
