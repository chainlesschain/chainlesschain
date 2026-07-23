/**
 * Background Task Worker - child process that executes a command.
 *
 * Args: [command, cwd, type]
 * Sends messages to parent: { type: "heartbeat"|"result"|"error", ... }
 */

import executionBroker from "../lib/process-execution-broker/index.js";

const [command, cwd, type] = process.argv.slice(2);

const heartbeat = setInterval(() => {
  if (process.send) process.send({ type: "heartbeat" });
}, 5000);

try {
  const result = executionBroker.execSync(command, {
    cwd: cwd || process.cwd(),
    encoding: "utf-8",
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    origin: `background-task:command:${type || "unknown"}`,
    policy: "allow",
    scope: "background-task",
    shell: true,
  });

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
