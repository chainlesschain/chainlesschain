import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
  createCodingAgentEvent,
  CODING_AGENT_EVENT_TYPES,
} from "../../runtime/runtime-events.js";
import { createSessionRecord } from "../../runtime/contracts/session-record.js";

// Build a unified envelope for a solicited WS response. The bridge correlates
// by `requestId` (the inbound request's id) and unwraps `payload` for callers
// so existing flat-shape consumers keep working unchanged.
function envelopeResponse(type, id, payload, sessionId) {
  return createCodingAgentEvent(type, payload || {}, {
    requestId: id,
    sessionId: sessionId || null,
    source: "cli-runtime",
  });
}

function envelopeError(id, code, message, sessionId) {
  return createCodingAgentEvent(
    CODING_AGENT_EVENT_TYPES.ERROR,
    { code, message },
    {
      requestId: id,
      sessionId: sessionId || null,
      source: "cli-runtime",
    },
  );
}

// Phase 5 envelope opt-in via beta flag `unified-envelope-2026-04-16`.
// Falls back to false if BetaFlags is unavailable so legacy behavior wins.
const PHASE5_ENVELOPE_FLAG = "unified-envelope-2026-04-16";
async function _isPhase5EnvelopesEnabled() {
  try {
    const { getBetaFlags } =
      await import("../../lib/session-core-singletons.js");
    const flags = await getBetaFlags();
    return flags.isEnabled(PHASE5_ENVELOPE_FLAG);
  } catch (_e) {
    return false;
  }
}

async function ensureSessionHandler(server, ws, session) {
  if (server.sessionHandlers.has(session.id)) {
    return server.sessionHandlers.get(session.id);
  }

  const { WebSocketInteractionAdapter } =
    await import("../../lib/interaction-adapter.js");
  const enablePhase5Envelopes = await _isPhase5EnvelopesEnabled();
  session.interaction = new WebSocketInteractionAdapter(ws, session.id, {
    enablePhase5Envelopes,
    envelopeBus: server.envelopeBus || null,
  });

  let handler;
  if (session.type === "chat") {
    const { WSChatHandler } = await import("../../lib/ws-chat-handler.js");
    handler = new WSChatHandler({
      session,
      interaction: session.interaction,
    });
  } else {
    const { WSAgentHandler } = await import("./ws-agent-handler.js");
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
    server._send(
      ws,
      envelopeError(
        id,
        "NO_SESSION_SUPPORT",
        "Session support not configured on this server",
      ),
    );
    return;
  }

  const {
    sessionType,
    provider,
    model,
    apiKey,
    baseUrl,
    projectRoot,
    enabledToolNames,
    hostManagedToolPolicy,
    worktreeIsolation,
    systemPromptExtension,
    shellPolicyOverrides,
  } = message;

  try {
    const { sessionId } = server.sessionManager.createSession({
      type: sessionType || "agent",
      provider,
      model,
      apiKey,
      baseUrl,
      projectRoot,
      enabledToolNames,
      hostManagedToolPolicy,
      worktreeIsolation,
      systemPromptExtension,
      shellPolicyOverrides,
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

    // Phase 5: broadcast service envelope for unified subscribers.
    if (typeof server.broadcastEnvelope === "function") {
      server.broadcastEnvelope({
        type: "session.created",
        sessionId,
        payload: {
          sessionType: sessionType || "agent",
          provider,
          model,
          projectRoot: projectRoot || null,
        },
      });
    }
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

    server._send(
      ws,
      envelopeResponse(
        CODING_AGENT_EVENT_TYPES.SESSION_STARTED,
        id,
        {
          sessionId,
          sessionType: sessionType || "agent",
          record,
        },
        sessionId,
      ),
    );
  } catch (err) {
    server._send(ws, envelopeError(id, "SESSION_CREATE_FAILED", err.message));
  }
}

export async function handleSessionResume(server, id, ws, message) {
  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const { sessionId } = message;
  const session = server.sessionManager.resumeSession(sessionId);

  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
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

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.SESSION_RESUMED,
      id,
      {
        sessionId: session.id,
        history,
        record,
      },
      session.id,
    ),
  );
}

