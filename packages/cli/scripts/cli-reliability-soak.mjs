#!/usr/bin/env node

import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../../..");
const CLI_ENTRYPOINT = resolve(SCRIPT_DIR, "../bin/chainlesschain.js");
const MCP_OUTPUT_FIXTURE = resolve(
  SCRIPT_DIR,
  "cli-reliability-mcp-server.mjs",
);
const RESULT_SCHEMA = "chainlesschain.cli-reliability-soak.v2";
const MIB = 1024 * 1024;
const MCP_PRIVATE_CANARY = "CC_RELIABILITY_MCP_PRIVATE_CANARY";
const MAX_RETAINED_LATENCY_SAMPLES = 10_000;
const ownedProcesses = new Set();

function positiveNumber(value, fallback, name, { integer = false } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new Error(`${name} must be a positive${integer ? " integer" : ""}`);
  }
  return parsed;
}

export function resolveReliabilityProfile(env = process.env) {
  const mode = String(env.CC_CLI_RELIABILITY_MODE || "smoke").trim();
  if (!new Set(["smoke", "formal"]).has(mode)) {
    throw new Error("CC_CLI_RELIABILITY_MODE must be smoke or formal");
  }
  const formal = mode === "formal";
  const floor = (value, minimum) => (formal ? Math.max(value, minimum) : value);
  return Object.freeze({
    mode,
    durationSeconds: floor(
      positiveNumber(
        env.CC_CLI_RELIABILITY_DURATION_SECONDS,
        formal ? 7_200 : 5,
        "duration seconds",
      ),
      formal ? 7_200 : 1,
    ),
    turns: floor(
      positiveNumber(
        env.CC_CLI_RELIABILITY_TURNS,
        formal ? 1_000 : 10,
        "turn count",
        { integer: true },
      ),
      formal ? 1_000 : 1,
    ),
    concurrentAgents: floor(
      positiveNumber(
        env.CC_CLI_RELIABILITY_AGENTS,
        formal ? 20 : 3,
        "agent count",
        { integer: true },
      ),
      formal ? 20 : 1,
    ),
    pipeCases: floor(
      positiveNumber(
        env.CC_CLI_RELIABILITY_PIPE_CASES,
        formal ? 20 : 2,
        "pipe case count",
        { integer: true },
      ),
      formal ? 20 : 1,
    ),
    disconnectCases: floor(
      positiveNumber(
        env.CC_CLI_RELIABILITY_DISCONNECT_CASES,
        formal ? 5 : 1,
        "disconnect case count",
        { integer: true },
      ),
      formal ? 5 : 1,
    ),
    slowConsumerMs: floor(
      positiveNumber(
        env.CC_CLI_RELIABILITY_SLOW_CONSUMER_MS,
        formal ? 2_000 : 250,
        "slow consumer duration",
        { integer: true },
      ),
      formal ? 2_000 : 1,
    ),
    checkpointIntervalSeconds: Math.min(
      60,
      positiveNumber(
        env.CC_CLI_RELIABILITY_CHECKPOINT_INTERVAL_SECONDS,
        formal ? 30 : 1,
        "checkpoint interval",
        { integer: true },
      ),
    ),
    cleanupDeadlineMs: Math.min(
      10_000,
      positiveNumber(
        env.CC_CLI_RELIABILITY_CLEANUP_DEADLINE_MS,
        10_000,
        "cleanup deadline",
        { integer: true },
      ),
    ),
    maxRssGrowthMb: positiveNumber(
      env.CC_CLI_RELIABILITY_MAX_RSS_GROWTH_MB,
      128,
      "maximum RSS growth",
    ),
    maxResourceGrowth: positiveNumber(
      env.CC_CLI_RELIABILITY_MAX_RESOURCE_GROWTH,
      8,
      "maximum FD/handle growth",
      { integer: true },
    ),
  });
}

export function percentile(values, wanted) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((wanted / 100) * sorted.length) - 1)
  ];
}

export function recordBoundedSample(
  values,
  value,
  observedCount,
  limit = MAX_RETAINED_LATENCY_SAMPLES,
) {
  if (!Number.isFinite(value)) return;
  if (values.length < limit) {
    values.push(value);
    return;
  }
  values[(observedCount - 1) % limit] = value;
}

function atomicWriteJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function trackProcess(child) {
  if (!child || typeof child.kill !== "function") return child;
  ownedProcesses.add(child);
  const release = () => ownedProcesses.delete(child);
  child.once?.("exit", release);
  child.once?.("error", release);
  return child;
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("git HEAD could not be resolved");
  return result.stdout.trim().toLowerCase();
}

function gitWorktreeChanges() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error("git worktree could not be verified");
  return result.stdout.trim().split(/\r?\n/u).filter(Boolean);
}

function commonArgs(baseUrl) {
  return [
    CLI_ENTRYPOINT,
    "agent",
    "--no-ide",
    "--no-mcp",
    "--provider",
    "ollama",
    "--model",
    "reliability-probe",
    "--base-url",
    baseUrl,
  ];
}

function childEnvironment(home) {
  return {
    ...process.env,
    CHAINLESSCHAIN_HOME: home,
    NO_COLOR: "1",
    CI: "1",
  };
}

