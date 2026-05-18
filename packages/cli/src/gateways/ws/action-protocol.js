// Track running cowork tasks for cancellation
const _runningTasks = new Map();

export async function handleCoworkTask(server, id, ws, message) {
  const { templateId = null, userMessage, files = [] } = message;

  if (!userMessage || typeof userMessage !== "string") {
    server._send(ws, {
      id,
      type: "error",
      code: "INVALID_MESSAGE",
      message: "userMessage field required",
    });
    return;
  }

  const ac = new AbortController();
  const trackingId = `cowork-${id}`;
  _runningTasks.set(trackingId, ac);

  try {
    const { runCoworkTask, runCoworkTaskParallel, runCoworkDebate } =
      await import("../../lib/cowork-task-runner.js");
    const { getTemplate } = await import("../../lib/cowork-task-templates.js");

    // Determine execution mode: debate > parallel > sequential
    const template = getTemplate(templateId);
    const useDebate =
      message.mode === "debate" ||
      (message.mode !== "agent" && template.mode === "debate");
    const useParallel =
      !useDebate &&
      (message.parallel === true ||
        (message.parallel !== false && template.parallelStrategy === "always"));

    server._send(ws, {
      id,
      type: "cowork:started",
      templateId,
      trackingId,
      parallel: useParallel,
      mode: useDebate ? "debate" : "agent",
    });

    const runner = useDebate
      ? runCoworkDebate
      : useParallel
        ? runCoworkTaskParallel
        : runCoworkTask;

    const result = await runner({
      templateId,
      userMessage,
      files,
      cwd: server.projectRoot || process.cwd(),
      llmOptions: {},
      signal: ac.signal,
      ...(useParallel
        ? {
            agents: message.agents || 3,
            strategy: message.strategy,
          }
        : {}),
      ...(useDebate && message.perspectives
        ? { perspectives: message.perspectives }
        : {}),
      onProgress: (progress) => {
        server._send(ws, {
          id,
          type: "cowork:progress",
          event: progress.type,
          tool: progress.tool,
          iterationCount: progress.iterationCount,
          tokenCount: progress.tokenCount,
        });
      },
    });

    server._send(ws, {
      id,
      type: "cowork:done",
      taskId: result.taskId,
      status: result.status,
      templateId: result.templateId,
      templateName: result.templateName,
      summary: result.result?.summary || "",
      artifacts: result.result?.artifacts || [],
      toolsUsed: result.result?.toolsUsed || [],
      iterationCount: result.result?.iterationCount || 0,
      tokenCount: result.result?.tokenCount || 0,
      parallel: result.parallel || false,
      subtaskCount: result.result?.subtaskCount || 0,
      mode: result.mode || (useDebate ? "debate" : "agent"),
      ...(useDebate
        ? {
            verdict: result.result?.verdict,
            consensusScore: result.result?.consensusScore,
            reviews: result.result?.reviews || [],
            perspectives: result.result?.perspectives || [],
          }
        : {}),
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "COWORK_FAILED",
      message: err.message,
    });
  } finally {
    _runningTasks.delete(trackingId);
  }
}

export function handleCoworkCancel(server, id, ws, message) {
  const { trackingId } = message;

  if (!trackingId) {
    server._send(ws, {
      id,
      type: "error",
      code: "INVALID_MESSAGE",
      message: "trackingId field required",
    });
    return;
  }

  const ac = _runningTasks.get(trackingId);
  if (ac) {
    ac.abort();
    _runningTasks.delete(trackingId);
    server._send(ws, { id, type: "cowork:cancelled", trackingId });
  } else {
    server._send(ws, {
      id,
      type: "error",
      code: "TASK_NOT_FOUND",
      message: `No running cowork task: ${trackingId}`,
    });
  }
}

export function handleSlashCommand(server, id, ws, message) {
  const { sessionId, command } = message;
  const handler = server.sessionHandlers.get(sessionId);

  if (!handler) {
    server._send(ws, {
      id,
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: `No active session handler for: ${sessionId}`,
    });
    return;
  }

  handler.handleSlashCommand(command, id);
}

export async function handleCoworkHistory(server, id, ws, message) {
  const { limit = 50 } = message;
  const cwd = server.projectRoot || process.cwd();

  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const histPath = join(cwd, ".chainlesschain", "cowork", "history.jsonl");

    if (!existsSync(histPath)) {
      server._send(ws, { id, type: "cowork:history", entries: [] });
      return;
    }

    const lines = readFileSync(histPath, "utf-8").split("\n").filter(Boolean);
    const entries = [];
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line));
      } catch (_e) {
        // skip malformed lines
      }
    }

    server._send(ws, { id, type: "cowork:history", entries });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "HISTORY_FAILED",
      message: err.message,
    });
  }
}

export async function handleCoworkTemplates(server, id, ws) {
  try {
    const { getTemplatesForUI } =
      await import("../../lib/cowork-task-templates.js");
    const templates = getTemplatesForUI();
    server._send(ws, { id, type: "cowork:templates", templates });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "TEMPLATES_FAILED",
      message: err.message,
    });
  }
}