export function handleSessionMessage(server, id, ws, message) {
  const { sessionId, content } = message;
  const handler = server.sessionHandlers.get(sessionId);

  if (!handler) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `No active session handler for: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  // Review-mode gate: while the session has a pending blocking review the
  // user must resolve it (approve/reject) before any new agent turn runs.
  if (
    server.sessionManager &&
    typeof server.sessionManager.isReviewBlocking === "function" &&
    server.sessionManager.isReviewBlocking(sessionId)
  ) {
    server._send(
      ws,
      envelopeError(
        id,
        "REVIEW_BLOCKING",
        "Session is in review mode — resolve the pending review before sending new messages.",
        sessionId,
      ),
    );
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
      server._send(
        ws,
        envelopeError(id, "MESSAGE_FAILED", err.message, sessionId),
      );
    });
}

export function handleSessionPolicyUpdate(server, id, ws, message) {
  const { sessionId, hostManagedToolPolicy } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.updateSessionPolicy
    ? server.sessionManager.updateSessionPolicy(
        sessionId,
        hostManagedToolPolicy,
      )
    : null;

  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true, sessionId },
      sessionId,
    ),
  );
}

export function handleSessionList(server, id, ws) {
  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
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
  server._send(
    ws,
    envelopeResponse(CODING_AGENT_EVENT_TYPES.SESSION_LIST, id, { sessions }),
  );
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

  // Phase 5: broadcast service envelope for unified subscribers.
  if (typeof server.broadcastEnvelope === "function") {
    server.broadcastEnvelope({
      type: "session.closed",
      sessionId,
      payload: {},
    });
  }
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

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true, sessionId },
      sessionId,
    ),
  );
}

export async function handleSessionInterrupt(server, id, ws, message) {
  const { sessionId } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const handler = server.sessionHandlers.get(sessionId);
  const result =
    handler && typeof handler.interrupt === "function"
      ? await handler.interrupt()
      : {
          sessionId,
          interrupted: true,
          wasProcessing: false,
          interruptedRequestId: null,
        };

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.SESSION_INTERRUPTED,
      id,
      result,
      sessionId,
    ),
  );
}

export function handleSessionAnswer(server, id, ws, message) {
  const { sessionId, requestId, answer } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (session && session.interaction && session.interaction.resolveAnswer) {
    session.interaction.resolveAnswer(requestId, answer);
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true },
      sessionId,
    ),
  );
}

/**
 * Query sub-agents spawned from a session.
 *
 * Message shape: { type: "sub-agent-list", id, sessionId }
 * Returns: envelope with payload { sessionId, active: [...], history: [...] }
 *
 * If `sessionId` is omitted, returns the global registry view so diagnostic
 * tools (e.g. `chainlesschain tasks list --sub-agents`) can inspect every
 * active child agent in the runtime.
 */
export async function handleSubAgentList(server, id, ws, message) {
  const sessionId = message?.sessionId || null;

  try {
    const { SubAgentRegistry } =
      await import("../../lib/sub-agent-registry.js");
    const registry = SubAgentRegistry.getInstance();

    let payload;
    if (sessionId) {
      const scoped = registry.getByParent(sessionId);
      payload = {
        sessionId,
        active: scoped.active,
        history: scoped.history,
        stats: registry.getStats(),
      };
    } else {
      payload = {
        sessionId: null,
        active: registry.getActive(),
        history: registry.getHistory(),
        stats: registry.getStats(),
      };
    }

    server._send(
      ws,
      envelopeResponse(
        CODING_AGENT_EVENT_TYPES.SUB_AGENT_LIST,
        id,
        payload,
        sessionId,
      ),
    );
  } catch (err) {
    server._send(
      ws,
      envelopeError(id, "SUB_AGENT_LIST_FAILED", err.message, sessionId),
    );
  }
}

/**
 * Fetch a single sub-agent snapshot by id.
 *
 * Message shape: { type: "sub-agent-get", id, subAgentId, sessionId? }
 * Returns: envelope carrying the registry snapshot (active or history) or
 *          an error envelope when the id is unknown.
 */
export async function handleSubAgentGet(server, id, ws, message) {
  const { subAgentId, sessionId } = message || {};

  if (!subAgentId) {
    server._send(
      ws,
      envelopeError(
        id,
        "MISSING_SUB_AGENT_ID",
        "sub-agent-get requires a subAgentId",
        sessionId || null,
      ),
    );
    return;
  }

  try {
    const { SubAgentRegistry } =
      await import("../../lib/sub-agent-registry.js");
    const snapshot = SubAgentRegistry.getInstance().getById(subAgentId);

    if (!snapshot) {
      server._send(
        ws,
        envelopeError(
          id,
          "SUB_AGENT_NOT_FOUND",
          `Sub-agent not found: ${subAgentId}`,
          sessionId || null,
        ),
      );
      return;
    }

    server._send(
      ws,
      envelopeResponse(
        CODING_AGENT_EVENT_TYPES.SUB_AGENT_LIST,
        id,
        {
          sessionId: sessionId || snapshot.parentId || null,
          subAgent: snapshot,
        },
        sessionId || snapshot.parentId || null,
      ),
    );
  } catch (err) {
    server._send(
      ws,
      envelopeError(id, "SUB_AGENT_GET_FAILED", err.message, sessionId || null),
    );
  }
}

/**
 * Helper: emit a review.* envelope through the session's interaction adapter
 * so every subscriber (bridge, renderer store) receives the same event
 * stream other runtime events use. Falls back to directly sending over the
 * current ws if the session has no interaction bound yet.
 */
function _emitReviewEvent(server, session, type, payload, ws) {
  const envelope = createCodingAgentEvent(
    type,
    { ...(payload || {}), sessionId: session.id },
    {
      sessionId: session.id,
      source: "cli-runtime",
    },
  );

  const interaction = session && session.interaction;
  if (interaction && typeof interaction.emit === "function") {
    try {
      interaction.emit(type, envelope.payload);
      return;
    } catch (_err) {
      // Fall through to ws send below.
    }
  }

  if (ws) {
    server._send(ws, envelope);
  }
}

/**
 * Enter review mode — block sendMessage until the review is resolved.
 *
 * Message shape:
 *   { type: "review-enter", id, sessionId, reason?, requestedBy?, checklist?, blocking? }
 */
export function handleReviewEnter(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const reviewState = server.sessionManager.enterReview(sessionId, {
    reason: message.reason || null,
    requestedBy: message.requestedBy || "user",
    checklist: message.checklist || [],
    blocking: message.blocking !== false,
  });

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_REQUESTED,
      id,
      { sessionId, reviewState },
      sessionId,
    ),
  );

  _emitReviewEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.REVIEW_REQUESTED,
    { reviewState },
    ws,
  );
}

/**
 * Submit a comment or toggle a checklist item on the active review.
 *
 * Message shape:
 *   { type: "review-submit", id, sessionId,
 *     comment?: { author?, content },
 *     checklistItemId?, checklistItemDone?, checklistItemNote? }
 */
export function handleReviewSubmit(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const updated = server.sessionManager.submitReviewComment(sessionId, {
    comment: message.comment || null,
    checklistItemId: message.checklistItemId || null,
    checklistItemDone: message.checklistItemDone,
    checklistItemNote: message.checklistItemNote,
  });

  if (!updated) {
    server._send(
      ws,
      envelopeError(
        id,
        "REVIEW_NOT_PENDING",
        "No pending review for this session",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_UPDATED,
      id,
      { sessionId, reviewState: updated },
      sessionId,
    ),
  );

  _emitReviewEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.REVIEW_UPDATED,
    { reviewState: updated },
    ws,
  );
}

/**
 * Resolve the active review with approved/rejected. Unblocks sendMessage.
 *
 * Message shape:
 *   { type: "review-resolve", id, sessionId, decision, resolvedBy?, summary? }
 */
export function handleReviewResolve(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const resolved = server.sessionManager.resolveReview(sessionId, {
    decision: message.decision,
    resolvedBy: message.resolvedBy || "user",
    summary: message.summary || null,
  });

  if (!resolved) {
    server._send(
      ws,
      envelopeError(
        id,
        "REVIEW_NOT_PENDING",
        "No pending review for this session",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_RESOLVED,
      id,
      { sessionId, reviewState: resolved },
      sessionId,
    ),
  );

  _emitReviewEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.REVIEW_RESOLVED,
    { reviewState: resolved },
    ws,
  );
}

/**
 * Fetch the current review state snapshot (or null if none).
 *
 * Message shape: { type: "review-status", id, sessionId }
 */
export function handleReviewStatus(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_STATE,
      id,
      { sessionId, reviewState: session.reviewState || null },
      sessionId,
    ),
  );
}

/**
 * Helper: emit a patch.* envelope through the session's interaction adapter
 * (same fan-out pattern as _emitReviewEvent).
 */
function _emitPatchEvent(server, session, type, payload, ws) {
  const envelope = createCodingAgentEvent(
    type,
    { ...(payload || {}), sessionId: session.id },
    {
      sessionId: session.id,
      source: "cli-runtime",
    },
  );

  const interaction = session && session.interaction;
  if (interaction && typeof interaction.emit === "function") {
    try {
      interaction.emit(type, envelope.payload);
      return;
    } catch (_err) {
      // Fall through to ws send below.
    }
  }

  if (ws) {
    server._send(ws, envelope);
  }
}

/**
 * Propose a patch (or batch of file edits) for preview.
 *
 * Message shape:
 *   { type: "patch-propose", id, sessionId, files: [...], origin?, reason? }
 */
export function handlePatchPropose(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!Array.isArray(message.files) || message.files.length === 0) {
    server._send(
      ws,
      envelopeError(
        id,
        "INVALID_PAYLOAD",
        "patch-propose requires a non-empty files array",
        sessionId,
      ),
    );
    return;
  }

  const patch = server.sessionManager.proposePatch(sessionId, {
    files: message.files,
    origin: message.origin || "tool",
    reason: message.reason || null,
    requestId: message.requestId || null,
  });

  if (!patch) {
    server._send(
      ws,
      envelopeError(
        id,
        "PATCH_PROPOSE_FAILED",
        "Unable to record patch",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_PROPOSED,
      id,
      { sessionId, patch },
      sessionId,
    ),
  );

  _emitPatchEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.PATCH_PROPOSED,
    { patch },
    ws,
  );
}

/**
 * Apply a previously-proposed patch.
 *
 * Message shape:
 *   { type: "patch-apply", id, sessionId, patchId, resolvedBy?, note? }
 */
export function handlePatchApply(server, id, ws, message) {
  const { sessionId, patchId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!patchId) {
    server._send(
      ws,
      envelopeError(id, "INVALID_PAYLOAD", "patchId is required", sessionId),
    );
    return;
  }

  const patch = server.sessionManager.applyPatch(sessionId, patchId, {
    resolvedBy: message.resolvedBy || "user",
    note: message.note || null,
  });

  if (!patch) {
    server._send(
      ws,
      envelopeError(
        id,
        "PATCH_NOT_FOUND",
        `Patch not found: ${patchId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_APPLIED,
      id,
      { sessionId, patch },
      sessionId,
    ),
  );

  _emitPatchEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.PATCH_APPLIED,
    { patch },
    ws,
  );
}

