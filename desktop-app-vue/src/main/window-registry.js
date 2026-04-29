/**
 * window-registry — Phase 1.5 多窗口架构 MVP (2026-04-30).
 *
 * Tracks role → BrowserWindow mappings for the embedded web-shell. Each
 * role has at most one live window; opening the same role twice focuses the
 * existing one instead of spawning a duplicate. Geometry (x/y/w/h) is
 * persisted under `ui.windowGeometry.<role>` in settings.json so the same
 * layout restores on next launch.
 *
 * Roles (from design memo `desktop_web_shell_multi_window_design.md`):
 *   - "main"     — primary chat window (loaded by createWindow)
 *   - "artifact" — split-out artifact viewer
 *   - "project"  — project workspace view
 *   - "dashboard" — runtime metrics / status board
 *
 * The registry deliberately does NOT couple to BrowserWindow's lifecycle
 * automatically; consumers (main/index.js) call `register()` after their
 * own creation and `release()` on the window's "closed" event. This keeps
 * the registry pure-data and unit-testable without instantiating Electron.
 *
 * Design constraints captured in tests:
 *   - register() throws on duplicate role
 *   - release() is idempotent (closing a window twice is safe)
 *   - resolveUrl() builds the embedded web-shell URL with the role hash
 *     fragment matching what the SPA's router watches (Vue Router hash mode)
 *   - geometry persistence is explicit (caller pulls `getGeometryFor(role)`
 *     from settings, applies via window.setBounds; on resize/move emits
 *     a debounced `geometry-change` event the consumer mirrors back to disk)
 */

const path = require("path");

/** Allowed role names. Anything else throws to catch typos at registration. */
const VALID_ROLES = new Set(["main", "artifact", "project", "dashboard"]);

/** Reasonable default sizes per role for first-launch (no persisted geo). */
const DEFAULT_GEOMETRY = Object.freeze({
  main: Object.freeze({ width: 1200, height: 800 }),
  artifact: Object.freeze({ width: 600, height: 800 }),
  project: Object.freeze({ width: 900, height: 700 }),
  dashboard: Object.freeze({ width: 720, height: 540 }),
});

/**
 * @typedef {Object} WindowRecord
 * @property {string} role
 * @property {object} window  - the BrowserWindow (opaque to this module)
 * @property {string|null} url - last url loaded
 */

class WindowRegistry {
  constructor() {
    /** @type {Map<string, WindowRecord>} */
    this._byRole = new Map();
  }

  /**
   * Register a freshly created BrowserWindow under its role. Throws if a
   * window for the same role is already alive — caller should `focus()`
   * the existing one instead.
   *
   * @param {string} role
   * @param {object} window
   * @param {string} [url]
   */
  register(role, window, url = null) {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`window-registry: unknown role "${role}"`);
    }
    if (!window) {
      throw new TypeError("window-registry: window is required");
    }
    if (this._byRole.has(role)) {
      throw new Error(
        `window-registry: role "${role}" already has a live window — ` +
          "call get() and focus() instead of opening a duplicate",
      );
    }
    this._byRole.set(role, { role, window, url });
  }

  /**
   * Forget the window for a role. Idempotent — calling release on an
   * already-released role is a no-op (so consumers can safely wire it to
   * the BrowserWindow "closed" event without guarding).
   *
   * @param {string} role
   * @returns {boolean} true if a record was actually removed
   */
  release(role) {
    return this._byRole.delete(role);
  }

  /**
   * @param {string} role
   * @returns {WindowRecord | null}
   */
  get(role) {
    return this._byRole.get(role) ?? null;
  }

  /**
   * @param {string} role
   * @returns {boolean}
   */
  has(role) {
    return this._byRole.has(role);
  }

  /**
   * @returns {WindowRecord[]} a snapshot — mutating it does not affect the registry
   */
  list() {
    return Array.from(this._byRole.values());
  }

  /**
   * Build the URL the new BrowserWindow should `loadURL`. The role rides
   * in the hash fragment so vue-router (hash mode) sees it without any
   * extra server route. The "main" role uses the bare httpUrl — no hash.
   *
   * @param {string} role
   * @param {string} httpUrl  e.g. "http://127.0.0.1:54321/"
   * @param {Record<string, string|number|boolean>} [query]
   * @returns {string}
   */
  resolveUrl(role, httpUrl, query = {}) {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`window-registry: unknown role "${role}"`);
    }
    if (typeof httpUrl !== "string" || !httpUrl) {
      throw new TypeError("window-registry: httpUrl is required");
    }
    const base = httpUrl.endsWith("/") ? httpUrl : `${httpUrl}/`;
    if (role === "main") {
      return base;
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}#/${role}?${qs}` : `${base}#/${role}`;
  }

  /**
   * Default geometry for a role's first-launch. Caller should prefer
   * persisted geometry from settings.json when available.
   *
   * @param {string} role
   * @returns {{ width: number, height: number }}
   */
  defaultGeometryFor(role) {
    return DEFAULT_GEOMETRY[role] ?? DEFAULT_GEOMETRY.main;
  }

  /**
   * Pull persisted bounds for a role from a settings object (the shape
   * `_readSettingsSync()` returns). Returns null if not present so caller
   * falls back to defaults.
   *
   * @param {string} role
   * @param {object | null} settings
   * @returns {{ x?: number, y?: number, width: number, height: number } | null}
   */
  getGeometryFromSettings(role, settings) {
    if (!settings || typeof settings !== "object") {
      return null;
    }
    const geo = settings.ui?.windowGeometry?.[role];
    if (!geo || typeof geo !== "object") {
      return null;
    }
    if (typeof geo.width !== "number" || typeof geo.height !== "number") {
      return null;
    }
    return geo;
  }
}

/** Singleton accessor — registry state is process-wide for the main proc. */
let _instance = null;

function getWindowRegistry() {
  if (!_instance) {
    _instance = new WindowRegistry();
  }
  return _instance;
}

/** Test-only — wipe the singleton so each test starts clean. */
function _resetForTest() {
  _instance = null;
}

module.exports = {
  WindowRegistry,
  VALID_ROLES,
  DEFAULT_GEOMETRY,
  getWindowRegistry,
  _resetForTest,
};
