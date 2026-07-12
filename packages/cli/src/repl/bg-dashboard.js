/**
 * Background-agent dashboard — the interactive agent view behind
 * `cc daemon view` (no id). Claude-Code `claude agents` parity: one live panel
 * over every background session with grouping (Needs input / Working / Idle /
 * Completed / Failed / Stopped), peek + reply, attach hand-off, stop, rename,
 * pin, filter, and new-task dispatch. Phase→group classification is the shared
 * `background-agent-phase.js` contract, so `idle` (parked, nothing blocking)
 * is kept distinct from a genuine `needs-input` (a human decision blocks it).
 *
 * Design:
 * - Pure model/render layer (`groupKey`, `buildDashboardModel`,
 *   `renderDashboard`) — deterministic, unit-tested with injected `now`.
 * - `runBgDashboard(deps)` controller — every effect (list/stop/rename/pin/
 *   attach/dispatch/log/prompt IO) is an injected dep so tests drive it with
 *   fakes; the command layer wires the real supervisor.
 * - Raw ANSI on the alternate screen buffer (no TUI framework dependency);
 *   line-input actions (reply/rename/dispatch) temporarily leave the alt
 *   screen for a plain readline prompt, then re-enter.
 */

import chalk from "chalk";
import { phaseGroupKey } from "../lib/background-agent-phase.js";

export const GROUP_ORDER = [
  "needs-input",
  "working",
  "idle",
  "completed",
  "failed",
  "stopped",
];

export const GROUP_TITLES = {
  "needs-input": "Needs input",
  working: "Working",
  idle: "Idle",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * Group a session into a dashboard bucket. Delegates to the shared
 * `background-agent-phase.js` contract so the worker/supervisor and this panel
 * agree on phase semantics: running + pending approval / blocking phase →
 * "needs-input"; running + idle (parked, nothing blocking) → "idle"; running +
 * working/turn/starting → "working"; lost/unknown → "failed".
 */
export function groupKey(session) {
  return phaseGroupKey(session);
}

function formatAge(ms) {
  const n = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? `${m % 60}m` : ""}`;
}

export const FILTERS = ["all", "active", "needs-input"];

function passesFilter(session, filter) {
  if (filter === "active") return session.status === "running";
  if (filter === "needs-input") return groupKey(session) === "needs-input";
  return true;
}

/**
 * Build the render model: grouped rows (pinned first inside each group,
 * then newest first) plus a flat selection list in display order.
 */
export function buildDashboardModel(sessions, options = {}) {
  const filter = options.filter || "all";
  const now = typeof options.now === "number" ? options.now : Date.now();
  const byGroup = new Map(GROUP_ORDER.map((k) => [k, []]));
  for (const s of sessions || []) {
    if (!s || !passesFilter(s, filter)) continue;
    byGroup.get(groupKey(s))?.push(s);
  }
  for (const list of byGroup.values()) {
    list.sort(
      (a, b) =>
        (b.pinned === true) - (a.pinned === true) ||
        (b.startedAt || 0) - (a.startedAt || 0),
    );
  }
  const groups = GROUP_ORDER.map((key) => ({
    key,
    title: GROUP_TITLES[key],
    rows: byGroup.get(key) || [],
  })).filter((g) => g.rows.length > 0);
  const flat = groups.flatMap((g) => g.rows);
  return { groups, flat, filter, now };
}

function rowLine(session, { selected, now }) {
  const elapsed = session.endedAt
    ? session.endedAt - session.startedAt
    : now - session.startedAt;
  const pin = session.pinned ? chalk.yellow("★ ") : "  ";
  const marker = selected ? chalk.cyan("❯ ") : "  ";
  const id = String(session.id || "").padEnd(24);
  const title = session.title ? ` ${session.title}` : "";
  const pr = session.pr?.number
    ? chalk.magenta(
        `  #${session.pr.number}${session.pr.state ? ` ${session.pr.state}` : ""}`,
      )
    : "";
  const approvals = Number(session.pendingApprovals)
    ? chalk.yellow(`  ⏳${session.pendingApprovals}`)
    : "";
  const ws = session.worktree || session.cwd || "";
  const line = `${marker}${pin}${id} ${formatAge(elapsed).padStart(5)}  ${chalk.gray(ws)}${title}${pr}${approvals}`;
  return selected ? chalk.bold(line) : line;
}

