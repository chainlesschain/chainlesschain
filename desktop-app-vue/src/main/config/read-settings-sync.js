/**
 * read-settings-sync — pure helper extracted from ChainlessChainApp's
 * `_readSettingsSync()` (Phase 1.3) so it can be unit-tested without
 * spinning up an Electron app instance.
 *
 * The helper synchronously reads `<userDataPath>/settings.json` and
 * returns the parsed JSON object. Returns `null` on any failure
 * (file-not-found, malformed JSON, EACCES, …) — callers must treat
 * `null` as "no persistent setting available, fall back to defaults".
 *
 * Usage from main:
 *   const { readSettingsSync } = require("./config/read-settings-sync");
 *   const settings = readSettingsSync(app.getPath("userData"), {
 *     onError: (err) => logger.warn(`[Main] settings.json: ${err.message}`),
 *   });
 *
 * Why sync: this runs ONCE on createWindow (per-launch), and the result
 * gates `shouldRunWebShell` BEFORE the renderer can be spawned. Async
 * would force createWindow to await a tiny disk read for no benefit.
 */

const fs = require("fs");
const path = require("path");

/**
 * @param {string} userDataPath
 *   Absolute path of Electron's userData (e.g. `app.getPath("userData")`).
 * @param {{ onError?: (err: Error) => void }} [options]
 *   Optional `onError` callback for logging — exception is still swallowed.
 * @returns {object | null} parsed settings.json contents (with app-config.json's
 *   `ui.*` layered in on top so SystemSettings.vue toggles take effect at boot),
 *   or null on miss / failure
 */
function readSettingsSync(userDataPath, options = {}) {
  if (typeof userDataPath !== "string" || !userDataPath) {
    return null;
  }
  let base = null;
  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf8");
      base = JSON.parse(raw);
    }
  } catch (err) {
    if (typeof options.onError === "function") {
      try {
        options.onError(err);
      } catch {
        /* swallow secondary failures */
      }
    }
    base = null;
  }

  // SystemSettings.vue writes ui.* to app-config.json (AppConfigManager), not
  // settings.json. Overlay app-config.json's `ui` so the boot-time
  // shouldRunWebShell decision honors the SystemSettings switch.
  let appUi = null;
  try {
    const appConfigPath = path.join(userDataPath, "app-config.json");
    if (fs.existsSync(appConfigPath)) {
      const raw = fs.readFileSync(appConfigPath, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.ui &&
        typeof parsed.ui === "object"
      ) {
        appUi = parsed.ui;
      }
    }
  } catch (err) {
    if (typeof options.onError === "function") {
      try {
        options.onError(err);
      } catch {
        /* swallow */
      }
    }
  }

  if (!base && !appUi) {
    return null;
  }
  if (!appUi) {
    return base;
  }
  if (!base || typeof base !== "object") {
    return { ui: { ...appUi } };
  }
  return {
    ...base,
    ui: {
      ...(base.ui && typeof base.ui === "object" ? base.ui : {}),
      ...appUi,
    },
  };
}

/**
 * Sync writer counterpart to `readSettingsSync`. Reads the current
 * settings, hands them to the mutator (which may mutate in-place or
 * return a new object), then writes the result back atomically via
 * a `.tmp` rename. Returns the persisted object on success, `null`
 * on any failure.
 *
 * Atomic write avoids the half-written-JSON corruption window the
 * UI's debounced writes (Phase 1.5 geometry persister) would otherwise
 * tickle on hard kill.
 *
 * @param {string} userDataPath
 * @param {(current: object) => object | void} mutator
 *   Receives the current settings (or `{}` if none); may mutate in-place
 *   or return a fresh object — both are honoured.
 * @param {{ onError?: (err: Error) => void }} [options]
 * @returns {object | null} the object that was actually persisted, or null on failure
 */
function writeSettingsSync(userDataPath, mutator, options = {}) {
  if (typeof userDataPath !== "string" || !userDataPath) {
    return null;
  }
  if (typeof mutator !== "function") {
    return null;
  }
  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    const tmpPath = `${settingsPath}.tmp`;
    let current = {};
    if (fs.existsSync(settingsPath)) {
      try {
        current = JSON.parse(fs.readFileSync(settingsPath, "utf8")) || {};
      } catch {
        // Malformed file — start from empty so the mutator can repair.
        current = {};
      }
    }
    const next = mutator(current);
    const toWrite = next ?? current;
    fs.writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2), "utf8");
    fs.renameSync(tmpPath, settingsPath);
    return toWrite;
  } catch (err) {
    if (typeof options.onError === "function") {
      try {
        options.onError(err);
      } catch {
        /* swallow */
      }
    }
    return null;
  }
}

module.exports = { readSettingsSync, writeSettingsSync };
