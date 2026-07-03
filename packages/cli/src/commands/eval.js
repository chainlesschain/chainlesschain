/**
 * `cc eval` — reliability eval harness (Phase 7). Runs a suite of self-checking
 * coding tasks against the real agent and reports the task-success rate.
 *
 * Each task gets a fresh temp workspace; the agent is invoked headlessly
 * (`cc agent -p` in that cwd with acceptEdits so it can write files) and the
 * task's objective check() decides pass/fail. `--dry-run` swaps in a no-op agent
 * so the harness + report can be exercised without a model.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { runEvalSuite } from "../lib/eval/runner.js";
import { getSuite } from "../lib/eval/tasks.js";
import {
  TelemetryRecorder,
  formatTelemetry,
} from "../lib/telemetry/span-recorder.js";
import { computeTrend, formatTrend } from "../lib/eval/trend.js";

/** Append a run summary as one JSONL line to the history file. */
function appendHistory(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
}

/** Read a JSONL eval-history file into an array of run records (skips bad lines). */
function readHistory(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip a corrupt history line rather than abort the report */
    }
  }
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file is src/commands/eval.js → the CLI entry is bin/chainlesschain.js.
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

/**
 * Build a runAgent that shells out to a headless `cc agent -p` in the task's
 * workspace. acceptEdits lets it write files without an interactive prompt.
 */
function makeHeadlessRunAgent(opts = {}) {
  return function runAgent({ prompt, cwd, timeoutMs }) {
    return new Promise((resolve) => {
      const args = [
        BIN,
        "agent",
        "-p",
        prompt,
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "text",
      ];
      if (opts.model) args.push("--model", opts.model);
      if (opts.provider) args.push("--provider", opts.provider);
      const child = spawn(process.execPath, args, {
        cwd,
        env: { ...process.env, CLAUDECODE: "1" },
        windowsHide: true,
      });
      let out = "";
      let err = "";
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        done({
          ok: false,
          output: out,
          error: `timed out after ${timeoutMs || 120000}ms`,
        });
      }, timeoutMs || 120000);
      if (typeof timer.unref === "function") timer.unref();
      child.stdout?.on("data", (d) => (out += d.toString("utf8")));
      child.stderr?.on("data", (d) => (err += d.toString("utf8")));
      child.on("error", (e) => {
        clearTimeout(timer);
        done({ ok: false, output: out, error: e.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ ok: code === 0, output: out, error: code === 0 ? null : err });
      });
    });
  };
}

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
      "Report the pass-rate trend from --history instead of running (CI gate)",
    )
    .option(
      "--regression-threshold <pct>",
      "With --trend: pass-rate drop (in points) that fails the gate on its own",
      "0",
    )
    .action(async (options) => {
      // Trend mode: don't run the suite — read the recorded history and report
      // the pass-rate trend + per-task regressions. This is the release-pipeline
      // consumer (the runs themselves need a real model; the report is pure).
      if (options.trend) {
        if (!options.history) {
          (log.error || console.error)("--trend requires --history <file>");
          process.exitCode = 1;
          return;
        }
        const runs = readHistory(options.history);
        const threshold =
          Math.max(0, Number(options.regressionThreshold) || 0) / 100;
        const trend = computeTrend(runs, { regressionThreshold: threshold });
        if (options.json) console.log(JSON.stringify(trend, null, 2));
        else (log.log || console.log)(formatTrend(trend));
        if (trend.regressed) process.exitCode = 1;
        return;
      }

      let tasks;
      try {
        tasks = getSuite(options.suite);
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

      const summary = await runEvalSuite(tasks, {
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

      // Append to the trend history (a compact record — pass counts + per-task
      // pass/fail + a timestamp/label — so `cc eval --trend` can chart it).
      if (options.history) {
        try {
          appendHistory(options.history, {
            ranAt: new Date().toISOString(),
            label: options.label || null,
            passed: summary.passed,
            total: summary.total,
            passRate: summary.passRate,
            results: (summary.results || []).map((r) => ({
              id: r.id,
              pass: r.pass,
            })),
          });
        } catch (e) {
          (log.error || console.error)(`  history write failed: ${e.message}`);
        }
      }

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        // Per-task lines already streamed via onResult; print the summary +
        // the telemetry metrics (durations / failure classification).
        const pct = (summary.passRate * 100).toFixed(1);
        (log.log || console.log)(
          `\nEval: ${summary.passed}/${summary.total} passed (${pct}%) in ${summary.ms}ms`,
        );
        if (summary.telemetry) {
          (log.log || console.log)("\n" + formatTelemetry(summary.telemetry));
        }
      }
      // Non-zero exit when not every task passed — usable as a CI gate.
      if (summary.passed < summary.total) process.exitCode = 1;
    });
  return program;
}