/**
 * Render the dashboard to a string (no cursor positioning — the controller
 * clears and repaints the alt screen).
 */
export function renderDashboard(model, options = {}) {
  const selectedIndex = options.selectedIndex ?? 0;
  const lines = [];
  const total = model.flat.length;
  lines.push(
    chalk.bold("  Background agents") +
      chalk.gray(
        `  ${total} shown · filter: ${model.filter}` +
          (options.message ? `  — ${options.message}` : ""),
      ),
  );
  lines.push("");
  if (total === 0) {
    lines.push(chalk.gray("  No background agents match this filter."));
    lines.push(
      chalk.gray('  Press "d" to dispatch a new background task, "q" to quit.'),
    );
  }
  let index = 0;
  for (const group of model.groups) {
    lines.push(chalk.bold(`  ${group.title} (${group.rows.length})`));
    for (const session of group.rows) {
      lines.push(
        rowLine(session, { selected: index === selectedIndex, now: model.now }),
      );
      index++;
    }
    lines.push("");
  }
  if (options.peek) {
    lines.push(chalk.bold(`  Peek: ${options.peek.id}`));
    const text = (options.peek.log || "").trimEnd();
    for (const l of text ? text.split("\n").slice(-15) : ["(no output)"]) {
      lines.push(chalk.gray(`  │ ${l}`));
    }
    lines.push("");
  }
  lines.push(
    chalk.gray(
      "  ↑/↓ select · enter peek · r reply · a attach · s stop · n rename · x pin · d dispatch · f filter · q quit",
    ),
  );
  return lines.join("\n");
}

const ESC = "\x1b";
const ALT_ENTER = `${ESC}[?1049h${ESC}[?25l`;
const ALT_EXIT = `${ESC}[?25h${ESC}[?1049l`;
const CLEAR = `${ESC}[2J${ESC}[H`;

/** Default terminal IO — swapped for a fake in tests. */
export function defaultDashboardIo() {
  return {
    isTTY: Boolean(process.stdout.isTTY && process.stdin.isTTY),
    write: (s) => process.stdout.write(s),
    enterAlt: () => process.stdout.write(ALT_ENTER),
    exitAlt: () => process.stdout.write(ALT_EXIT),
    clear: () => process.stdout.write(CLEAR),
    setRaw: (on) => {
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(on);
      }
    },
    async listenKeys(onKey) {
      const readline = await import("node:readline");
      readline.emitKeypressEvents(process.stdin);
      process.stdin.resume();
      const handler = (str, key) => onKey(str, key || {});
      process.stdin.on("keypress", handler);
      return () => process.stdin.off("keypress", handler);
    },
    async promptLine(question) {
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        return await new Promise((resolve) => rl.question(question, resolve));
      } finally {
        rl.close();
      }
    },
  };
}

/**
 * Interactive dashboard loop. All effects come from deps:
 *   listAgents() → session[]           readLog(id, lines) → string
 *   stopAgent(id)                      renameAgent(id, title)
 *   pinAgent(id, pinned)               replyAgent(session, text)
 *   attachAgent(session)               dispatchAgent(text)
 *   io — see defaultDashboardIo()      refreshMs, now — timing seams
 */
