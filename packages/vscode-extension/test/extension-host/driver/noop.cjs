"use strict";

function activate() {
  if (process.env.CHAINLESSCHAIN_HOST_JOURNEY_MODE !== "dom-relay") {
    return undefined;
  }
  // VS Code 1.131 on macOS can discover the development driver without
  // invoking --extensionTestsPath. Share the exact same once-only promise with
  // the normal test entry so either activation path starts (but never doubles)
  // the installed-VSIX journey.
  return require("./smoke.cjs").run();
}

function deactivate() {}

module.exports = { activate, deactivate };