async function startFakeOllama() {
  let calls = 0;
  const mcpObservations = {
    requestCount: 0,
    toolCallResponses: 0,
    finalResponses: 0,
    budgetCodeObserved: false,
    canaryObserved: false,
  };
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      calls += 1;
      const slowPipeProbe = body.includes("PIPE-SLOW-PROBE");
      const disconnectProbe = body.includes("DISCONNECT-PROBE");
      const pipeProbe = body.includes("PIPE-PROBE") || slowPipeProbe;
      const mcpOutputProbe = body.includes("MCP-OUTPUT-PROBE");
      if (mcpOutputProbe) {
        mcpObservations.requestCount += 1;
        mcpObservations.budgetCodeObserved ||= body.includes(
          "CC_MCP_TOOL_RESULT_TOO_LARGE",
        );
        mcpObservations.canaryObserved ||= body.includes(MCP_PRIVATE_CANARY);
      }
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        // The CLI should always send JSON; an invalid request gets the same
        // deterministic response and will fail in the caller's own contract.
      }
      if (mcpOutputProbe) {
        const toolCallRequired = !mcpObservations.budgetCodeObserved;
        if (toolCallRequired) mcpObservations.toolCallResponses += 1;
        else mcpObservations.finalResponses += 1;
        const toolCallId = `reliability-mcp-output-${mcpObservations.toolCallResponses}`;
        const payload = toolCallRequired
          ? {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: toolCallId,
                    type: "function",
                    function: {
                      name: "mcp__reliability__oversized_output",
                      arguments: {},
                    },
                  },
                ],
              },
              done: true,
              prompt_eval_count: 1,
              eval_count: 1,
            }
          : {
              message: {
                role: "assistant",
                content: "oversized MCP result rejected safely",
              },
              done: true,
              prompt_eval_count: 1,
              eval_count: 1,
            };
        response.writeHead(200, {
          "Content-Type":
            parsed?.stream === true
              ? "application/x-ndjson"
              : "application/json",
        });
        response.end(
          `${JSON.stringify(payload)}${parsed?.stream === true ? "\n" : ""}`,
        );
        return;
      }
      if (parsed?.stream !== true) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            message: { role: "assistant", content: "reliability-ok" },
            done: true,
            prompt_eval_count: 1,
            eval_count: 1,
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      const chunks =
        slowPipeProbe || disconnectProbe ? 4_096 : pipeProbe ? 256 : 1;
      let index = 0;
      const send = () => {
        if (response.destroyed || response.writableEnded) return;
        if (index < chunks) {
          const accepted = response.write(
            `${JSON.stringify({ message: { role: "assistant", content: "x".repeat(256) }, done: false })}\n`,
          );
          index += 1;
          if (accepted) setImmediate(send);
          else response.once("drain", send);
          return;
        }
        response.end(
          `${JSON.stringify({ done: true, prompt_eval_count: 1, eval_count: chunks })}\n`,
        );
      };
      send();
    });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    calls: () => calls,
    mcpObservations: () => ({ ...mcpObservations }),
  };
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`child ${child.pid} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
}

function spawnCli(
  args,
  { home, stdio = ["ignore", "pipe", "pipe"], env = {} } = {},
) {
  return trackProcess(
    spawn(process.execPath, args, {
      cwd: REPOSITORY_ROOT,
      env: { ...childEnvironment(home), ...env },
      stdio,
      windowsHide: true,
    }),
  );
}

function resourceCount(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return { kind: "unavailable", count: null };
  if (process.platform === "linux") {
    try {
      return { kind: "fd", count: readdirSync(`/proc/${pid}/fd`).length };
    } catch {
      const listing = spawnSync(
        "bash",
        ["-lc", `ls -1 /proc/${pid}/fd 2>/dev/null | wc -l`],
        { encoding: "utf8" },
      );
      const count = Number.parseInt(listing.stdout, 10);
      return { kind: "fd", count: Number.isFinite(count) ? count : null };
    }
  }
  if (process.platform === "darwin") {
    const listing = spawnSync("lsof", ["-n", "-p", String(pid)], {
      encoding: "utf8",
    });
    const count =
      listing.status === 0
        ? listing.stdout.trim().split(/\r?\n/u).length - 1
        : null;
    return { kind: "fd", count };
  }
  if (process.platform === "win32") {
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).HandleCount`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const count = Number.parseInt(probe.stdout, 10);
    return { kind: "handle", count: Number.isFinite(count) ? count : null };
  }
  return { kind: "unavailable", count: null };
}

function rssBytes(pid) {
  if (process.platform === "linux") {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status);
      return match ? Number(match[1]) * 1024 : null;
    } catch {
      return null;
    }
  }
  if (process.platform === "win32") {
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).WorkingSet64`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const value = Number(probe.stdout.trim());
    return Number.isFinite(value) ? value : null;
  }
  const probe = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const value = Number(probe.stdout.trim());
  return Number.isFinite(value) ? value * 1024 : null;
}

function ioSnapshot(pid) {
  if (process.platform === "linux") {
    try {
      const fields = Object.fromEntries(
        readFileSync(`/proc/${pid}/io`, "utf8")
          .trim()
          .split(/\r?\n/u)
          .map((line) => line.split(/:\s*/u))
          .map(([name, value]) => [name, Number(value)]),
      );
      return {
        available: true,
        readBytes: fields.read_bytes,
        writeBytes: fields.write_bytes,
        readChars: fields.rchar,
        writeChars: fields.wchar,
      };
    } catch {
      return { available: false, reason: "proc-io-unavailable" };
    }
  }
  if (process.platform === "win32") {
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ReadTransferCount,WriteTransferCount | ConvertTo-Json -Compress)`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    try {
      const parsed = JSON.parse(probe.stdout.trim());
      return {
        available: true,
        readBytes: Number(parsed.ReadTransferCount),
        writeBytes: Number(parsed.WriteTransferCount),
      };
    } catch {
      return { available: false, reason: "cim-io-unavailable" };
    }
  }
  return { available: false, reason: "host-has-no-portable-io-counter" };
}

function ioDelta(before, after) {
  if (!before.available || !after.available) {
    return {
      available: false,
      reason: after.reason || before.reason || "unavailable",
    };
  }
  const result = { available: true };
  for (const field of ["readBytes", "writeBytes", "readChars", "writeChars"]) {
    if (Number.isFinite(before[field]) && Number.isFinite(after[field])) {
      result[field] = Math.max(0, after[field] - before[field]);
    }
  }
  return result;
}

