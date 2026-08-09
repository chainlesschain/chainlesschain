#!/usr/bin/env node
"use strict";

function main() {
  console.error(
    "ERROR: Use desktop-app-vue/scripts/test-runner.js from the desktop-app-vue working directory. This root compatibility entry point intentionally fails instead of reporting a false pass.",
  );
  return 2;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
