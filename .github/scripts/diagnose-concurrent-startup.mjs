// Instrumentation only: runtime is pinned to exact8905; one unchanged cohort.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

export const SOURCE_SHA = "890510d0311805e591302853f7f348a6d9f6fb66";
const PROFILE = Object.freeze({
  concurrentAgents: 20,
  cleanupDeadlineMs: 10000,
});
const MAX_CAPTURE = 65536;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeCode = (error) =>
  [
    "CC_RELIABILITY_CHILD_TIMEOUT",
    "CC_RELIABILITY_CHILD_FAILED",
    "ERR_ASSERTION",
    "EBUSY",
    "EPERM",
    "EACCES",
    "ENOENT",
    "ETIMEDOUT",
    "EPIPE",
  ].includes(error?.code)
    ? error.code
    : "OTHER";

// Failure, interruption and finalization share one cached action/deadline.
export function createCleanupOwner({
  records,
  retire,
  observer,
  now = () => performance.now(),
}) {
  let pending;
  return (force) => {
    if (pending) return pending;
    const deadline = now() + 10000;
    pending = Promise.resolve().then(async () => {
      const remaining = () => Math.max(0, deadline - now());
      const results = await Promise.allSettled([
        force
          ? retire(records, remaining(), { now })
          : Promise.resolve({
              scope: "direct-children",
              allClosed: records.every((record) => record.closed),
              treeTermination: "unverified",
            }),
        observer.stop(deadline),
      ]);
      const cohort =
        results[0].status === "fulfilled"
          ? results[0].value
          : { confirmed: false };
      const sampler =
        results[1].status === "fulfilled"
          ? results[1].value
          : { closed: false };
      const withinDeadline = now() <= deadline;
      return {
        mode: force ? "forced-retirement" : "direct-child-close",
        deadlineMs: 10000,
        cohort,
        observer: sampler,
        withinDeadline,
        safeToRemove:
          withinDeadline &&
          sampler.closed === true &&
          (force ? cohort.confirmed === true : cohort.allClosed === true),
      };
    });
    return pending;
  };
}

export function createEvidenceCheckpoint(report, write) {
  return (stage) => {
    try {
      write();
      return true;
    } catch (error) {
      report.finalizationFailures ||= [];
      if (report.finalizationFailures.length < 16)
        report.finalizationFailures.push({
          stage: [
            "initial",
            "partial",
            "interrupt",
            "final",
            "manifest-failure",
          ].includes(stage)
            ? stage
            : "other",
          code: safeCode(error),
        });
      return false;
    }
  };
}

export function createObserver({
  script,
  report,
  elapsed,
  limit,
  spawnProcess = spawn,
  now = () => performance.now(),
}) {
  let child;
  let closed = false;
  let stopping = false;
  let closedPromise = Promise.resolve();
  const state = report.observer;
  return {
    start(records) {
      if (stopping || child) return;
      state.launchAtMs = elapsed();
      const manifest = records
        .filter(
          (record) =>
            !record.closed &&
            record.completion.exit() === null &&
            Number.isSafeInteger(record.child.pid),
        )
        .map((record) => ({
          agentIndex: record.index,
          pid: record.child.pid,
          beforeMs: record.beforeMs,
          afterMs: record.afterMs,
        }));
      try {
        child = spawnProcess(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
          ],
          { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
        );
      } catch {
        limit("observer-spawn-unavailable");
        closed = true;
        return;
      }
      closedPromise = new Promise((resolve) =>
        child.once("close", (code) => {
          closed = true;
          state.closeAtMs = elapsed();
          state.exitCode = Number.isInteger(code) ? code : null;
          resolve();
        }),
      );
      child.once("error", () => limit("observer-spawn-unavailable"));
      child.stdin.on("error", () => limit("observer-input-unavailable"));
      child.stderr.on("data", (chunk) => {
        state.stderrBytes += chunk.length;
      });
      let buffer = "";
      let bytes = 0;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
        state.stdoutBytes = bytes;
        if (bytes > 1024 * 1024) {
          limit("observer-output-limit");
          buffer = "";
          return;
        }
        buffer += chunk;
        if (buffer.length > 8192 && !buffer.includes("\n")) {
          limit("observer-line-limit");
          buffer = "";
          return;
        }
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const row = JSON.parse(line);
            if (row.kind === "ready") {
              state.readyAtMs ??= elapsed();
              continue;
            }
            if (row.kind === "unavailable") {
              limit("observer-runtime-unavailable");
              continue;
            }
            if (
              row.kind !== "sample" ||
              !Number.isInteger(row.agentIndex) ||
              row.agentIndex < 0 ||
              row.agentIndex >= 20 ||
              !Number.isFinite(row.observerMs) ||
              row.observerMs < 0 ||
              row.observerMs > 140000
            ) {
              limit("observer-invalid-row");
              continue;
            }
            if (
              records.find((record) => record.index === row.agentIndex)?.closed
            )
              continue;
            if (report.samples.length >= 2620) {
              limit("observer-sample-limit");
              continue;
            }
            const available =
              row.available === true &&
              Number.isFinite(row.cpuMs) &&
              row.cpuMs >= 0 &&
              Number.isSafeInteger(row.rssBytes) &&
              row.rssBytes >= 0;
            report.samples.push({
              agentIndex: row.agentIndex,
              receivedAtMs: elapsed(),
              observerMs: row.observerMs,
              available,
              cpuMs: available ? row.cpuMs : null,
              rssBytes: available ? row.rssBytes : null,
            });
          } catch {
            limit("observer-invalid-row");
          }
        }
      });
      child.stdin.write(`${JSON.stringify(manifest)}\n`);
    },
    async stop(deadline) {
      stopping = true;
      if (!child) return { closed: true, started: false };
      // EOF requests a graceful stop. Never kill an observer PID, including one
      // whose exit/close is delayed or whose numeric PID might have been reused.
      if (!closed && !child.stdin.destroyed) child.stdin.end();
      if (!closed)
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, Math.max(0, deadline - now()));
          closedPromise.then(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      if (!closed) limit("observer-close-unconfirmed");
      return { closed, started: true };
    },
  };
}

