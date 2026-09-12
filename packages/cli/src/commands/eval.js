/**
 * `cc eval` — reliability eval harness (Phase 7). Runs a suite of self-checking
 * coding tasks against the real agent and reports the task-success rate.
 *
 * Each task gets a fresh temp workspace; the agent is invoked headlessly
 * (`cc agent -p` in that cwd with acceptEdits so it can write files) and the
 * task's objective check() and successful Agent completion decide pass/fail.
 * `--dry-run` swaps in a no-op agent
 * so the harness + report can be exercised without a model.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runEvalSuite } from "../lib/eval/runner.js";
import { getSuite } from "../lib/eval/tasks.js";
import executionBroker from "../lib/process-execution-broker/index.js";
import {
  TelemetryRecorder,
  formatTelemetry,
} from "../lib/telemetry/span-recorder.js";
import { computeTrend, formatTrend } from "../lib/eval/trend.js";
import {
  createEvalComparison,
  createEvalHistoryRecord,
  evalDigest,
  evaluateStrictEvalGate,
  EVAL_EXECUTION_PROTOCOL,
  readComparisonContext,
  readEvalHistory,
} from "../lib/eval/evidence.js";

export const _deps = {
  platform: process.platform,
  kill: process.kill.bind(process),
  spawn: executionBroker.spawn.bind(executionBroker),
  spawnSync: executionBroker.spawnSync.bind(executionBroker),
  runEvalSuite,
  getSuite,
};

/** Append a run summary as one JSONL line to the history file. */
function appendHistory(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file is src/commands/eval.js → the CLI entry is bin/chainlesschain.js.
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

function verifyAgentTerminal(output) {
  try {
    const events = output
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const results = events.filter((event) => event?.type === "result");
    const terminal = results[0];
    return {
      terminalVerified:
        results.length === 1 &&
        events.at(-1) === terminal &&
        terminal.subtype === "success" &&
        terminal.is_error === false &&
        !events.some((event) => event?.type === "error"),
      observedFallback: events.some((event) =>
        ["provider_fallback", "model_fallback"].includes(event?.subtype),
      ),
    };
  } catch {
    return { terminalVerified: false, observedFallback: null };
  }
}

/**
 * Kill an agent child AND its tool grandchildren. A bare child.kill("SIGTERM")
 * only reaches the direct child (and on Windows TerminateProcess never reaches
 * grandchildren), leaving tools alive and still WRITING into the workspace.
 * POSIX children are spawned detached (own process group) so -pid reaps the
 * whole tree; Windows uses taskkill /T /F. Same pattern as the async-hook
 * supervisor's _killChildTree.
 */
function killAgentTree(child) {
  if (!child || !child.pid) return;
  if (_deps.platform === "win32") {
    try {
      _deps.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 10000,
        origin: "eval:agent-tree-kill",
        policy: "allow",
        scope: "eval",
        shell: false,
      });
    } catch {
      /* fall through to the direct kill below */
    }
  } else {
    try {
      _deps.kill(-child.pid, "SIGKILL"); // negative pid = process group
      return;
    } catch {
      /* not a group leader / already gone — fall through */
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

/**
 * Build a runAgent that shells out to a headless `cc agent -p` in the task's
 * workspace. acceptEdits lets it write files without an interactive prompt.
 */
function makeHeadlessRunAgent(opts = {}) {
  return function runAgent({ prompt, cwd, timeoutMs }) {
    return new Promise((resolve) => {
      let args;
      if (opts._argv) {
        // Test seam: run an arbitrary node argv instead of the real agent, so
        // the timeout/tree-kill path is testable offline.
        args = opts._argv;
      } else {
        args = [
          BIN,
          "agent",
          "-p",
          prompt,
          "--permission-mode",
          "acceptEdits",
          "--output-format",
          "stream-json",
        ];
        if (opts.model) args.push("--model", opts.model);
        if (opts.provider) args.push("--provider", opts.provider);
        if (opts.ephemeral === true) args.push("--ephemeral");
      }
      const child = _deps.spawn(process.execPath, args, {
        cwd,
        env: { ...process.env, ...(opts.env || {}), CLAUDECODE: "1" },
        windowsHide: true,
        // Own process group on POSIX so a timeout can reap the whole tree.
        detached: _deps.platform !== "win32",
        origin: "eval:agent-run",
        policy: "allow",
        scope: "eval",
        shell: false,
      });
      let out = "";
      let err = "";
      let settled = false;
      let timedOut = false;
      let graceTimer = null;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(graceTimer);
        resolve({
          ...result,
          executionEvidence: {
            protocol: EVAL_EXECUTION_PROTOCOL,
            exitCode: result.exitCode ?? null,
            signal: result.signal ?? null,
            terminalVerified: result.terminalVerified === true,
            observedFallback: result.observedFallback ?? null,
          },
        });
      };
      const timer = setTimeout(() => {
        // Kill the WHOLE tree, then settle on `close` — resolving immediately
        // would race a still-live agent against the runner's after-snapshot,
        // check() and workspace rmSync (nondeterministic scores + EBUSY leaks).
        timedOut = true;
        killAgentTree(child);
        // Last resort if the process is unkillable and `close` never fires —
        // don't hang the whole suite on one stuck task.
        graceTimer = setTimeout(() => {
          done({
            ok: false,
            output: out,
            error: `timed out after ${timeoutMs || 120000}ms (process did not exit after kill)`,
          });
        }, 10000);
        if (typeof graceTimer.unref === "function") graceTimer.unref();
      }, timeoutMs || 120000);
      if (typeof timer.unref === "function") timer.unref();
      child.stdout?.on("data", (d) => (out += d.toString("utf8")));
      child.stderr?.on("data", (d) => (err += d.toString("utf8")));
      child.on("error", (e) => {
        clearTimeout(timer);
        done({ ok: false, output: out, error: e.message });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          done({
            ok: false,
            output: out,
            exitCode: code,
            signal: signal || null,
            error: `timed out after ${timeoutMs || 120000}ms`,
          });
          return;
        }
        const { terminalVerified, observedFallback } = opts._argv
          ? { terminalVerified: false, observedFallback: null }
          : verifyAgentTerminal(out);
        const ok = code === 0 && !signal && (opts._argv || terminalVerified);
        done({
          ok: Boolean(ok),
          output: out,
          exitCode: code,
          signal: signal || null,
          terminalVerified,
          observedFallback,
          error: ok
            ? null
            : code === 0 && !signal
              ? "agent stream lacks a valid success terminal"
              : err || `agent process exited with ${signal || code}`,
        });
      });
    });
  };
}

