/**
 * Workflow Automation Skill Handler
 *
 * Multi-step workflow creation and execution via WorkflowEngine.
 */

const { logger } = require("../../../../utils/logger.js");

let workflowEngine = null;

module.exports = {
  async init(skill) {
    try {
      workflowEngine = require("../../../../browser/actions/workflow-engine.js");
      logger.info("[WorkflowAutomation] WorkflowEngine loaded");
    } catch (error) {
      logger.warn(
        "[WorkflowAutomation] WorkflowEngine not available:",
        error.message,
      );
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, name, args } = parseInput(input);

    logger.info(`[WorkflowAutomation] Action: ${action}, Name: ${name}`);

    try {
      switch (action) {
        case "create":
        case "new":
          return await handleCreate(name, args, context);

        case "run":
        case "start":
        case "execute":
          return await handleRun(name, context);

        case "list":
        case "ls":
          return await handleList();

        case "status":
        case "check":
          return await handleStatus(name);

        case "pause":
          return await handlePause(name);

        case "resume":
        case "continue":
          return await handleResume(name);

        case "cancel":
        case "stop":
        case "abort":
          return await handleCancel(name);

        case "delete":
        case "remove":
          return await handleDelete(name);

        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use create, run, list, status, pause, resume, or cancel.`,
          };
      }
    } catch (error) {
      logger.error(`[WorkflowAutomation] Error:`, error);
      return { success: false, error: error.message, action };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list", name: "", args: "" };
  }

  const trimmed = input.trim();
  const parts = trimmed.match(/^(\S+)\s*(["']([^"']+)["']|(\S+))?\s*(.*)?$/);

  if (!parts) {
    return { action: trimmed.toLowerCase(), name: "", args: "" };
  }

  return {
    action: parts[1].toLowerCase(),
    name: parts[3] || parts[4] || "",
    args: parts[5] || "",
  };
}

function getEngine() {
  if (!workflowEngine) {
    return null;
  }
  return typeof workflowEngine.getInstance === "function"
    ? workflowEngine.getInstance()
    : workflowEngine;
}

async function handleCreate(name, definition, context) {
  if (!name) {
    return {
      success: false,
      error: 'No workflow name provided. Example: create "My Workflow"',
    };
  }

  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  const workflowDef = {
    name,
    steps: [],
    description: definition || `Workflow: ${name}`,
  };

  if (typeof engine.createWorkflow === "function") {
    const result = await engine.createWorkflow(workflowDef);
    return { success: true, action: "create", name, workflow: result };
  }
  if (typeof engine.create === "function") {
    const result = await engine.create(workflowDef);
    return { success: true, action: "create", name, workflow: result };
  }

  return { success: false, error: "Workflow creation not supported." };
}

async function handleRun(nameOrId, context) {
  if (!nameOrId) {
    return {
      success: false,
      error: "No workflow name/id provided. Example: run daily-backup",
    };
  }

  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  if (typeof engine.runWorkflow === "function") {
    const result = await engine.runWorkflow(nameOrId, context);
    return { success: true, action: "run", name: nameOrId, result };
  }
  if (typeof engine.run === "function") {
    const result = await engine.run(nameOrId, context);
    return { success: true, action: "run", name: nameOrId, result };
  }
  if (typeof engine.execute === "function") {
    const result = await engine.execute(nameOrId, context);
    return { success: true, action: "run", name: nameOrId, result };
  }

  return { success: false, error: "Workflow execution not supported." };
}

async function handleList() {
  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  let workflows = [];
  if (typeof engine.listWorkflows === "function") {
    workflows = await engine.listWorkflows();
  } else if (typeof engine.list === "function") {
    workflows = await engine.list();
  } else if (typeof engine.getWorkflows === "function") {
    workflows = await engine.getWorkflows();
  }

  return {
    success: true,
    action: "list",
    workflows: Array.isArray(workflows) ? workflows : [],
    count: Array.isArray(workflows) ? workflows.length : 0,
  };
}

async function handleStatus(nameOrId) {
  if (!nameOrId) {
    return { success: false, error: "No workflow name/id provided." };
  }

  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  if (typeof engine.getStatus === "function") {
    const status = await engine.getStatus(nameOrId);
    return { success: true, action: "status", name: nameOrId, status };
  }
  if (typeof engine.getWorkflowStatus === "function") {
    const status = await engine.getWorkflowStatus(nameOrId);
    return { success: true, action: "status", name: nameOrId, status };
  }

  return { success: false, error: "Status check not supported." };
}

async function handlePause(nameOrId) {
  if (!nameOrId) {
    return { success: false, error: "No workflow name/id provided." };
  }

  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  if (typeof engine.pauseWorkflow === "function") {
    await engine.pauseWorkflow(nameOrId);
    return { success: true, action: "pause", name: nameOrId };
  }
  if (typeof engine.pause === "function") {
    await engine.pause(nameOrId);
    return { success: true, action: "pause", name: nameOrId };
  }

  return { success: false, error: "Workflow pause not supported." };
}

async function handleResume(nameOrId) {
  if (!nameOrId) {
    return { success: false, error: "No workflow name/id provided." };
  }

  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  if (typeof engine.resumeWorkflow === "function") {
    await engine.resumeWorkflow(nameOrId);
    return { success: true, action: "resume", name: nameOrId };
  }
  if (typeof engine.resume === "function") {
    await engine.resume(nameOrId);
    return { success: true, action: "resume", name: nameOrId };
  }

  return { success: false, error: "Workflow resume not supported." };
}

async function handleCancel(nameOrId) {
  if (!nameOrId) {
    return { success: false, error: "No workflow name/id provided." };
  }

  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  if (typeof engine.cancelWorkflow === "function") {
    await engine.cancelWorkflow(nameOrId);
    return { success: true, action: "cancel", name: nameOrId };
  }
  if (typeof engine.cancel === "function") {
    await engine.cancel(nameOrId);
    return { success: true, action: "cancel", name: nameOrId };
  }

  return { success: false, error: "Workflow cancel not supported." };
}

async function handleDelete(nameOrId) {
  if (!nameOrId) {
    return { success: false, error: "No workflow name/id provided." };
  }

  const engine = getEngine();
  if (!engine) {
    return { success: false, error: "Workflow engine not available." };
  }

  if (typeof engine.deleteWorkflow === "function") {
    await engine.deleteWorkflow(nameOrId);
    return { success: true, action: "delete", name: nameOrId };
  }
  if (typeof engine.delete === "function") {
    await engine.delete(nameOrId);
    return { success: true, action: "delete", name: nameOrId };
  }

  return { success: false, error: "Workflow deletion not supported." };
}
