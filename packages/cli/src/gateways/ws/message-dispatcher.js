export function createWsMessageDispatcher(server) {
  return {
    async dispatch(clientId, ws, message) {
      const { id, type } = message;

      if (!id) {
        server._send(ws, {
          type: "error",
          code: "MISSING_ID",
          message: 'Message must include an "id" field',
        });
        return;
      }

      const client = server.clients.get(clientId);
      if (server.token && !client.authenticated && type !== "auth") {
        server._send(ws, {
          id,
          type: "error",
          code: "AUTH_REQUIRED",
          message: "Authentication required. Send an auth message first.",
        });
        return;
      }

      const routes = {
        auth: () => server._handleAuth(clientId, ws, message),
        ping: () => server._send(ws, { id, type: "pong", serverTime: Date.now() }),
        execute: () => server._executeCommand(id, ws, message.command, false),
        stream: () => server._executeCommand(id, ws, message.command, true),
        cancel: () => server._cancelRequest(id, ws),
        "session-create": () => server._handleSessionCreate(id, ws, message),
        "session-resume": () => server._handleSessionResume(id, ws, message),
        "session-message": () => server._handleSessionMessage(id, ws, message),
        "session-list": () => server._handleSessionList(id, ws),
        "session-close": () => server._handleSessionClose(id, ws, message),
        "slash-command": () => server._handleSlashCommand(id, ws, message),
        "session-answer": () => server._handleSessionAnswer(id, ws, message),
        orchestrate: () => server._handleOrchestrate(id, ws, message),
        "tasks-list": () => server._handleTasksList(id, ws),
        "tasks-stop": () => server._handleTasksStop(id, ws, message),
        "tasks-detail": () => server._handleTaskDetail(id, ws, message),
        "tasks-history": () => server._handleTaskHistory(id, ws, message),
        "worktree-diff": () => server._handleWorktreeDiff(id, ws, message),
        "worktree-merge": () => server._handleWorktreeMerge(id, ws, message),
        "worktree-list": () => server._handleWorktreeList(id, ws),
        "compression-stats": () => server._handleCompressionStats(id, ws, message),
      };

      const handler = routes[type];
      if (!handler) {
        server._send(ws, {
          id,
          type: "error",
          code: "UNKNOWN_TYPE",
          message: `Unknown message type: ${type}`,
        });
        return;
      }

      return handler();
    },
  };
}
