/**
 * window-geometry-persister — Phase 1.5 follow-up (2026-04-30).
 *
 * Listens to a BrowserWindow's `resize` and `move` events and debounces
 * writes to `<userData>/settings.json` under `ui.windowGeometry.<role>`
 * so the same layout restores next launch. Pure-data class: takes the
 * window, role, debounce duration, getBounds + writer callbacks via
 * options so vitest can drive it without Electron.
 *
 * Wiring example (next-session integration):
 *   const persister = new WindowGeometryPersister({
 *     write: (role, bounds) =>
 *       writeSettingsSync(userDataPath, (s) => {
 *         s.ui = s.ui || {};
 *         s.ui.windowGeometry = s.ui.windowGeometry || {};
 *         s.ui.windowGeometry[role] = bounds;
 *       }),
 *     debounceMs: 500,
 *   });
 *   persister.attach("main", this.mainWindow);
 *   this.mainWindow.on("closed", () => persister.detach("main"));
 *
 * The `attach()` method returns a disposer for ergonomic teardown:
 *   const dispose = persister.attach(role, win);
 *   win.on("closed", dispose);
 */

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 *
 * @typedef {Object} PersisterOptions
 * @property {(role: string, bounds: Bounds) => void} write
 *   Required — called with the role + current bounds when the debounce
 *   timer fires. Synchronous; persistence errors are the writer's job.
 * @property {number} [debounceMs=500]
 *   Coalescing window for resize/move bursts. Lower = more disk writes,
 *   higher = larger lossy window on hard crash.
 * @property {(window: any) => Bounds | null} [readBounds]
 *   Override how to read bounds off a window (defaults to `getBounds()`).
 *   Tests inject a stub.
 * @property {(fn: () => void, ms: number) => any} [setTimer]
 * @property {(handle: any) => void} [clearTimer]
 *   Override timer factory for deterministic test scheduling. Defaults to
 *   global setTimeout / clearTimeout.
 */

class WindowGeometryPersister {
  /** @param {PersisterOptions} options */
  constructor(options = {}) {
    if (typeof options.write !== "function") {
      throw new TypeError("WindowGeometryPersister: options.write is required");
    }
    this._write = options.write;
    this._debounceMs =
      typeof options.debounceMs === "number" && options.debounceMs >= 0
        ? options.debounceMs
        : DEFAULT_DEBOUNCE_MS;
    this._readBounds =
      options.readBounds ||
      ((win) =>
        typeof win?.getBounds === "function" ? win.getBounds() : null);
    this._setTimer = options.setTimer || setTimeout;
    this._clearTimer = options.clearTimer || clearTimeout;

    /** @type {Map<string, { window: any, timer: any, listener: () => void }>} */
    this._attached = new Map();
  }

  /**
   * Attach to a BrowserWindow under the given role. Returns a disposer
   * that detach()es when invoked — handy to wire into the window's
   * "closed" event without a separate detach call.
   *
   * @param {string} role
   * @param {any} window  - BrowserWindow-like object exposing on / removeListener / getBounds
   * @returns {() => void}  dispose function (idempotent)
   */
  attach(role, window) {
    if (!role || typeof role !== "string") {
      throw new TypeError("WindowGeometryPersister: role required");
    }
    if (!window || typeof window.on !== "function") {
      throw new TypeError(
        "WindowGeometryPersister: window with .on() required",
      );
    }
    if (this._attached.has(role)) {
      // Idempotent — already attached, return a noop disposer pointing
      // at the live record (so the caller's "closed" handler still
      // detaches correctly).
      return () => this.detach(role);
    }

    const listener = () => this._scheduleFlush(role);
    const record = { window, timer: null, listener };
    this._attached.set(role, record);

    window.on("resize", listener);
    window.on("move", listener);

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      this.detach(role);
    };
  }

  /**
   * Stop listening on a role. Idempotent.
   *
   * @param {string} role
   * @returns {boolean} true if a record was actually removed
   */
  detach(role) {
    const rec = this._attached.get(role);
    if (!rec) {
      return false;
    }
    if (rec.timer) {
      this._clearTimer(rec.timer);
      rec.timer = null;
    }
    if (typeof rec.window.removeListener === "function") {
      rec.window.removeListener("resize", rec.listener);
      rec.window.removeListener("move", rec.listener);
    }
    this._attached.delete(role);
    return true;
  }

  /**
   * Flush all pending writes immediately (no debounce). Useful on app
   * `before-quit` so the last user-visible bounds aren't lost to the
   * timer.
   */
  flushAll() {
    for (const [role, rec] of this._attached) {
      if (rec.timer) {
        this._clearTimer(rec.timer);
        rec.timer = null;
      }
      this._writeNow(role, rec.window);
    }
  }

  /** @private */
  _scheduleFlush(role) {
    const rec = this._attached.get(role);
    if (!rec) {
      return;
    }
    if (rec.timer) {
      this._clearTimer(rec.timer);
    }
    rec.timer = this._setTimer(() => {
      rec.timer = null;
      this._writeNow(role, rec.window);
    }, this._debounceMs);
  }

  /** @private */
  _writeNow(role, window) {
    const bounds = this._readBounds(window);
    if (!bounds) {
      return;
    }
    try {
      this._write(role, bounds);
    } catch {
      // Caller's writer is responsible for its own error handling — we
      // swallow here so a transient FS error doesn't kill the listener.
    }
  }

  /** Number of currently-attached roles (test helper). */
  get attachedCount() {
    return this._attached.size;
  }
}

module.exports = { WindowGeometryPersister, DEFAULT_DEBOUNCE_MS };