function descendantProcessSnapshot(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { available: false, pids: [] };
  }
  if (process.platform === "win32") {
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference='Stop'; $items=@(` +
          `Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | ` +
          `Select-Object ProcessId,ParentProcessId); ` +
          `ConvertTo-Json -Compress -InputObject $items`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (probe.status !== 0) return { available: false, pids: [] };
    try {
      const processes = JSON.parse(probe.stdout.trim());
      const childrenByParent = new Map();
      for (const entry of Array.isArray(processes) ? processes : [processes]) {
        const processId = Number(entry?.ProcessId);
        const parentProcessId = Number(entry?.ParentProcessId);
        if (
          !Number.isSafeInteger(processId) ||
          processId <= 0 ||
          !Number.isSafeInteger(parentProcessId) ||
          parentProcessId < 0
        ) {
          continue;
        }
        const children = childrenByParent.get(parentProcessId) || [];
        children.push(processId);
        childrenByParent.set(parentProcessId, children);
      }
      const descendants = [];
      const pending = [...(childrenByParent.get(pid) || [])];
      const seen = new Set();
      while (pending.length > 0) {
        const processId = pending.shift();
        if (seen.has(processId)) continue;
        seen.add(processId);
        descendants.push(processId);
        pending.push(...(childrenByParent.get(processId) || []));
      }
      return { available: true, pids: descendants };
    } catch {
      return { available: false, pids: [] };
    }
  }
  const descendants = [];
  const pending = [pid];
  const seen = new Set([pid]);
  while (pending.length > 0) {
    const parentPid = pending.shift();
    const probe = spawnSync("pgrep", ["-P", String(parentPid)], {
      encoding: "utf8",
    });
    if (probe.status !== 0 && probe.status !== 1) {
      return { available: false, pids: [] };
    }
    if (probe.status === 1) continue;
    for (const value of probe.stdout.trim().split(/\s+/u).filter(Boolean)) {
      const processId = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(processId) || processId <= 0) continue;
      if (seen.has(processId)) continue;
      seen.add(processId);
      descendants.push(processId);
      pending.push(processId);
    }
  }
  return { available: true, pids: descendants };
}

function descendantCount(pid) {
  const snapshot = descendantProcessSnapshot(pid);
  return snapshot.available ? snapshot.pids.length : null;
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "ESRCH" ? false : null;
  }
}

async function waitForLocalProcessRetirement(pid, timeoutMs) {
  let alive = processExists(pid);
  const deadline = performance.now() + timeoutMs;
  while (alive === true && performance.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    alive = processExists(pid);
  }
  return alive === false;
}

function diagnosticCodes(...values) {
  return [
    ...new Set(values.join("\n").match(/\b(?:CC|ERR)_[A-Z0-9_]+\b/gu) || []),
  ].slice(0, 20);
}

function diagnosticClasses(...values) {
  const value = values.join("\n");
  return [
    ["fetch-failed", /fetch failed/iu],
    ["connection-refused", /ECONNREFUSED|connection refused/iu],
    ["no-response", /no.response|empty response/iu],
    ["cleanup-deadline", /cleanup.+deadline/iu],
    ["output-backpressure", /backpressure/iu],
    ["model-error", /model error|provider error/iu],
  ]
    .filter(([, pattern]) => pattern.test(value))
    .map(([name]) => name);
}

async function pipeScenario(baseUrl, home, profile) {
  const brokenConsumers = [];
  for (let index = 0; index < profile.pipeCases; index += 1) {
    const started = performance.now();
    const child = spawnCli(
      [
        ...commonArgs(baseUrl),
        "-p",
        `PIPE-PROBE-${index}`,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ],
      { home },
    );
    child.stderr.resume();
    let closed = false;
    child.stdout.once("data", () => {
      closed = true;
      child.stdout.destroy();
    });
    const exit = await waitForExit(child, profile.cleanupDeadlineMs + 20_000);
    brokenConsumers.push({
      closed,
      exitCode: exit.code,
      signal: exit.signal,
      durationMs: performance.now() - started,
      descendantsAfterExit: descendantCount(child.pid),
    });
  }
  const slowConsumers = [];
  for (let index = 0; index < profile.pipeCases; index += 1) {
    const started = performance.now();
    const child = spawnCli(
      [
        ...commonArgs(baseUrl),
        "-p",
        `PIPE-SLOW-PROBE-${index}`,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ],
      { home },
    );
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    let buffer = "";
    let result = null;
    let bytes = 0;
    let peakReadableBytes = 0;
    let stalledAt = null;
    let actualStallMs = 0;
    let resolveStall;
    let rejectStall;
    const stallCompleted = new Promise((resolvePromise, rejectPromise) => {
      resolveStall = resolvePromise;
      rejectStall = rejectPromise;
    });
    const arrivalDeadline = setTimeout(() => {
      rejectStall(new Error("slow pipe consumer observed no output"));
    }, profile.cleanupDeadlineMs + 60_000);
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (stalledAt === null) {
        stalledAt = performance.now();
        child.stdout.pause();
        const stallDeadline = stalledAt + profile.slowConsumerMs;
        const releaseAtDeadline = () => {
          const remainingMs = stallDeadline - performance.now();
          if (remainingMs > 0) {
            setTimeout(releaseAtDeadline, Math.ceil(remainingMs));
            return;
          }
          actualStallMs = performance.now() - stalledAt;
          clearTimeout(arrivalDeadline);
          child.stdout.resume();
          resolveStall();
        };
        setTimeout(releaseAtDeadline, profile.slowConsumerMs);
      }
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === "result") result = event;
        } catch {
          // Malformed protocol output is reflected by a missing result below.
        }
      }
    });
    const sampler = setInterval(() => {
      peakReadableBytes = Math.max(
        peakReadableBytes,
        Number(child.stdout.readableLength || 0),
      );
    }, 10);
    sampler.unref?.();
    await stallCompleted.catch((error) => {
      clearTimeout(arrivalDeadline);
      child.kill("SIGKILL");
      throw error;
    });
    const exit = await waitForExit(child, profile.cleanupDeadlineMs + 60_000);
    clearInterval(sampler);
    slowConsumers.push({
      exitCode: exit.code,
      signal: exit.signal,
      durationMs: performance.now() - started,
      configuredStallMs: profile.slowConsumerMs,
      actualStallMs,
      stallObserved: stalledAt !== null,
      peakReadableBytes,
      outputBytes: bytes,
      resultSubtype: result?.subtype || null,
      resultIsError: result?.is_error ?? null,
      diagnosticCodes: diagnosticCodes(
        `${result?.code || ""} ${result?.error || ""}`,
      ),
      descendantsAfterExit: descendantCount(child.pid),
    });
  }
  return {
    pass:
      brokenConsumers.every(
        (sample) => sample.closed && sample.exitCode === 0,
      ) &&
      slowConsumers.every(
        (sample) =>
          sample.exitCode === 0 &&
          sample.resultIsError === false &&
          sample.stallObserved &&
          sample.actualStallMs >= profile.slowConsumerMs,
      ),
    brokenConsumerP95Ms: percentile(
      brokenConsumers.map((sample) => sample.durationMs),
      95,
    ),
    slowConsumerP95Ms: percentile(
      slowConsumers.map((sample) => sample.durationMs),
      95,
    ),
    cleanupDeadlineMs: profile.cleanupDeadlineMs,
    brokenConsumers,
    slowConsumers,
  };
}

async function runDiskFailureCase(
  baseUrl,
  home,
  expectedFsCode,
  profile,
  modelCalls,
) {
  const probePath = join(home, "sessions", `.reliability-probe-${process.pid}`);
  let observedHostCode = null;
  try {
    writeFileSync(probePath, "probe", "utf8");
  } catch (error) {
    observedHostCode = error?.code || null;
  } finally {
    rmSync(probePath, { force: true });
  }

  const callsBefore = modelCalls();
  const child = spawnCli(
    [
      ...commonArgs(baseUrl),
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ],
    { home, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (stdout.length < 256 * 1024) stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += chunk;
  });
  child.stdin.end(`${JSON.stringify({ type: "user", text: "disk-probe" })}\n`);
  const started = performance.now();
  const exit = await waitForExit(child, profile.cleanupDeadlineMs + 60_000);
  const events = stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const failure = events.find(
    (event) => event?.persistence?.code === "CC_SESSION_PERSISTENCE_FAILED",
  );
  const callsAfter = modelCalls();
  return {
    pass:
      observedHostCode === expectedFsCode &&
      exit.code !== 0 &&
      failure?.is_error === true &&
      failure.persistence.fs_code === expectedFsCode &&
      callsAfter === callsBefore,
    expectedFsCode,
    observedHostCode,
    modelCalls: callsAfter - callsBefore,
    durationMs: performance.now() - started,
    exit,
    projection: failure
      ? {
          subtype: failure.subtype || null,
          code: failure.persistence.code,
          fsCode: failure.persistence.fs_code,
          phase: failure.persistence.phase,
          commitState: failure.persistence.commit_state,
          retryable: failure.persistence.retryable,
        }
      : null,
    diagnosticCodes: diagnosticCodes(stdout, stderr),
    diagnosticClasses: diagnosticClasses(stdout, stderr),
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
  };
}

async function diskScenario(baseUrl, profile, modelCalls) {
  const configured = {
    EROFS: process.env.CC_CLI_RELIABILITY_DISK_EROFS_HOME || null,
    ENOSPC: process.env.CC_CLI_RELIABILITY_DISK_ENOSPC_HOME || null,
  };
  const required = profile.mode === "formal" && process.platform === "linux";
  if (!configured.EROFS || !configured.ENOSPC) {
    return {
      pass: !required,
      configured: false,
      required,
      reason: "real-disk-fixtures-not-configured",
    };
  }
  const erofs = await runDiskFailureCase(
    baseUrl,
    configured.EROFS,
    "EROFS",
    profile,
    modelCalls,
  );
  const enospc = await runDiskFailureCase(
    baseUrl,
    configured.ENOSPC,
    "ENOSPC",
    profile,
    modelCalls,
  );
  return {
    pass: erofs.pass && enospc.pass,
    configured: true,
    required,
    fixtures: { erofs, enospc },
  };
}

async function mcpOutputScenario(baseUrl, home, profile, llm) {
  mkdirSync(home, { recursive: true });
  const configPath = join(home, "managed-settings.json");
  const callLogPath = join(home, "mcp-output-calls.jsonl");
  atomicWriteJson(configPath, {
    permissions: { allow: ["mcp__reliability__oversized_output"] },
    mcpServers: {
      reliability: {
        command: process.execPath,
        args: [MCP_OUTPUT_FIXTURE],
        env: { CC_CLI_RELIABILITY_MCP_CALL_LOG: callLogPath },
      },
    },
  });

  const child = spawnCli(
    [
      ...commonArgs(baseUrl),
      "-p",
      "MCP-OUTPUT-PROBE",
      "--output-format",
      "stream-json",
      "--max-turns",
      "3",
      "--strict-mcp-config",
      "--allowed-tools",
      "mcp__reliability__oversized_output",
    ],
    {
      home,
      env: {
        CC_MCP_EXECUTABLE_TRUST: "1",
        CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: join(
          dirname(home),
          "mcp-security-anchors",
        ),
        CC_MANAGED_SETTINGS: configPath,
      },
    },
  );
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let canaryObserved = false;
  const sensitiveTails = { stdout: "", stderr: "" };
  const observe = (chunk, stream) => {
    const value = String(chunk);
    const combined = `${sensitiveTails[stream]}${value}`;
    canaryObserved ||= combined.includes(MCP_PRIVATE_CANARY);
    sensitiveTails[stream] = combined.slice(-(MCP_PRIVATE_CANARY.length - 1));
    const bytes = Buffer.byteLength(value);
    if (stream === "stdout") {
      stdoutBytes += bytes;
      if (stdout.length < 256 * 1024) stdout += value;
    } else {
      stderrBytes += bytes;
      if (stderr.length < 128 * 1024) stderr += value;
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => observe(chunk, "stdout"));
  child.stderr.on("data", (chunk) => observe(chunk, "stderr"));
  const started = performance.now();
  const exit = await waitForExit(child, profile.cleanupDeadlineMs + 90_000);

  const callEntries = existsSync(callLogPath)
    ? readFileSync(callLogPath, "utf8")
        .split(/\r?\n/u)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];
  const serverPid = callEntries.find((entry) =>
    Number.isSafeInteger(entry?.serverPid),
  )?.serverPid;
  const serverRetired = Number.isSafeInteger(serverPid)
    ? await waitForLocalProcessRetirement(serverPid, profile.cleanupDeadlineMs)
    : false;
  const protocolEvents = stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const result = protocolEvents.findLast((event) => event.type === "result");
  const toolResults = protocolEvents.filter(
    (event) => event.type === "tool_result",
  );
  const observations = llm.mcpObservations();
  const pass =
    exit.code === 0 &&
    result?.is_error === false &&
    callEntries.length === 1 &&
    callEntries[0]?.called === true &&
    callEntries[0]?.resultBytes > MIB &&
    observations.toolCallResponses === 1 &&
    observations.finalResponses === 1 &&
    observations.budgetCodeObserved &&
    !observations.canaryObserved &&
    !canaryObserved &&
    serverRetired;
  return {
    pass,
    durationMs: performance.now() - started,
    exit,
    resultSubtype: result?.subtype || null,
    resultIsError: result?.is_error ?? null,
    toolCalls: callEntries.length,
    oversizedResultBytes: callEntries[0]?.resultBytes || null,
    budgetCodeObservedByModel: observations.budgetCodeObserved,
    privateCanaryObservedByModel: observations.canaryObserved,
    privateCanaryObservedOnWire: canaryObserved,
    modelRequestCount: observations.requestCount,
    modelToolCallResponses: observations.toolCallResponses,
    modelFinalResponses: observations.finalResponses,
    mcpServerPidObserved: Number.isSafeInteger(serverPid),
    mcpServerRetired: serverRetired,
    diagnosticCodes: diagnosticCodes(stdout, stderr),
    diagnosticClasses: diagnosticClasses(stdout, stderr),
    toolResultProjections: toolResults.map((event) => ({
      isError: event.is_error ?? null,
      code: event.result?.code || event.code || null,
      incidentCode: event.result?.mcpLedgerIncident?.code || null,
      outcomeUnknown: event.result?.outcomeUnknown ?? null,
      retryable: event.result?.retryable ?? null,
    })),
    stdoutBytes,
    stderrBytes,
    ...(process.env.CC_CLI_RELIABILITY_DEBUG === "1"
      ? {
          debugStdout: stdout.slice(-2_000),
          debugStderr: stderr.slice(-2_000),
        }
      : {}),
  };
}

async function duplexSoakScenario(
  baseUrl,
  home,
  profile,
  { checkpoint = null } = {},
) {
  const child = spawnCli(
    [
      ...commonArgs(baseUrl),
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ],
    { home, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stderr.resume();
  let buffer = "";
  let resultCount = 0;
  let resultErrorCount = 0;
  let resultLengthMinimum = null;
  let resultLengthMaximum = null;
  const resultSubtypeCounts = new Map();
  const observedDiagnosticCodes = new Set();
  const observedDiagnosticClasses = new Set();
  const waiters = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === "result") {
          resultCount += 1;
          if (event.is_error !== false) resultErrorCount += 1;
          const subtype = String(event.subtype || "unknown");
          resultSubtypeCounts.set(
            subtype,
            (resultSubtypeCounts.get(subtype) || 0) + 1,
          );
          if (typeof event.result === "string") {
            const length = event.result.length;
            resultLengthMinimum =
              resultLengthMinimum === null
                ? length
                : Math.min(resultLengthMinimum, length);
            resultLengthMaximum =
              resultLengthMaximum === null
                ? length
                : Math.max(resultLengthMaximum, length);
          }
          diagnosticCodes(`${event.code || ""} ${event.error || ""}`).forEach(
            (code) => observedDiagnosticCodes.add(code),
          );
          diagnosticClasses(
            `${event.code || ""} ${event.error || ""} ${event.result || ""}`,
          ).forEach((value) => observedDiagnosticClasses.add(value));
          for (let index = waiters.length - 1; index >= 0; index -= 1) {
            if (resultCount >= waiters[index].count) {
              const [waiter] = waiters.splice(index, 1);
              waiter.resolve();
            }
          }
        }
      } catch {
        // Only complete NDJSON lines are considered protocol evidence.
      }
    }
  });
  const waitForResults = (count) =>
    resultCount >= count
      ? Promise.resolve()
      : new Promise((resolvePromise, rejectPromise) => {
          const resolve = () => {
            clearTimeout(timer);
            resolvePromise();
          };
          const timer = setTimeout(() => {
            const index = waiters.findIndex(
              (waiter) => waiter.resolve === resolve,
            );
            if (index >= 0) waiters.splice(index, 1);
            rejectPromise(new Error(`turn ${count} timed out`));
          }, 60_000);
          waiters.push({ count, resolve });
        });

  const latencies = [];
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  const resourcesBefore = resourceCount(child.pid);
  const rssBefore = rssBytes(child.pid);
  const ioBefore = ioSnapshot(child.pid);
  let resourcesMaximum = resourcesBefore.count;
  let rssMaximum = rssBefore;
  const deadline = performance.now() + profile.durationSeconds * 1_000;
  const scenarioStarted = performance.now();
  let lastMetricSampleAt = 0;
  let lastCheckpointAt = performance.now();
  let turns = 0;
  while (turns < profile.turns || performance.now() < deadline) {
    const started = performance.now();
    const accepted = child.stdin.write(
      `${JSON.stringify({ type: "user", text: `soak-${turns}` })}\n`,
    );
    if (!accepted) {
      await new Promise((resolvePromise, rejectPromise) => {
        const onDrain = () => {
          child.stdin.removeListener("error", onError);
          resolvePromise();
        };
        const onError = (error) => {
          child.stdin.removeListener("drain", onDrain);
          rejectPromise(error);
        };
        child.stdin.once("drain", onDrain);
        child.stdin.once("error", onError);
      });
    }
    turns += 1;
    await waitForResults(turns);
    const now = performance.now();
    recordBoundedSample(latencies, now - started, turns);
    if (now - lastMetricSampleAt >= 1_000) {
      lastMetricSampleAt = now;
      const rss = rssBytes(child.pid);
      const resources = resourceCount(child.pid);
      if (rss != null) rssMaximum = Math.max(rssMaximum || 0, rss);
      if (resources.count != null) {
        resourcesMaximum = Math.max(resourcesMaximum || 0, resources.count);
      }
    }
    if (
      checkpoint &&
      now - lastCheckpointAt >= profile.checkpointIntervalSeconds * 1_000
    ) {
      lastCheckpointAt = now;
      checkpoint({
        status: "running",
        turns,
        resultCount,
        continuousDurationSeconds: (now - scenarioStarted) / 1_000,
        latency: {
          p95Ms: percentile(latencies, 95),
          observedCount: turns,
          retainedCount: latencies.length,
        },
        rss: { beforeBytes: rssBefore, maximumBytes: rssMaximum },
        resources: {
          kind: resourcesBefore.kind,
          before: resourcesBefore.count,
          maximum: resourcesMaximum,
        },
      });
    }
  }
  const resourcesAfter = resourceCount(child.pid);
  const rssAfter = rssBytes(child.pid);
  const ioAfter = ioSnapshot(child.pid);
  const descendantsBeforeExit = descendantProcessSnapshot(child.pid);
  child.stdin.end();
  const exit = await waitForExit(child, profile.cleanupDeadlineMs + 20_000);
  const descendantRetirements = descendantsBeforeExit.available
    ? await Promise.all(
        descendantsBeforeExit.pids.map((processId) =>
          waitForLocalProcessRetirement(processId, profile.cleanupDeadlineMs),
        ),
      )
    : [];
  const descendantsAfterExit = descendantProcessSnapshot(child.pid);
  const allDescendantsRetired =
    descendantsBeforeExit.available &&
    descendantsAfterExit.available &&
    descendantRetirements.every(Boolean) &&
    descendantsAfterExit.pids.length === 0;
  const resourceGrowth =
    resourcesBefore.count == null || resourcesAfter.count == null
      ? null
      : resourcesAfter.count - resourcesBefore.count;
  const rssGrowthBytes =
    rssBefore == null || rssAfter == null ? null : rssAfter - rssBefore;
  const requiredMeasurementsAvailable =
    rssGrowthBytes != null &&
    resourceGrowth != null &&
    descendantsBeforeExit.available &&
    descendantsAfterExit.available;
  return {
    pass:
      exit.code === 0 &&
      resultCount === turns &&
      resultErrorCount === 0 &&
      (resourceGrowth == null || resourceGrowth <= profile.maxResourceGrowth) &&
      (rssGrowthBytes == null ||
        rssGrowthBytes <= profile.maxRssGrowthMb * MIB) &&
      (!descendantsBeforeExit.available || allDescendantsRetired) &&
      (profile.mode !== "formal" || requiredMeasurementsAvailable),
    turns,
    configuredDurationSeconds: profile.durationSeconds,
    continuousDurationSeconds: (performance.now() - scenarioStarted) / 1_000,
    latency: {
      p95Ms: percentile(latencies, 95),
      observedCount: turns,
      retainedCount: latencies.length,
      retention: "rolling-window",
    },
    rss: {
      beforeBytes: rssBefore,
      afterBytes: rssAfter,
      growthBytes: rssGrowthBytes,
      maximumBytes: rssMaximum,
      peakGrowthBytes:
        rssBefore == null || rssMaximum == null ? null : rssMaximum - rssBefore,
      limitGrowthBytes: profile.maxRssGrowthMb * MIB,
    },
    resources: {
      kind: resourcesBefore.kind,
      before: resourcesBefore.count,
      after: resourcesAfter.count,
      delta: resourceGrowth,
      maximum: resourcesMaximum,
      peakDelta:
        resourcesBefore.count == null || resourcesMaximum == null
          ? null
          : resourcesMaximum - resourcesBefore.count,
      limitGrowth: profile.maxResourceGrowth,
      requiredMeasurementsAvailable,
    },
    io: ioDelta(ioBefore, ioAfter),
    processDescendants: {
      measurementAvailable:
        descendantsBeforeExit.available && descendantsAfterExit.available,
      beforeExit: descendantsBeforeExit.available
        ? descendantsBeforeExit.pids.length
        : null,
      observed: descendantsBeforeExit.pids.length,
      retired: descendantRetirements.filter(Boolean).length,
      afterExit: descendantsAfterExit.available
        ? descendantsAfterExit.pids.length
        : null,
      allRetired: allDescendantsRetired,
    },
    exit,
    results: {
      count: resultCount,
      errorCount: resultErrorCount,
      subtypeCounts: Object.fromEntries(resultSubtypeCounts),
      lengthMinimum: resultLengthMinimum,
      lengthMaximum: resultLengthMaximum,
    },
    diagnosticCodes: [...observedDiagnosticCodes].slice(0, 20),
    diagnosticClasses: [...observedDiagnosticClasses].slice(0, 20),
  };
}

async function concurrentAgentScenario(baseUrl, home, profile) {
  const started = performance.now();
  const children = Array.from(
    { length: profile.concurrentAgents },
    (_, index) => {
      const child = spawnCli(
        [
          ...commonArgs(baseUrl),
          "-p",
          `agent-${index}`,
          "--output-format",
          "json",
        ],
        { home: join(home, `agent-${index}`) },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (stdout.length < 64 * 1024) stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 64 * 1024) stderr += chunk;
      });
      return { child, output: () => ({ stdout, stderr }) };
    },
  );
  const exits = await Promise.all(
    children.map(async ({ child, output }) => {
      const exit = await waitForExit(child, 120_000);
      const captured = output();
      let result = null;
      try {
        result = JSON.parse(captured.stdout.trim());
      } catch {
        // Invalid output is reflected by the failed result contract below.
      }
      return {
        ...exit,
        resultSubtype: result?.subtype || null,
        resultIsError: result?.is_error ?? null,
        resultLength:
          typeof result?.result === "string" ? result.result.length : null,
        diagnosticCodes: diagnosticCodes(captured.stdout, captured.stderr),
        diagnosticClasses: diagnosticClasses(captured.stdout, captured.stderr),
        ...(process.env.CC_CLI_RELIABILITY_DEBUG === "1"
          ? {
              debugStdout: captured.stdout.slice(-2_000),
              debugStderr: captured.stderr.slice(-2_000),
            }
          : {}),
        stdoutBytes: Buffer.byteLength(captured.stdout),
        stderrBytes: Buffer.byteLength(captured.stderr),
      };
    }),
  );
  return {
    pass: exits.every(
      (exit) => exit.code === 0 && exit.resultIsError === false,
    ),
    agents: profile.concurrentAgents,
    durationMs: performance.now() - started,
    exits,
  };
}

async function ttyScenario(baseUrl, home, profile) {
  let pty;
  try {
    pty = await import("node-pty");
  } catch (error) {
    return {
      pass: profile.mode !== "formal",
      supported: false,
      reason: error.code || "load-failed",
    };
  }
  const nativeOptions =
    process.platform === "win32" ? { useConpty: true, useConptyDll: true } : {};
  const started = performance.now();
  const terminal = pty.spawn(
    process.execPath,
    [...commonArgs(baseUrl), "-p", "tty-probe", "--output-format", "json"],
    {
      cwd: REPOSITORY_ROOT,
      env: childEnvironment(home),
      cols: 120,
      rows: 40,
      ...nativeOptions,
    },
  );
  let output = "";
  terminal.onData((chunk) => {
    output += chunk;
  });
  const exit = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      terminal.kill();
      rejectPromise(new Error("TTY probe exceeded its cleanup deadline"));
    }, profile.cleanupDeadlineMs + 60_000);
    terminal.onExit((event) => {
      clearTimeout(timer);
      resolvePromise(event);
    });
  });
  const normalProcessRetired = processExists(terminal.pid) === false;
  const normal = {
    pass:
      exit.exitCode === 0 &&
      output.includes('"is_error":false') &&
      normalProcessRetired,
    durationMs: performance.now() - started,
    exitCode: exit.exitCode,
    signal: exit.signal,
    outputBytes: Buffer.byteLength(output),
    diagnosticCodes: diagnosticCodes(output),
    processRetired: normalProcessRetired,
  };
  const disconnects = [];
  for (let index = 0; index < profile.disconnectCases; index += 1) {
    const disconnectedAt = performance.now();
    const probe = pty.spawn(
      process.execPath,
      [
        ...commonArgs(baseUrl),
        "-p",
        `TTY-DISCONNECT-PROBE-${index}`,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ],
      {
        cwd: REPOSITORY_ROOT,
        env: childEnvironment(join(home, `disconnect-${index}`)),
        cols: 120,
        rows: 40,
        ...nativeOptions,
      },
    );
    const probePid = probe.pid;
    let outputObserved = false;
    let killRequested = false;
    let outputBytes = 0;
    let protocolOutput = "";
    probe.onData((chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (protocolOutput.length < 64 * 1024) protocolOutput += chunk;
      if (killRequested || !protocolOutput.includes('"type"')) return;
      outputObserved = true;
      killRequested = true;
      probe.kill();
    });
    const disconnectedExit = await new Promise(
      (resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          try {
            probe.kill();
          } catch {
            // The timeout result remains authoritative.
          }
          rejectPromise(
            new Error("TTY disconnect exceeded its cleanup deadline"),
          );
        }, profile.cleanupDeadlineMs + 20_000);
        probe.onExit((event) => {
          clearTimeout(timer);
          resolvePromise(event);
        });
      },
    );
    const probeRetired = processExists(probePid) === false;
    disconnects.push({
      pass: outputObserved && killRequested && probeRetired,
      outputObserved,
      killRequested,
      protocolEventObserved: protocolOutput.includes('"type"'),
      processRetired: probeRetired,
      durationMs: performance.now() - disconnectedAt,
      exitCode: disconnectedExit.exitCode,
      signal: disconnectedExit.signal,
      outputBytes,
      diagnosticCodes: diagnosticCodes(protocolOutput),
    });
  }
  return {
    pass: normal.pass && disconnects.every((sample) => sample.pass),
    supported: true,
    normal,
    disconnects,
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function sshOptions(identity) {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "StrictHostKeyChecking=no",
    ...(identity ? ["-i", identity] : []),
  ];
}

function remotePidAlive(target, identity, pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const probe = spawnSync(
    "ssh",
    [...sshOptions(identity), target, `kill -0 ${pid}`],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", timeout: 10_000 },
  );
  return probe.status === 0;
}

async function sshScenario(baseUrl, home, profile) {
  const target = process.env.CC_CLI_RELIABILITY_SSH_TARGET;
  if (!target)
    return { pass: true, configured: false, reason: "target-not-configured" };
  const identity = process.env.CC_CLI_RELIABILITY_SSH_IDENTITY;
  const remoteArgs = [
    "env",
    `CHAINLESSCHAIN_HOME=${home}`,
    process.execPath,
    ...commonArgs(baseUrl),
    "-p",
    "ssh-tty-probe",
    "--output-format",
    "json",
  ];
  const child = trackProcess(
    spawn(
      "ssh",
      [
        "-tt",
        ...sshOptions(identity),
        target,
        remoteArgs.map(shellQuote).join(" "),
      ],
      {
        cwd: REPOSITORY_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    ),
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.resume();
  const started = performance.now();
  const exit = await waitForExit(child, profile.cleanupDeadlineMs + 60_000);
  const normal = {
    pass: exit.code === 0 && output.includes('"is_error":false'),
    durationMs: performance.now() - started,
    exit,
    diagnosticCodes: diagnosticCodes(output),
    outputBytes: Buffer.byteLength(output),
  };
  const disconnects = [];
  for (let index = 0; index < profile.disconnectCases; index += 1) {
    const disconnectHome = join(home, `disconnect-${index}`);
    const command = [
      "env",
      `CHAINLESSCHAIN_HOME=${disconnectHome}`,
      process.execPath,
      ...commonArgs(baseUrl),
      "-p",
      `SSH-DISCONNECT-PROBE-${index}`,
      "--output-format",
      "stream-json",
      "--include-partial-messages",
    ];
    const remoteScript =
      `printf 'CC_RELIABILITY_REMOTE_PID=%s\\n' "$$"; exec ` +
      command.map(shellQuote).join(" ");
    const disconnected = trackProcess(
      spawn(
        "ssh",
        [
          "-tt",
          ...sshOptions(identity),
          target,
          "sh",
          "-lc",
          shellQuote(remoteScript),
        ],
        {
          cwd: REPOSITORY_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      ),
    );
    const disconnectedStarted = performance.now();
    let captured = "";
    let outputObserved = false;
    let killRequested = false;
    disconnected.stdout.setEncoding("utf8");
    disconnected.stdout.on("data", (chunk) => {
      if (captured.length < 128 * 1024) captured += chunk;
      if (killRequested || !captured.includes('"type"')) return;
      outputObserved = true;
      killRequested = true;
      disconnected.kill("SIGKILL");
    });
    disconnected.stderr.resume();
    const disconnectedExit = await waitForExit(
      disconnected,
      profile.cleanupDeadlineMs + 60_000,
    );
    const pidMatch = /CC_RELIABILITY_REMOTE_PID=(\d+)/u.exec(captured);
    const remotePid = pidMatch ? Number(pidMatch[1]) : null;
    let alive = remotePidAlive(target, identity, remotePid);
    const retirementDeadline = performance.now() + profile.cleanupDeadlineMs;
    while (alive === true && performance.now() < retirementDeadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      alive = remotePidAlive(target, identity, remotePid);
    }
    if (alive === true) {
      spawnSync(
        "ssh",
        [...sshOptions(identity), target, `kill -KILL ${remotePid}`],
        { cwd: REPOSITORY_ROOT, encoding: "utf8", timeout: 10_000 },
      );
    }
    disconnects.push({
      pass:
        outputObserved &&
        killRequested &&
        Number.isSafeInteger(remotePid) &&
        alive === false,
      outputObserved,
      killRequested,
      remotePidObserved: Number.isSafeInteger(remotePid),
      remoteRetired: alive === false,
      durationMs: performance.now() - disconnectedStarted,
      exit: disconnectedExit,
      diagnosticCodes: diagnosticCodes(captured),
      outputBytes: Buffer.byteLength(captured),
    });
  }
  return {
    pass: normal.pass && disconnects.every((sample) => sample.pass),
    configured: true,
    target: "configured-local-ssh",
    normal,
    disconnects,
  };
}

function readResumeReport(output, { headSha, profile }) {
  if (process.env.CC_CLI_RELIABILITY_RESUME !== "1" || !existsSync(output)) {
    return null;
  }
  let previous;
  try {
    previous = JSON.parse(readFileSync(output, "utf8"));
  } catch {
    throw new Error("reliability resume artifact is not valid JSON");
  }
  if (
    previous.schema !== RESULT_SCHEMA ||
    previous.headSha !== headSha ||
    previous.platform !== process.platform ||
    previous.arch !== process.arch ||
    JSON.stringify(previous.profile) !== JSON.stringify(profile)
  ) {
    throw new Error(
      "reliability resume artifact does not match schema, SHA, host, or profile",
    );
  }
  return previous;
}

function installInterruptionCheckpoint(report, output) {
  const handlers = new Map();
  const install = (signal, exitCode) => {
    const handler = () => {
      report.status = "interrupted";
      report.activeScenario = report.activeScenario || null;
      report.interruption = {
        signal,
        observedAt: new Date().toISOString(),
      };
      for (const child of ownedProcesses) {
        try {
          child.kill("SIGKILL");
        } catch {
          // The checkpoint remains useful even if a child already exited.
        }
      }
      try {
        report.checkpointedAt = new Date().toISOString();
        atomicWriteJson(output, report);
      } finally {
        process.exit(exitCode);
      }
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  };
  install("SIGINT", 130);
  install("SIGTERM", 143);
  if (process.platform === "win32") install("SIGBREAK", 131);
  return () => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
}

async function main() {
  const profile = resolveReliabilityProfile();
  const headSha = gitHead();
  const worktreeChanges = gitWorktreeChanges();
  const expectedSha = String(
    process.env.CC_CLI_RELIABILITY_EXPECTED_SHA || "",
  ).toLowerCase();
  const output =
    process.env.CC_CLI_RELIABILITY_OUTPUT ||
    join(tmpdir(), `cli-reliability-${process.platform}-${process.pid}.json`);
  const root = mkdtempSync(join(tmpdir(), "cc-cli-reliability-"));
  let previous = null;
  let resumeError = null;
  try {
    previous = readResumeReport(output, { headSha, profile });
  } catch (error) {
    resumeError = error;
  }
  const startedAt = new Date().toISOString();
  const report = {
    schema: RESULT_SCHEMA,
    status: "running",
    startedAt,
    seriesStartedAt:
      previous?.seriesStartedAt || previous?.startedAt || startedAt,
    headSha,
    expectedSha: expectedSha || null,
    exactShaVerified:
      Boolean(expectedSha) &&
      expectedSha === headSha &&
      worktreeChanges.length === 0,
    source: {
      clean: worktreeChanges.length === 0,
      changeCount: worktreeChanges.length,
    },
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    profile,
    scenarios: {},
    partialScenarios: {},
    activeScenario: null,
    resume: {
      requested: process.env.CC_CLI_RELIABILITY_RESUME === "1",
      recovered: previous !== null,
      priorStatus: previous?.status || null,
      attempt: Number.isSafeInteger(previous?.resume?.attempt)
        ? previous.resume.attempt + 1
        : 1,
      recoveredScenarios: [],
    },
    violations: [],
  };
  const checkpoint = () => {
    report.checkpointedAt = new Date().toISOString();
    atomicWriteJson(output, report);
  };
  checkpoint();
  const removeInterruptionCheckpoint = installInterruptionCheckpoint(
    report,
    output,
  );
  try {
    if (resumeError) throw resumeError;
    if (expectedSha && expectedSha !== headSha) {
      throw new Error(
        `exact SHA mismatch: expected ${expectedSha}, got ${headSha}`,
      );
    }
    if (expectedSha && worktreeChanges.length > 0) {
      throw new Error(
        `exact SHA source verification refused ${worktreeChanges.length} worktree change(s)`,
      );
    }
    const llm = await startFakeOllama();
    try {
      const selected = new Set(
        String(process.env.CC_CLI_RELIABILITY_SCENARIOS || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      const shouldRun = (name) => selected.size === 0 || selected.has(name);
      const runScenario = async (name, operation) => {
        const recovered = previous?.scenarios?.[name];
        if (recovered?.pass === true) {
          report.scenarios[name] = recovered;
          report.resume.recoveredScenarios.push(name);
          checkpoint();
          return;
        }
        report.activeScenario = { name, startedAt: new Date().toISOString() };
        checkpoint();
        report.scenarios[name] = await operation();
        report.activeScenario = null;
        delete report.partialScenarios[name];
        checkpoint();
      };
      if (shouldRun("disk")) {
        await runScenario("disk", () =>
          diskScenario(llm.baseUrl, profile, llm.calls),
        );
      }
      if (shouldRun("mcpOutput")) {
        await runScenario("mcpOutput", () =>
          mcpOutputScenario(
            llm.baseUrl,
            join(root, "mcp-output"),
            profile,
            llm,
          ),
        );
      }
      if (shouldRun("pipe")) {
        await runScenario("pipe", () =>
          pipeScenario(llm.baseUrl, join(root, "pipe"), profile),
        );
      }
      if (shouldRun("tty")) {
        await runScenario("tty", () =>
          ttyScenario(llm.baseUrl, join(root, "tty"), profile),
        );
      }
      if (shouldRun("ssh")) {
        await runScenario("ssh", () =>
          sshScenario(llm.baseUrl, join(root, "ssh"), profile),
        );
      }
      if (shouldRun("concurrentAgents")) {
        await runScenario("concurrentAgents", () =>
          concurrentAgentScenario(llm.baseUrl, join(root, "agents"), profile),
        );
      }
      if (shouldRun("duplexSoak")) {
        await runScenario("duplexSoak", () =>
          duplexSoakScenario(llm.baseUrl, join(root, "duplex"), profile, {
            checkpoint: (partial) => {
              report.partialScenarios.duplexSoak = partial;
              checkpoint();
            },
          }),
        );
      }
      report.fakeModelCalls = llm.calls();
    } finally {
      llm.server.closeAllConnections?.();
      await new Promise((resolvePromise) => llm.server.close(resolvePromise));
    }
    for (const [name, scenario] of Object.entries(report.scenarios)) {
      if (!scenario.pass) report.violations.push(`${name} scenario failed`);
    }
    report.status = report.violations.length === 0 ? "passed" : "failed";
  } catch (error) {
    report.status = "failed";
    report.violations.push(error?.message || String(error));
  } finally {
    removeInterruptionCheckpoint();
    report.finishedAt = new Date().toISOString();
    report.activeScenario = null;
    checkpoint();
    rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(
    `${JSON.stringify({ status: report.status, output })}\n`,
  );
  // node-pty can retain a native libuv handle after its child has exited. The
  // gate has already measured the target CLI, closed its server, and flushed
  // the exclusive artifact, so terminate the harness deterministically.
  process.exit(report.status === "passed" ? 0 : 1);
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