export async function handleOrchestrate(server, id, ws, message) {
  const {
    task,
    cwd,
    agents = 3,
    ci = "npm test",
    noCi = false,
    strategy,
  } = message;

  if (!task || typeof task !== "string") {
    server._send(ws, {
      id,
      type: "error",
      code: "INVALID_TASK",
      message: "task field required",
    });
    return;
  }

  try {
    const { Orchestrator, TASK_SOURCE } =
      await import("../../lib/orchestrator.js");

    const orch = new Orchestrator({
      cwd: cwd || server.projectRoot || process.cwd(),
      maxParallel: Math.min(parseInt(agents, 10) || 3, 10),
      ciCommand: ci,
      agents: strategy ? { strategy } : undefined,
      verbose: false,
    });

    const wsNotifier = orch.notifier.addWebSocketChannel({
      send: (data) => server._send(ws, data),
      requestId: id,
    });

    orch.on("agent:output", (ev) => wsNotifier.sendAgentOutput(ev));
    orch.on("task:added", (t) => wsNotifier.sendStatus(t));
    orch.on("task:decomposing", (t) => wsNotifier.sendStatus(t));
    orch.on("ci:checking", ({ task: t }) => wsNotifier.sendStatus(t));
    orch.on("task:retrying", ({ task: t }) => wsNotifier.sendStatus(t));

    const result = await orch.addTask(task, {
      source: TASK_SOURCE.CLI,
      cwd: cwd || server.projectRoot || process.cwd(),
      runCI: !noCi,
      notify: true,
    });

    server._send(ws, {
      id,
      type: "orchestrate:done",
      taskId: result.id,
      status: result.status,
      retries: result.retries,
      subtasks: result.subtasks?.length || 0,
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "ORCHESTRATE_FAILED",
      message: err.message,
    });
  }
}

// ─── Workflow (N1) ───────────────────────────────────────────────────────────

function _cwd(server) {
  return server.projectRoot || process.cwd();
}

function _sendError(server, ws, id, code, message) {
  server._send(ws, { id, type: "error", code, message });
}

export async function handleWorkflowList(server, id, ws) {
  try {
    const { listWorkflows } = await import("../../lib/cowork-workflow.js");
    const workflows = listWorkflows(_cwd(server));
    server._send(ws, { id, type: "workflow:list", workflows });
  } catch (err) {
    _sendError(server, ws, id, "WORKFLOW_LIST_FAILED", err.message);
  }
}

export async function handleWorkflowGet(server, id, ws, message) {
  const { id: wfId } = message || {};
  if (!wfId) return _sendError(server, ws, id, "MISSING_ID", "id required");
  try {
    const { getWorkflow } = await import("../../lib/cowork-workflow.js");
    const workflow = getWorkflow(_cwd(server), wfId);
    server._send(ws, { id, type: "workflow:get", workflow: workflow || null });
  } catch (err) {
    _sendError(server, ws, id, "WORKFLOW_GET_FAILED", err.message);
  }
}

export async function handleWorkflowSave(server, id, ws, message) {
  const { workflow } = message || {};
  if (!workflow || typeof workflow !== "object") {
    return _sendError(
      server,
      ws,
      id,
      "INVALID_WORKFLOW",
      "workflow object required",
    );
  }
  try {
    const { validateWorkflow, saveWorkflow } =
      await import("../../lib/cowork-workflow.js");
    const result = validateWorkflow(workflow);
    if (!result.valid) {
      return _sendError(
        server,
        ws,
        id,
        "WORKFLOW_INVALID",
        result.errors.join("; "),
      );
    }
    saveWorkflow(_cwd(server), workflow);
    server._send(ws, {
      id,
      type: "workflow:save",
      saved: true,
      workflowId: workflow.id,
    });
  } catch (err) {
    _sendError(server, ws, id, "WORKFLOW_SAVE_FAILED", err.message);
  }
}

export async function handleWorkflowRemove(server, id, ws, message) {
  const { id: wfId } = message || {};
  if (!wfId) return _sendError(server, ws, id, "MISSING_ID", "id required");
  try {
    const { removeWorkflow } = await import("../../lib/cowork-workflow.js");
    const removed = removeWorkflow(_cwd(server), wfId);
    server._send(ws, { id, type: "workflow:remove", removed });
  } catch (err) {
    _sendError(server, ws, id, "WORKFLOW_REMOVE_FAILED", err.message);
  }
}

export async function handleWorkflowRun(server, id, ws, message) {
  const { id: wfId } = message || {};
  if (!wfId) return _sendError(server, ws, id, "MISSING_ID", "id required");

  try {
    const { getWorkflow, executeWorkflow } =
      await import("../../lib/cowork-workflow.js");
    const workflow = getWorkflow(_cwd(server), wfId);
    if (!workflow) {
      return _sendError(
        server,
        ws,
        id,
        "WORKFLOW_NOT_FOUND",
        `No workflow: ${wfId}`,
      );
    }

    const runId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    server._send(ws, { id, type: "workflow:started", runId, workflowId: wfId });

    const onStepStart = ({ stepId, message: stepMessage }) => {
      server._send(ws, {
        id,
        type: "workflow:step-start",
        runId,
        stepId,
        message: stepMessage,
      });
    };
    const onStepComplete = (outcome) => {
      server._send(ws, {
        id,
        type: "workflow:step-complete",
        runId,
        stepId: outcome?.id,
        status: outcome?.status,
        summary: outcome?.result?.summary,
      });
    };

    const record = await executeWorkflow({
      workflow,
      cwd: _cwd(server),
      onStepStart,
      onStepComplete,
    });

    server._send(ws, {
      id,
      type: "workflow:done",
      runId,
      status: record?.status || "completed",
      steps: record?.steps || [],
    });
  } catch (err) {
    _sendError(server, ws, id, "WORKFLOW_RUN_FAILED", err.message);
  }
}
