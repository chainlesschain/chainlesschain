/**
 * terminal-handlers — WS topic handlers for the Plan A remote-terminal
 * feature (`docs/design/Android_Remote_Terminal_Plan_A.md`).
 *
 * Exposes 8 topics on top of the shared PtyManager:
 *   terminal.create / list / stdin / resize / close / history
 *   plus server-pushed events terminal.stdout / terminal.exit
 *
 * Wiring contract: the bootstrap calls
 *
 *     const { handlers, attachServerEvents } =
 *       createTerminalHandlers({ ptyManager, broadcast });
 *     // spread handlers into wsHandlers
 *     attachServerEvents();  // subscribes PtyManager events → ws.broadcast
 *
 * In DB-bound Desktop production, every operation carries projectId and
 * stdout/exit is sent only to WebSocket connections that successfully
 * selected that project. Client-side filtering is not an authorization
 * boundary.
 *
 * projectId is a session partition inside the already authenticated/trusted
 * device boundary; it is not a per-client project ACL. `verifyTrustedSource`
 * remains the caller trust gate.
 *
 * Payload data is base64(UTF-8) on the wire — see design §3.3 / §3.4. The
 * handlers do the encode/decode so the PtyManager stays Buffer-native and
 * SPA stays string-native.
 */

const DEFAULT_DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\bdel\s+\/[sq]/i,
  /\bdiskpart\b/i,
  // Bash fork bomb literal — match the canonical sequence
  /:\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;\s*:/,
];
const {
  createBoundTerminalSession,
} = require("../../terminal/terminal-create-request");

function bufferToBase64(buf) {
  return Buffer.isBuffer(buf)
    ? buf.toString("base64")
    : Buffer.from(buf, "utf-8").toString("base64");
}

function base64ToBuffer(s) {
  if (typeof s !== "string") {
    throw new Error("data_must_be_base64_string");
  }
  return Buffer.from(s, "base64");
}

/**
 * @typedef {Object} TerminalHandlersOptions
 * @property {import("../../terminal/PtyManager").PtyManager} ptyManager
 * @property {(frame: any) => void} broadcast  ws-cli-loader's broadcast fn
 * @property {(cmd: string, sessionId: string) => Promise<boolean>} [requireConfirmation]
 *   Hook invoked when stdin matches a dangerous pattern. Returns true if
 *   the user confirmed at the desktop trust anchor. Default = always
 *   reject (safe default until the systray confirm UI lands in Phase 4).
 * @property {RegExp[]} [dangerousPatterns]
 *   Override the default keyword blocklist.
 * @property {(envelope: any) => boolean} [verifyTrustedSource]
 *   Per-envelope trust gate — return false to silently drop. Plan A
 *   intends to wire this to paired_devices/trustLevel checks in Phase 3;
 *   in Phase 1 (developer using own desktop) default-allows everything.
 * @property {boolean} [requireProjectScope]
 *   Require every operation to carry a projectId. Defaults to the
 *   PtyManager's DB-binding mode.
 */

/**
 * @param {TerminalHandlersOptions} options
 */
