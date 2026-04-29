/**
 * `fs.openDialog` / `fs.saveDialog` WS handlers — Phase 1.2 first batch.
 *
 * Security-by-design: these handlers DO NOT expose arbitrary path I/O. Every
 * read/write is gated by an Electron native dialog the user explicitly
 * confirms. This deliberately trades automation power for a sane default —
 * no hostile or malformed WS frame can read `/etc/passwd` or overwrite files
 * silently. Future Phase 1.4+ may add scoped, whitelist-based handlers
 * (`fs.read` for project tree, `fs.write` for project tree) but those need
 * a separate threat-model review.
 *
 * Handler frames:
 *   client → server: { id, type: "fs.openDialog", title?, filters? }
 *   server → client: { id, type: "fs.openDialog.result", ok: true,
 *     result: { canceled, path, size, content, reason? } }
 *
 *   client → server: { id, type: "fs.saveDialog", title?, defaultPath?,
 *     filters?, content }
 *   server → client: { id, type: "fs.saveDialog.result", ok: true,
 *     result: { canceled, path } }
 *
 * The `mainWindow` option is required at registration — the handler throws
 * "main_window_unavailable" if it's null at call time (e.g. window already
 * destroyed). `dialogModule` and `fsModule` are injectable so unit tests
 * don't need to spin up Electron.
 *
 * Read cap: 10 MiB. Larger files return `{ reason: "too_large", content: null }`
 * so the SPA can show a "file too large" UI without us blocking the WS loop
 * loading 500 MB into memory.
 */

const READ_MAX_BYTES = 10 * 1024 * 1024;

/**
 * @typedef {Object} FsHandlerOptions
 * @property {Electron.BrowserWindow | null} [mainWindow]
 *   Parent window for native dialogs. Required at call time.
 * @property {{ showOpenDialog: Function, showSaveDialog: Function }} [dialogModule]
 *   Override Electron's `dialog`. Defaults to `require("electron").dialog`.
 * @property {{ stat: Function, readFile: Function, writeFile: Function }} [fsModule]
 *   Override `fs.promises`. Defaults to `require("fs").promises`.
 */

function loadDialog(options) {
  if (options.dialogModule) {
    return options.dialogModule;
  }
  // Lazy-require so unit tests don't pull in Electron.
  return require("electron").dialog;
}

function loadFsPromises(options) {
  if (options.fsModule) {
    return options.fsModule;
  }
  return require("fs").promises;
}

/**
 * Build the `fs.openDialog` topic handler.
 *
 * @param {FsHandlerOptions} options
 * @returns {(frame: any) => Promise<{
 *   canceled: boolean,
 *   path: string | null,
 *   size?: number,
 *   content: string | null,
 *   reason?: "too_large",
 * }>}
 */
function createFsOpenDialogHandler(options = {}) {
  return async function fsOpenDialogHandler(frame) {
    if (!options.mainWindow) {
      throw new Error("main_window_unavailable");
    }
    const dialog = loadDialog(options);
    const fs = loadFsPromises(options);

    const result = await dialog.showOpenDialog(options.mainWindow, {
      title: frame?.title || "选择文件",
      properties: ["openFile"],
      filters: Array.isArray(frame?.filters) ? frame.filters : undefined,
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true, path: null, content: null };
    }

    const filePath = result.filePaths[0];
    const stat = await fs.stat(filePath);

    if (stat.size > READ_MAX_BYTES) {
      return {
        canceled: false,
        path: filePath,
        size: stat.size,
        content: null,
        reason: "too_large",
      };
    }

    const content = await fs.readFile(filePath, "utf-8");
    return {
      canceled: false,
      path: filePath,
      size: stat.size,
      content,
    };
  };
}

/**
 * Build the `fs.saveDialog` topic handler.
 *
 * @param {FsHandlerOptions} options
 * @returns {(frame: any) => Promise<{
 *   canceled: boolean,
 *   path: string | null,
 * }>}
 */
function createFsSaveDialogHandler(options = {}) {
  return async function fsSaveDialogHandler(frame) {
    if (!options.mainWindow) {
      throw new Error("main_window_unavailable");
    }
    if (typeof frame?.content !== "string") {
      throw new Error("content_must_be_string");
    }

    const dialog = loadDialog(options);
    const fs = loadFsPromises(options);

    const result = await dialog.showSaveDialog(options.mainWindow, {
      title: frame.title || "保存文件",
      defaultPath: frame.defaultPath,
      filters: Array.isArray(frame.filters) ? frame.filters : undefined,
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true, path: null };
    }

    await fs.writeFile(result.filePath, frame.content, "utf-8");
    return { canceled: false, path: result.filePath };
  };
}

module.exports = {
  createFsOpenDialogHandler,
  createFsSaveDialogHandler,
  READ_MAX_BYTES,
};
