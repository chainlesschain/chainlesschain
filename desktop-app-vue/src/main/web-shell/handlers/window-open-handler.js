/**
 * `window.open` WS handler — Phase 1.5 multi-window scaffold (2026-04-30).
 *
 * Spawns (or refocuses) a side BrowserWindow for a registered role
 * (artifact / project / dashboard) that all dial the SAME embedded WS
 * server. The "main" role is owned by main/index.js's bootstrap and is
 * NOT openable via this topic — caller will see role_reserved.
 *
 * Wire frame (client → server):
 *   { id: "win-1", type: "window.open", role: "artifact",
 *     query?: { id: "abc-123" } }
 *
 * Result on server → client (wrapped by ws-cli-loader as
 *   { type: "window.open.result", id, ok: true, result: <below> }):
 *   { role, opened: true | false, url, reason?: "already_open" | "role_reserved" }
 *
 * Construction (DI for unit-tests):
 *   createWindowOpenHandler({
 *     registry,                        // WindowRegistry instance
 *     httpUrl: "http://127.0.0.1:N/",  // captured post-startWebShell
 *     preloadPath: "/abs/web-shell.js",// passed to BrowserWindow webPreferences
 *     browserWindowFactory?: (opts) => BrowserWindow,
 *                                       // overrides require("electron").BrowserWindow
 *   })
 *
 * The factory split (`browserWindowFactory`) keeps the handler unit-testable
 * without spinning up Electron — tests pass a stub that records the calls
 * and returns a fake window object that responds to `loadURL` + `focus` +
 * `on('closed', ...)`.
 *
 * Wiring example (next-session work, NOT in this commit):
 *   const handle = await startWebShell({ ... });
 *   handle.register("window.open", createWindowOpenHandler({
 *     registry: getWindowRegistry(),
 *     httpUrl: handle.httpUrl,
 *     preloadPath: path.join(__dirname, "../preload/web-shell.js"),
 *   }));
 */

const VALID_OPENABLE_ROLES = new Set([
  "artifact",
  "project",
  "dashboard",
  // 'desktop:*' opens a window loading the V5/V6 desktop renderer at a
  // specific page. Used to surface HardwareWalletPage / BackupDashboard /
  // LLMTestChatPage / SystemSettings from inside the web-shell SPA, since
  // those pages depend on the desktop preload's full electronAPI surface
  // (native UKey / FS / settings) which the web-shell preload doesn't expose.
  "desktop:hardware-wallet",
  "desktop:backup-dashboard",
  "desktop:llm-test-chat",
  "desktop:settings",
]);

const { DESKTOP_ROLE_PATHS } = require("../../window-registry");

/**
 * @typedef {Object} WindowOpenHandlerOptions
 * @property {object} registry            Required — WindowRegistry instance.
 * @property {string} httpUrl             Required — base URL of the embedded HTTP.
 * @property {string} [preloadPath]       Path to web-shell preload (web-shell.js).
 * @property {string} [v5EntryUrl]        V5/V6 renderer entry URL (e.g.
 *   `http://localhost:5173/` in dev or `file:///.../renderer/index.html` in
 *   prod). Used for `desktop:*` roles to load the full desktop SPA instead
 *   of the embedded web-panel.
 * @property {string} [desktopPreloadPath] Path to the FULL desktop preload
 *   (`preload/index.js`) — exposes the complete `window.electronAPI` surface
 *   that V5/V6 pages need. Different from `preloadPath` (which is the
 *   minimal web-shell preload).
 * @property {(opts: any) => any} [browserWindowFactory]
 *   Override Electron's `new BrowserWindow(opts)`. Tests pass a stub.
 * @property {(role: string, win: any) => void} [onWindowOpened]
 *   Optional side-effect fired AFTER a window is created + registered.
 *   Used by main/index.js to attach the WindowGeometryPersister so side
 *   windows persist their bounds the same way the main window does.
 *   Errors thrown by the callback are swallowed — geometry persistence
 *   should never fail a window-open.
 */

