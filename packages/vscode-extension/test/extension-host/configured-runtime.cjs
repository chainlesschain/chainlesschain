"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

// An explicit installed host is a separate, versioned diagnostic target. Never
// silently substitute it for a downloaded stable/insiders release gate.
function resolveConfiguredRuntime(executable, requestedVersion) {
  if (!path.isAbsolute(executable)) {
    throw new Error("--vscode-executable requires an absolute path");
  }
  if (!/^\d+\.\d+\.\d+$/.test(requestedVersion)) {
    throw new Error("--vscode-executable requires an exact --vscode-version");
  }
  const executablePath = fs.realpathSync(executable);
  if (!fs.statSync(executablePath).isFile()) {
    throw new Error("Configured VS Code executable is not a file");
  }
  const directory = path.dirname(executablePath);
  const appDirectory = [
    path.join(directory, "resources", "app"),
    path.resolve(directory, "..", "Resources", "app"),
  ].find((candidate) => fs.existsSync(path.join(candidate, "package.json")));
  if (!appDirectory) {
    throw new Error(
      "Configured VS Code distribution has no application manifest",
    );
  }
  const manifestBytes = fs.readFileSync(
    path.join(appDirectory, "package.json"),
  );
  const version = JSON.parse(manifestBytes.toString("utf8")).version;
  if (version !== requestedVersion) {
    throw new Error(
      `Configured VS Code version mismatch: requested ${requestedVersion}, manifest ${version}`,
    );
  }
  const cliPath = path.join(appDirectory, "out", "cli.js");
  if (!fs.statSync(cliPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Configured VS Code distribution has no native CLI entry");
  }
  return {
    executablePath,
    cliPath,
    receipt: {
      schema: "chainlesschain.configured-vscode-runtime/v1",
      selection: "explicit-installed-executable",
      version,
      executableSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(executablePath))
        .digest("hex"),
      manifestSha256: crypto
        .createHash("sha256")
        .update(manifestBytes)
        .digest("hex"),
    },
  };
}

function runConfiguredVsCodeCommand(runtime, args, { timeout = 120_000 } = {}) {
  // Mirrors VS Code's bin/code.cmd, without cmd.exe quoting or touching the
  // installed application's files. Callers always supply an isolated profile.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.VSCODE_DEV;
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.executablePath, [runtime.cliPath, ...args], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (data) => (stdout += data));
    child.stderr.setEncoding("utf8").on("data", (data) => (stderr += data));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Configured VS Code CLI timed out"));
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !signal) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `Configured VS Code CLI failed (${signal || code}): ${stderr}`,
          ),
        );
    });
  });
}

module.exports = { resolveConfiguredRuntime, runConfiguredVsCodeCommand };
