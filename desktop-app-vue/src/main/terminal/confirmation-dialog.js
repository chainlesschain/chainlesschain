/**
 * confirmation-dialog — bridge `requireConfirmation` hook to Electron's
 * native message box, with optional "permanent trust" persistence.
 *
 * Plan A spec (docs/design/Android_Remote_Terminal_Plan_A.md §4.3):
 *   On dangerous-keyword stdin from a remote source (Android / WS client),
 *   the desktop is the trust anchor and must show a user-confirmable
 *   dialog. Local user can choose Allow / Deny / "Permanently trust this
 *   device for this command".
 *
 * Currently the trust map is in-memory only (resets per app launch). A
 * future enhancement persists to `.chainlesschain/config.json`'s
 * `terminal.permanentTrustedCommands` and reads on bootstrap.
 *
 * Returns a function with signature `(cmd, sessionId) => Promise<boolean>`
 * suitable for direct injection into `createTerminalHandlers({ requireConfirmation })`.
 */

/**
 * @param {object} options
 * @param {() => import('electron').BrowserWindow | null} options.getMainWindow
 *   Parent window for the modal (so it inherits focus + above-others).
 *   Lazy getter — main window may not exist yet when this is called.
 * @param {{ showMessageBox: Function }} [options.dialogModule]
 *   Override Electron's `dialog` (for unit tests).
 * @returns {(cmd: string, sessionId: string) => Promise<boolean>}
 */
function createTerminalConfirmation(options = {}) {
  const getMainWindow = options.getMainWindow || (() => null);
  const dialogModule = options.dialogModule || require("electron").dialog;
  // In-memory allowlist of "<sessionId>:<cmd>" entries the user has
  // permanently approved. Cleared on app restart — Plan A intentionally
  // does not persist sensitive command allowlists to disk.
  const trustedKeys = new Set();

  return async function requireConfirmation(cmd, sessionId) {
    const key = `${sessionId || "*"}:${cmd}`;
    if (trustedKeys.has(key)) {
      return true;
    }

    const win = getMainWindow() || null;
    try {
      const result = await dialogModule.showMessageBox(win, {
        type: "warning",
        title: "远程命令需要确认",
        message: "远程设备请求执行高危命令",
        detail: `命令: ${cmd}\n会话: ${sessionId || "(未知)"}\n\n确认在桌面端执行？`,
        buttons: ["拒绝", "允许一次", "永久信任本命令"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 2) {
        trustedKeys.add(key);
        return true;
      }
      return result.response === 1;
    } catch {
      // Dialog failed (e.g. headless test). Default to deny — never let
      // a dialog crash turn into silent approval.
      return false;
    }
  };
}

module.exports = { createTerminalConfirmation };
