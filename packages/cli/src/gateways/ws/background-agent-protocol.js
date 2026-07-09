/**
 * background-agent WS protocol — exposes the background-session transport to
 * web-panel / IDE clients so a "background agents" panel can list sessions,
 * live-follow their logs, and interactively take a session over (follow-up
 * prompts / stop-turn), reusing the exact same NDJSON pipe protocol that
 * `cc attach` speaks.
 *
 * Routes (request → reply):
 *   bg-list      {all?}            → {type:"bg-list", sessions}
 *   bg-view      {bgId, lines?}    → {type:"bg-view", session, log}
 *   bg-attach    {bgId, lines?}    → {type:"bg-attach", bgId, hello, log}
 *   bg-prompt    {bgId, text}      → {type:"bg-prompt", bgId, sent}
 *   bg-stop-turn {bgId}            → {type:"bg-stop-turn", bgId, sent}
 *   bg-detach    {bgId}            → {type:"bg-detach", bgId}
 *   bg-stop      {bgId}            → {type:"bg-stop", session}   (kill whole session)
 *
 * While attached, the server pushes unsolicited frames to that client:
 *   {type:"bg-event", bgId, event}   worker lifecycle events (turn-started /
 *                                    turn-ended / idle / accepted / error /
 *                                    transport-closed)
 *   {type:"bg-log",   bgId, chunk}   log-file delta (500ms poll)
 *
 * The state file's `transport.token` is the local takeover capability — it is
 * NEVER sent over WS. Sessions are serialized with `interactive: true/false`
 * instead; the server process (same user) performs the pipe handshake itself.
 */

import { existsSync, readFileSync } from "node:fs";

const LOG_POLL_MS = 500;

async function loadSupervisor() {
  return import("../../lib/background-agent-supervisor.js");
}

/** Strip the takeover token before a session state crosses the WS boundary. */
export function sanitizeBackgroundSession(state) {
  if (!state) return state;
  const { transport, ...rest } = state;
  return { ...rest, interactive: Boolean(transport?.pipe) };
}

function sendError(server, id, ws, code, message) {
  server._send(ws, { id, type: "error", code, message });
}

function attachments(client) {
  if (!client._bgAttachments) client._bgAttachments = new Map();
  return client._bgAttachments;
}

function dropAttachment(client, bgId) {
  const map = client?._bgAttachments;
  const entry = map?.get(bgId);
  if (!entry) return false;
  map.delete(bgId);
  clearInterval(entry.poll);
  try {
    entry.conn.close();
  } catch {
    /* worker side already gone */
  }
  return true;
}

/** Tear down every transport relay a client holds (called on ws close). */
export function cleanupBgAttachments(client) {
  const map = client?._bgAttachments;
  if (!map) return;
  for (const bgId of [...map.keys()]) dropAttachment(client, bgId);
}

export async function handleBgList(server, id, ws, message) {
  try {
    const { listBackgroundAgents } = await loadSupervisor();
    const sessions = listBackgroundAgents({ all: message.all === true }).map(
      sanitizeBackgroundSession,
    );
    server._send(ws, { id, type: "bg-list", sessions });
  } catch (err) {
    sendError(server, id, ws, "BG_LIST_FAILED", err.message);
  }
}

export async function handleBgView(server, id, ws, message) {
  try {
    const {
      readBackgroundAgentState,
      effectiveBackgroundAgentState,
      readBackgroundAgentLog,
    } = await loadSupervisor();
    if (!message.bgId) {
      return sendError(server, id, ws, "NO_BG_ID", "bgId required");
    }
    const session = effectiveBackgroundAgentState(
      readBackgroundAgentState(message.bgId),
    );
    if (!session) {
      return sendError(
        server,
        id,
        ws,
        "BG_NOT_FOUND",
        `Background agent not found: ${message.bgId}`,
      );
    }
    const log = readBackgroundAgentLog(message.bgId, {
      lines: Number(message.lines) || 100,
    });
    server._send(ws, {
      id,
      type: "bg-view",
      session: sanitizeBackgroundSession(session),
      log,
    });
  } catch (err) {
    sendError(server, id, ws, "BG_VIEW_FAILED", err.message);
  }
}

