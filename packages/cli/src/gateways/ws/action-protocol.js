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

  try {
    const { runCoworkTask } = await import("../../lib/cowork-task-runner.js");

    server._send(ws, {
      id,
      type: "cowork:started",
      templateId,
    });

    const result = await runCoworkTask({
      templateId,
      userMessage,
      files,
      cwd: server.projectRoot || process.cwd(),
      llmOptions: {},
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
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "COWORK_FAILED",
      message: err.message,
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