/**
 * Reject/discard a previously-proposed patch.
 *
 * Message shape:
 *   { type: "patch-reject", id, sessionId, patchId, resolvedBy?, reason? }
 */
export function handlePatchReject(server, id, ws, message) {
  const { sessionId, patchId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!patchId) {
    server._send(
      ws,
      envelopeError(id, "INVALID_PAYLOAD", "patchId is required", sessionId),
    );
    return;
  }

  const patch = server.sessionManager.rejectPatch(sessionId, patchId, {
    resolvedBy: message.resolvedBy || "user",
    reason: message.reason || null,
  });

  if (!patch) {
    server._send(
      ws,
      envelopeError(
        id,
        "PATCH_NOT_FOUND",
        `Patch not found: ${patchId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_REJECTED,
      id,
      { sessionId, patch },
      sessionId,
    ),
  );

  _emitPatchEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.PATCH_REJECTED,
    { patch },
    ws,
  );
}

/**
 * Fetch the patch summary for a session (pending + history + totals).
 *
 * Message shape: { type: "patch-summary", id, sessionId }
 */
export function handlePatchSummary(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const summary = server.sessionManager.getPatchSummary(sessionId);

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_SUMMARY,
      id,
      { sessionId, summary },
      sessionId,
    ),
  );
}

/**
 * Helper: emit a task-graph.* envelope through the session's interaction
 * adapter (same fan-out pattern as _emitPatchEvent).
 */
function _emitTaskGraphEvent(server, session, type, payload, ws) {
  const envelope = createCodingAgentEvent(
    type,
    { ...(payload || {}), sessionId: session.id },
    {
      sessionId: session.id,
      source: "cli-runtime",
    },
  );

  const interaction = session && session.interaction;
  if (interaction && typeof interaction.emit === "function") {
    try {
      interaction.emit(type, envelope.payload);
      return;
    } catch (_err) {
      // Fall through to ws send below.
    }
  }

  if (ws) {
    server._send(ws, envelope);
  }
}

/**
 * Create a session-scoped task graph.
 *
 * Message shape:
 *   { type: "task-graph-create", id, sessionId, title?, nodes: [...] }
 */
export function handleTaskGraphCreate(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!Array.isArray(message.nodes)) {
    server._send(
      ws,
      envelopeError(
        id,
        "INVALID_PAYLOAD",
        "task-graph-create requires a nodes array",
        sessionId,
      ),
    );
    return;
  }

  const graph = server.sessionManager.createTaskGraph(sessionId, {
    graphId: message.graphId,
    title: message.title,
    description: message.description,
    nodes: message.nodes,
  });

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_CREATED,
      id,
      { sessionId, graph },
      sessionId,
    ),
  );

  _emitTaskGraphEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.TASK_GRAPH_CREATED,
    { graph },
    ws,
  );
}

/**
 * Add a node to an existing task graph.
 *
 * Message shape:
 *   { type: "task-graph-add-node", id, sessionId, node: { id, title, dependsOn? } }
 */
export function handleTaskGraphAddNode(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const node = message.node || null;
  if (!node || !node.id) {
    server._send(
      ws,
      envelopeError(
        id,
        "INVALID_PAYLOAD",
        "task-graph-add-node requires node.id",
        sessionId,
      ),
    );
    return;
  }

  const graph = server.sessionManager.addTaskNode(sessionId, node);
  if (!graph) {
    server._send(
      ws,
      envelopeError(
        id,
        "TASK_GRAPH_ADD_FAILED",
        "Unable to add node (no graph, or duplicate id)",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_ADDED,
      id,
      { sessionId, graph, nodeId: node.id },
      sessionId,
    ),
  );

  _emitTaskGraphEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_ADDED,
    { graph, nodeId: node.id },
    ws,
  );
}

/**
 * Update a task graph node (status, result, error, metadata).
 *
 * Message shape:
 *   { type: "task-graph-update-node", id, sessionId, nodeId, updates: { status?, result?, error? } }
 */
export function handleTaskGraphUpdateNode(server, id, ws, message) {
  const { sessionId, nodeId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!nodeId) {
    server._send(
      ws,
      envelopeError(id, "INVALID_PAYLOAD", "nodeId is required", sessionId),
    );
    return;
  }

  const graph = server.sessionManager.updateTaskNode(
    sessionId,
    nodeId,
    message.updates || {},
  );

  if (!graph) {
    server._send(
      ws,
      envelopeError(
        id,
        "TASK_GRAPH_NODE_NOT_FOUND",
        `Task node not found: ${nodeId}`,
        sessionId,
      ),
    );
    return;
  }

  const node = graph.nodes[nodeId];
  let eventType = CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_UPDATED;
  if (node && node.status === "completed") {
    eventType = CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_COMPLETED;
  } else if (node && node.status === "failed") {
    eventType = CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_FAILED;
  }

  server._send(
    ws,
    envelopeResponse(eventType, id, { sessionId, graph, nodeId }, sessionId),
  );

  _emitTaskGraphEvent(server, session, eventType, { graph, nodeId }, ws);

  if (graph.status === "completed" || graph.status === "failed") {
    _emitTaskGraphEvent(
      server,
      session,
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_COMPLETED,
      { graph },
      ws,
    );
  }
}

/**
 * Advance the task graph: promote any pending node whose deps are satisfied.
 *
 * Message shape: { type: "task-graph-advance", id, sessionId }
 */
export function handleTaskGraphAdvance(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const result = server.sessionManager.advanceTaskGraph(sessionId);
  if (!result) {
    server._send(
      ws,
      envelopeError(
        id,
        "TASK_GRAPH_NOT_FOUND",
        "No task graph on session",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_ADVANCED,
      id,
      { sessionId, graph: result.graph, becameReady: result.becameReady },
      sessionId,
    ),
  );

  _emitTaskGraphEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.TASK_GRAPH_ADVANCED,
    { graph: result.graph, becameReady: result.becameReady },
    ws,
  );
}

/**
 * Fetch the current task graph state.
 *
 * Message shape: { type: "task-graph-state", id, sessionId }
 */
export function handleTaskGraphState(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const graph = server.sessionManager.getTaskGraph(sessionId);

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_STATE,
      id,
      { sessionId, graph },
      sessionId,
    ),
  );
}

export function handleHostToolResult(server, id, ws, message) {
  const { sessionId, requestId, success, result, error, toolName } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session || !session.interaction) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
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

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true },
      sessionId,
    ),
  );
}
