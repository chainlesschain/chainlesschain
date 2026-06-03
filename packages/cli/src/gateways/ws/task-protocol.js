export async function handleTaskDetail(server, id, ws, message) {
  try {
    await server._ensureTaskManager();
    if (!message.taskId) {
      server._send(ws, {
        id,
        type: "error",
        code: "NO_TASK",
        message: "taskId required",
      });
      return;
    }
    const task = server._taskManager.getDetails(message.taskId);
    server._send(ws, { id, type: "tasks-detail", task });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "TASK_DETAIL_FAILED",
      message: err.message,
    });
  }
}

export async function handleTaskHistory(server, id, ws, message) {
  try {
    await server._ensureTaskManager();
    if (!message.taskId) {
      server._send(ws, {
        id,
        type: "error",
        code: "NO_TASK",
        message: "taskId required",
      });
      return;
    }
    const history = server._taskManager.getHistory(message.taskId, {
      limit: message.limit,
      offset: message.offset,
    });
    server._send(ws, {
      id,
      type: "tasks-history",
      taskId: message.taskId,
      history,
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "TASK_HISTORY_FAILED",
      message: err.message,
    });
  }
}
