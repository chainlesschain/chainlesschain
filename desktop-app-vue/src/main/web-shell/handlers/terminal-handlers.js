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
 * `broadcast(frame)` is the ws-cli-loader.js return value — fan-out to all
 * connected clients on the embedded WS gateway. Phase 1 broadcasts every
 * stdout/exit to every client; the SPA filters by sessionId. Phase 4 will
 * track per-client subscription if needed.
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

  // Server → all-clients fan-out plumbing. The bootstrap calls this once
  // after constructing the WS gateway so events route there.
  function attachServerEvents() {
    ptyManager.on("stdout", ({ sessionId, data, seq }) => {
      broadcast({
        type: "terminal.stdout",
        payload: {
          sessionId,
          data: bufferToBase64(data),
          seq,
        },
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
      if (!verifyTrustedSource(frame)) {
        return null;
      } // silent drop
      const payload = frame?.payload || frame || {};
      // PtyManager.create throws on whitelist / native / cap failures.
      // The dispatcher converts thrown errors into `.result` ok:false
      // envelopes, so SPA gets a clean error.code.
      return ptyManager.create({
        shell: payload.shell,
        cwd: payload.cwd,
        env: payload.env,
        cols: payload.cols,
        rows: payload.rows,
      });
    },

    "terminal.list": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      return { sessions: ptyManager.list() };
    },

    "terminal.stdin": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const { sessionId, data } = frame?.payload || frame || {};
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
      ptyManager.write(sessionId, buf);
      return { ok: true };
    },

    "terminal.resize": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const { sessionId, cols, rows } = frame?.payload || frame || {};
      if (!sessionId) {
        throw new Error("session_id_required");
      }
      ptyManager.resize(sessionId, cols, rows);
      return { ok: true };
    },

    "terminal.close": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const { sessionId } = frame?.payload || frame || {};
      if (!sessionId) {
        throw new Error("session_id_required");
      }
      ptyManager.close(sessionId);
      return { ok: true };
    },

    "terminal.history": async (frame) => {
      if (!verifyTrustedSource(frame)) {
        return null;
      }
      const { sessionId, fromSeq } = frame?.payload || frame || {};
      if (!sessionId) {
        throw new Error("session_id_required");
      }
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

module.exports = {
  createTerminalHandlers,
  DEFAULT_DANGEROUS_PATTERNS,
  // exported for tests
  _bufferToBase64: bufferToBase64,
  _base64ToBuffer: base64ToBuffer,
};