export async function handleBgAttach(server, clientId, id, ws, message) {
  try {
    const client = server.clients.get(clientId);
    if (!client) {
      return sendError(server, id, ws, "NO_CLIENT", "client not registered");
    }
    if (!message.bgId) {
      return sendError(server, id, ws, "NO_BG_ID", "bgId required");
    }
    const bgId = message.bgId;
    const {
      readBackgroundAgentState,
      effectiveBackgroundAgentState,
      readBackgroundAgentLog,
      logPath,
    } = await loadSupervisor();

    const existing = attachments(client).get(bgId);
    if (existing) {
      // Idempotent re-attach: reply with the live handshake instead of
      // stacking a second relay (a reconnecting panel re-sends bg-attach).
      server._send(ws, {
        id,
        type: "bg-attach",
        bgId,
        hello: existing.hello,
        log: "",
        reattached: true,
      });
      return;
    }

    const session = effectiveBackgroundAgentState(
      readBackgroundAgentState(bgId),
    );
    if (!session) {
      return sendError(
        server,
        id,
        ws,
        "BG_NOT_FOUND",
        `Background agent not found: ${bgId}`,
      );
    }
    if (session.status !== "running" || !session.transport?.pipe) {
      return sendError(
        server,
        id,
        ws,
        "BG_NOT_INTERACTIVE",
        `Background agent ${bgId} is ${session.status} and has no live session transport`,
      );
    }

    const { connectBackgroundSession } =
      await import("../../lib/background-session-transport.js");
    let conn;
    try {
      conn = await connectBackgroundSession({
        pipePath: session.transport.pipe,
        token: session.transport.token,
        onEvent: (event) => {
          server._send(ws, { type: "bg-event", bgId, event });
        },
        onClose: () => {
          if (dropAttachment(client, bgId)) {
            server._send(ws, {
              type: "bg-event",
              bgId,
              event: { type: "transport-closed" },
            });
          }
        },
      });
    } catch (err) {
      return sendError(
        server,
        id,
        ws,
        "BG_ATTACH_FAILED",
        `session transport unavailable: ${err.message}`,
      );
    }

    const logFile = logPath(bgId);
    let offset = existsSync(logFile) ? readFileSync(logFile, "utf8").length : 0;
    const poll = setInterval(() => {
      try {
        if (!existsSync(logFile)) return;
        const text = readFileSync(logFile, "utf8");
        if (offset > text.length) offset = 0; // truncated/rotated
        if (text.length > offset) {
          const chunk = text.slice(offset);
          offset = text.length;
          server._send(ws, { type: "bg-log", bgId, chunk });
        }
      } catch {
        /* transient read failures skip one tick */
      }
    }, LOG_POLL_MS);
    poll.unref?.();

    attachments(client).set(bgId, { conn, poll, hello: conn.hello });
    server._send(ws, {
      id,
      type: "bg-attach",
      bgId,
      hello: conn.hello,
      log: readBackgroundAgentLog(bgId, {
        lines: Number(message.lines) || 100,
      }),
    });
  } catch (err) {
    sendError(server, id, ws, "BG_ATTACH_FAILED", err.message);
  }
}

function requireAttachment(server, clientId, id, ws, message) {
  const client = server.clients.get(clientId);
  const entry = client?._bgAttachments?.get(message.bgId);
  if (!message.bgId) {
    sendError(server, id, ws, "NO_BG_ID", "bgId required");
    return null;
  }
  if (!entry) {
    sendError(
      server,
      id,
      ws,
      "BG_NOT_ATTACHED",
      `not attached to ${message.bgId} — send bg-attach first`,
    );
    return null;
  }
  return entry;
}

export async function handleBgPrompt(server, clientId, id, ws, message) {
  const entry = requireAttachment(server, clientId, id, ws, message);
  if (!entry) return;
  const text = String(message.text || "").trim();
  if (!text) {
    return sendError(server, id, ws, "NO_TEXT", "prompt text required");
  }
  const sent = entry.conn.send({ type: "prompt", text });
  server._send(ws, { id, type: "bg-prompt", bgId: message.bgId, sent });
}

export async function handleBgStopTurn(server, clientId, id, ws, message) {
  const entry = requireAttachment(server, clientId, id, ws, message);
  if (!entry) return;
  const sent = entry.conn.send({ type: "stop" });
  server._send(ws, { id, type: "bg-stop-turn", bgId: message.bgId, sent });
}

export async function handleBgDetach(server, clientId, id, ws, message) {
  if (!message.bgId) {
    return sendError(server, id, ws, "NO_BG_ID", "bgId required");
  }
  const client = server.clients.get(clientId);
  const dropped = dropAttachment(client, message.bgId);
  server._send(ws, { id, type: "bg-detach", bgId: message.bgId, dropped });
}

export async function handleBgRename(server, id, ws, message) {
  try {
    if (!message.bgId) {
      return sendError(server, id, ws, "NO_BG_ID", "bgId required");
    }
    const { renameBackgroundAgent } = await loadSupervisor();
    const session = renameBackgroundAgent(message.bgId, message.title);
    server._send(ws, {
      id,
      type: "bg-rename",
      session: sanitizeBackgroundSession(session),
    });
  } catch (err) {
    sendError(server, id, ws, "BG_RENAME_FAILED", err.message);
  }
}

export async function handleBgResume(server, id, ws, message) {
  try {
    if (!message.bgId) {
      return sendError(server, id, ws, "NO_BG_ID", "bgId required");
    }
    const { resumeBackgroundAgent } = await loadSupervisor();
    const session = resumeBackgroundAgent(message.bgId, message.text);
    server._send(ws, {
      id,
      type: "bg-resume",
      session: sanitizeBackgroundSession(session),
    });
  } catch (err) {
    sendError(server, id, ws, "BG_RESUME_FAILED", err.message);
  }
}

export async function handleBgStop(server, clientId, id, ws, message) {
  try {
    if (!message.bgId) {
      return sendError(server, id, ws, "NO_BG_ID", "bgId required");
    }
    // Kill the whole session: drop our relay first so the worker's
    // "no clients" finalize path doesn't race the stop.
    dropAttachment(server.clients.get(clientId), message.bgId);
    const { stopBackgroundAgent } = await loadSupervisor();
    const session = stopBackgroundAgent(message.bgId);
    server._send(ws, {
      id,
      type: "bg-stop",
      session: sanitizeBackgroundSession(session),
    });
  } catch (err) {
    sendError(server, id, ws, "BG_STOP_FAILED", err.message);
  }
}
