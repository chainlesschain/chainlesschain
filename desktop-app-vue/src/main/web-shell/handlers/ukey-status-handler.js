/**
 * `ukey.status` WS handler — Phase 0 spike step 2.
 *
 * Returns a snapshot of the U-Key subsystem so the web-panel can render a
 * device-status badge without waiting on a real signing operation. The
 * heavyweight `ukey:detect` IPC remains the source of truth in the desktop
 * renderer; this handler is the WS-equivalent surface for the web shell.
 *
 * The `ukeyManager` parameter is the same singleton injected into
 * `ukey-ipc.js`. Tests pass a stub.
 */

const SUPPORTED_HARDWARE_PLATFORMS = new Set(["win32"]);

/**
 * Build a `ukey.status` handler bound to a given UKey manager (or stub).
 *
 * @param {Object} [options]
 * @param {{ detect?: () => Promise<any> } | null} [options.ukeyManager]
 *        UKey manager instance. If null/undefined, returns
 *        `{ available: false, reason: "manager_not_initialized", … }`.
 * @param {() => string} [options.getPlatform]
 *        Override `process.platform` (for tests).
 * @returns {(frame: any, ctx: { topic: string, id: string }) => Promise<{
 *   available: boolean,
 *   detected: boolean,
 *   unlocked: boolean,
 *   simulationMode: boolean,
 *   platform: string,
 *   reason?: string,
 *   error?: string,
 * }>}
 */
function createUKeyStatusHandler(options = {}) {
  const { ukeyManager, getPlatform } = options;
  const readPlatform = () =>
    typeof getPlatform === "function" ? getPlatform() : process.platform;

  return async function ukeyStatusHandler() {
    const platform = readPlatform();
    const supportsHardware = SUPPORTED_HARDWARE_PLATFORMS.has(platform);

    if (!ukeyManager || typeof ukeyManager.detect !== "function") {
      return {
        available: false,
        detected: false,
        unlocked: false,
        simulationMode: !supportsHardware,
        platform,
        reason: "manager_not_initialized",
      };
    }

    try {
      const detect = await ukeyManager.detect();
      return {
        available: true,
        detected: !!detect?.detected,
        unlocked: !!detect?.unlocked,
        simulationMode:
          typeof detect?.simulationMode === "boolean"
            ? detect.simulationMode
            : !supportsHardware,
        platform,
        reason: detect?.reason,
      };
    } catch (err) {
      return {
        available: false,
        detected: false,
        unlocked: false,
        simulationMode: !supportsHardware,
        platform,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

module.exports = { createUKeyStatusHandler, SUPPORTED_HARDWARE_PLATFORMS };
