"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Preserve the driver's rejected Promise reason before VS Code shuts down
 * the test window. Deliberately captures no environment, config or UI state. */
function recordHostDriverFailure(
  error,
  { resultFile, phase, log = console.error } = {},
) {
  const receipt = {
    schema: "cc-ide-host-driver-failure/v1",
    phase: phase || null,
    at: new Date().toISOString(),
    error: {
      name: String(error?.name || "Error").slice(0, 256),
      message: String(error?.message || error).slice(0, 8192),
      stack: String(error?.stack || "").slice(0, 32768),
    },
  };
  try {
    log(
      `[extension-host-smoke] driver failed: ${receipt.error.stack || receipt.error.message}`,
    );
  } catch {
    /* Preserve the original error even when the console is gone. */
  }
  if (typeof resultFile !== "string" || !resultFile) return;
  try {
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(
      `${resultFile}.failure.json`,
      JSON.stringify(receipt, null, 2) + "\n",
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch {
    /* Never replace the failed assertion with a diagnostic IO error. */
  }
}

module.exports = { recordHostDriverFailure };