function createWindowOpenHandler(options = {}) {
  if (!options.registry) {
    throw new TypeError("createWindowOpenHandler: registry is required");
  }
  if (!options.httpUrl || typeof options.httpUrl !== "string") {
    throw new TypeError("createWindowOpenHandler: httpUrl is required");
  }

  const factory =
    options.browserWindowFactory ||
    ((opts) => {
      // Lazy-require so unit tests don't pull in Electron.
      const { BrowserWindow } = require("electron");
      return new BrowserWindow(opts);
    });

  return async function windowOpenHandler(frame) {
    const role = frame?.role;
    if (typeof role !== "string" || !role) {
      throw new Error("role_required");
    }
    if (role === "main") {
      // The main window's lifecycle is owned by createWindow, not by
      // window.open. Refusing here keeps the registry's invariant
      // (single owner per role) intact.
      return {
        role,
        opened: false,
        url: null,
        reason: "role_reserved",
      };
    }
    if (!VALID_OPENABLE_ROLES.has(role)) {
      throw new Error(`unknown_role:${role}`);
    }

    // Idempotency: opening the same role twice focuses the existing window
    // rather than spawning a duplicate.
    if (options.registry.has(role)) {
      const existing = options.registry.get(role);
      try {
        existing.window?.focus?.();
      } catch {
        // Window may be in a weird state — non-fatal.
      }
      return {
        role,
        opened: false,
        url: existing.url,
        reason: "already_open",
      };
    }

    // 'desktop:*' roles load the V5/V6 desktop renderer at a specific
    // hash route, with the FULL desktop preload (electronAPI surface).
    // Anything else stays on the embedded web-panel SPA + web-shell preload.
    const isDesktopRole = role.startsWith("desktop:");
    let url;
    let preloadForWindow = options.preloadPath;
    if (isDesktopRole) {
      if (!options.v5EntryUrl) {
        throw new Error("v5_entry_unavailable");
      }
      const hashPath = DESKTOP_ROLE_PATHS[role];
      if (!hashPath) {
        throw new Error(`unknown_desktop_role:${role}`);
      }
      // Build the full URL: <v5EntryUrl>#/<path>. v5EntryUrl may already
      // end in `index.html` (file:// in prod) or just `/` (dev). Hash
      // routing makes both work.
      const base = options.v5EntryUrl;
      url = base.includes("#") ? base : `${base}#${hashPath}`;
      preloadForWindow = options.desktopPreloadPath || preloadForWindow;
    } else {
      url = options.registry.resolveUrl(role, options.httpUrl, frame?.query);
    }
    const geo = options.registry.defaultGeometryFor(role);

    const browserOpts = {
      width: geo.width,
      height: geo.height,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Desktop pages need the same sandbox-off workaround the main
        // window uses — see main/index.js comment about Electron 39
        // sandboxed_renderer crash on Windows.
        ...(isDesktopRole ? { sandbox: false } : {}),
        ...(preloadForWindow ? { preload: preloadForWindow } : {}),
      },
    };

    const win = factory(browserOpts);
    if (!win) {
      throw new Error("browser_window_creation_failed");
    }

    if (typeof win.loadURL === "function") {
      win.loadURL(url);
    }
    options.registry.register(role, win, url);

    if (typeof options.onWindowOpened === "function") {
      try {
        options.onWindowOpened(role, win);
      } catch {
        // Geometry persistence (or any other observer) must not break
        // window-open — the window is already live and registered.
      }
    }

    // Hook the BrowserWindow's "closed" event so the registry stays in
    // sync without consumers having to remember to call release().
    if (typeof win.on === "function") {
      win.on("closed", () => {
        options.registry.release(role);
      });
    }

    return { role, opened: true, url };
  };
}

module.exports = {
  createWindowOpenHandler,
  VALID_OPENABLE_ROLES,
};
