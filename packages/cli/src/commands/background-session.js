import { existsSync, readFileSync } from "node:fs";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { readPrLinkLedger } from "../lib/pr-link-ledger.js";
import executionBroker from "../lib/process-execution-broker/index.js";

function formatAge(ms) {
  const n = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m < 60) return `${m}m${s ? ` ${s}s` : ""}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h}h${rest ? ` ${rest}m` : ""}`;
}

export function formatBackgroundAgentLine(session, now = Date.now()) {
  const elapsed = session?.endedAt
    ? session.endedAt - session.startedAt
    : now - session.startedAt;
  const title = session?.title ? `  ${session.title}` : "";
  return `${session.id}  ${String(session.status || "?").padEnd(9)} ${formatAge(elapsed).padStart(6)}  ${session.cwd || ""}${title}`;
}

function printBackgroundAgents(sessions, { now = Date.now() } = {}) {
  if (!sessions.length) {
    logger.log(chalk.gray("No background agents."));
    return;
  }
  for (const session of sessions) {
    logger.log(formatBackgroundAgentLine(session, now));
    if (session.pid || session.sessionId) {
      logger.log(
        chalk.gray(
          `  pid ${session.pid || "?"}${session.sessionId ? `  session ${session.sessionId}` : ""}`,
        ),
      );
    }
  }
}

function formatTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : "-";
}

export function formatBackgroundAgentDetails(
  session,
  logText = "",
  options = {},
) {
  const now = typeof options.now === "number" ? options.now : Date.now();
  const elapsed = session?.endedAt
    ? session.endedAt - session.startedAt
    : now - session.startedAt;
  const lines = [
    `Background agent ${session.id}`,
    `  status: ${session.status || "?"}`,
    `  title: ${session.title || "-"}`,
    `  cwd: ${session.cwd || "-"}`,
    `  pid: ${session.pid || "-"}`,
    `  workerPid: ${session.workerPid || "-"}`,
    `  agentPid: ${session.agentPid || "-"}`,
    `  session: ${session.sessionId || "-"}`,
    `  elapsed: ${formatAge(elapsed)}`,
    `  startedAt: ${formatTimestamp(session.startedAt)}`,
    `  endedAt: ${formatTimestamp(session.endedAt)}`,
    `  log: ${session.logFile || "-"}`,
  ];
  if (session.worktreePath) {
    lines.push(`  worktree: ${session.worktreePath}`);
    lines.push(`  repoRoot: ${session.repoRoot || "-"}`);
    lines.push(`  branch: ${session.branch || "-"}`);
    lines.push(`  baseSha: ${session.baseSha || "-"}`);
  }
  if (session.phase) lines.push(`  phase: ${session.phase}`);
  if (session.pr?.number) {
    lines.push(
      `  pr: #${session.pr.number}${session.pr.state ? ` ${session.pr.state}` : ""}${session.pr.url ? `  ${session.pr.url}` : ""}`,
    );
  }
  if (Number.isFinite(Number(session.turnCount))) {
    lines.push(`  turns: ${session.turnCount}`);
  }
  if (session.transport?.pipe) {
    lines.push(`  transport: interactive attach available`);
  }
  if (session.lostReason) lines.push(`  lostReason: ${session.lostReason}`);
  if (Number.isFinite(Number(session.exitCode))) {
    lines.push(`  exitCode: ${session.exitCode}`);
  }
  lines.push("", "Recent output:");
  lines.push(logText ? logText.trimEnd() : "  (no log output)");
  lines.push("", "Commands:");
  lines.push(`  cc attach ${session.id}`);
  lines.push(`  cc logs ${session.id} -n 100`);
  if (session.status === "running") {
    lines.push(`  cc daemon stop ${session.id}`);
  }
  return lines.join("\n");
}

