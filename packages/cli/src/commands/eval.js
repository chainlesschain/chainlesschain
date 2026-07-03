/**
 * `cc eval` — reliability eval harness (Phase 7). Runs a suite of self-checking
 * coding tasks against the real agent and reports the task-success rate.
 *
 * Each task gets a fresh temp workspace; the agent is invoked headlessly
 * (`cc agent -p` in that cwd with acceptEdits so it can write files) and the
 * task's objective check() decides pass/fail. `--dry-run` swaps in a no-op agent
 * so the harness + report can be exercised without a model.
 */

import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { runEvalSuite } from "../lib/eval/runner.js";
import { getSuite } from "../lib/eval/tasks.js";

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
      "--dry-run",
      "Use a no-op agent (exercise the harness/report without a model)",
    )
    .action(async (options) => {
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

      const summary = await runEvalSuite(tasks, {
        runAgent,
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

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        // Per-task lines already streamed via onResult; print just the summary.
        const pct = (summary.passRate * 100).toFixed(1);
        (log.log || console.log)(
          `\nEval: ${summary.passed}/${summary.total} passed (${pct}%) in ${summary.ms}ms`,
        );
      }
      // Non-zero exit when not every task passed — usable as a CI gate.
      if (summary.passed < summary.total) process.exitCode = 1;
    });
  return program;
}
