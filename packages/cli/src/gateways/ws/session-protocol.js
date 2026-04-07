import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
} from "../../runtime/runtime-events.js";
import { createSessionRecord } from "../../runtime/contracts/session-record.js";

async function ensureSessionHandler(server, ws, session) {
  if (server.sessionHandlers.has(session.id)) {
    return server.sessionHandlers.get(session.id);
  }

  const { WebSocketInteractionAdapter } =
    await import("../../lib/interaction-adapter.js");
  session.interaction = new WebSocketInteractionAdapter(ws, session.id);

  let handler;
  if (session.type === "chat") {
    const { WSChatHandler } = await import("../../lib/ws-chat-handler.js");
    handler = new WSChatHandler({
      session,
      interaction: session.interaction,
    });
  } else {
    const { WSAgentHandler } = await import("../../lib/ws-agent-handler.js");
    handler = new WSAgentHandler({
      session,
      interaction: session.interaction,
      db: server.sessionManager.db,
    });
  }

  server.sessionHandlers.set(session.id, handler);
  return handler;
}

export async function handleSessionCreate(server, id, ws, message) {
  if (!server.sessionManager) {
    server._send(ws, {
      id,
      type: "error",
      code: "NO_SESSION_SUPPORT",
      message: "Session support not configured on this server",
    });
    return;
  }

  const {
    sessionType,
    provider,
    model,
    apiKey,
    baseUrl,
    projectRoot,
    hostManagedToolPolicy,
    worktreeIsolation,
  } = message;

  try {
    const { sessionId } = server.sessionManager.createSession({
      type: sessionType || "agent",
      provider,
      model,
      apiKey,
      baseUrl,
      projectRoot,
      hostManagedToolPolicy,
      worktreeIsolation,
    });

    const session = server.sessionManager.getSession(sessionId);
    const record = createSessionRecord(session, {
      sessionId,
      sessionType: sessionType || "agent",
      provider,
      model,
      projectRoot: projectRoot || null,
      baseProjectRoot: session?.baseProjectRoot || projectRoot || null,
      worktreeIsolation: worktreeIsolation === true,
      worktree: session?.worktree || null,
      status: "created",
    });

    try {
      await ensureSessionHandler(server, ws, session);
    } catch (_err) {
      // Session exists even if handler bootstrapping fails.
    }

    server.emit("session:create", { sessionId, type: sessionType || "agent" });
    server.emit(
      RUNTIME_EVENTS.SESSION_START,
      createRuntimeEvent(
        RUNTIME_EVENTS.SESSION_START,
        {
          sessionId,
          sessionType: sessionType || "agent",
          provider,
          model,
          projectRoot: projectRoot || null,
          record,
        },
        { kind: "server", sessionId },
      ),
    );

    server._send(ws, {
      id,
      type: "session-created",
      sessionId,
      sessionType: sessionType || "agent",
      record,
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "SESSION_CREATE_FAILED",
      message: err.message,
    });
  }
}

export async function handleSessionResume(server, id, ws, message) {
  if (!server.sessionManager) {
    server._send(ws, {
      id,
      type: "error",
      code: "NO_SESSION_SUPPORT",
      message: "Session support not configured",
    });
    return;
  }

  const { sessionId } = message;
  const session = server.sessionManager.resumeSession(sessionId);

  if (!session) {
    server._send(ws, {
      id,
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: `Session not found: ${sessionId}`,
    });
    return;
  }

  if (!server.sessionHandlers.has(sessionId)) {
    try {
      await ensureSessionHandler(server, ws, session);
    } catch (_err) {
      // Session resumed without live handler.
    }
  }

  const history = (session.messages || []).filter((m) => m.role !== "system");
  const record = createSessionRecord(session, {
    history,
    messageCount: history.length,
    status: "resumed",
  });

  server.emit(
    RUNTIME_EVENTS.SESSION_RESUME,
    createRuntimeEvent(
      RUNTIME_EVENTS.SESSION_RESUME,
      {
        sessionId: session.id,
        historyCount: history.length,
        sessionType: session.type || null,
        record,
      },
      { kind: "server", sessionId: session.id },
    ),
  );

  server._send(ws, {
    id,
    type: "session-resumed",
    sessionId: session.id,
    history,
    record,
  });
}

