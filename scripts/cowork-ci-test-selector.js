#!/usr/bin/env node
"use strict";

function main() {
  const payload = {
    schemaVersion: 1,
    status: "error",
    code: "WRONG_ENTRY_POINT",
    message:
      "The CI selector lives at desktop-app-vue/scripts/cowork-ci-test-selector.js and must run with desktop-app-vue as its working directory.",
  };

  console.error(`COWORK_TEST_SELECTION_JSON=${JSON.stringify(payload)}`);
  return 2;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