function parseLines(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function loadSupervisor() {
  return import("../lib/background-agent-supervisor.js");
}

export const LOG_TRUNCATION_NOTICE =
  "--- log truncated/rotated, resuming from tail ---";
const TRUNCATION_RESUME_TAIL_BYTES = 4096;

export function readLogFromOffset(file, offset) {
  if (!existsSync(file)) return { text: "", offset };
  const text = readFileSync(file, "utf8");
  if (offset > text.length) {
    // Gap 3: the log shrank under us (rotation/truncation). Resetting the
    // offset to 0 used to REPLAY the entire new file into the follow stream;
    // resume from the current tail instead, with an explicit marker.
    const from = Math.max(0, text.length - TRUNCATION_RESUME_TAIL_BYTES);
    return {
      text: `\n${LOG_TRUNCATION_NOTICE}\n${text.slice(from)}`,
      offset: text.length,
      truncated: true,
    };
  }
  return { text: text.slice(offset), offset: text.length };
}

async function followBackgroundAgent(id, options = {}) {
  const {
    readBackgroundAgentState,
    effectiveBackgroundAgentState,
    readBackgroundAgentLog,
    logPath,
  } = await loadSupervisor();
  const lines = parseLines(options.lines, 100);
  let state = effectiveBackgroundAgentState(readBackgroundAgentState(id));
  if (!state) throw new Error(`Background agent not found: ${id}`);
  const logFile = logPath(id);
  const initial = readBackgroundAgentLog(id, { lines });
  if (initial)
    process.stdout.write(initial.endsWith("\n") ? initial : `${initial}\n`);
  let offset = existsSync(logFile) ? readFileSync(logFile, "utf8").length : 0;

  if (options.follow === false || state.status !== "running") {
    return state;
  }

  logger.log(chalk.gray(`Attached to ${id}. Streaming logs; Ctrl-C detaches.`));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const next = readLogFromOffset(logFile, offset);
    offset = next.offset;
    if (next.text) process.stdout.write(next.text);
    state = effectiveBackgroundAgentState(readBackgroundAgentState(id));
    if (!state || state.status !== "running") {
      if (state) {
        logger.log(chalk.gray(`\n${id} is ${state.status}.`));
      }
      return state;
    }
  }
}

/**
 * Interactive attach over the session transport: stream the log AND accept
 * typed follow-up prompts (plus /stop · /status · /detach). Returns false
 * when the transport is unavailable so the caller can fall back to the
 * log-only follow.
 */
