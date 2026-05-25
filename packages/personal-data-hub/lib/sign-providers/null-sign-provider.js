"use strict";

/**
 * Phase 6a (2026-05-25) — NullSignProvider: default no-op for callers
 * that don't have a WebContentsView context (e.g. headless `cc serve`
 * without Electron, or unit tests).
 *
 * Mirror of Android `pdh/social/NullSignProvider.kt`.
 *
 * API clients use this as the default — when wiring upgrades to
 * Electron+WebContentsView, swap to `XhsSignBridge` / `ToutiaoSignBridge`
 * etc. **without changing the api-client code**. The signing endpoints
 * gracefully degrade to "best-effort" or "empty result" rather than
 * throwing.
 */

const { SignProvider } = require("./interface");

class NullSignProvider extends SignProvider {
  // Inherits all stubs from base — signUrl returns null,
  // signedHeaders returns {}, shutdown is no-op.
}

/** Frozen singleton — callers should not create multiple NullSignProviders. */
const NULL_SIGN_PROVIDER = Object.freeze(new NullSignProvider());

module.exports = {
  NullSignProvider,
  NULL_SIGN_PROVIDER,
};
