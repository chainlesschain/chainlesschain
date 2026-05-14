/**
 * terminal-ipc — IPC bridge for the V6 native shell.
 *
 * Wires the shared PtyManager singleton to ipcMain.handle + webContents.send
 * so the V6 renderer can talk to the same session table as the web-shell
 * WS gateway. The same `PtyManager` instance is passed to
 * `startWebShell({ ptyManager })` and `setupTerminalIpc({ ptyManager })`
 * — sessions opened in either shell are visible in the other.
 *
 * IPC channels (request → response):
 *   terminal:create   ({ shell, cwd, env, cols, rows }) → { sessionId, pid, shell, createdAt }
 *   terminal:list     () → [{ id, shell, cwd, alive, lastSeq }, …]
 *   terminal:stdin    ({ sessionId, data })           → { ok: true }     // data: UTF-8 string
 *   terminal:resize   ({ sessionId, cols, rows })     → { ok: true }
 *   terminal:close    ({ sessionId })                 → { ok: true }
 *   terminal:history  ({ sessionId, fromSeq })        → { chunks:[{seq,data}], truncated }
 *
 * Server-pushed events (main → all renderers):
 *   terminal:stdout   ({ sessionId, data, seq })      // data: UTF-8 string
 *   terminal:exit     ({ sessionId, exitCode, signal })
 *
 * Unlike the WS protocol, the IPC bridge passes UTF-8 strings directly
 * (no base64) — Electron's structured-clone IPC handles binary safely.
 * The dangerous-keyword gate and trusted-source gate are NOT applied here
 * because the renderer is already inside the trust boundary (same user,
 * same Electron app). Remote callers go through the WS path which has
 * the full gating chain.
 */

/**
 * @typedef {Object} TerminalIpcOptions
 * @property {import('./PtyManager').PtyManager} ptyManager
 *   Required — singleton PtyManager shared with web-shell.
 * @property {import('electron').IpcMain} ipcMain
 *   Required — Electron's ipcMain (injectable for tests).
 * @property {() => Array<{ send: (channel: string, payload: any) => void }>}
 *   [getWebContentsList]
 *   Returns the list of WebContents to broadcast push events to. Default:
 *   uses Electron's BrowserWindow.getAllWindows().map(w => w.webContents).
 *   Tests pass a stub returning recorded sinks.
 */

// Track setups by ptyManager so re-calling with the same instance is a
// no-op (production callers shouldn't double-setup) while tests with
// fresh fakes get clean state per call.
const _activeSetups = new WeakSet();

/**
 * Register the terminal:* IPC handlers + start fan-out of PtyManager
 * events to all renderers. Re-calling with the same ptyManager instance
 * is a no-op (logs warning). Different instances each get their own
 * registration.
 *
 * Returns a `dispose` fn that unregisters everything.
 *
 * @param {TerminalIpcOptions} options
 * @returns {() => void}
 */
function setupTerminalIpc(options) {
  if (!options || !options.ptyManager) {
    throw new TypeError("setupTerminalIpc: ptyManager is required");
  }
  if (!options.ipcMain) {
    throw new TypeError("setupTerminalIpc: ipcMain is required");
  }
  if (_activeSetups.has(options.ptyManager)) {
    console.warn(
      "[terminal-ipc] setupTerminalIpc called twice for same ptyManager — ignoring",
    );
    return () => {};
  }
  const { ptyManager, ipcMain } = options;
  const detachFns = [];
  const getWebContentsList =
    options.getWebContentsList ||
    (() => {
      const { BrowserWindow } = require("electron");
      return BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .map((w) => w.webContents)
        .filter((wc) => wc && !wc.isDestroyed());
    });

  function broadcast(channel, payload) {
    for (const wc of getWebContentsList()) {
      try {
        wc.send(channel, payload);
      } catch {
        // webContents may be destroyed mid-loop — skip silently.
      }
    }
  }

  ipcMain.handle("terminal:create", async (_event, req = {}) => {
    return ptyManager.create({
      shell: req.shell,
      cwd: req.cwd,
      env: req.env,
      cols: req.cols,
      rows: req.rows,
    });
  });

  ipcMain.handle("terminal:list", async () => {
    return ptyManager.list();
  });

  ipcMain.handle("terminal:stdin", async (_event, req = {}) => {
    const { sessionId, data } = req;
    if (!sessionId) {
      throw new Error("session_id_required");
    }
    if (typeof data !== "string") {
      throw new Error("data_must_be_string");
    }
    ptyManager.write(sessionId, data);
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", async (_event, req = {}) => {
    const { sessionId, cols, rows } = req;
    if (!sessionId) {
      throw new Error("session_id_required");
    }
    ptyManager.resize(sessionId, cols, rows);
    return { ok: true };
  });

  ipcMain.handle("terminal:close", async (_event, req = {}) => {
    const { sessionId } = req;
    if (!sessionId) {
      throw new Error("session_id_required");
    }
    ptyManager.close(sessionId);
    return { ok: true };
  });

  ipcMain.handle("terminal:history", async (_event, req = {}) => {
    const { sessionId, fromSeq } = req;
    if (!sessionId) {
      throw new Error("session_id_required");
    }
    const { chunks, truncated } = ptyManager.history(sessionId, fromSeq || 0);
    return {
      chunks: chunks.map((c) => ({
        seq: c.seq,
        data: c.data.toString("utf-8"),
      })),
      truncated,
    };
  });

  function onStdout({ sessionId, data, seq }) {
    const str = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
    broadcast("terminal:stdout", { sessionId, data: str, seq });
  }
  function onExit({ sessionId, exitCode, signal }) {
    broadcast("terminal:exit", { sessionId, exitCode, signal });
  }
  ptyManager.on("stdout", onStdout);
  ptyManager.on("exit", onExit);

  _activeSetups.add(ptyManager);
  detachFns.push(
    () => ipcMain.removeHandler("terminal:create"),
    () => ipcMain.removeHandler("terminal:list"),
    () => ipcMain.removeHandler("terminal:stdin"),
    () => ipcMain.removeHandler("terminal:resize"),
    () => ipcMain.removeHandler("terminal:close"),
    () => ipcMain.removeHandler("terminal:history"),
    () => ptyManager.off("stdout", onStdout),
    () => ptyManager.off("exit", onExit),
  );
  return function dispose() {
    for (const fn of detachFns) {
      try {
        fn();
      } catch {
        /* idempotent teardown */
      }
    }
    detachFns.length = 0;
    _activeSetups.delete(ptyManager);
  };
}

module.exports = { setupTerminalIpc };
