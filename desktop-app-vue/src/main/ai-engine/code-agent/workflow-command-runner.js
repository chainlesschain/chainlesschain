/**
 * Workflow command runner — in-process dispatcher for `$xxx` shortcuts.
 *
 * Parses the `$skill [args]` prefix syntax via workflow-command-parser,
 * then invokes the corresponding workflow skill handler directly in the
 * Electron main process. Does NOT go through the Coding Agent bridge /
 * CLI WS server — workflow state is project-local and lives in
 * `.chainlesschain/sessions/<id>/` under the main process's file system.
 *
 * This module is the single integration point for both AIChatPage
 * (renderer → IPC → here) and CLI (require this module or parallel impl).
 */

const path = require("path");
const { logger } = require("../../utils/logger.js");
const { parseWorkflowCommand } = require("./workflow-command-parser.js");

const HANDLER_PATHS = {
  "deep-interview": "../cowork/skills/builtin/deep-interview/handler.js",
  ralplan: "../cowork/skills/builtin/ralplan/handler.js",
  ralph: "../cowork/skills/builtin/ralph/handler.js",
  team: "../cowork/skills/builtin/team/handler.js",
};

const _deps = { loadHandler };

function loadHandler(skill) {
  const rel = HANDLER_PATHS[skill];
  if (!rel) {
    throw new Error(`workflow-command-runner: unknown skill "${skill}"`);
  }
  // eslint-disable-next-line global-require
  return require(path.resolve(__dirname, rel));
}

/**
 * Detect whether a message text is a workflow shortcut without executing.
 * Useful for UI highlighting / autocomplete.
 */
function isWorkflowCommand(text) {
  return parseWorkflowCommand(text).matched;
}

/**
 * Parse and execute a workflow command.
 *
 * @param {string} text   Raw user input, e.g. `$deep-interview "add OAuth"`
 * @param {object} context  { projectRoot, sessionId?, workspaceRoot?, cwd? }
 * @returns {Promise<object>} handler result (or { success:false, matched:false })
 */
async function runWorkflowCommand(text, context = {}) {
  const parsed = parseWorkflowCommand(text);
  if (!parsed.matched) {
    return {
      success: false,
      matched: false,
      message: "Not a workflow command (no $skill prefix)",
    };
  }

  let handler;
  try {
    handler = _deps.loadHandler(parsed.skill);
  } catch (err) {
    return {
      success: false,
      matched: true,
      skill: parsed.skill,
      error: err.message,
      message: `Failed to load handler: ${err.message}`,
    };
  }

  const task = {
    action: parsed.rest,
    params: parsed.params,
  };

  try {
    const result = await handler.execute(task, context);
    return {
      ...result,
      matched: true,
      skill: parsed.skill,
    };
  } catch (err) {
    logger.error(
      `[workflow-command-runner] ${parsed.skill} threw: ${err.message}`,
    );
    return {
      success: false,
      matched: true,
      skill: parsed.skill,
      error: err.message,
      message: `Workflow skill "${parsed.skill}" threw: ${err.message}`,
    };
  }
}

module.exports = {
  runWorkflowCommand,
  isWorkflowCommand,
  _deps,
};