export function createFixture({ report, elapsed, limit }) {
  let count = 0;
  return createServer((request, response) => {
    if (++count > 200) {
      limit("fixture-request-limit");
      request.destroy();
      return;
    }
    const row = {
      ordinal: count,
      agentIndex: null,
      beginAtMs: elapsed(),
      bodyEndAtMs: null,
      finishAtMs: null,
      closeAtMs: null,
      requestBytes: 0,
      responseBytes: 0,
    };
    report.requests.push(row);
    let chunks = [];
    request.on("data", (chunk) => {
      row.requestBytes += chunk.length;
      if (row.requestBytes > 16 * 1024 * 1024) {
        chunks = [];
        limit("fixture-body-limit");
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("error", () => limit("fixture-request-error"));
    request.on("close", () => {
      row.requestCloseAtMs = elapsed();
    });
    request.on("aborted", () => {
      row.requestAbortedAtMs = elapsed();
    });
    response.on("error", () => limit("fixture-response-error"));
    response.on("finish", () => {
      row.finishAtMs = elapsed();
    });
    response.on("close", () => {
      row.closeAtMs = elapsed();
    });
    request.on("end", () => {
      row.bodyEndAtMs = elapsed();
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        limit("fixture-invalid-json");
      }
      chunks = [];
      const content = Array.isArray(parsed?.messages)
        ? parsed.messages.findLast((entry) => entry?.role === "user")?.content
        : null;
      const match =
        typeof content === "string" && /^agent-([0-9]|1[0-9])$/u.exec(content);
      if (match) row.agentIndex = Number(match[1]);
      else limit("fixture-unmapped-agent");
      if (parsed?.stream !== true) {
        const body = JSON.stringify({
          message: { role: "assistant", content: "reliability-ok" },
          done: true,
          prompt_eval_count: 1,
          eval_count: 1,
        });
        row.headersAtMs = elapsed();
        response.writeHead(200, { "Content-Type": "application/json" });
        row.responseBytes += Buffer.byteLength(body);
        row.firstWriteAtMs = elapsed();
        row.endCalledAtMs = elapsed();
        response.end(body);
        return;
      }
      row.headersAtMs = elapsed();
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      const first = `${JSON.stringify({ message: { role: "assistant", content: "reliability-ok" }, done: false })}\n`;
      const last = `${JSON.stringify({ done: true, prompt_eval_count: 1, eval_count: 1 })}\n`;
      const end = () => {
        if (!response.destroyed && !response.writableEnded) {
          row.responseBytes += Buffer.byteLength(last);
          row.endCalledAtMs = elapsed();
          response.end(last);
        }
      };
      row.responseBytes += Buffer.byteLength(first);
      row.firstWriteAtMs = elapsed();
      if (response.write(first)) setImmediate(end);
      else response.once("drain", end);
    });
  });
}

// Preserve only fixed message templates, never user-controlled values or paths.
export function redactStderr(value) {
  return String(value)
    .slice(0, MAX_CAPTURE)
    .split(/\r?\n/u)
    .slice(0, 64)
    .filter(Boolean)
    .map((line) => {
      if (/Database initialized:/u.test(line))
        return "Database initialized: [REDACTED]";
      if (/sandbox mode is explicitly off/u.test(line))
        return "sandbox mode is explicitly off [REDACTED]";
      if (/Bootstrap failed:/u.test(line))
        return "Bootstrap failed: [REDACTED]";
      if (/^(?:Error|Evolution ingress):/u.test(line))
        return line.startsWith("Error:")
          ? "Error: [REDACTED]"
          : "Evolution ingress: [REDACTED]";
      return "[REDACTED]";
    });
}

export async function main() {
  const root = process.cwd();
  const driverDirectory = path.dirname(fileURLToPath(import.meta.url));
  const outputDirectory = path.resolve(
    process.env.CC_CONCURRENT_DIAGNOSTIC_OUTPUT_DIR,
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const report = {
    schema: "chainlesschain.concurrent-startup-diagnostic/v1",
    disposition: "diagnostic-only-non-qualifying",
    formalQualification: false,
    paidReady: false,
    nativeAdmission: false,
    sourceSha: SOURCE_SHA,
    driverSha: process.env.CC_CONCURRENT_DIAGNOSTIC_DRIVER_SHA || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    startedAt: new Date().toISOString(),
    status: "running",
    profile: PROFILE,
    childTimeoutMs: 120000,
    observations: [],
    helperCalls: [],
    requests: [],
    samples: [],
    limitations: [],
    observer: { stdoutBytes: 0, stderrBytes: 0 },
    metricMeaning:
      "Helper clocks begin at preload installation and are separate from driver time. A begin without return is an unfinished call, with helper PID unknown for spawnSync. Sync duration includes process creation, execution, teardown and scheduling. ACL marker elapsed time is script-internal, not total process time or proof of success. Async byte counts cover emitted stream data only. Bounded synchronous sidecar writes add diagnostic overhead. Root-process CPU/RSS excludes helper descendants. Observer cold start competes with workload; sample receipt time and observer clock are distinct. Neither sampling nor direct-child close proves former-tree retirement.",
  };
  const output = path.join(
    outputDirectory,
    "concurrent-startup-diagnostic.json",
  );
  const checkpoint = () => {
    const temporary = `${output}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
    fs.renameSync(temporary, output);
  };
  const limit = (code) => {
    if (!report.limitations.includes(code)) report.limitations.push(code);
  };
  const saveCheckpoint = createEvidenceCheckpoint(report, checkpoint);
  const finalizationFailure = (stage, error) => {
    report.finalizationFailures ||= [];
    if (report.finalizationFailures.length < 16)
      report.finalizationFailures.push({ stage, code: safeCode(error) });
    limit("finalization-incomplete");
    process.exitCode = 1;
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  let home;
  let helperDirectory;
  let server;
  let cleanup;
  let finalizing;
  let sampler;
  let scenarioFinished = false;
  const records = [];
  let interrupted = false;
  const finalize = () => {
    if (finalizing) return finalizing;
    finalizing = (async () => {
      try {
        if (cleanup)
          report.cleanup = await cleanup(
            !scenarioFinished || interrupted || Boolean(report.failure),
          );
      } catch {
        report.cleanup = { safeToRemove: false };
        limit("cleanup-exception");
      }
      if (server) {
        try {
          server.closeAllConnections();
        } catch (error) {
          finalizationFailure("close-fixture-connections", error);
        }
        try {
          await new Promise((resolve, reject) =>
            server.close((error) =>
              error && error.code !== "ERR_SERVER_NOT_RUNNING"
                ? reject(error)
                : resolve(),
            ),
          );
        } catch (error) {
          finalizationFailure("close-fixture", error);
        }
      }
      for (const row of report.observations) {
        try {
          const file = path.join(helperDirectory, `helper-${row.index}.jsonl`);
          const size = fs.statSync(file).size;
          assert.ok(size <= 256 * 1024);
          const text = fs.readFileSync(file, "utf8");
          const lines = text.split("\n");
          if (lines.pop()) limit("helper-partial-final-line");
          const events = lines.filter(Boolean).map((line) => JSON.parse(line));
          if (!events.some((event) => event.kind === "ready"))
            limit("helper-not-ready");
          if (events.some((event) => event.kind === "limit"))
            limit("helper-output-limit");
          report.helperCalls.push({
            agentIndex: row.index,
            observedUntilMs: elapsed(),
            observedUntilEpochMs: Date.now(),
            events,
          });
        } catch {
          limit("helper-evidence-unavailable");
        }
      }
      if (helperDirectory) {
        if (report.cleanup?.safeToRemove === true) {
          try {
            const resolved = fs.realpathSync.native(helperDirectory);
            assert.equal(
              path.dirname(resolved),
              fs.realpathSync.native(os.tmpdir()),
            );
            assert.ok(
              path.basename(resolved).startsWith("cc-helper-observation-"),
            );
            fs.rmSync(resolved, { recursive: true, force: true });
          } catch {
            limit("helper-directory-cleanup-unavailable");
          }
        }
        report.helperDirectoryRetained = fs.existsSync(helperDirectory);
      }
      if (home) {
        if (report.cleanup?.safeToRemove === true) {
          try {
            const resolved = fs.realpathSync.native(home);
            assert.equal(
              path.dirname(resolved),
              fs.realpathSync.native(os.tmpdir()),
            );
            assert.ok(
              path.basename(resolved).startsWith("cc-concurrent-diagnostic-"),
            );
            fs.rmSync(resolved, { recursive: true, force: true });
          } catch (error) {
            limit(`home-cleanup-${safeCode(error)}`);
          }
        }
        report.temporaryDirectoryRetained = fs.existsSync(home);
      }
      try {
        report.sourceCleanAfter =
          git("status", "--porcelain=v1", "--untracked-files=all") === "";
      } catch {
        report.sourceCleanAfter = false;
      }
      if (!report.sourceCleanAfter) limit("source-changed");
      if (!report.observer.readyAtMs) limit("observer-not-ready");
      if (!report.samples.some((sample) => sample.available))
        limit("observer-no-usable-metrics");
      if (interrupted) report.status = "diagnostic-interrupted";
      else if (
        report.limitations.length &&
        report.status === "diagnostic-completed"
      )
        report.status = "diagnostic-completed-with-limitations";
      report.finishedAt = new Date().toISOString();
      report.elapsedMs = elapsed();
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onInterrupt);
      if (process.platform === "win32")
        process.removeListener("SIGBREAK", onInterrupt);
      const saved = saveCheckpoint("final");
      let evidenceFile = output;
      if (!saved) {
        evidenceFile = path.join(
          outputDirectory,
          "concurrent-startup-finalization.json",
        );
        try {
          fs.writeFileSync(
            evidenceFile,
            `${JSON.stringify(report, null, 2)}\n`,
          );
        } catch (error) {
          finalizationFailure("write-fallback-evidence", error);
        }
      }
      try {
        const bytes = fs.readFileSync(evidenceFile);
        fs.writeFileSync(
          path.join(outputDirectory, "evidence-manifest.json"),
          `${JSON.stringify({ schema: "chainlesschain.diagnostic-evidence/v1", disposition: report.disposition, sourceSha: SOURCE_SHA, driverSha: report.driverSha, runId: report.runId, runAttempt: report.runAttempt, files: [{ name: path.basename(evidenceFile), bytes: bytes.length, sha256: hash(bytes) }], driverFiles: report.driverFiles || [] }, null, 2)}\n`,
          { flag: "wx" },
        );
      } catch (error) {
        finalizationFailure("write-evidence-manifest", error);
        saveCheckpoint("manifest-failure");
      }
      if (
        report.failure ||
        interrupted ||
        !report.sourceCleanAfter ||
        report.cleanup?.safeToRemove !== true ||
        report.limitations.length ||
        report.finalizationFailures?.length
      )
        process.exitCode = 1;
    })();
    return finalizing;
  };
  const onInterrupt = () => {
    if (interrupted) return;
    interrupted = true;
    report.interruption = { atMs: elapsed() };
    saveCheckpoint("interrupt");
    void finalize().then(
      () => process.exit(1),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  if (process.platform === "win32") process.on("SIGBREAK", onInterrupt);
  saveCheckpoint("initial");
  try {
    assert.equal(process.platform, "win32");
    assert.equal(process.version, "v22.12.0");
    assert.equal(process.env.CC_CONCURRENT_DIAGNOSTIC_SOURCE_SHA, SOURCE_SHA);
    assert.match(report.driverSha, /^[a-f0-9]{40}$/u);
    assert.equal(git("rev-parse", "HEAD"), SOURCE_SHA);
    report.sourceCleanBefore =
      git("status", "--porcelain=v1", "--untracked-files=all") === "";
    assert.equal(report.sourceCleanBefore, true);
    report.unchangedNpmTrees = [
      "cli",
      "agent-protocol",
      "core-env",
      "shared-logger",
      "core-config",
      "core-db",
      "core-infra",
      "core-mtc",
      "core-multisig",
      "core-settlement",
      "session-core",
      "context-memory-kernel",
      "agent-sdk",
      "personal-data-hub",
    ].map((name) => {
      const directory = `packages/${name}`;
      const sourceTree = git("rev-parse", `${SOURCE_SHA}:${directory}`);
      const driverTree = git("rev-parse", `${report.driverSha}:${directory}`);
      assert.equal(sourceTree, driverTree);
      return { directory, sourceTree, driverTree };
    });
    report.rootManifestBlobs = ["package.json", "package-lock.json"].map(
      (name) => {
        const sourceBlob = git("rev-parse", `${SOURCE_SHA}:${name}`);
        const driverBlob = git("rev-parse", `${report.driverSha}:${name}`);
        assert.equal(sourceBlob, driverBlob);
        return { name, sourceBlob, driverBlob };
      },
    );
    report.unchangedCliRuntime =
      git("rev-parse", `${SOURCE_SHA}:packages/cli/src`) ===
      git("rev-parse", `${report.driverSha}:packages/cli/src`);
    assert.equal(report.unchangedCliRuntime, true);
    report.driverFiles = [
      "diagnose-concurrent-startup.mjs",
      "concurrent-startup-observer.ps1",
      "concurrent-startup-preload.cjs",
      "cli-concurrent-startup-diagnostic.yml",
    ].map((name) => {
      const repositoryPath = `.github/${name.endsWith(".yml") ? "workflows" : "scripts"}/${name}`;
      const bytes = fs.readFileSync(path.join(driverDirectory, name));
      const expected = execFileSync(
        "git",
        ["show", `${report.driverSha}:${repositoryPath}`],
        { cwd: root, windowsHide: true },
      );
      assert.equal(hash(bytes), hash(expected));
      return {
        name,
        bytes: bytes.length,
        sha256: hash(bytes),
        gitBlob: git("rev-parse", `${report.driverSha}:${repositoryPath}`),
      };
    });
    const sourceModule = path.join(
      root,
      "packages/cli/scripts/cli-reliability-soak.mjs",
    );
    report.producer = {
      sha256: hash(fs.readFileSync(sourceModule)),
      gitBlob: git(
        "rev-parse",
        `${SOURCE_SHA}:packages/cli/scripts/cli-reliability-soak.mjs`,
      ),
    };
    const require = createRequire(path.join(root, "packages/cli/package.json"));
    const storageFile = require.resolve(
      "@chainlesschain/session-core/private-storage",
    );
    const storagePackage = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(storageFile), "../package.json"),
        "utf8",
      ),
    );
    report.resolvedPrivateStorage = {
      version: storagePackage.version,
      sha256: hash(fs.readFileSync(storageFile)),
    };
    assert.equal(storagePackage.version, "0.3.22");
    const {
      concurrentAgentScenario,
      retireConcurrentAgentChildren,
      observeChildCompletion,
      diskFailureDiagnostics,
    } = await import(pathToFileURL(sourceModule));
    home = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-concurrent-diagnostic-",
      ),
    );
    helperDirectory = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-helper-observation-"),
    );
    sampler = createObserver({
      script: path.join(driverDirectory, "concurrent-startup-observer.ps1"),
      report,
      elapsed,
      limit,
    });
    cleanup = createCleanupOwner({
      records,
      retire: retireConcurrentAgentChildren,
      observer: sampler,
    });
    server = createFixture({ report, elapsed, limit });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    report.scenario = await concurrentAgentScenario(
      `http://127.0.0.1:${server.address().port}`,
      home,
      PROFILE,
      {
        checkpoint(partial) {
          report.partialScenario = partial;
          saveCheckpoint("partial");
        },
        async retireChildren(_records, deadlineMs) {
          assert.equal(deadlineMs, 10000);
          const result = await cleanup(true);
          return {
            ...result.cohort,
            confirmed: result.safeToRemove,
            observer: result.observer,
          };
        },
        spawnChild(args, options) {
          const index = report.observations.length;
          const row = {
            index,
            spawnAtMs: elapsed(),
            firstStdoutAtMs: null,
            firstStderrAtMs: null,
            resultAtMs: null,
            exitAtMs: null,
            closeAtMs: null,
            stdoutBytes: 0,
            stderrBytes: 0,
            startupSafeClasses: [],
            stderrRedacted: [],
            resultSubtype: null,
            resultIsError: null,
            outputTruncated: false,
          };
          report.observations.push(row);
          const beforeMs = Date.now();
          const child = spawn(
            process.execPath,
            [
              "--require",
              path.join(driverDirectory, "concurrent-startup-preload.cjs"),
              ...args,
            ],
            {
              cwd: root,
              env: {
                ...process.env,
                CHAINLESSCHAIN_HOME: options.home,
                NO_COLOR: "1",
                CI: "1",
                ...options.env,
                CC_STARTUP_OBSERVATION_FILE: path.join(
                  helperDirectory,
                  `helper-${index}.jsonl`,
                ),
              },
              stdio: options.stdio || ["ignore", "pipe", "pipe"],
              detached: options.detached,
              windowsHide: true,
            },
          );
          const observed = observeChildCompletion(child);
          const record = {
            index,
            child,
            closed: false,
            spawnError: false,
            beforeMs,
            afterMs: Date.now(),
            completion: {
              exit: observed.exit,
              closed: observed.closed,
              wait(timeoutMs) {
                return new Promise((resolve, reject) => {
                  const timer = setTimeout(
                    () => reject(new Error("close-deadline")),
                    timeoutMs,
                  );
                  observed.closed.then(() => {
                    clearTimeout(timer);
                    resolve(observed.exit());
                  });
                });
              },
            },
          };
          records.push(record);
          child.once("error", () => {
            record.spawnError = true;
          });
          child.once("exit", () => {
            row.exitAtMs = elapsed();
          });
          child.once("close", () => {
            record.closed = true;
            row.closeAtMs = elapsed();
          });
          let stdout = "";
          let stderr = "";
          for (const channel of ["stdout", "stderr"]) {
            child[channel].setEncoding("utf8");
            child[channel].on("data", (chunk) => {
              row[`${channel}Bytes`] += Buffer.byteLength(chunk);
              row[
                channel === "stdout" ? "firstStdoutAtMs" : "firstStderrAtMs"
              ] ??= elapsed();
              let buffer = channel === "stdout" ? stdout : stderr;
              const available = Math.max(0, MAX_CAPTURE - buffer.length);
              buffer += chunk.slice(0, available);
              row.outputTruncated ||= chunk.length > available;
              if (channel === "stderr") {
                stderr = buffer;
                row.startupSafeClasses = diskFailureDiagnostics(stderr).classes;
                row.stderrRedacted = redactStderr(stderr);
              } else {
                stdout = buffer;
                try {
                  const result = JSON.parse(stdout.trim());
                  if (
                    row.resultAtMs === null &&
                    typeof result?.is_error === "boolean"
                  ) {
                    row.resultAtMs = elapsed();
                    row.resultIsError = result.is_error;
                    row.resultSubtype = ["success", "error"].includes(
                      result.subtype,
                    )
                      ? result.subtype
                      : null;
                  }
                } catch {
                  /* Never retain raw malformed output. */
                }
              }
            });
          }
          child.once("close", () => {
            stdout = "";
            stderr = "";
          });
          if (index === 19)
            queueMicrotask(() => {
              try {
                sampler.start(records);
              } catch {
                limit("observer-start-error");
              }
            });
          return child;
        },
      },
    );
    scenarioFinished = true;
    report.status = report.scenario.pass
      ? "diagnostic-completed"
      : "diagnostic-scenario-failed";
    if (!report.scenario.pass) process.exitCode = 1;
  } catch (error) {
    report.status = "diagnostic-failed";
    report.failure = {
      kind:
        error?.code === "CC_RELIABILITY_CHILD_TIMEOUT"
          ? "original-120000ms-timeout"
          : "driver-or-scenario-error",
      code: safeCode(error),
      childIndex: Number.isInteger(error?.childIndex) ? error.childIndex : null,
    };
    process.exitCode = 1;
  } finally {
    await finalize();
  }
  // All evidence is finalized. Unknown children/observer retain the home and
  // remain an explicit failure; do not hang or introduce another cleanup budget.
  process.exit(process.exitCode || 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch {
    process.stderr.write(
      "Concurrent startup diagnostic finalization unavailable.\n",
    );
    process.exit(1);
  }
}
