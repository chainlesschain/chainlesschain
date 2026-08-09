#!/usr/bin/env node
"use strict";

function main() {
  console.error(
    "ERROR: Use desktop-app-vue/scripts/auto-fix-runner.js from the desktop-app-vue working directory. Automatic mutation is not available from this root entry point.",
  );
  return 2;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
