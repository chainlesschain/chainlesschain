import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import logger from "./logger.js";

export function isDockerAvailable() {
  try {
    execSync("docker --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isDockerComposeAvailable() {
  try {
    execSync("docker compose version", { stdio: "ignore" });
    return true;
  } catch {
    try {
      execSync("docker-compose --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

function getComposeCommand() {
  try {
    execSync("docker compose version", { stdio: "ignore" });
    return "docker compose";
  } catch {
    return "docker-compose";
  }
}

export function findComposeFile(searchPaths) {
  const names = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];
  for (const dir of searchPaths) {
    for (const name of names) {
      const filePath = join(dir, name);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
  }
  return null;
}

export function servicesUp(composePath, options = {}) {
  const cmd = getComposeCommand();
  const args = ["-f", composePath, "up", "-d"];
  if (options.services) {
    args.push(...options.services);
  }
  return runCompose(cmd, args);
}

export function servicesDown(composePath) {
  const cmd = getComposeCommand();
  return runCompose(cmd, ["-f", composePath, "down"]);
}

export function servicesLogs(composePath, options = {}) {
  const cmd = getComposeCommand();
  const args = ["-f", composePath, "logs"];
  if (options.follow) args.push("-f");
  if (options.tail) args.push("--tail", String(options.tail));
  if (options.services) args.push(...options.services);

  const parts = cmd.split(" ");
  const child = spawn(parts[0], [...parts.slice(1), ...args], {
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose logs exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

export function servicesPull(composePath) {
  const cmd = getComposeCommand();
  return runCompose(cmd, ["-f", composePath, "pull"]);
}

export function getServiceStatus(composePath) {
  const cmd = getComposeCommand();
  try {
    const output = execSync(`${cmd} -f "${composePath}" ps --format json`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    try {
      return JSON.parse(`[${output.trim().split("\n").join(",")}]`);
    } catch {
      return output.trim();
    }
  } catch {
    return null;
  }
}

function runCompose(cmd, args) {
  const fullCmd = `${cmd} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
  logger.verbose(`Running: ${fullCmd}`);
  try {
    execSync(fullCmd, { stdio: "inherit" });
    return true;
  } catch (err) {
    logger.error(`Command failed: ${fullCmd}`);
    throw err;
  }
}
