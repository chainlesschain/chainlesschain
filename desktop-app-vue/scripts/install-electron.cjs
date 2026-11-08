"use strict";

const { spawnSync } = require("node:child_process");

function installElectron() {
  let installer;
  try {
    installer = require.resolve("electron/install.js");
  } catch (error) {
    console.warn(
      `[postinstall] Electron installer is unavailable (${error.code || "unknown"}); desktop runtime installation skipped.`,
    );
    return;
  }
  const result = spawnSync(process.execPath, [installer], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.warn(
      `[postinstall] Electron runtime installation did not complete (${result.error?.code || result.signal || result.status}); retry node scripts/install-electron.cjs before running the desktop app.`,
    );
  }
}

installElectron();
