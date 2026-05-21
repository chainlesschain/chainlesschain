/**
 * cc-android-bridge — Node-side facade for the Android JNI bridge.
 *
 * Plan A Sub-Phase A6/A7 scaffold (see `docs/design/Personal_Data_Hub_Android_Standalone_Cc.md`
 * §4.2 + §6.1). The eventual native binding (`cc-android-bridge.node`,
 * loaded from `android-app/app/src/main/cpp/`) exposes Java/Kotlin APIs to
 * the in-APK Node runtime: ContentResolver query, PackageManager listings,
 * Runtime.exec / Shizuku / Magisk su, Accessibility node tree, SAF DocumentFile
 * read.
 *
 * **v0.1 status**: the native .node binding is NOT yet shipped. This file is
 * a pure stub — every `invoke()` call rejects with ANDROID_BRIDGE_NOT_AVAILABLE.
 * It exists so the `cc android …` commands and `system-data-android` adapter
 * (A7 / A8) can land + be unit-tested ahead of the JNI work. When A6 ships
 * the .node binding, this file's `loadNativeBinding()` will resolve the real
 * module; method dispatch is already wired.
 *
 * Detection precedence (highest first):
 *   1. process.env.CC_ANDROID_BRIDGE_OVERRIDE === "1" — test override; bridge
 *      reports "available" and routes through `_deps.testInvoke` (which tests
 *      replace with a mock). Lets us exercise the command code paths without
 *      a real device.
 *   2. process.platform === "android"
 *   3. process.env.PREFIX startsWith "/data/data/com.chainlesschain.android/"
 *      (Termux $PREFIX pattern in the bundled cc).
 *
 * Method names are kebab-case to match the `cc android <verb>` CLI surface,
 * not the underlying JNI signatures (those use Java camelCase). Mapping
 * happens in the future native binding.
 */

import { createRequire } from "node:module";

const ANDROID_PREFIX = "/data/data/com.chainlesschain.android/";
const nodeRequire = createRequire(import.meta.url);

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
 * Lazy-load the native .node binding when we're actually on Android. Stays
 * null elsewhere. The binding is expected at:
 *   $APK/lib/<abi>/cc-android-bridge.node
 * resolved via require.resolve("cc-android-bridge").
 *
 * Wrapped in try so a missing binding (current state pre-A6) doesn't crash
 * the CLI on import — `invoke()` reports it as a runtime error instead.
 */
export function loadNativeBinding() {
  if (!detectAndroid()) return null;
  if (process.env.CC_ANDROID_BRIDGE_OVERRIDE === "1") return null;
  try {
    return nodeRequire("cc-android-bridge");
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
 * Invoke a bridge method.
 *
 * @param {string} method — kebab-case method name (e.g. "contacts.query",
 *   "fs.read", "a11y.query", "app.list").
 * @param {object} [params]
 * @returns {Promise<any>}
 *
 * Rejects with AndroidBridgeUnavailableError when:
 *  - Not running on Android (and CC_ANDROID_BRIDGE_OVERRIDE != 1)
 *  - Running on Android but native binding failed to load
 *  - Method is not registered in the native binding
 */
export async function invoke(method, params = {}) {
  if (typeof method !== "string" || method.length === 0) {
    throw new TypeError(
      "cc-android-bridge.invoke: method must be non-empty string",
    );
  }

  // Test path — _deps.testInvoke replaced by harness.
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

  const native = _deps.loadNativeBinding();
  if (!native) {
    throw new AndroidBridgeUnavailableError(
      "native binding cc-android-bridge.node missing — A6 JNI module not yet bundled",
    );
  }
  if (typeof native.invoke !== "function") {
    throw new AndroidBridgeUnavailableError(
      "native binding loaded but does not export invoke()",
    );
  }
  return await native.invoke(method, params);
}

/**
 * Check whether the bridge is usable right now without throwing.
 * Returns `{ available: boolean, reason?: string }`.
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
  const native = _deps.loadNativeBinding();
  if (!native) {
    return {
      available: false,
      reason: "native-binding-missing (A6 pending)",
    };
  }
  return { available: true };
}

// _deps injection seam (per [[feedback-vi-mock-cjs-interop]]). Tests reach in
// and replace these to exercise both success + error paths without needing
// a real Android device or the unloaded native binding.
export const _deps = {
  detectAndroid,
  loadNativeBinding,
  testInvoke: null,
};

export default {
  invoke,
  caps,
  AndroidBridgeUnavailableError,
  _deps,
};
