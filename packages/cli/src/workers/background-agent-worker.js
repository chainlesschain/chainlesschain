import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  openBackgroundLogFile,
  readBackgroundAgentState,
  removeJobFile,
  writeBackgroundAgentState,
} from "../lib/background-agent-supervisor.js";

const jobFile = process.argv[2];
let job;
try {
  job = JSON.parse(readFileSync(jobFile, "utf8"));
  removeJobFile(jobFile);
  const log = openBackgroundLogFile(job.id);
  const child = spawn(process.execPath, [job.cliEntry, ...job.argv], {
    cwd: job.cwd,
    env: { ...process.env, CC_BACKGROUND_AGENT_ID: job.id },
    stdio: ["ignore", log.fd, log.fd],
    windowsHide: true,
  });
  child.on("exit", (code, signal) => {
    const current = readBackgroundAgentState(job.id) || {};
    if (current.status === "running") {
      writeBackgroundAgentState({
        ...current,
        status: code === 0 ? "completed" : "failed",
        endedAt: Date.now(),
        exitCode: code,
        signal: signal || null,
      });
    }
    log.close();
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    const current = readBackgroundAgentState(job.id) || { id: job.id };
    writeBackgroundAgentState({
      ...current,
      status: "failed",
      endedAt: Date.now(),
      exitCode: 1,
      error: error.message,
    });
    log.close();
    process.exit(1);
  });
} catch (error) {
  if (job?.id) {
    const current = readBackgroundAgentState(job.id) || { id: job.id };
    writeBackgroundAgentState({
      ...current,
      status: "failed",
      endedAt: Date.now(),
      exitCode: 1,
      error: error.message,
    });
  }
  process.exit(1);
}