export async function interactiveAttach(id, state, options = {}) {
  const { connectBackgroundSession } =
    await import("../lib/background-session-transport.js");
  const { readBackgroundAgentLog, logPath } = await loadSupervisor();

  let closed = false;
  let conn;
  try {
    conn = await connectBackgroundSession({
      pipePath: state.transport.pipe,
      token: state.transport.token,
      onEvent: (message) => {
        switch (message.type) {
          case "turn-started":
            logger.log(
              chalk.gray(
                `— turn ${message.turn} started${message.prompt ? `: ${message.prompt}` : ""}`,
              ),
            );
            return;
          case "turn-ended":
            logger.log(
              chalk.gray(
                `— turn ${message.turn} ended (exit ${message.exitCode})`,
              ),
            );
            return;
          case "idle":
            logger.log(
              chalk.gray(
                "— session idle; type a follow-up prompt, or Ctrl-C to detach (ends the session)",
              ),
            );
            return;
          case "accepted":
            logger.log(chalk.gray(`— prompt queued (#${message.queued})`));
            return;
          case "status":
            logger.log(
              chalk.gray(
                `— ${message.id} phase=${message.phase} turn=${message.turn}`,
              ),
            );
            return;
          case "stopping":
            logger.log(chalk.gray("— stopping current turn"));
            return;
          case "closing":
            return; // close handler prints the final state
          case "error":
            logger.log(chalk.yellow(`— ${message.message}`));
            return;
          case "interaction_request": {
            // P0-2: Human-in-the-loop interaction request from the agent
            const {
              intId,
              prompt,
              hint,
              options: opts,
              multiSelect,
              timeoutMs,
            } = message;
            logger.log("");
            logger.log(chalk.cyan.bold("? Agent asks for your input:"));
            logger.log(chalk.white(`  ${prompt}`));
            if (hint) logger.log(chalk.gray(`  (${hint})`));
            if (timeoutMs)
              logger.log(
                chalk.gray(`  (timeout: ${Math.round(timeoutMs / 1000)}s)`),
              );
            let promptText = "  Your answer";
            if (opts && Array.isArray(opts) && opts.length > 0) {
              logger.log("");
              opts.forEach((opt, idx) => {
                const label =
                  typeof opt === "string" ? opt : opt.label || String(opt);
                const desc =
                  typeof opt === "object" && opt.description
                    ? ` - ${opt.description}`
                    : "";
                logger.log(chalk.white(`    ${idx + 1}) ${label}${desc}`));
              });
              promptText = multiSelect
                ? "  Enter number(s) (comma-separated)"
                : "  Enter a number";
            }
            if (multiSelect)
              logger.log(chalk.gray("  (multiple selections allowed)"));
            // Pause the log stream and prompt the user via readline
            rl.question(chalk.cyan(`${promptText}: `), (raw) => {
              const answer = raw.trim();
              let resolved = answer;
              if (opts && Array.isArray(opts) && opts.length > 0) {
                // Parse numeric selection
                const nums = answer
                  .split(",")
                  .map((s) => parseInt(s.trim(), 10))
                  .filter((n) => n >= 1 && n <= opts.length);
                if (nums.length === 0) {
                  logger.log(
                    chalk.yellow("  Invalid selection, sending raw text"),
                  );
                } else if (multiSelect) {
                  resolved = nums.map((n) => opts[n - 1]);
                } else {
                  resolved = opts[nums[0] - 1];
                }
                // Normalize to value if object option
                if (multiSelect) {
                  resolved = resolved.map((o) =>
                    typeof o === "object" && o.value !== undefined
                      ? o.value
                      : o,
                  );
                } else if (
                  typeof resolved === "object" &&
                  resolved.value !== undefined
                ) {
                  resolved = resolved.value;
                }
              }
              conn.send({
                type: "interaction_response",
                intId,
                answer: resolved,
              });
              logger.log(chalk.gray("— response sent to agent"));
            });
            return;
          }
          default:
            return;
        }
      },
      onClose: () => {
        closed = true;
      },
    });
  } catch {
    return false; // transport gone (worker finalizing/finalized) — fall back
  }

  const lines = parseLines(options.lines, 100);
  const initial = readBackgroundAgentLog(id, { lines });
  if (initial)
    process.stdout.write(initial.endsWith("\n") ? initial : `${initial}\n`);
  const logFile = logPath(id);
  let offset = existsSync(logFile) ? readFileSync(logFile, "utf8").length : 0;
  logger.log(
    chalk.gray(
      `Attached to ${id} (interactive). Type a prompt to continue the session; /stop · /status · Ctrl-C detaches.`,
    ),
  );

  // P0-2: If the agent is already waiting for human input (e.g. the question
  // was issued before this client attached, or a previous client detached
  // without answering), re-prompt immediately.
  const preExistingQuestion =
    state.status === "awaiting-input" && state.pendingQuestion
      ? { ...state.pendingQuestion }
      : null;

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    if (text === "/detach" || text === "/exit" || text === "/quit") {
      rl.close();
      return;
    }
    if (text === "/stop") {
      conn.send({ type: "stop" });
      return;
    }
    if (text === "/status") {
      conn.send({ type: "status" });
      return;
    }
    conn.send({ type: "prompt", text });
  });
  const detach = () => rl.close();
  rl.on("SIGINT", detach);

  if (preExistingQuestion) {
    setImmediate(() => {
      conn.onEvent?.({
        type: "interaction_request",
        intId: preExistingQuestion.intId,
        prompt: preExistingQuestion.prompt,
        hint: preExistingQuestion.hint,
        options: preExistingQuestion.options,
        multiSelect: preExistingQuestion.multiSelect,
        timeoutMs: preExistingQuestion.timeoutMs,
        _deferred: true,
      });
    });
  }

  await new Promise((resolve) => {
    rl.on("close", resolve);
    const poll = setInterval(() => {
      const next = readLogFromOffset(logFile, offset);
      offset = next.offset;
      if (next.text) process.stdout.write(next.text);
      if (closed) {
        clearInterval(poll);
        rl.close();
      }
    }, 500);
    poll.unref?.();
    rl.on("close", () => clearInterval(poll));
  });

  // Drain any output written between the last poll and detach.
  const rest = readLogFromOffset(logFile, offset);
  if (rest.text) process.stdout.write(rest.text);
  try {
    conn.close();
  } catch {
    /* already closed by the worker */
  }
  const { readBackgroundAgentState, effectiveBackgroundAgentState } =
    await loadSupervisor();
  const finalState = effectiveBackgroundAgentState(
    readBackgroundAgentState(id),
  );
  if (finalState) logger.log(chalk.gray(`\n${id} is ${finalState.status}.`));
  return true;
}