// For tests: the timeout/tree-kill path needs a real spawned process.
export { makeHeadlessRunAgent, killAgentTree };

export function registerEvalCommand(program, { logger } = {}) {
  const log = logger || console;
  program
    .command("eval")
    .description(
      "Run the reliability eval suite (self-checking coding tasks) and report the task-success rate",
    )
    .option("--suite <name>", "Suite to run", "builtin")
    .option("--model <model>", "Model for the agent runs")
    .option("--provider <provider>", "Provider for the agent runs")
    .option("--json", "Output the summary as JSON")
    .option("--keep", "Keep the per-task temp workspaces (debug)")
    .option(
      "--otlp <file>",
      "Write OpenTelemetry (OTLP/JSON) spans for the run to a file",
    )
    .option(
      "--dry-run",
      "Use a no-op agent (exercise the harness/report without a model)",
    )
    .option(
      "--history <file>",
      "Append this run's summary (JSONL) for trend tracking",
    )
    .option(
      "--label <label>",
      "Tag this run in the history (e.g. a version/commit)",
    )
    .option(
      "--trend",
      "Report the diagnostic pass-rate trend from --history instead of running",
    )
    .option(
      "--strict",
      "With --trend: require complete, comparable recent evidence; legacy history cannot pass",
    )
    .option(
      "--max-age-hours <hours>",
      "With --strict: maximum age of both compared runs",
      "168",
    )
    .option(
      "--comparison-context <file>",
      "Bind explicit provider/model to operator-declared modelRevision and environment/permission/inference digests (not production attestation)",
    )
    .option(
      "--regression-threshold <pct>",
      "With --trend: pass-rate drop (in points) that fails the gate on its own",
      "0",
    )
    .action(async (options) => {
      if (options.strict && !options.trend) {
        (log.error || console.error)(
          "--strict requires --trend --history <file>",
        );
        process.exitCode = 1;
        return;
      }
      if (options.strict && options.dryRun) {
        (log.error || console.error)(
          "--dry-run cannot be combined with --strict",
        );
        process.exitCode = 1;
        return;
      }
      // Trend mode: don't run the suite — read the recorded history and report
      // the pass-rate trend + per-task regressions. This is the release-pipeline
      // consumer (the runs themselves need a real model; the report is pure).
      if (options.trend) {
        if (!options.history) {
          (log.error || console.error)("--trend requires --history <file>");
          process.exitCode = 1;
          return;
        }
        let history;
        try {
          history = readEvalHistory(options.history);
        } catch {
          history = { runs: [], issues: [{ code: "history_unreadable" }] };
        }
        const threshold = Number(options.regressionThreshold) / 100;
        if (options.strict) {
          const gate = evaluateStrictEvalGate(history, {
            maxAgeMs: Number(options.maxAgeHours) * 60 * 60 * 1000,
            regressionThreshold: threshold,
          });
          if (options.json) console.log(JSON.stringify(gate, null, 2));
          else
            (log.log || console.log)(
              `Eval comparison: ${gate.status}\n` +
                `  Scope: local configuration comparison; operator declarations are not production attestation.\n` +
                (gate.reasons.length
                  ? `  ${gate.reasons.join(", ")}`
                  : "  Comparable executions and candidate checks passed."),
            );
          if (!gate.passed) process.exitCode = 1;
          return;
        }
        const trend = computeTrend(history.runs, {
          regressionThreshold: Math.max(0, threshold || 0),
        });
        if (history.issues.length) trend.historyIssues = history.issues;
        if (options.json) console.log(JSON.stringify(trend, null, 2));
        else {
          (log.log || console.log)(formatTrend(trend));
          if (history.issues.length)
            (log.error || console.error)(
              "History contains invalid or unreadable records; this diagnostic is not release evidence.",
            );
        }
        if (trend.regressed) process.exitCode = 1;
        return;
      }

      let tasks;
      let comparison;
      try {
        tasks = _deps.getSuite(options.suite);
        comparison = createEvalComparison({
          suite: options.suite,
          corpusDigest: evalDigest(
            fs.readFileSync(new URL("../lib/eval/tasks.js", import.meta.url)),
          ),
          provider: options.provider,
          model: options.model,
          context: options.comparisonContext
            ? readComparisonContext(options.comparisonContext, {
                provider: options.provider,
                model: options.model,
              })
            : null,
        });
      } catch (err) {
        log.error ? log.error(err.message) : console.error(err.message);
        process.exitCode = 1;
        return;
      }
      const runAgent = options.dryRun
        ? async () => ({ ok: true, output: "(dry-run: no agent)" })
        : makeHeadlessRunAgent({
            model: options.model,
            provider: options.provider,
          });

      // OTel-shaped telemetry for the run (per-task span + failure class).
      const recorder = new TelemetryRecorder({ serviceName: "cc-eval" });

      const summary = await _deps.runEvalSuite(tasks, {
        runAgent,
        recorder,
        keepWorkspaces: options.keep === true,
        onResult: options.json
          ? undefined
          : (r) =>
              (log.info || console.log)(
                `  ${r.pass ? "✔" : "✗"} ${r.id} (${r.ms}ms)` +
                  (r.error
                    ? ` — ${r.error}`
                    : r.detail
                      ? ` — ${r.detail}`
                      : ""),
              ),
      });
      const record = createEvalHistoryRecord(summary, {
        comparison,
        dryRun: options.dryRun === true,
        label: options.label || null,
      });

      if (options.otlp) {
        try {
          fs.writeFileSync(
            options.otlp,
            JSON.stringify(recorder.toOtlp(), null, 2),
            "utf8",
          );
        } catch (e) {
          (log.error || console.error)(`  otlp write failed: ${e.message}`);
        }
      }
      try {
        const { exportTelemetryRecorder } =
          await import("../lib/observability/index.js");
        exportTelemetryRecorder(recorder);
      } catch {
        // Collector export is best-effort and never changes evaluation gates.
      }

      // Append to the trend history (a compact record — pass counts + per-task
      // pass/fail + a timestamp/label — so `cc eval --trend` can chart it).
      if (options.history) {
        try {
          appendHistory(options.history, record);
        } catch (e) {
          (log.error || console.error)(`  history write failed: ${e.message}`);
          process.exitCode = 1;
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ ...summary, ...record }, null, 2));
      } else {
        // Per-task lines already streamed via onResult; print the summary +
        // the telemetry metrics (durations / failure classification).
        const pct = (summary.passRate * 100).toFixed(1);
        (log.log || console.log)(
          `\nEval: ${summary.passed}/${summary.total} passed (${pct}%) in ${summary.ms}ms`,
        );
        if (typeof summary.unrelatedChangeRate === "number") {
          const upct = (summary.unrelatedChangeRate * 100).toFixed(1);
          (log.log || console.log)(
            `Unrelated-change rate: ${upct}% (${summary.tasksWithUnrelatedChanges} task(s) edited files outside their expected surface)`,
          );
        }
        if (summary.telemetry) {
          (log.log || console.log)("\n" + formatTelemetry(summary.telemetry));
        }
      }
      // Non-zero exit when not every task passed — usable as a CI gate.
      if (summary.total === 0 || summary.passed < summary.total)
        process.exitCode = 1;
    });
  return program;
}
