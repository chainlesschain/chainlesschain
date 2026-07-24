"use strict";

const os = require("node:os");
const path = require("node:path");

function defaultVscodiumRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return appData ? path.join(appData, "VSCodium") : null;
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "VSCodium",
    );
  }
  const configHome =
    typeof process.env.XDG_CONFIG_HOME === "string" &&
    process.env.XDG_CONFIG_HOME.trim()
      ? process.env.XDG_CONFIG_HOME.trim()
      : path.join(os.homedir(), ".config");
  return path.join(configHome, "VSCodium");
}

module.exports = {
  defaultVscodiumRoot,
};
