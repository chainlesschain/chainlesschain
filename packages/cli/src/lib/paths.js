import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { CONFIG_DIR_NAME } from "../constants.js";
import { getPlatform } from "./platform.js";

export function getHomeDir() {
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getBinDir() {
  return join(getHomeDir(), "bin");
}

export function getConfigPath() {
  return join(getHomeDir(), "config.json");
}

export function getStatePath() {
  return join(getHomeDir(), "state");
}

export function getPidFilePath() {
  return join(getStatePath(), "app.pid");
}

export function getServicesDir() {
  return join(getHomeDir(), "services");
}

export function getLogsDir() {
  return join(getHomeDir(), "logs");
}

export function getCacheDir() {
  return join(getHomeDir(), "cache");
}

export function getElectronUserDataDir() {
  const p = getPlatform();
  const appName = "chainlesschain-desktop-vue";
  switch (p) {
    case "win32":
      return join(
        process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
        appName,
      );
    case "darwin":
      return join(homedir(), "Library", "Application Support", appName);
    case "linux":
      return join(
        process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
        appName,
      );
    default:
      return join(homedir(), appName);
  }
}

export function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

export function ensureHomeDir() {
  const dirs = [
    getHomeDir(),
    getBinDir(),
    getStatePath(),
    getServicesDir(),
    getLogsDir(),
    getCacheDir(),
  ];
  for (const dir of dirs) {
    ensureDir(dir);
  }
  return getHomeDir();
}
