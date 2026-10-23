// Diagnostic-only execution of an unchanged source commit. Never release evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

// Both the producer timeout and diagnostic interruption share this same action.
// A rejected or unconfirmed retirement is cached too; it is never retried.
export function createSingleOwnerRetirement(retire) {
  let owner;
  let pending;
  return (target, observed, deadlineMs) => {
    if (deadlineMs !== 10000) throw new TypeError("cleanup-deadline-changed");
    if (pending) {
      if (target !== owner) throw new TypeError("cleanup-owner-changed");
      return pending;
    }
    owner = target;
    pending = Promise.resolve().then(() =>
      retire(target, observed, deadlineMs),
    );
    return pending;
  };
}

const SOURCE_SHA = "0e59f8a304996e2597fe1af61b36e4da0551ec2f";
const root = process.cwd();
const driverDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(process.env.CC_TURN_DIAGNOSTIC_OUTPUT_DIR);
fs.mkdirSync(outputDirectory, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
const npmPaths = [
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
].map((name) => `packages/${name}`);
const profile = Object.freeze({
  mode: "smoke",
  warmupTurns: 20,
  turns: 10,
  durationSeconds: 1,
  checkpointIntervalSeconds: 30,
  cleanupDeadlineMs: 10000,
  maxRssGrowthMb: 128,
  maxResourceGrowth: 8,
});
const started = performance.now();
const elapsed = () => performance.now() - started;
const report = {
  schema: "chainlesschain.duplex-turn-latency-diagnostic/v1",
  disposition: "diagnostic-only-non-qualifying",
  formalQualification: false,
  paidReady: false,
  nativeAdmission: false,
  sourceSha: SOURCE_SHA,
  driverSha: process.env.CC_TURN_DIAGNOSTIC_DRIVER_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  startedAt: new Date().toISOString(),
  status: "running",
  profile,
  turnTimeoutMs: 60000,
  turns: [],
  events: [],
  eventCounts: {},
  requests: [],
  limits: {
    maxTurns: 30,
    maxEvents: 2048,
    maxRequests: 512,
    maxProtocolLineBytes: 1024 * 1024,
    maxChildDiagnosticBytes: 1024 * 1024,
    maxFixtureBodyBytes: 32 * 1024 * 1024,
  },
  truncated: {
    turns: false,
    events: false,
    requests: false,
    protocolLines: false,
  },
  stdoutBytes: 0,
  stderrBytes: 0,
  stderrCodes: [],
  checkpoints: [],
};
const checkpoint = () => {
  const output = path.join(outputDirectory, "duplex-turn-diagnostic.json");
  const temporary = `${output}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, output);
};
checkpoint();
let home;
let child;
let completion;
let server;
let retirement;
let finalizationPromise;
let interruptionStarted = false;
let lastResult = 0;
let latestPartial = null;
const safeCodes = new Set([
  "CC_SESSION_PERSISTENCE_FAILED",
  "CC_COMPACTION_USAGE_UNKNOWN",
  "CC_COMPACTION_REVISION_STALE",
  "CC_COMPACTION_SETTLEMENT_FAILED",
  "CC_MCP_TOOL_RESULT_TOO_LARGE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
]);
const allowedEvents = new Set([
  "init",
  "system",
  "user",
  "assistant",
  "result",
  "stream_event",
  "token_usage",
  "token-usage",
  "model_call_started",
  "model_call_completed",
  "run-started",
  "run-finished",
  "run-ended",
  "compaction",
  "micro-compaction",
  "compaction-degraded",
  "compaction_usage_unknown",
  "session-runtime-retention",
  "session-runtime-retention-degraded",
  "session_runtime_retention",
  "session_updated",
  "session_start",
  "tool_call",
  "tool_result",
  "error",
  "turn_started",
  "turn_completed",
]);
function eventRow(event) {
  const type = allowedEvents.has(event?.type) ? event.type : "other";
  report.eventCounts[type] = (report.eventCounts[type] || 0) + 1;
  if (report.events.length < report.limits.maxEvents)
    report.events.push({
      type,
      elapsedMs: elapsed(),
      sent: report.turns.length,
      results: lastResult,
    });
  else report.truncated.events = true;
  if (event?.type !== "result") return;
  lastResult++;
  const turn = report.turns[lastResult - 1];
  if (turn) {
    turn.resultAtMs = elapsed();
    turn.latencyMs = turn.resultAtMs - turn.sentAtMs;
    turn.isError = event.is_error !== false;
    turn.subtype = ["success", "error"].includes(event.subtype)
      ? event.subtype
      : "other";
    turn.resultLength =
      typeof event.result === "string" ? event.result.length : null;
  }
  checkpoint();
}

async function handleInterruption(signal, exitCode) {
  if (interruptionStarted) return;
  interruptionStarted = true;
  report.interruption = { signal, elapsedMs: elapsed() };
  report.status = "diagnostic-interrupted";
  try {
    checkpoint();
  } catch {
    /* Preserve the interruption and cleanup action. */
  }
  try {
    if (child && completion && retirement) {
      report.interruptionCleanup = await retirement(
        child,
        completion,
        profile.cleanupDeadlineMs,
      );
    }
  } catch {
    report.interruptionCleanup = { confirmed: false, failure: "cleanup-error" };
  }
  try {
    await finalizeDiagnostic();
    report.status = "diagnostic-interrupted";
    checkpoint();
  } catch {
    console.error(
      JSON.stringify({
        status: "diagnostic-interrupted-evidence-incomplete",
        formalQualification: false,
      }),
    );
  }
  process.exit(exitCode);
}
for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ...(process.platform === "win32" ? [["SIGBREAK", 131]] : []),
]) {
  process.once(signal, () => {
    void handleInterruption(signal, exitCode);
  });
}

try {
  report.activePhase = "verify-source-and-driver";
  assert.equal(process.version, "v22.12.0");
  assert.equal(process.env.CC_TURN_DIAGNOSTIC_SOURCE_SHA, SOURCE_SHA);
  assert.match(report.driverSha, /^[a-f0-9]{40}$/);
  assert.equal(git("rev-parse", "HEAD"), SOURCE_SHA);
  report.sourceCleanBefore =
    git("status", "--porcelain=v1", "--untracked-files=all") === "";
  assert.equal(report.sourceCleanBefore, true);
  report.unchangedNpmTrees = npmPaths.map((directory) => {
    const sourceTree = git("rev-parse", `${SOURCE_SHA}:${directory}`);
    const driverTree = git("rev-parse", `${report.driverSha}:${directory}`);
    assert.equal(sourceTree, driverTree, `Changed npm tree: ${directory}`);
    return { directory, sourceTree, driverTree };
  });
  for (const file of ["package.json", "package-lock.json"])
    assert.equal(
      git("rev-parse", `${SOURCE_SHA}:${file}`),
      git("rev-parse", `${report.driverSha}:${file}`),
    );
  report.driverFiles = [
    "diagnose-duplex-turns.mjs",
    "duplex-turn-diagnostics-preload.cjs",
    "cli-turn-latency-diagnostic.yml",
  ].map((name) => {
    const bytes = fs.readFileSync(path.join(driverDirectory, name));
    const repositoryPath = name.endsWith(".yml")
      ? `.github/workflows/${name}`
      : `.github/scripts/${name}`;
    const original = execFileSync(
      "git",
      ["show", `${report.driverSha}:${repositoryPath}`],
      { cwd: root, windowsHide: true },
    );
    assert.equal(hash(bytes), hash(original));
    return { name, sha256: hash(bytes) };
  });
  const sourceModule = path.join(
    root,
    "packages/cli/scripts/cli-reliability-soak.mjs",
  );
  report.producerSha256 = hash(fs.readFileSync(sourceModule));
  report.producerGitBlob = git(
    "rev-parse",
    `${SOURCE_SHA}:packages/cli/scripts/cli-reliability-soak.mjs`,
  );
  report.activePhase = "start-loopback-fixture";
  const {
    duplexSoakScenario,
    observeChildCompletion,
    retireDuplexProcessTree,
  } = await import(pathToFileURL(sourceModule));
  retirement = createSingleOwnerRetirement(retireDuplexProcessTree);
  const temporaryRoot = fs.realpathSync.native(os.tmpdir());
  home = fs.mkdtempSync(path.join(temporaryRoot, "cc-turn-diagnostic-"));
  // Same immediate ordinary Ollama reply as the exact-source reliability fixture.
  server = createServer((request, response) => {
    const row = {
      sequence: report.requests.length + 1,
      beginAtMs: elapsed(),
      sent: report.turns.length,
      receivedBytes: 0,
    };
    if (report.requests.length < report.limits.maxRequests)
      report.requests.push(row);
    else report.truncated.requests = true;
    let body = "";
    request.on("data", (chunk) => {
      row.receivedBytes += chunk.length;
      if (row.receivedBytes > report.limits.maxFixtureBodyBytes) {
        // An observer-cap failure invalidates this diagnostic; it is never
        // interpreted as an unchanged-runtime failure or a successful sample.
        body = "";
        report.fixtureBodyLimitExceeded = true;
        row.bodyLimitExceeded = true;
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      row.bodyCompleteAtMs = elapsed();
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* Exact fixture accepts invalid JSON identically. */
      }
      body = "";
      row.stream = parsed?.stream === true;
      row.messageCount = Array.isArray(parsed?.messages)
        ? parsed.messages.length
        : null;
      row.messageRoles = {};
      for (const message of Array.isArray(parsed?.messages)
        ? parsed.messages
        : []) {
        const role = ["system", "user", "assistant", "tool"].includes(
          message?.role,
        )
          ? message.role
          : "other";
        row.messageRoles[role] = (row.messageRoles[role] || 0) + 1;
      }
      if (!row.stream) {
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
      let index = 0;
      const send = () => {
        if (response.destroyed || response.writableEnded) return;
        if (index === 0) {
          const accepted = response.write(
            `${JSON.stringify({ message: { role: "assistant", content: "reliability-ok" }, done: false })}\n`,
          );
          index++;
          if (accepted) setImmediate(send);
          else response.once("drain", send);
        } else
          response.end(
            `${JSON.stringify({ done: true, prompt_eval_count: 1, eval_count: 1 })}\n`,
          );
      };
      send();
    });
    response.once("finish", () => {
      row.finishedAtMs = elapsed();
    });
    response.once("close", () => {
      row.closedAtMs = elapsed();
    });
    request.once("error", () => {
      row.requestErrorObserved = true;
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.activePhase = "unchanged-duplex-scenario";
  const result = await duplexSoakScenario(origin, home, profile, {
    retireChild: retirement,
    checkpoint(partial) {
      latestPartial = partial;
      if (report.checkpoints.length < 64)
        report.checkpoints.push({
          elapsedMs: elapsed(),
          status: partial.status,
          turns: partial.turns,
          sentCount: partial.sentCount,
          resultCount: partial.resultCount,
        });
      report.partialScenario = partial;
      checkpoint();
    },
    spawnChild(args, options) {
      // Preserve original cwd/env/stdio/detach and argv; add only a passive preload.
      child = spawn(
        process.execPath,
        [
          "--require",
          path.join(driverDirectory, "duplex-turn-diagnostics-preload.cjs"),
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
            CC_TURN_DIAGNOSTIC_CHILD_FILE: path.join(
              outputDirectory,
              "child-diagnostics.jsonl",
            ),
            CC_TURN_DIAGNOSTIC_BROKER_ORIGIN: origin,
          },
          stdio: options.stdio,
          detached: options.detached,
          windowsHide: true,
        },
      );
      completion = observeChildCompletion(child);
      const write = child.stdin.write;
      child.stdin.write = function (...values) {
        if (report.turns.length < report.limits.maxTurns)
          report.turns.push({
            sequence: report.turns.length + 1,
            phase:
              report.turns.length < profile.warmupTurns ? "warmup" : "measured",
            sentAtMs: elapsed(),
          });
        else report.truncated.turns = true;
        return Reflect.apply(write, this, values);
      };
      let buffer = "";
      let discardLine = false;
      child.stdout.on("data", (chunk) => {
        report.stdoutBytes += Buffer.byteLength(chunk);
        for (const segment of String(chunk).split(/(?<=\n)/u)) {
          if (!discardLine) buffer += segment;
          if (Buffer.byteLength(buffer) > report.limits.maxProtocolLineBytes) {
            discardLine = true;
            buffer = "";
            report.truncated.protocolLines = true;
          }
          if (segment.endsWith("\n")) {
            if (!discardLine)
              try {
                eventRow(JSON.parse(buffer));
              } catch {
                /* Never emit malformed/raw output. */
              }
            buffer = "";
            discardLine = false;
          }
        }
      });
      let stderrTail = "";
      child.stderr.on("data", (chunk) => {
        report.stderrBytes += Buffer.byteLength(chunk);
        const text = stderrTail + String(chunk);
        for (const code of safeCodes)
          if (text.includes(code) && !report.stderrCodes.includes(code))
            report.stderrCodes.push(code);
        stderrTail = text.slice(-128);
      });
      return child;
    },
  });
  report.scenario = result;
  report.status = result.pass
    ? "diagnostic-completed"
    : "diagnostic-scenario-failed";
  report.activePhase = null;
} catch (error) {
  report.status = "diagnostic-failed";
  report.failure = {
    kind:
      error?.code === "CC_RELIABILITY_TURN_TIMEOUT"
        ? "original-turn-timeout"
        : "driver-or-scenario-error",
    phase: report.activePhase,
    code:
      safeCodes.has(error?.code) ||
      ["CC_RELIABILITY_TURN_TIMEOUT", "ERR_ASSERTION"].includes(error?.code)
        ? error.code
        : null,
  };
  process.exitCode = 1;
} finally {
  await finalizeDiagnostic();
}

function finalizeDiagnostic() {
  if (finalizationPromise) return finalizationPromise;
  finalizationPromise = (async () => {
    const finalizationFailure = (stage, error) => {
      report.finalizationFailures ||= [];
      report.finalizationFailures.push({
        stage,
        code: [
          "EBUSY",
          "EPERM",
          "EACCES",
          "ENOENT",
          "ENOSPC",
          "EROFS",
          "ERR_ASSERTION",
        ].includes(error?.code)
          ? error.code
          : "OTHER",
      });
      process.exitCode = 1;
    };
    if (
      child &&
      completion?.exit() === null &&
      retirement &&
      !latestPartial?.cleanup
    ) {
      // The producer's failed cleanup is authoritative. Never retry it with a
      // second signal or a second 10-second budget.
      try {
        report.fallbackCleanup = await retirement(
          child,
          completion,
          profile.cleanupDeadlineMs,
        );
      } catch (error) {
        finalizationFailure("fallback-process-cleanup", error);
      }
    }
    if (server) {
      try {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      } catch (error) {
        finalizationFailure("close-loopback-fixture", error);
      }
    }
    if (home) {
      const file = path.join(home, "fetch-diagnostics.jsonl");
      try {
        if (fs.existsSync(file) && fs.statSync(file).size <= 65536)
          fs.copyFileSync(
            file,
            path.join(outputDirectory, "fetch-diagnostics.jsonl"),
          );
      } catch (error) {
        finalizationFailure("preserve-fetch-diagnostics", error);
      }
      const cleanupConfirmed =
        report.scenario?.processDescendants?.allRetired === true ||
        latestPartial?.cleanup?.confirmed === true ||
        report.fallbackCleanup?.confirmed === true ||
        report.interruptionCleanup?.confirmed === true ||
        !child;
      report.cleanupConfirmed = cleanupConfirmed;
      if (cleanupConfirmed) {
        try {
          const resolved = fs.realpathSync.native(home);
          assert.equal(
            path.dirname(resolved),
            fs.realpathSync.native(os.tmpdir()),
          );
          assert.ok(path.basename(resolved).startsWith("cc-turn-diagnostic-"));
          fs.rmSync(resolved, { recursive: true, force: true });
        } catch (error) {
          finalizationFailure("remove-temporary-home", error);
        }
      }
      report.temporaryDirectoryRetained = fs.existsSync(home);
    }
    try {
      report.sourceCleanAfter =
        git("status", "--porcelain=v1", "--untracked-files=all") === "";
    } catch (error) {
      report.sourceCleanAfter = false;
      finalizationFailure("verify-final-source", error);
    }
    if (report.fixtureBodyLimitExceeded)
      report.status = "diagnostic-invalid-body-limit";
    if (report.interruption) report.status = "diagnostic-interrupted";
    if (
      !report.sourceCleanAfter ||
      report.cleanupConfirmed === false ||
      report.status !== "diagnostic-completed"
    )
      process.exitCode = 1;
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = elapsed();
    try {
      checkpoint();
    } catch (error) {
      finalizationFailure("write-final-checkpoint", error);
      console.error(
        JSON.stringify({
          status: "diagnostic-evidence-write-failed",
          formalQualification: false,
        }),
      );
    }
  })();
  return finalizationPromise;
}
console.log(
  JSON.stringify({
    status: report.status,
    disposition: report.disposition,
    sourceSha: SOURCE_SHA,
    results: lastResult,
    formalQualification: false,
  }),
);
