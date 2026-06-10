/**
 * cc loop — repeatedly run a command or agent prompt on a fixed interval
 * (Claude-Code `/loop` parity, MVP). Lightweight by design: unlike `cc ccron`
 * (in-memory profile governance, runs nothing) or `cc automation` (DB-backed
 * flow/trigger engine), this just re-runs ONE thing on a timer until a stop
 * condition fires or you Ctrl-C.
 *
 *   cc loop "check if CI passed, summarize failures"   # wraps `cc agent -p`
 *   cc loop --every 30s -- npm test                    # external command
 *   cc loop --every 1m --max-iterations 10 -- npm test
 *   cc loop --until-exit-zero --every 30s -- npm test  # stop when it passes
 *   cc loop --until "DONE" --every 1m "poll the deploy"
 *   cc loop "review the diff" --think --provider openai # extra flags → cc agent
 *   cc loop --dynamic "watch the deploy; stop when it's live" # agent self-paces
 *
 * Two modes, disambiguated by the literal `--` separator:
 *   - no `--`  → the single operand is a PROMPT, run via `cc agent -p <prompt>`
 *   - with `--` → the operands after it are an EXTERNAL command (shell-resolved)
 *
 * The loop driver lives in src/lib/loop.js (pure, clock-injected). This layer
 * only builds the concrete iteration (spawn + tee output) and wires SIGINT.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  runLoop,
  parseDuration,
  formatDuration,
  makeSleep,
  parseLoopDirectives,
} from "../lib/loop.js";

/**
 * Appended to the prompt under `--dynamic` so the model can self-pace: it ends
 * its reply with at most one control directive the loop parses (parseLoopDirectives).
 */
const DYNAMIC_PROMPT_SUFFIX = `

---
You are running inside a \`cc loop --dynamic\` controller. After deciding what happens next, end your reply with EXACTLY ONE control directive alone on the final line:
  [[loop:next <interval>]]   run me again after <interval> (e.g. 30s, 5m, 1h)
  [[loop:stop]]              the task is complete — stop looping
Emit neither and the loop falls back to its default --every interval.`;

/** Absolute path to this CLI's bin entry, for self-spawning the prompt mode. */
const BIN_PATH = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);

/**
 * Run one child process to completion. Tees stdout/stderr to the parent (so
 * the user sees live output) while capturing it, so `--until <regex>` can match
 * against what was printed. Resolves with { exitCode, output }.
 */
function spawnIteration(cmd, args, { shell, onChild, capture }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      shell,
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
      env: process.env,
    });
    if (onChild) onChild(child);

    let output = "";
    if (capture) {
      child.stdout?.on("data", (d) => {
        output += d;
        process.stdout.write(d);
      });
      child.stderr?.on("data", (d) => {
        output += d;
        process.stderr.write(d);
      });
    }

    // `close` (not `exit`) so piped stdio is fully drained before we resolve.
    child.on("close", (code, signal) => {
      resolve({ exitCode: code == null ? null : code, output, signal });
    });
    child.on("error", (err) => {
      resolve({
        exitCode: 127,
        output: String(err.message || err),
        signal: null,
      });
    });
  });
}