export function handleSessionMessage(server, id, ws, message) {
  const { sessionId, content } = message;
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

  server.emit(
    RUNTIME_EVENTS.SESSION_MESSAGE,
    createRuntimeEvent(
      RUNTIME_EVENTS.SESSION_MESSAGE,
      {
        sessionId,
        messageId: id,
        content,
      },
      { kind: "server", sessionId },
    ),
  );

  handler
    .handleMessage(content, id)
    .then(() => {
      if (server.sessionManager) {
        try {
          server.sessionManager.persistMessages(sessionId);
        } catch (_err) {
          // Non-critical.
        }
      }
    })
    .catch((err) => {
      server._send(ws, {
        id,
        type: "error",
        code: "MESSAGE_FAILED",
        message: err.message,
      });
    });
}

export function handleSessionPolicyUpdate(server, id, ws, message) {
  const { sessionId, hostManagedToolPolicy } = message;

  if (!server.sessionManager) {
    server._send(ws, {
      id,
      type: "error",
      code: "NO_SESSION_SUPPORT",
      message: "Session support not configured",
    });
    return;
  }

  const session = server.sessionManager.updateSessionPolicy
    ? server.sessionManager.updateSessionPolicy(
        sessionId,
        hostManagedToolPolicy,
      )
    : null;

  if (!session) {
    server._send(ws, {
      id,
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: `Session not found: ${sessionId}`,
    });
    return;
  }

  server._send(ws, {
    id,
    type: "session-policy-updated",
    success: true,
    sessionId,
  });
}

export function handleSessionList(server, id, ws) {
  if (!server.sessionManager) {
    server._send(ws, {
      id,
      type: "error",
      code: "NO_SESSION_SUPPORT",
      message: "Session support not configured",
    });
    return;
  }

  const sessions = server.sessionManager.listSessions().map((session) => ({
    ...session,
    record: createSessionRecord(session, {
      sessionId: session.id,
      sessionType: session.type || null,
      status: session.status || "listed",
      history: Array.isArray(session.messages)
        ? session.messages.filter((item) => item.role !== "system")
        : [],
    }),
  }));
  server._send(ws, {
    id,
    type: "session-list-result",
    sessions,
  });
}

export function handleSessionClose(server, id, ws, message) {
  const { sessionId } = message;

  const handler = server.sessionHandlers.get(sessionId);
  if (handler && handler.destroy) {
    handler.destroy();
  }
  server.sessionHandlers.delete(sessionId);

  if (server.sessionManager) {
    try {
      server.sessionManager.closeSession(sessionId);
    } catch (_err) {
      // Non-critical.
    }
  }

  server.emit("session:close", { sessionId });
  server.emit(
    RUNTIME_EVENTS.SESSION_END,
    createRuntimeEvent(
      RUNTIME_EVENTS.SESSION_END,
      {
        sessionId,
        record: createSessionRecord(
          { id: sessionId, type: null },
          { sessionId, status: "closed", history: [], messageCount: 0 },
        ),
      },
      { kind: "server", sessionId },
    ),
  );

  server._send(ws, {
    id,
    type: "result",
    success: true,
    sessionId,
  });
}

export function handleSessionAnswer(server, id, ws, message) {
  const { sessionId, requestId, answer } = message;

  if (!server.sessionManager) {
    server._send(ws, {
      id,
      type: "error",
      code: "NO_SESSION_SUPPORT",
      message: "Session support not configured",
    });
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (session && session.interaction && session.interaction.resolveAnswer) {
    session.interaction.resolveAnswer(requestId, answer);
  }

  server._send(ws, { id, type: "result", success: true });
}

export function handleHostToolResult(server, id, ws, message) {
  const { sessionId, requestId, success, result, error, toolName } = message;

  if (!server.sessionManager) {
    server._send(ws, {
      id,
      type: "error",
      code: "NO_SESSION_SUPPORT",
      message: "Session support not configured",
    });
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session || !session.interaction) {
    server._send(ws, {
      id,
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: `Session not found: ${sessionId}`,
    });
    return;
  }

  if (typeof session.interaction.resolveHostTool === "function") {
    session.interaction.resolveHostTool(requestId, {
      success: success !== false,
      result,
      error: error || null,
      toolName: toolName || null,
    });
  }

  server._send(ws, { id, type: "result", success: true });
}