/**
 * `cc daemon view` (no id) — the interactive agent dashboard. Wires the real
 * supervisor/transport into the injectable controller (repl/bg-dashboard.js).
 * Non-TTY (or --json) degrades to the status listing.
 */
async function runDashboardView(options = {}) {
  const supervisor = await loadSupervisor();
  const {
    listBackgroundAgents,
    readBackgroundAgentLog,
    stopBackgroundAgent,
    renameBackgroundAgent,
    setBackgroundAgentPinned,
    resumeBackgroundAgent,
    readBackgroundAgentState,
    effectiveBackgroundAgentState,
  } = supervisor;

  const listAll = () => {
    const sessions = listBackgroundAgents({ all: true });
    // PR/session linking: decorate rows whose conversation touched a PR
    // (`#123 open`). One ledger read per refresh; best-effort.
    try {
      const ledger = readPrLinkLedger();
      for (const s of sessions) {
        const links = s.sessionId ? ledger[s.sessionId] : null;
        if (Array.isArray(links) && links.length > 0 && !s.pr) {
          s.pr = [...links].sort(
            (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
          )[0];
        }
      }
    } catch {
      /* PR decoration is cosmetic */
    }
    return sessions;
  };

  if (options.json || !process.stdout.isTTY || !process.stdin.isTTY) {
    const sessions = listAll();
    if (options.json) {
      console.log(JSON.stringify({ sessions }, null, 2));
    } else {
      printBackgroundAgents(sessions);
      logger.log(
        chalk.gray("(interactive dashboard needs a TTY — showing a snapshot)"),
      );
    }
    return;
  }

  const { runBgDashboard } = await import("../repl/bg-dashboard.js");
  const { fileURLToPath } = await import("node:url");
  const BIN_PATH = fileURLToPath(
    new URL("../../bin/chainlesschain.js", import.meta.url),
  );

  await runBgDashboard({
    listAgents: listAll,
    readLog: (id, lines) => {
      try {
        return readBackgroundAgentLog(id, { lines });
      } catch {
        return "";
      }
    },
    stopAgent: (id) => stopBackgroundAgent(id),
    renameAgent: (id, title) => renameBackgroundAgent(id, title),
    pinAgent: (id, pinned) => setBackgroundAgentPinned(id, pinned),
    replyAgent: async (session, text) => {
      // Running with a live transport → queue a follow-up turn; otherwise
      // continue the finished conversation as a new background session.
      if (
        session.status === "running" &&
        session.transport?.pipe &&
        session.transport?.token
      ) {
        const { connectBackgroundSession } =
          await import("../lib/background-session-transport.js");
        const conn = await connectBackgroundSession({
          pipePath: session.transport.pipe,
          token: session.transport.token,
          onEvent: () => {},
          onClose: () => {},
        });
        try {
          conn.send({ type: "prompt", text });
          // give the frame a beat to flush before closing
          await new Promise((r) => setTimeout(r, 150));
        } finally {
          try {
            conn.close();
          } catch {
            /* worker already closed it */
          }
        }
        return;
      }
      resumeBackgroundAgent(session.id, text);
    },
    attachAgent: async (session) => {
      const fresh = effectiveBackgroundAgentState(
        readBackgroundAgentState(session.id),
      );
      if (!fresh) return;
      if (
        fresh.status === "running" &&
        fresh.transport?.pipe &&
        fresh.transport?.token
      ) {
        const attached = await interactiveAttach(session.id, fresh, {});
        if (attached) return;
      }
      await followBackgroundAgent(session.id, { lines: 40 });
    },
    dispatchAgent: async (text) => {
      const child = executionBroker.spawn(
        process.execPath,
        [BIN_PATH, "agent", "--bg", "-p", text],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          origin: "background-session:dispatch",
          policy: "allow",
          scope: "background-session",
          shell: false,
        },
      );
      child.unref();
      return null; // id is minted by the launcher; the next refresh shows it
    },
  });
}

