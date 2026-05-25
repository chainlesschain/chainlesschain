"use strict";

/**
 * Phase 6a (2026-05-25) — sign-providers entry point.
 *
 * Re-exports the abstract `SignProvider` contract + the default
 * `NullSignProvider` impl. Real implementations live in the desktop
 * Electron main process (`desktop-app-vue/src/main/sign-bridge/`)
 * because they need a WebContentsView. CLI / web-shell / test code
 * uses NullSignProvider unless desktop-side wiring injects a real one.
 */

const { SignProvider } = require("./interface");
const { NullSignProvider, NULL_SIGN_PROVIDER } = require("./null-sign-provider");

module.exports = {
  SignProvider,
  NullSignProvider,
  NULL_SIGN_PROVIDER,
};