export async function runBgDashboard(deps = {}) {
  const io = deps.io || defaultDashboardIo();
  const now = deps.now || (() => Date.now());
  const refreshMs = deps.refreshMs ?? 2000;
  const listAgents = deps.listAgents || (() => []);

  let selected = 0;
  let filterIndex = 0;
  let peek = null;
  let message = "";
  let model = buildDashboardModel(listAgents(), {
    filter: FILTERS[filterIndex],
    now: now(),
  });

  const render = () => {
    model = buildDashboardModel(listAgents(), {
      filter: FILTERS[filterIndex],
      now: now(),
    });
    if (selected >= model.flat.length)
      selected = Math.max(0, model.flat.length - 1);
    if (peek && !model.flat.some((s) => s.id === peek.id)) peek = null;
    io.clear();
    io.write(
      renderDashboard(model, { selectedIndex: selected, peek, message }) + "\n",
    );
  };

  const selectedSession = () => model.flat[selected] || null;

  // Line-input actions leave the alt screen so readline behaves normally.
  const promptOutside = async (question) => {
    io.setRaw(false);
    io.exitAlt();
    try {
      return await io.promptLine(question);
    } finally {
      io.enterAlt();
      io.setRaw(true);
    }
  };

  io.enterAlt();
  io.setRaw(true);
  const timer = setInterval(render, refreshMs);
  timer.unref?.();
  render();

  let stopListening = () => {};
  await new Promise((resolve) => {
    const finish = () => resolve();
    const onKey = async (str, key) => {
      const name = key?.name || str;
      const ctrlC = key?.ctrl && key.name === "c";
      message = "";
      try {
        if (ctrlC || name === "q") return finish();
        if (name === "down" || name === "j") {
          selected = Math.min(model.flat.length - 1, selected + 1);
        } else if (name === "up" || name === "k") {
          selected = Math.max(0, selected - 1);
        } else if (name === "return" || name === "p") {
          const s = selectedSession();
          peek =
            s && peek?.id !== s.id
              ? { id: s.id, log: deps.readLog ? deps.readLog(s.id, 15) : "" }
              : null;
        } else if (name === "f") {
          filterIndex = (filterIndex + 1) % FILTERS.length;
          selected = 0;
        } else if (name === "x") {
          const s = selectedSession();
          if (s && deps.pinAgent) {
            deps.pinAgent(s.id, s.pinned !== true);
            message = s.pinned ? `unpinned ${s.id}` : `pinned ${s.id}`;
          }
        } else if (name === "s") {
          const s = selectedSession();
          if (s && deps.stopAgent) {
            deps.stopAgent(s.id);
            message = `stopped ${s.id}`;
          }
        } else if (name === "n") {
          const s = selectedSession();
          if (s && deps.renameAgent) {
            const title = await promptOutside(`New title for ${s.id}: `);
            if (title && title.trim()) {
              deps.renameAgent(s.id, title.trim());
              message = `renamed ${s.id}`;
            }
          }
        } else if (name === "r") {
          const s = selectedSession();
          if (s && deps.replyAgent) {
            const text = await promptOutside(`Reply to ${s.id}: `);
            if (text && text.trim()) {
              await deps.replyAgent(s, text.trim());
              message = `sent to ${s.id}`;
            }
          }
        } else if (name === "d") {
          if (deps.dispatchAgent) {
            const text = await promptOutside("New background task: ");
            if (text && text.trim()) {
              const id = await deps.dispatchAgent(text.trim());
              message = id ? `dispatched ${id}` : "dispatched";
            }
          }
        } else if (name === "a") {
          const s = selectedSession();
          if (s && deps.attachAgent) {
            // Hand the terminal over to attach, then come back.
            io.setRaw(false);
            io.exitAlt();
            stopListening();
            try {
              await deps.attachAgent(s);
            } finally {
              io.enterAlt();
              io.setRaw(true);
              stopListening = (await io.listenKeys(onKey)) || (() => {});
            }
          }
        }
      } catch (err) {
        message = `error: ${err.message}`;
      }
      render();
    };
    io.listenKeys(onKey).then((stop) => {
      stopListening = stop || (() => {});
    });
  });

  clearInterval(timer);
  stopListening();
  io.setRaw(false);
  io.exitAlt();
}