export function registerBackgroundSessionCommands(program) {
  program
    .command("logs <id>")
    .description("Print recent output from a background agent")
    .option("-n, --lines <n>", "Number of lines", "100")
    .action(async (id, options) => {
      try {
        const { readBackgroundAgentState, readBackgroundAgentLog } =
          await loadSupervisor();
        if (!readBackgroundAgentState(id)) {
          throw new Error(`Background agent not found: ${id}`);
        }
        process.stdout.write(
          readBackgroundAgentLog(id, { lines: parseLines(options.lines, 100) }),
        );
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  program
    .command("attach <id>")
    .description(
      "Attach to a background agent — interactive when its session transport is available, log stream otherwise",
    )
    .option("-n, --lines <n>", "Initial lines to print", "100")
    .option("--no-follow", "Print the initial log tail and exit")
    .option("--no-input", "Log stream only; never send prompts")
    .action(async (id, options) => {
      try {
        const { readBackgroundAgentState, effectiveBackgroundAgentState } =
          await loadSupervisor();
        const state = effectiveBackgroundAgentState(
          readBackgroundAgentState(id),
        );
        if (!state) throw new Error(`Background agent not found: ${id}`);
        const wantsInteractive =
          options.input !== false &&
          options.follow !== false &&
          state.status === "running" &&
          state.transport?.pipe &&
          state.transport?.token &&
          process.stdin.isTTY;
        if (wantsInteractive) {
          const attached = await interactiveAttach(id, state, options);
          if (attached) return;
          // transport refused (worker mid-finalize) — fall back to logs
        }
        await followBackgroundAgent(id, options);
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  const daemon = program
    .command("daemon")
    .description("Inspect and stop background agent supervisor sessions");

  daemon
    .command("status")
    .description("Show background agent supervisor status")
    .option("--all", "Include completed, failed, stopped and lost sessions")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { backgroundAgentsDir, listBackgroundAgents } =
          await loadSupervisor();
        const sessions = listBackgroundAgents({ all: options.all === true });
        const running = sessions.filter((s) => s.status === "running").length;
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                supervisor: "background-agents",
                dir: backgroundAgentsDir(),
                running,
                total: sessions.length,
                sessions,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.log(
          `${chalk.bold("Background agent supervisor")}  ${running} running  ${sessions.length} shown`,
        );
        logger.log(chalk.gray(`  dir ${backgroundAgentsDir()}`));
        printBackgroundAgents(sessions);
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  daemon
    .command("view [id]")
    .description(
      "Detailed view of one background agent, or the interactive agent dashboard when no id is given",
    )
    .option("-n, --lines <n>", "Recent log lines to include", "40")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        if (!id) {
          await runDashboardView(options);
          return;
        }
        const {
          readBackgroundAgentState,
          effectiveBackgroundAgentState,
          readBackgroundAgentLog,
        } = await loadSupervisor();
        const session = effectiveBackgroundAgentState(
          readBackgroundAgentState(id),
        );
        if (!session) throw new Error(`Background agent not found: ${id}`);
        const lines = parseLines(options.lines, 40);
        const log = readBackgroundAgentLog(id, { lines });
        if (options.json) {
          console.log(JSON.stringify({ session, log }, null, 2));
          return;
        }
        logger.log(formatBackgroundAgentDetails(session, log));
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  daemon
    .command("rename <id> <title...>")
    .description("Rename a background agent session")
    .option("--json", "Output as JSON")
    .action(async (id, title, options) => {
      try {
        const { renameBackgroundAgent } = await loadSupervisor();
        const state = renameBackgroundAgent(
          id,
          Array.isArray(title) ? title.join(" ") : title,
        );
        if (options.json) {
          console.log(JSON.stringify(state, null, 2));
          return;
        }
        logger.log(chalk.green(`Renamed background agent ${state.id}`));
        logger.log(chalk.gray(`  ${state.title}`));
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  daemon
    .command("resume <id> <prompt...>")
    .description(
      "Continue a finished/crashed background session as a new background run on the same conversation",
    )
    .option("--json", "Output as JSON")
    .action(async (id, prompt, options) => {
      try {
        const { resumeBackgroundAgent } = await loadSupervisor();
        const state = resumeBackgroundAgent(
          id,
          Array.isArray(prompt) ? prompt.join(" ") : prompt,
        );
        if (options.json) {
          console.log(JSON.stringify(state, null, 2));
          return;
        }
        logger.log(
          chalk.green(`Resumed session as background agent ${state.id}`),
        );
        logger.log(chalk.gray(`  session ${state.sessionId}`));
        logger.log(chalk.gray(`  attach: cc attach ${state.id}`));
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  // daemon rm — record cleanup (gap-analysis 2026-07-11 P0 后台 Supervisor).
  daemon
    .command("rm <id>")
    .description(
      "Remove a finished background agent's record + log (a bound worktree is removed only when verified empty; the conversation session itself is untouched)",
    )
    .option("--force", "Stop a still-running agent first, then remove")
    .option("--keep-log", "Keep the log file, remove only the state record")
    .option(
      "--keep-worktree",
      "Keep the isolated worktree and remove only the background record",
    )
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { removeBackgroundAgent } = await loadSupervisor();
        const result = removeBackgroundAgent(id, {
          force: options.force === true,
          keepLog: options.keepLog === true,
          keepWorktree: options.keepWorktree === true,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        logger.log(
          chalk.green(`Removed background agent ${result.id}`) +
            chalk.gray(` (was ${result.status})`),
        );
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  daemon
    .command("stop [id]")
    .description("Stop one background agent, or all running agents with --any")
    .option("--any", "Stop all running background agents")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { listBackgroundAgents, stopBackgroundAgent } =
          await loadSupervisor();
        if (!id && options.any !== true) {
          throw new Error("daemon stop requires <id> or --any");
        }
        const targets = options.any
          ? listBackgroundAgents().map((s) => s.id)
          : [id];
        const results = [];
        for (const target of targets) {
          results.push(stopBackgroundAgent(target));
        }
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }
        if (results.length === 0) {
          logger.log(chalk.gray("No running background agents."));
          return;
        }
        for (const result of results) {
          if (result.stopped) {
            logger.log(chalk.green(`Stopped background agent ${result.id}`));
          } else {
            logger.log(chalk.gray(`${result.id} is already ${result.status}`));
          }
        }
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });
}
