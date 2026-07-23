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
 *   cc loop --save ci-watch --every 1m -- npm test      # persist a resumable loop
 *   cc loop --resume ci-watch --max-iterations 20       # continue it (cumulative)
 *
 * Two modes, disambiguated by the literal `--` separator:
 *   - no `--`  → the single operand is a PROMPT, run via `cc agent -p <prompt>`
 *   - with `--` → the operands after it are an EXTERNAL command (shell-resolved)
 *
 * The loop driver lives in src/lib/loop.js (pure, clock-injected). This layer
 * only builds the concrete iteration (spawn + tee output) and wires SIGINT.
 */

import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import executionBroker from "../lib/process-execution-broker/index.js";
import {
  runLoop,
  parseDuration,
  formatDuration,
  makeSleep,
  parseLoopDirectives,
  summarizeLoopEvents,
} from "../lib/loop.js";
import {
  startSession,
  appendEvent,
  readEvents,
  sessionExists,
} from "../harness/jsonl-session-store.js";

export const _deps = {
  spawn: executionBroker.spawn.bind(executionBroker),
};

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
    const child = _deps.spawn(cmd, args, {
      shell,
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
      env: process.env,
      origin: "loop:iteration",
      policy: "allow",
      scope: "loop",
    });
    if (onChild) onChild(child);

    const outChunks = [];
    if (capture) {
      child.stdout?.on("data", (d) => {
        outChunks.push(d);
        process.stdout.write(d);
      });
      child.stderr?.on("data", (d) => {
        outChunks.push(d);
        process.stderr.write(d);
      });
    }

    // `close` (not `exit`) so piped stdio is fully drained before we resolve.
    child.on("close", (code, signal) => {
      // Decode the captured bytes once, at the end. Accumulating with
      // `output += chunk` would decode each stdout chunk independently, so a
      // multi-byte UTF-8 character split across a chunk boundary corrupts the
      // captured string that `--until <regex>` / `--dynamic` directive parsing
      // reads. (The raw passthrough writes above are unaffected.)
      const output = Buffer.concat(outChunks).toString("utf-8");
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

/**
 * Build the concrete child invocation from the resolved operands + mode.
 * Shared by fresh runs and `--resume` (which reconstructs it from saved config).
 *   exec mode  → shell-run the joined operands (resolves Windows .cmd shims).
 *   prompt mode → `cc agent -p <prompt>` with operands up to the first flag as
 *                 the prompt and the rest forwarded verbatim to `cc agent`.
 * Returns { cmd, args, shell, label }.
 */
function buildInvocation({ operands, execMode, dynamic }) {
  if (execMode) {
    const cmd = operands.join(" ");
    return { cmd, args: [], shell: true, label: cmd };
  }
  const flagIdx = operands.findIndex((p) => p.startsWith("-"));
  const promptParts = flagIdx === -1 ? operands : operands.slice(0, flagIdx);
  const agentFlags = flagIdx === -1 ? [] : operands.slice(flagIdx);
  let prompt = promptParts.join(" ");
  if (dynamic) prompt += DYNAMIC_PROMPT_SUFFIX;
  const label =
    `cc agent -p ${chalk.italic(promptParts.join(" "))}` +
    (agentFlags.length ? ` ${chalk.gray(agentFlags.join(" "))}` : "");
  return {
    cmd: process.execPath,
    args: [BIN_PATH, "agent", "-p", prompt, ...agentFlags],
    shell: false,
    label,
  };
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
    .option(
      "--save [id]",
      "Persist this loop to a resumable session (auto-generates an id if omitted)",
    )
    .option("--resume <id>", "Continue a previously --save'd loop session")
    .option("--json", "Print a JSON summary when the loop ends")
    .allowUnknownOption(true) // pass-through flags for the wrapped agent/command
    .action(async (parts, options, command) => {
      try {
        // Was an option explicitly given on the command line (vs a default)?
        // Used so --resume inherits the saved config but still honors flags the
        // user re-passes (e.g. extend --max-iterations).
        const fromCli = (name) =>
          command?.getOptionValueSource?.(name) === "cli";

        // --- resolve session: --resume loads saved config; --save persists ---
        let sessionId = null;
        let persist = false;
        let startIndex = 0;
        let savedConfig = null;
        if (options.resume) {
          if (!sessionExists(options.resume)) {
            logger.error(chalk.red(`no such loop session: ${options.resume}`));
            logger.log(chalk.gray("  list sessions with: cc session list"));
            process.exitCode = 1;
            return;
          }
          const s = summarizeLoopEvents(readEvents(options.resume));
          if (!s.config) {
            logger.error(
              chalk.red(`session ${options.resume} has no loop to resume`),
            );
            process.exitCode = 1;
            return;
          }
          savedConfig = s.config;
          startIndex = s.completedIterations;
          sessionId = options.resume;
          persist = true;
        }

        // --- resolve mode / operands (saved config wins on resume) ---
        let execMode;
        let operands;
        let dynamic;
        if (savedConfig) {
          execMode = Boolean(savedConfig.execMode);
          operands = savedConfig.operands || [];
          dynamic = fromCli("dynamic")
            ? Boolean(options.dynamic)
            : Boolean(savedConfig.dynamic);
        } else {
          // `--` is the unambiguous signal for external-command mode. Commander
          // folds the post-`--` operands into `parts`, so we sniff the parsed
          // argv for the literal separator. `rawArgs` is what Commander actually
          // parsed (process.argv in prod, the explicit array under test).
          const argv = command?.parent?.rawArgs || process.argv;
          execMode = argv.includes("--");
          operands = (parts || []).filter((p) => p !== "--");
          dynamic = Boolean(options.dynamic);
        }

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

        // --- resolve interval (CLI overrides saved on resume) ---
        const everyRaw =
          savedConfig && !fromCli("every") ? savedConfig.every : options.every;
        let intervalMs;
        try {
          intervalMs = parseDuration(everyRaw);
        } catch (e) {
          logger.error(chalk.red(e.message));
          process.exitCode = 1;
          return;
        }

        // --- resolve stop conditions (CLI overrides saved on resume) ---
        const maxRaw =
          savedConfig && !fromCli("maxIterations")
            ? savedConfig.maxIterations
            : options.maxIterations;
        let maxIterations;
        if (maxRaw != null) {
          maxIterations = Number(maxRaw);
          if (!Number.isInteger(maxIterations) || maxIterations < 1) {
            logger.error(
              chalk.red("--max-iterations must be a positive integer"),
            );
            process.exitCode = 1;
            return;
          }
        }
        const untilRaw =
          savedConfig && !fromCli("until") ? savedConfig.until : options.until;
        let untilRegex = null;
        if (untilRaw) {
          try {
            untilRegex = new RegExp(untilRaw);
          } catch (e) {
            logger.error(chalk.red(`invalid --until regex: ${e.message}`));
            process.exitCode = 1;
            return;
          }
        }
        const untilExitZero =
          savedConfig && !fromCli("untilExitZero")
            ? Boolean(savedConfig.untilExitZero)
            : Boolean(options.untilExitZero);

        // --- build the child invocation (shared with resume) ---
        const { cmd, args, shell, label } = buildInvocation({
          operands,
          execMode,
          dynamic,
        });

        // --- --save creates a fresh session + writes the loop_config once ---
        if (options.save != null && !options.resume) {
          persist = true;
          sessionId = startSession(
            typeof options.save === "string" && options.save
              ? options.save
              : null,
            { title: `loop: ${operands.join(" ")}`.slice(0, 80) },
          );
          appendEvent(sessionId, "loop_config", {
            execMode,
            operands,
            dynamic,
            every: everyRaw,
            maxIterations: maxIterations ?? null,
            untilExitZero,
            until: untilRaw || null,
          });
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
        const capture = Boolean(untilRegex) || dynamic;
        logger.log(
          chalk.cyan(
            `↻ loop: ${label}  ${chalk.gray(
              `(${dynamic ? "dynamic, fallback " : "every "}${formatDuration(
                intervalMs,
              )}${maxIterations ? `, max ${maxIterations}` : ""}${
                startIndex ? `, resuming from ${startIndex}` : ""
              }${persist ? `, session ${sessionId}` : ""})`,
            )}`,
          ),
        );

        const startedAt = Date.now();
        let summary;
        try {
          summary = await runLoop({
            intervalMs,
            maxIterations,
            untilExitZero,
            untilRegex,
            startIndex,
            sleep: makeSleep(controller.signal),
            shouldStop: () => controller.signal.aborted,
            onIteration: (n, res) => {
              const tag =
                res.exitCode === 0
                  ? chalk.green(`exit 0`)
                  : chalk.red(`exit ${res.exitCode}`);
              logger.log(chalk.gray(`  ↳ iteration ${n} done (${tag})`));
              // Persist a compact record per round (no output body — keeps the
              // session small; resume only needs the count + config).
              if (persist) {
                appendEvent(sessionId, "loop_iteration", {
                  n,
                  exitCode: res.exitCode,
                  durationMs: res.durationMs ?? null,
                  done: Boolean(res.done),
                  nextDelayMs: res.nextDelayMs ?? null,
                });
              }
            },
            runIteration: async (n) => {
              logger.log(chalk.gray(`\n▸ iteration ${n} — ${label}`));
              const t0 = Date.now();
              const res = await spawnIteration(cmd, args, {
                shell,
                capture,
                onChild: (c) => {
                  activeChild = c;
                },
              });
              res.durationMs = Date.now() - t0;
              // --dynamic: read the iteration's [[loop:next]] / [[loop:stop]]
              // directive and surface it to runLoop as done / nextDelayMs.
              // Use the RESOLVED `dynamic` (not raw options.dynamic): on
              // `cc loop --resume`, dynamic is rehydrated from saved config while
              // options.dynamic is false — gating on the raw flag would skip
              // directive parsing and the model's [[loop:stop]] would be ignored,
              // running the loop forever.
              if (dynamic) {
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
        const stoppedBy = interrupted ? "signal" : summary.stoppedBy;

        if (persist) {
          appendEvent(sessionId, "loop_end", {
            stoppedBy,
            iterations: summary.iterations,
          });
        }

        if (options.json) {
          logger.log(
            JSON.stringify(
              {
                iterations: summary.iterations,
                stoppedBy,
                lastExitCode: lastExit,
                elapsed,
                ...(persist ? { sessionId } : {}),
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(
            chalk.cyan(
              `\n✔ loop ended — ${summary.iterations} iteration(s), stopped by ${chalk.bold(
                stoppedBy,
              )} ${chalk.gray(`(${elapsed})`)}`,
            ),
          );
          if (persist) {
            logger.log(
              chalk.gray(
                `  session saved — resume with: cc loop --resume ${sessionId}`,
              ),
            );
          }
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
