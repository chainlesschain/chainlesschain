/**
 * `shell.switch` WS handler — Phase 1.6 symmetric switch (2026-05-01).
 *
 * The web-panel SPA uses this to opt out of the web-shell back to the
 * V5/V6 desktop renderer. The web-shell preload is intentionally empty
 * (see src/preload/web-shell.js — "preload 仅暴露真·原生 API" strategy
 * decision), so the SPA can't call `electronAPI.invoke('config:set')`
 * the way the V6 shell does. This topic is the WS-native equivalent:
 * receive `{target: "desktop"}`, persist `ui.useWebShellExperimental
 * = false`, then `app.relaunch() + app.exit(0)` so the next launch
 * lands on the V5/V6 renderer.
 *
 * Symmetry with V6: the V6 shell uses `electronAPI.invoke('config:set'
 * /'system:restart')` directly because its preload exposes the full
 * desktop surface. Web-panel can't, so it routes through this topic.
 *
 * Restart is deferred 100ms so the WS reply can flush before the
 * renderer dies (otherwise the SPA sees its WS close mid-await and
 * surfaces an error toast instead of the user's "switching" state).
 *
 * Caller frame:
 *   { type: "shell.switch", id: "...", target: "desktop" }
 *
 * Response:
 *   { type: "shell.switch.result", id: "...", ok: true,
 *     result: { switching: true, target: "desktop" } }
 */

const VALID_TARGETS = new Set(["desktop", "web-shell"]);

/**
 * Build a `shell.switch` handler.
 *
 * @param {Object} options
 * @param {() => { set: (key: string, value: any) => void } | null} options.getAppConfig
 *   Lazy getter for the AppConfigManager singleton (database-config.js).
 *   Lazy because the singleton may be initialised after web-shell starts.
 * @param {{ relaunch: () => void, exit: (code: number) => void }} [options.app]
 *   Override for `electron.app` — used by tests to assert without
 *   killing the test process.
 * @param {(fn: () => void, ms: number) => any} [options.scheduleRestart]
 *   Override for setTimeout — tests inject a sync `(fn) => fn()`.
 * @returns {(payload: any) => Promise<{ switching: true, target: string }>}
 */
function createShellSwitchHandler(options = {}) {
  const getAppConfig = options.getAppConfig;
  if (typeof getAppConfig !== "function") {
    throw new Error("createShellSwitchHandler: getAppConfig is required");
  }
  const app = options.app || require("electron").app;
  const scheduleRestart =
    options.scheduleRestart || ((fn, ms) => setTimeout(fn, ms));

  return async function shellSwitchHandler(payload) {
    const target = payload && payload.target;
    if (!VALID_TARGETS.has(target)) {
      throw new Error(
        `target must be one of: ${[...VALID_TARGETS].join(", ")}`,
      );
    }

    const appConfig = getAppConfig();
    if (!appConfig || typeof appConfig.set !== "function") {
      throw new Error("appConfig unavailable");
    }

    // target=desktop → useWebShellExperimental:false → V5/V6 on next boot.
    // target=web-shell → useWebShellExperimental:true → web-shell on next boot.
    appConfig.set("ui.useWebShellExperimental", target === "web-shell");

    // Defer the relaunch so the WS reply can serialise back to the SPA
    // before app.exit(0) tears down the renderer. 100ms is well below
    // any user-perceivable delay but generous enough for the framing.
    scheduleRestart(() => {
      try {
        app.relaunch();
        app.exit(0);
      } catch {
        /* swallow — process is exiting anyway */
      }
    }, 100);

    return { switching: true, target };
  };
}

module.exports = { createShellSwitchHandler, VALID_TARGETS };
