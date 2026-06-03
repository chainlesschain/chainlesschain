/**
 * cc-android-bridge — Node-side facade for the Android JNI bridge.
 *
 * Plan A Sub-Phase A6 (see `docs/design/Personal_Data_Hub_Android_Standalone_Cc.md`).
 *
 * **A6a transport (current)**: HTTP localhost. The Android app starts a
 * tiny HTTP server (CcAndroidBridgeServer.kt) at App.onCreate; this file
 * reads the port + token written to filesDir/.chainlesschain/bridge/ and
 * forwards `invoke(method, params)` as `POST /invoke?method=<kebab>` with
 * the JSON params as body and `Authorization: Bearer <token>`.
 *
 * Why HTTP not JNI: the cc subprocess is a separate Linux process (per
 * memory android_cc_subprocess_execve_via_mksh) — JNI cannot bridge
 * process boundaries. HTTP localhost gives the same UX with zero NDK
 * toolchain dependency. The .so + Unix-socket path stays on the roadmap
 * (A6b) for the in-process feel but is not blocking the feature.
 *
 * Detection precedence (highest first):
 *   1. process.env.CC_ANDROID_BRIDGE_OVERRIDE === "1" — test override
 *   2. process.platform === "android"
 *   3. process.env.PREFIX startsWith "/data/data/com.chainlesschain.android/"
 *      (Termux $PREFIX pattern in the bundled cc).
 *
 * Bridge config discovery (Android only):
 *   - filesDir/.chainlesschain/bridge/port  — "8237" etc.
 *   - filesDir/.chainlesschain/bridge/token — 48-hex-char auth token
 * filesDir resolves to `$PREFIX/..` (Termux convention: filesDir is the
 * parent of usr/).
 *
 * Method names are kebab-case to match the `cc android <verb>` CLI surface.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ANDROID_PREFIX = "/data/data/com.chainlesschain.android/";

export function detectAndroid() {
  if (process.env.CC_ANDROID_BRIDGE_OVERRIDE === "1") return true;
  if (process.platform === "android") return true;
  if (
    typeof process.env.PREFIX === "string" &&
    process.env.PREFIX.startsWith(ANDROID_PREFIX)
  ) {
    return true;
  }
  return false;
}

/**
 * Locate the Android app's filesDir from inside the in-APK cc subprocess.
 * Termux convention: $PREFIX = filesDir/usr → filesDir = dirname($PREFIX).
 * Falls back to env var CC_ANDROID_BRIDGE_CONFIG_DIR (LAN / desktop case
 * where caller has discovered the Android filesDir some other way).
 */
function resolveBridgeConfigDir() {
  if (process.env.CC_ANDROID_BRIDGE_CONFIG_DIR) {
    return process.env.CC_ANDROID_BRIDGE_CONFIG_DIR;
  }
  if (
    typeof process.env.PREFIX === "string" &&
    process.env.PREFIX.startsWith(ANDROID_PREFIX)
  ) {
    return join(dirname(process.env.PREFIX), ".chainlesschain", "bridge");
  }
  return null;
}

/**
 * Read the port + token written by CcAndroidBridgeServer.start() in
 * filesDir/.chainlesschain/bridge/. Returns null if either file is missing
 * (server not started yet, or running off-device without override).
 */
export function loadBridgeConfig() {
  const dir = resolveBridgeConfigDir();
  if (!dir) return null;
  try {
    const portPath = join(dir, "port");
    const tokenPath = join(dir, "token");
    if (!existsSync(portPath) || !existsSync(tokenPath)) return null;
    const port = parseInt(readFileSync(portPath, "utf-8").trim(), 10);
    const token = readFileSync(tokenPath, "utf-8").trim();
    if (!Number.isFinite(port) || port <= 0 || !token) return null;
    return { port, token, baseUrl: `http://127.0.0.1:${port}` };
  } catch (_e) {
    return null;
  }
}

export class AndroidBridgeUnavailableError extends Error {
  constructor(reason) {
    super(`ANDROID_BRIDGE_NOT_AVAILABLE: ${reason}`);
    this.code = "ANDROID_BRIDGE_NOT_AVAILABLE";
    this.reason = reason;
  }
}

/**
 * Invoke a bridge method via the HTTP transport.
 *
 * @param {string} method — kebab-case method name (e.g. "contacts.query")
 * @param {object} [params]
 * @returns {Promise<any>}  Parsed JSON response from the bridge.
 *
 * Rejects with AndroidBridgeUnavailableError when:
 *  - Not running on Android and CC_ANDROID_BRIDGE_OVERRIDE != 1
 *  - Running on Android but bridge config (port/token) missing
 *  - HTTP request fails or server returns non-200
 *  - Method name unknown (server returns {"error": "UNKNOWN_METHOD"})
 */
export async function invoke(method, params = {}) {
  if (typeof method !== "string" || method.length === 0) {
    throw new TypeError(
      "cc-android-bridge.invoke: method must be non-empty string",
    );
  }

  // Test path — harness replaces _deps.testInvoke.
  if (
    process.env.CC_ANDROID_BRIDGE_OVERRIDE === "1" &&
    typeof _deps.testInvoke === "function"
  ) {
    return await _deps.testInvoke(method, params);
  }

  if (!_deps.detectAndroid()) {
    throw new AndroidBridgeUnavailableError(
      `not running on Android (platform=${process.platform})`,
    );
  }

  const config = _deps.loadBridgeConfig();
  if (!config) {
    throw new AndroidBridgeUnavailableError(
      "bridge config missing — CcAndroidBridgeServer not started? (filesDir/.chainlesschain/bridge/{port,token})",
    );
  }

  const url = `${config.baseUrl}/invoke?method=${encodeURIComponent(method)}`;
  let resp;
  try {
    resp = await _deps.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(params || {}),
    });
  } catch (e) {
    throw new AndroidBridgeUnavailableError(
      `HTTP transport error: ${e && e.message ? e.message : String(e)}`,
    );
  }
  if (!resp.ok) {
    throw new AndroidBridgeUnavailableError(`bridge HTTP ${resp.status}`);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AndroidBridgeUnavailableError(
      `bridge returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Check whether the bridge is reachable right now without throwing.
 * Returns `{ available: boolean, reason?: string, port?: number }`.
 */
export function caps() {
  if (process.env.CC_ANDROID_BRIDGE_OVERRIDE === "1") {
    return { available: true, reason: "test-override" };
  }
  if (!_deps.detectAndroid()) {
    return {
      available: false,
      reason: `not-on-android (platform=${process.platform})`,
    };
  }
  const config = _deps.loadBridgeConfig();
  if (!config) {
    return {
      available: false,
      reason: "bridge-server-not-started (port/token files missing)",
    };
  }
  return { available: true, port: config.port };
}

// _deps injection seam (per [[feedback-vi-mock-cjs-interop]]). Tests reach in
// and replace these to exercise success / error paths without a real device.
export const _deps = {
  detectAndroid,
  loadBridgeConfig,
  fetch: globalThis.fetch.bind(globalThis),
  testInvoke: null,
};

export default {
  invoke,
  caps,
  AndroidBridgeUnavailableError,
  _deps,
};
