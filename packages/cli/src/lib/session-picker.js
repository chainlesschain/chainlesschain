/**
 * Interactive "which session to resume?" picker — shared by `cc session resume`
 * and `cc agent --resume/--continue` so both render the same list and apply the
 * same fallbacks (Claude-Code `--resume` parity).
 *
 * Behaviour:
 *  - 0 sessions            → { id: null }   (caller decides how to report)
 *  - non-TTY / single / noPicker → most-recent, no prompt (claude --continue)
 *  - TTY + >1 sessions     → inquirer `select`; Ctrl-C falls back to most-recent
 *
 * All non-determinism (the session list, TTY-ness, the prompt fn) is injectable
 * via `deps` so the deterministic branches are unit-testable without a TTY.
 */

import chalk from "chalk";
import { listRecentSessions } from "./recent-session.js";

/** Render one session row for the picker list. */
export function formatSessionChoice(s) {
  const title = (s.title || "Untitled").slice(0, 50).padEnd(50);
  const msgs = chalk.cyan(`${s.message_count ?? 0} msgs`);
  const when = chalk.gray(s.updated_at || "");
  const store = s._store === "jsonl" ? " " + chalk.yellow("[JSONL]") : "";
  return {
    name: `${title} ${msgs}  ${when}${store}`,
    value: s.id,
    short: String(s.id).slice(0, 12),
  };
}

/**
 * Resolve which recent session to resume.
 *
 * @param {object} ctx              bootstrap() context (db optional)
 * @param {object} [opts]
 * @param {string} [opts.message]   picker prompt
 * @param {boolean} [opts.noPicker] force most-recent, skip the prompt
 * @param {number} [opts.scan]      forwarded to listRecentSessions
 * @param {object} [deps]           { listRecentSessions, isTTY, select }
 * @returns {Promise<{id:string|null, sessions:Array, picked:boolean}>}
 */
export async function pickRecentSession(ctx, opts = {}, deps = {}) {
  const list = deps.listRecentSessions || listRecentSessions;
  const isTTY =
    deps.isTTY !== undefined ? deps.isTTY : Boolean(process.stdin.isTTY);

  const sessions = list(ctx, { scan: opts.scan });
  if (!sessions || sessions.length === 0) {
    return { id: null, sessions: [], picked: false };
  }

  // No interactive prompt possible/wanted → newest wins (claude --continue).
  if (!isTTY || sessions.length === 1 || opts.noPicker) {
    return { id: sessions[0].id, sessions, picked: false };
  }

  const select = deps.select || (await import("@inquirer/prompts")).select;
  try {
    const id = await select({
      message: opts.message || "Resume which session?",
      choices: sessions.map(formatSessionChoice),
    });
    return { id, sessions, picked: true };
  } catch {
    // Ctrl-C / non-interactive environment → fall back to most recent.
    return { id: sessions[0].id, sessions, picked: false };
  }
}
