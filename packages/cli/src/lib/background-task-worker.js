/**
 * Background Task Worker — child process that executes a command.
 *
 * Args: [command, cwd, type]
 * Sends messages to parent: { type: "heartbeat"|"result"|"error", ... }
 */

import { execSync } from "node:child_process";

const [command, cwd, type] = process.argv.slice(2);

// Heartbeat every 5 seconds
const heartbeat = setInterval(() => {
  if (process.send) process.send({ type: "heartbeat" });
}, 5000);

try {
  let result;

  if (type === "shell") {
    result = execSync(command, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 300000, // 5 min max
      maxBuffer: 10 * 1024 * 1024,
    });
  } else {
    // Default: treat as shell
    result = execSync(command, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  if (process.send) {
    process.send({ type: "result", data: result || "Done" });
  }
} catch (err) {
  if (process.send) {
    process.send({
      type: "error",
      error: err.stderr || err.message || String(err),
    });
  }
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
}
