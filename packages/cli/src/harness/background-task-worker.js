/**
 * Background Task Worker - child process that executes a command.
 *
 * Args: [command, cwd, type]
 * Sends messages to parent: { type: "heartbeat"|"result"|"error", ... }
 */

import { executeBackgroundTaskCommand } from "./background-task-command-runner.js";

const [
  command,
  cwd,
  type,
  sandboxWorkspaceCwd = "",
  sandboxRequiredBoundaries = "",
] = process.argv.slice(2);

const heartbeat = setInterval(() => {
  if (process.send) process.send({ type: "heartbeat" });
}, 5000);

try {
  const result = await executeBackgroundTaskCommand({
    command,
    cwd,
    type,
    workspaceCwd: sandboxWorkspaceCwd,
    requiredBoundaries: sandboxRequiredBoundaries,
  });

  if (process.send) {
    process.send({ type: "result", data: result || "Done" });
  }
} catch (err) {
  if (process.send) {
    process.send({
      type: "error",
      error: err.stderr || err.message || String(err),
      code: err.code || null,
      sandboxReason: err.sandboxReason || null,
      sandboxFailClosed: err.sandboxFailClosed === true,
    });
  }
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
}