export function registerLoopCommand(program) {
  program
    .command("loop [parts...]")
    .description(
      "Repeatedly run an agent prompt or `-- <command>` on a fixed interval",
    )
    .option(
      "--every <dur>",
      "Interval between iterations (e.g. 30s, 5m, 1.5h; bare number = seconds)",
      "5m",
    )
    .option("-n, --max-iterations <n>", "Stop after N iterations")
    .option(
      "--until-exit-zero",
      "Stop once an iteration exits with code 0 (e.g. tests pass)",
    )
    .option(
      "--until <regex>",
      "Stop once an iteration's output matches this JS regex",
    )
    .option(
      "--dynamic",
      "Let each iteration self-pace via [[loop:next <dur>]] / [[loop:stop]] directives (prompt mode augments the prompt)",
    )
    .option("--json", "Print a JSON summary when the loop ends")
    .allowUnknownOption(true) // pass-through flags for the wrapped agent/command
    .action(async (parts, options, command) => {
      try {
        // --- resolve interval ---
        let intervalMs;
        try {
          intervalMs = parseDuration(options.every);
        } catch (e) {
          logger.error(chalk.red(e.message));
          process.exitCode = 1;
          return;
        }

        // --- resolve stop conditions ---
        let maxIterations;
        if (options.maxIterations != null) {
          maxIterations = Number(options.maxIterations);
          if (!Number.isInteger(maxIterations) || maxIterations < 1) {
            logger.error(
              chalk.red("--max-iterations must be a positive integer"),
            );
            process.exitCode = 1;
            return;
          }
        }
        let untilRegex = null;
        if (options.until) {
          try {
            untilRegex = new RegExp(options.until);
          } catch (e) {
            logger.error(chalk.red(`invalid --until regex: ${e.message}`));
            process.exitCode = 1;
            return;
          }
        }

        // --- determine mode (external command vs agent prompt) ---
        // `--` is the unambiguous signal for external-command mode. Commander
        // folds the post-`--` operands into `parts`, so we sniff the parsed argv
        // for the literal separator. `rawArgs` is what Commander actually parsed
        // (process.argv in prod, the explicit array under test) — preferred over
        // the global process.argv so detection holds in both.
        const argv = command?.parent?.rawArgs || process.argv;
        const execMode = argv.includes("--");
        const operands = (parts || []).filter((p) => p !== "--");

        if (operands.length === 0) {
          logger.error(
            chalk.red(
              'nothing to loop: pass a prompt ("...") or a command after `--`',
            ),
          );
          logger.log(chalk.gray('  cc loop --every 5m "check CI"'));
          logger.log(chalk.gray("  cc loop --every 30s -- npm test"));
          process.exitCode = 1;
          return;
        }

        let cmd;
        let args;
        let shell;
        let label;
        if (execMode) {
          // External command: shell-resolved so Windows `.cmd` shims (npm, etc.)
          // and shell builtins work cross-platform.
          cmd = operands.join(" ");
          args = [];
          shell = true;
          label = cmd;
        } else {
          // Prompt mode: re-invoke this CLI as `cc agent -p <prompt>`. Operands
          // up to the first flag-looking token form the prompt; everything from
          // the first `-…` token on is forwarded verbatim to `cc agent` (so
          // `cc loop "review the diff" --think --provider openai` works). Loop's
          // own flags are consumed by Commander before we ever see operands.
          const flagIdx = operands.findIndex((p) => p.startsWith("-"));
          const promptParts =
            flagIdx === -1 ? operands : operands.slice(0, flagIdx);
          const agentFlags = flagIdx === -1 ? [] : operands.slice(flagIdx);
          let prompt = promptParts.join(" ");
          if (options.dynamic) prompt += DYNAMIC_PROMPT_SUFFIX;
          cmd = process.execPath;
          args = [BIN_PATH, "agent", "-p", prompt, ...agentFlags];
          shell = false;
          label =
            `cc agent -p ${chalk.italic(promptParts.join(" "))}` +
            (agentFlags.length ? ` ${chalk.gray(agentFlags.join(" "))}` : "");
        }

        // --- SIGINT → graceful stop after the current iteration ---
        const controller = new AbortController();
        let activeChild = null;
        let interrupted = false;
        const onSigint = () => {
          interrupted = true;
          controller.abort();
          if (activeChild && activeChild.exitCode == null) {
            try {
              activeChild.kill("SIGINT");
            } catch {
              /* already gone */
            }
          }
          logger.log(chalk.yellow("\n⏹  stopping after current iteration…"));
        };
        process.on("SIGINT", onSigint);

        // Capture output when we need to read it: regex matching or --dynamic
        // directive parsing.
        const capture = Boolean(untilRegex) || Boolean(options.dynamic);
        logger.log(
          chalk.cyan(
            `↻ loop: ${label}  ${chalk.gray(
              `(${options.dynamic ? "dynamic, fallback " : "every "}${formatDuration(
                intervalMs,
              )}${maxIterations ? `, max ${maxIterations}` : ""})`,
            )}`,
          ),
        );

        const startedAt = Date.now();
        let summary;
        try {
          summary = await runLoop({
            intervalMs,
            maxIterations,
            untilExitZero: Boolean(options.untilExitZero),
            untilRegex,
            sleep: makeSleep(controller.signal),
            shouldStop: () => controller.signal.aborted,
            onIteration: (n, res) => {
              const tag =
                res.exitCode === 0
                  ? chalk.green(`exit 0`)
                  : chalk.red(`exit ${res.exitCode}`);
              logger.log(chalk.gray(`  ↳ iteration ${n} done (${tag})`));
            },
            runIteration: async (n) => {
              logger.log(chalk.gray(`\n▸ iteration ${n} — ${label}`));
              const res = await spawnIteration(cmd, args, {
                shell,
                capture,
                onChild: (c) => {
                  activeChild = c;
                },
              });
              // --dynamic: read the iteration's [[loop:next]] / [[loop:stop]]
              // directive and surface it to runLoop as done / nextDelayMs.
              if (options.dynamic) {
                const d = parseLoopDirectives(res.output);
                res.done = d.done;
                if (d.nextDelayMs != null) res.nextDelayMs = d.nextDelayMs;
                if (d.done) {
                  logger.log(chalk.gray(`     ↺ directive: stop`));
                } else if (d.nextDelayMs != null) {
                  logger.log(
                    chalk.gray(
                      `     ↺ directive: next in ${formatDuration(d.nextDelayMs)}`,
                    ),
                  );
                }
              }
              return res;
            },
          });
        } finally {
          process.removeListener("SIGINT", onSigint);
        }

        const elapsed = formatDuration(Date.now() - startedAt);
        const lastExit =
          summary.results.length > 0
            ? summary.results[summary.results.length - 1].exitCode
            : null;

        if (options.json) {
          logger.log(
            JSON.stringify(
              {
                iterations: summary.iterations,
                stoppedBy: interrupted ? "signal" : summary.stoppedBy,
                lastExitCode: lastExit,
                elapsed,
              },
              null,
              2,
            ),
          );
        } else {
          const why = interrupted ? "interrupted" : summary.stoppedBy;
          logger.log(
            chalk.cyan(
              `\n✔ loop ended — ${summary.iterations} iteration(s), stopped by ${chalk.bold(
                why,
              )} ${chalk.gray(`(${elapsed})`)}`,
            ),
          );
        }

        // Exit code mirrors the last iteration when we stopped on a condition;
        // an interrupt is a clean stop (0).
        if (!interrupted && lastExit != null) process.exitCode = lastExit;
      } catch (err) {
        logger.error(chalk.red(`loop failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
