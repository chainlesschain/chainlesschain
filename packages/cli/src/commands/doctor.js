import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createConnection } from "node:net";
import semver from "semver";
import { MIN_NODE_VERSION, DEFAULT_PORTS, VERSION } from "../constants.js";
import { getHomeDir, getConfigPath, getBinDir } from "../lib/paths.js";
import {
  isDockerAvailable,
  isDockerComposeAvailable,
} from "../lib/service-manager.js";
import { loadConfig } from "../lib/config-manager.js";
import logger from "../lib/logger.js";

export function registerDoctorCommand(program) {
  program
    .command("doctor")
    .description("Diagnose your ChainlessChain environment")
    .action(async () => {
      logger.log(chalk.bold("\n  ChainlessChain Doctor\n"));

      const checks = [];

      // Node.js
      const nodeVersion = process.versions.node;
      const nodeOk = semver.gte(nodeVersion, MIN_NODE_VERSION);
      checks.push({
        name: `Node.js ${nodeVersion}`,
        ok: nodeOk,
        detail: nodeOk ? "" : `Requires >=${MIN_NODE_VERSION}`,
      });

      // npm
      try {
        const npmVersion = execSync("npm --version", {
          encoding: "utf-8",
        }).trim();
        checks.push({ name: `npm ${npmVersion}`, ok: true });
      } catch {
        checks.push({ name: "npm", ok: false, detail: "Not found" });
      }

      // Docker
      checks.push({
        name: "Docker",
        ok: isDockerAvailable(),
        detail: isDockerAvailable() ? "" : "Not installed (optional)",
      });
      checks.push({
        name: "Docker Compose",
        ok: isDockerComposeAvailable(),
        detail: isDockerComposeAvailable() ? "" : "Not installed (optional)",
      });

      // Git
      try {
        const gitVersion = execSync("git --version", {
          encoding: "utf-8",
        }).trim();
        checks.push({ name: gitVersion, ok: true });
      } catch {
        checks.push({ name: "Git", ok: false, detail: "Not found" });
      }

      // Config directory
      const homeDir = getHomeDir();
      checks.push({
        name: `Config dir: ${homeDir}`,
        ok: existsSync(homeDir),
        detail: existsSync(homeDir) ? "" : 'Run "chainlesschain setup"',
      });

      // Config file
      const configPath = getConfigPath();
      checks.push({
        name: "Config file",
        ok: existsSync(configPath),
        detail: existsSync(configPath) ? "" : 'Run "chainlesschain setup"',
      });

      // Binary
      const binDir = getBinDir();
      const hasBin = existsSync(binDir) && readdirSafe(binDir).length > 0;
      checks.push({
        name: "Desktop binary",
        ok: hasBin,
        detail: hasBin
          ? ""
          : 'Run "chainlesschain setup" or "chainlesschain update"',
      });

      // Setup completed
      const config = loadConfig();
      checks.push({
        name: "Setup completed",
        ok: config.setupCompleted,
        detail: config.setupCompleted ? "" : 'Run "chainlesschain setup"',
      });

      // Print results
      for (const check of checks) {
        const icon = check.ok ? chalk.green("✔") : chalk.red("✖");
        const detail = check.detail ? chalk.gray(` (${check.detail})`) : "";
        logger.log(`  ${icon} ${check.name}${detail}`);
      }

      // Port scan
      logger.log(chalk.bold("\n  Port Status\n"));
      for (const [name, port] of Object.entries(DEFAULT_PORTS)) {
        const open = await checkPort(port);
        const icon = open ? chalk.green("●") : chalk.gray("○");
        logger.log(`  ${icon} ${name}: ${port}`);
      }

      // Disk space (basic)
      try {
        const { statfsSync } = await import("node:fs");
        // statfsSync available in Node 22+
        if (statfsSync) {
          const stats = statfsSync(homeDir);
          const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
          const ok = freeGB > 2;
          logger.log(chalk.bold("\n  Disk\n"));
          const icon = ok ? chalk.green("✔") : chalk.yellow("⚠");
          logger.log(`  ${icon} Free space: ${freeGB.toFixed(1)} GB`);
        }
      } catch {
        // statfsSync not available on all platforms
      }

      // Summary
      const failures = checks.filter((c) => !c.ok);
      logger.newline();
      if (failures.length === 0) {
        logger.log(chalk.bold.green("  All checks passed!\n"));
      } else {
        const critical = failures.filter(
          (c) => !c.detail?.includes("optional"),
        );
        if (critical.length > 0) {
          logger.log(
            chalk.bold.red(
              `  ${critical.length} issue(s) found. See details above.\n`,
            ),
          );
        } else {
          logger.log(
            chalk.bold.yellow(
              `  ${failures.length} optional component(s) missing.\n`,
            ),
          );
        }
      }
    });
}

function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 1000 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
