import { spawn, execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { getPidFilePath, getBinDir, ensureDir, getStatePath } from "./paths.js";
import { isWindows } from "./platform.js";
import logger from "./logger.js";

export function startApp(options = {}) {
  ensureDir(getStatePath());
  const pidFile = getPidFilePath();

  if (isAppRunning()) {
    logger.warn("ChainlessChain is already running");
    return null;
  }

  const binDir = getBinDir();
  let appPath;

  if (options.appPath) {
    appPath = options.appPath;
  } else if (isWindows()) {
    appPath = findExecutable(binDir, ".exe");
  } else {
    appPath = findExecutable(binDir);
  }

  if (!appPath) {
    throw new Error(
      'ChainlessChain binary not found. Run "chainlesschain setup" first.',
    );
  }

  const args = [];
  if (options.headless) {
    args.push("--headless");
  }

  logger.verbose(`Starting: ${appPath} ${args.join(" ")}`);

  const child = spawn(appPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...options.env },
  });

  child.unref();

  writeFileSync(pidFile, String(child.pid), "utf-8");
  logger.verbose(`PID ${child.pid} written to ${pidFile}`);

  return child.pid;
}

export function stopApp() {
  const pidFile = getPidFilePath();

  if (!existsSync(pidFile)) {
    logger.warn("No PID file found. App may not be running.");
    return false;
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);

  try {
    if (isWindows()) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    logger.verbose(`Sent stop signal to PID ${pid}`);
  } catch (err) {
    logger.verbose(`Process ${pid} may have already exited: ${err.message}`);
  }

  unlinkSync(pidFile);
  return true;
}

export function isAppRunning() {
  const pidFile = getPidFilePath();

  if (!existsSync(pidFile)) {
    return false;
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    unlinkSync(pidFile);
    return false;
  }
}

export function getAppPid() {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return null;
  return parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
}

function findExecutable(binDir, extension) {
  if (!existsSync(binDir)) return null;
  try {
    // Search recursively for the executable
    const results = [];
    searchDir(binDir, extension, results);
    return results.length > 0 ? results[0] : null;
  } catch {
    return null;
  }
}

function searchDir(dir, extension, results) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      searchDir(fullPath, extension, results);
    } else {
      const name = entry.name.toLowerCase();
      const isChainless = name.includes("chainlesschain");
      if (!isChainless) continue;
      if (extension && name.endsWith(extension)) {
        results.push(fullPath);
      } else if (
        !extension &&
        !name.endsWith(".dmg") &&
        !name.endsWith(".deb") &&
        !name.endsWith(".zip") &&
        !name.endsWith(".sha256") &&
        !name.endsWith(".dll") &&
        !name.endsWith(".dat") &&
        !name.endsWith(".pak") &&
        !name.endsWith(".json")
      ) {
        results.push(fullPath);
      }
    }
  }
}
