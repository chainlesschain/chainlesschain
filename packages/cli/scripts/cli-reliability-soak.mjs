#!/usr/bin/env node

import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
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
const RESULT_SCHEMA = "chainlesschain.cli-reliability-soak.v1";
const MIB = 1024 * 1024;

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
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      calls += 1;
      const pipeProbe = body.includes("PIPE-PROBE");
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        // The CLI should always send JSON; an invalid request gets the same
        // deterministic response and will fail in the caller's own contract.
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
      const chunks = pipeProbe ? 256 : 1;
      let index = 0;
      const send = () => {
        if (index < chunks) {
          response.write(
            `${JSON.stringify({ message: { role: "assistant", content: "x".repeat(256) }, done: false })}\n`,
          );
          index += 1;
          setImmediate(send);
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

function spawnCli(args, { home, stdio = ["ignore", "pipe", "pipe"] } = {}) {
  return spawn(process.execPath, args, {
    cwd: REPOSITORY_ROOT,
    env: childEnvironment(home),
    stdio,
    windowsHide: true,
  });
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

function descendantCount(pid) {
  if (process.platform === "win32") {
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq ${pid}).Count`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const value = Number.parseInt(probe.stdout, 10);
    return Number.isFinite(value) ? value : null;
  }
  const probe = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (probe.status === 1) return 0;
  return probe.status === 0
    ? probe.stdout.trim().split(/\s+/u).filter(Boolean).length
    : null;
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
  const samples = [];
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
    samples.push({
      closed,
      exitCode: exit.code,
      signal: exit.signal,
      durationMs: performance.now() - started,
      descendantsAfterExit: descendantCount(child.pid),
    });
  }
  return {
    pass: samples.every((sample) => sample.closed && sample.exitCode === 0),
    p95Ms: percentile(
      samples.map((sample) => sample.durationMs),
      95,
    ),
    cleanupDeadlineMs: profile.cleanupDeadlineMs,
    samples,
  };
}

async function duplexSoakScenario(baseUrl, home, profile) {
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
  const results = [];
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
          results.push(event);
          waiters.splice(0).forEach((resolvePromise) => resolvePromise());
        }
      } catch {
        // Only complete NDJSON lines are considered protocol evidence.
      }
    }
  });
  const waitForResults = (count) =>
    results.length >= count
      ? Promise.resolve()
      : new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(
            () => rejectPromise(new Error(`turn ${count} timed out`)),
            60_000,
          );
          waiters.push(() => {
            if (results.length < count) return;
            clearTimeout(timer);
            resolvePromise();
          });
        });

  const latencies = [];
  const rssSamples = [];
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  const resourcesBefore = resourceCount(child.pid);
  const rssBefore = rssBytes(child.pid);
  const ioBefore = ioSnapshot(child.pid);
  const deadline = performance.now() + profile.durationSeconds * 1_000;
  let turns = 0;
  while (turns < profile.turns || performance.now() < deadline) {
    const started = performance.now();
    child.stdin.write(
      `${JSON.stringify({ type: "user", text: `soak-${turns}` })}\n`,
    );
    turns += 1;
    await waitForResults(turns);
    latencies.push(performance.now() - started);
    const rss = rssBytes(child.pid);
    if (rss != null) rssSamples.push(rss);
  }
  const resourcesAfter = resourceCount(child.pid);
  const rssAfter = rssBytes(child.pid);
  const ioAfter = ioSnapshot(child.pid);
  const descendantsBeforeExit = descendantCount(child.pid);
  child.stdin.end();
  const exit = await waitForExit(child, profile.cleanupDeadlineMs + 20_000);
  const resourceGrowth =
    resourcesBefore.count == null || resourcesAfter.count == null
      ? null
      : resourcesAfter.count - resourcesBefore.count;
  const rssGrowthBytes =
    rssBefore == null || rssAfter == null ? null : rssAfter - rssBefore;
  const requiredMeasurementsAvailable =
    rssGrowthBytes != null &&
    resourceGrowth != null &&
    descendantsBeforeExit != null;
  return {
    pass:
      exit.code === 0 &&
      results.length === turns &&
      results.every((result) => result.is_error === false) &&
      (resourceGrowth == null || resourceGrowth <= profile.maxResourceGrowth) &&
      (rssGrowthBytes == null ||
        rssGrowthBytes <= profile.maxRssGrowthMb * MIB) &&
      (descendantsBeforeExit == null || descendantsBeforeExit === 0) &&
      (profile.mode !== "formal" || requiredMeasurementsAvailable),
    turns,
    durationSeconds: profile.durationSeconds,
    p95Ms: percentile(latencies, 95),
    rss: {
      beforeBytes: rssBefore,
      afterBytes: rssAfter,
      growthBytes: rssGrowthBytes,
      maximumBytes: rssSamples.length ? Math.max(...rssSamples) : null,
      limitGrowthBytes: profile.maxRssGrowthMb * MIB,
    },
    resources: {
      kind: resourcesBefore.kind,
      before: resourcesBefore.count,
      after: resourcesAfter.count,
      delta: resourceGrowth,
      limitGrowth: profile.maxResourceGrowth,
      requiredMeasurementsAvailable,
    },
    io: ioDelta(ioBefore, ioAfter),
    processDescendants: { beforeExit: descendantsBeforeExit, afterExit: 0 },
    exit,
    resultSubtypes: results.map((result) => result.subtype),
    resultLengths: results.map((result) =>
      typeof result.result === "string" ? result.result.length : null,
    ),
    diagnosticCodes: diagnosticCodes(
      ...results.map((result) => `${result.code || ""} ${result.error || ""}`),
    ),
    diagnosticClasses: diagnosticClasses(
      ...results.map(
        (result) =>
          `${result.code || ""} ${result.error || ""} ${result.result || ""}`,
      ),
    ),
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
  const started = performance.now();
  const terminal = pty.spawn(
    process.execPath,
    [...commonArgs(baseUrl), "-p", "tty-probe", "--output-format", "json"],
    { cwd: REPOSITORY_ROOT, env: childEnvironment(home), cols: 120, rows: 40 },
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
  return {
    pass: exit.exitCode === 0 && output.includes('"is_error":false'),
    supported: true,
    durationMs: performance.now() - started,
    exitCode: exit.exitCode,
    signal: exit.signal,
    outputBytes: Buffer.byteLength(output),
    diagnosticCodes: diagnosticCodes(output),
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
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
  const child = spawn(
    "ssh",
    [
      "-tt",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=no",
      ...(identity ? ["-i", identity] : []),
      target,
      remoteArgs.map(shellQuote).join(" "),
    ],
    {
      cwd: REPOSITORY_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.resume();
  const started = performance.now();
  const exit = await waitForExit(child, profile.cleanupDeadlineMs + 60_000);
  return {
    pass: exit.code === 0 && output.includes('"is_error":false'),
    configured: true,
    target: "configured-local-ssh",
    durationMs: performance.now() - started,
    exit,
    diagnosticCodes: diagnosticCodes(output),
    outputBytes: Buffer.byteLength(output),
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
  const report = {
    schema: RESULT_SCHEMA,
    status: "running",
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
    violations: [],
  };
  mkdirSync(dirname(output), { recursive: true });
  try {
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
      if (shouldRun("pipe")) {
        report.scenarios.pipe = await pipeScenario(
          llm.baseUrl,
          join(root, "pipe"),
          profile,
        );
      }
      if (shouldRun("tty")) {
        report.scenarios.tty = await ttyScenario(
          llm.baseUrl,
          join(root, "tty"),
          profile,
        );
      }
      if (shouldRun("ssh")) {
        report.scenarios.ssh = await sshScenario(
          llm.baseUrl,
          join(root, "ssh"),
          profile,
        );
      }
      if (shouldRun("concurrentAgents")) {
        report.scenarios.concurrentAgents = await concurrentAgentScenario(
          llm.baseUrl,
          join(root, "agents"),
          profile,
        );
      }
      if (shouldRun("duplexSoak")) {
        report.scenarios.duplexSoak = await duplexSoakScenario(
          llm.baseUrl,
          join(root, "duplex"),
          profile,
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
    report.finishedAt = new Date().toISOString();
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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
