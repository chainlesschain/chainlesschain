/**
 * terminal-handlers — WS topic handlers for Plan A remote-terminal.
 *
 * ESM mirror of `desktop-app-vue/src/main/web-shell/handlers/terminal-handlers.js`.
 * Keep both copies in sync (see the matching mirror docstring there).
 */

export const DEFAULT_DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\bdel\s+\/[sq]/i,
  /\bdiskpart\b/i,
  /:\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;\s*:/,
];

export function bufferToBase64(buf) {
  return Buffer.isBuffer(buf)
    ? buf.toString("base64")
    : Buffer.from(buf, "utf-8").toString("base64");
}

export function base64ToBuffer(s) {
  if (typeof s !== "string") {
    throw new Error("data_must_be_base64_string");
  }
  return Buffer.from(s, "base64");
}

export function createTerminalHandlers(options) {
  const { ptyManager, broadcast } = options;
  if (!ptyManager) throw new TypeError("ptyManager is required");
  if (typeof broadcast !== "function") {
    throw new TypeError("broadcast must be a function");
  }
  const dangerousPatterns =
    options.dangerousPatterns || DEFAULT_DANGEROUS_PATTERNS;
  const requireConfirmation =
    options.requireConfirmation || (async () => false);
  const verifyTrustedSource = options.verifyTrustedSource || (() => true);

  function attachServerEvents() {
    ptyManager.on("stdout", ({ sessionId, data, seq }) => {
      broadcast({
        type: "terminal.stdout",
        payload: { sessionId, data: bufferToBase64(data), seq },
      });
    });
    ptyManager.on("exit", ({ sessionId, exitCode, signal }) => {
      broadcast({
        type: "terminal.exit",
        payload: { sessionId, exitCode, signal },
      });
    });
  }

  const handlers = {
    "terminal.create": async (frame) => {
      if (!verifyTrustedSource(frame)) return null;
      const payload = frame?.payload || frame || {};
      return ptyManager.create({
        shell: payload.shell,
        cwd: payload.cwd,
        env: payload.env,
        cols: payload.cols,
        rows: payload.rows,
      });
    },

    "terminal.list": async (frame) => {
      if (!verifyTrustedSource(frame)) return null;
      return { sessions: ptyManager.list() };
    },

    "terminal.stdin": async (frame) => {
      if (!verifyTrustedSource(frame)) return null;
      const { sessionId, data } = frame?.payload || frame || {};
      if (!sessionId) throw new Error("session_id_required");
      const buf = base64ToBuffer(data);
      const text = buf.toString("utf-8");
      if (dangerousPatterns.some((re) => re.test(text))) {
        const ok = await requireConfirmation(text, sessionId);
        if (!ok) throw new Error("dangerous_keyword_blocked");
      }
      ptyManager.write(sessionId, buf);
      return { ok: true };
    },

    "terminal.resize": async (frame) => {
      if (!verifyTrustedSource(frame)) return null;
      const { sessionId, cols, rows } = frame?.payload || frame || {};
      if (!sessionId) throw new Error("session_id_required");
      ptyManager.resize(sessionId, cols, rows);
      return { ok: true };
    },

    "terminal.close": async (frame) => {
      if (!verifyTrustedSource(frame)) return null;
      const { sessionId } = frame?.payload || frame || {};
      if (!sessionId) throw new Error("session_id_required");
      ptyManager.close(sessionId);
      return { ok: true };
    },

    "terminal.history": async (frame) => {
      if (!verifyTrustedSource(frame)) return null;
      const { sessionId, fromSeq } = frame?.payload || frame || {};
      if (!sessionId) throw new Error("session_id_required");
      const { chunks, truncated } = ptyManager.history(sessionId, fromSeq || 0);
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