function createTerminalHandlers(options) {
  const { ptyManager, broadcast } = options;
  if (!ptyManager) {
    throw new TypeError("ptyManager is required");
  }
  if (typeof broadcast !== "function") {
    throw new TypeError("broadcast must be a function");
  }
  const dangerousPatterns =
    options.dangerousPatterns || DEFAULT_DANGEROUS_PATTERNS;
  const requireConfirmation =
    options.requireConfirmation || (async () => false);
  const verifyTrustedSource = options.verifyTrustedSource || (() => true);
  const requireProjectScope =
    options.requireProjectScope ?? ptyManager.requiresProjectScope === true;
  const clientProjectScopes = new Map();

  function optionalProjectIdFrom(payload) {
    const projectId =
      typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
    return projectId || null;
  }

  function projectIdFrom(payload) {
    const projectId = optionalProjectIdFrom(payload);
    if (requireProjectScope && !projectId) {
      const error = new Error("terminal_project_scope_required");
      error.code = "ERR_PTY_PROJECT_SCOPE_REQUIRED";
      throw error;
    }
    return projectId;
  }

  function rememberClientProject(ctx, projectId) {
    if (!requireProjectScope || !projectId || !ctx?.clientId || !ctx?.ws) {
      return;
    }
    let entry = clientProjectScopes.get(ctx.clientId);
    if (!entry) {
      entry = {
        projectIds: new Set(),
        server: ctx.server,
        ws: ctx.ws,
      };
      clientProjectScopes.set(ctx.clientId, entry);
      ctx.ws.once?.("close", () => {
        clientProjectScopes.delete(ctx.clientId);
      });
    }
    entry.projectIds.add(projectId);
  }

  function publishProjectEvent(projectId, frame) {
    if (!requireProjectScope) {
      broadcast(frame);
      return;
    }
    if (!projectId) {
      return;
    }
    for (const entry of clientProjectScopes.values()) {
      if (!entry.projectIds.has(projectId)) {
        continue;
      }
      try {
        entry.server?._send?.(entry.ws, frame);
      } catch {
        // Socket teardown races are handled by the close hook.
      }
    }
  }

  // Server → project-subscribed-client fan-out plumbing.
  let detachServerEvents = null;
  function attachServerEvents() {
    if (detachServerEvents) {
      return detachServerEvents;
    }
    const onStdout = ({ sessionId, projectId, data, seq }) => {
      publishProjectEvent(projectId, {
        type: "terminal.stdout",
        payload: {
          sessionId,
          projectId,
          data: bufferToBase64(data),
          seq,
        },
      });
    };
    const onExit = ({ sessionId, projectId, exitCode, signal }) => {
      publishProjectEvent(projectId, {
        type: "terminal.exit",
        payload: { sessionId, projectId, exitCode, signal },
      });
    };
    ptyManager.on("stdout", onStdout);
    ptyManager.on("exit", onExit);
    const detach = () => {
      if (detachServerEvents !== detach) {
        return;
      }
      const remove =
        typeof ptyManager.off === "function"
          ? ptyManager.off.bind(ptyManager)
          : typeof ptyManager.removeListener === "function"
            ? ptyManager.removeListener.bind(ptyManager)
            : null;
      remove?.("stdout", onStdout);
      remove?.("exit", onExit);
      clientProjectScopes.clear();
      detachServerEvents = null;
    };
    detachServerEvents = detach;
    return detach;
  }

  const handlers = {
    "terminal.create": async (frame, ctx) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      } // silent drop
      const payload = frame?.payload || frame || {};
      // PtyManager.create throws on whitelist / native / cap failures.
      // The dispatcher converts thrown errors into `.result` ok:false
      // envelopes, so SPA gets a clean error.code.
      const created = createBoundTerminalSession(ptyManager, payload);
      const resolvedProjectId = optionalProjectIdFrom(created);
      if (requireProjectScope && !resolvedProjectId) {
        const error = new Error("terminal_project_binding_missing");
        error.code = "ERR_PTY_PROJECT_BINDING_INVALID";
        throw error;
      }
      // Legacy clients may select by cwd. Subscribe with the manager's
      // DB-resolved id, never the caller's selector.
      rememberClientProject(ctx, resolvedProjectId);
      return created;
    },

    "terminal.list": async (frame, ctx) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const payload = frame?.payload || frame || {};
      const projectId = projectIdFrom(payload);
      const sessions = ptyManager.list(projectId);
      rememberClientProject(ctx, projectId);
      return { sessions };
    },

    "terminal.stdin": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const payload = frame?.payload || frame || {};
      const { sessionId, data } = payload;
      const projectId = projectIdFrom(payload);
      if (!sessionId) {
        throw new Error("session_id_required");
      }
      const buf = base64ToBuffer(data);
      const text = buf.toString("utf-8");
      if (dangerousPatterns.some((re) => re.test(text))) {
        const ok = await requireConfirmation(text, sessionId);
        if (!ok) {
          throw new Error("dangerous_keyword_blocked");
        }
      }
      ptyManager.write(sessionId, buf, projectId);
      return { ok: true };
    },

    "terminal.resize": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const payload = frame?.payload || frame || {};
      const { sessionId, cols, rows } = payload;
      const projectId = projectIdFrom(payload);
      if (!sessionId) {
        throw new Error("session_id_required");
      }
      ptyManager.resize(sessionId, cols, rows, projectId);
      return { ok: true };
    },

    "terminal.close": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const payload = frame?.payload || frame || {};
      const { sessionId } = payload;
      const projectId = projectIdFrom(payload);
      if (!sessionId) {
        throw new Error("session_id_required");
      }
      ptyManager.close(sessionId, projectId);
      return { ok: true };
    },

    "terminal.history": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const payload = frame?.payload || frame || {};
      const { sessionId, fromSeq } = payload;
      const projectId = projectIdFrom(payload);
      if (!sessionId) {
        throw new Error("session_id_required");
      }
      const { chunks, truncated } = ptyManager.history(
        sessionId,
        fromSeq || 0,
        projectId,
      );
      return {
        chunks: chunks.map((c) => ({
          seq: c.seq,
          data: bufferToBase64(c.data),
        })),
        truncated,
      };
    },
  };

  return { handlers, attachServerEvents };
}

module.exports = {
  createTerminalHandlers,
  DEFAULT_DANGEROUS_PATTERNS,
  // exported for tests
  _bufferToBase64: bufferToBase64,
  _base64ToBuffer: base64ToBuffer,
};
