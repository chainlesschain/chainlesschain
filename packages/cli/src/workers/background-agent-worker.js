import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
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

  const writeHeartbeat = () => {
    const current = readBackgroundAgentState(job.id) || { id: job.id };
    if (current.status && current.status !== "running") return false;
    writeBackgroundAgentState({
      ...current,
      id: job.id,
      pid: process.pid,
      workerPid: process.pid,
      agentPid: child.pid,
      status: "running",
      heartbeatAt: Date.now(),
    });
    return true;
  };
  writeHeartbeat();
  const heartbeat = setInterval(() => {
    try {
      if (!writeHeartbeat()) clearInterval(heartbeat);
    } catch {
      /* do not let heartbeat persistence kill the worker */
    }
  }, DEFAULT_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  child.on("exit", (code, signal) => {
    clearInterval(heartbeat);
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
    clearInterval(heartbeat);
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
