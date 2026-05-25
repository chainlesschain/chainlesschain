"use strict";

/**
 * Phase 6a (2026-05-25) — sign-bridge entry point.
 *
 * Desktop-only — these bridges spawn hidden Electron WebContentsView
 * instances to run platform signing JS (xhs.js / acrawler.js / NS_sig3).
 * **Do NOT import from cli or test code that's not in an Electron main
 * process** — `electron` module is unavailable there.
 *
 * Phase 6a (this commit) — base + XhsSignBridge (X-S signing for Xhs)
 * Phase 6b/6c — ToutiaoSignBridge (acrawler `_signature`) + KuaishouSignBridge
 *   (NS_sig3) reuse same base class
 */

const { ElectronWebSignBridge } = require("./electron-web-sign-bridge");
const { XhsSignBridge } = require("./xhs-sign-bridge");
const { ToutiaoSignBridge } = require("./toutiao-sign-bridge");
const { KuaishouSignBridge } = require("./kuaishou-sign-bridge");

module.exports = {
  ElectronWebSignBridge,
  XhsSignBridge,
  ToutiaoSignBridge,
  KuaishouSignBridge,
};
