/**
 * Terminal-context policy core — the pure-logic half of P1-2 (交互终端) of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md.
 *
 * P1-2 asks for an embedded interactive PTY inside an Agent Session: continuous
 * ANSI output, scrollback trimming, search/copy, user takeover, "把选中输出附加
 * 到下一轮", background commands surfacing PID / port / health, and — critically —
 * "Agent 不得把 Terminal 中的敏感输出默认加入模型上下文" (terminal output must NOT
 * enter the model context by default).
 *
 * This module is that policy + text layer, NOT a PTY: it never spawns a shell,
 * allocates a pseudo-terminal, or touches fs / clock / RNG / process. A caller
 * (the real PTY host) feeds captured bytes and a selection intent and reads back
 * what — if anything — is safe to hand the model.
 *
 * Two invariants give it teeth, mirroring the other gap cores:
 *   1. Terminal output fails CLOSED out of the model context: `selectTerminal
 *      ContextForModel` returns null unless the user EXPLICITLY opted this turn's
 *      output in. Ambient scrollback never leaks into a prompt.
 *   2. Whatever DOES get opted in is ANSI-stripped and secret-redacted (via
 *      [[secret-scan.js]]) and scrollback-capped, so a printed token or a control
 *      sequence can't ride into the context.
 *
 * PURE: no fs / clock / RNG / process / PTY.
 */

import { redactSecrets } from "./secret-scan.js";

/**
 * Match ANSI/VT control sequences: CSI (ESC [ … final byte), OSC (ESC ] … BEL or
 * ST) and the standalone two/three-byte escapes. Kept explicit rather than a
 * dependency so the strip is auditable (ESC = U+001B, CSI = U+009B, BEL = U+0007).
 * A fresh RegExp is compiled per call to avoid the /g lastIndex
 * hazard across invocations.
 */
function ansiRegex() {
  return new RegExp(
    [
      "[\\u001B\\u009B][[\\]()#;?]*" +
        "(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)" +
        "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PRZcf-ntqry=><~]))",
    ].join(""),
    "g",
  );
}

/**
 * Remove ANSI/VT escape sequences from terminal output, leaving human-readable
 * text (for search, copy, and — importantly — before the text ever reaches a
 * model, so escape codes can't smuggle intent or bloat the context). Non-string
 * input → "".
 */
export function stripAnsi(text) {
  if (typeof text !== "string") return "";
  return text.replace(ansiRegex(), "");
}

/** Default scrollback cap — how many trailing lines survive truncation. */
export const DEFAULT_SCROLLBACK_LINES = 400;

/**
 * Cap a captured buffer to its last `maxLines` lines (the live tail is what
 * matters for a running process). Marks the elision so the reader — and any
 * model — knows output was dropped rather than seeing a silently-truncated head.
 *
 * @returns {{text:string, truncated:boolean, droppedLines:number, totalLines:number}}
 */
export function truncateScrollback(text, maxLines = DEFAULT_SCROLLBACK_LINES) {
  const src = typeof text === "string" ? text : "";
  const cap =
    Number.isInteger(maxLines) && maxLines > 0
      ? maxLines
      : DEFAULT_SCROLLBACK_LINES;
  const lines = src.split("\n");
  const total = lines.length;
  if (total <= cap) {
    return { text: src, truncated: false, droppedLines: 0, totalLines: total };
  }
  const kept = lines.slice(total - cap);
  const dropped = total - cap;
  return {
    text: `…(${dropped} earlier lines elided)\n${kept.join("\n")}`,
    truncated: true,
    droppedLines: dropped,
    totalLines: total,
  };
}

/**
 * Decide what terminal output may be attached to the next model turn — the
 * fail-closed core of "Agent 不得把 Terminal 中的敏感输出默认加入模型上下文".
 *
 * Returns `null` (attach NOTHING) unless the user explicitly opted in this turn
 * (`optIn === true`). When opted in, a supplied `selection` (the user's
 * highlighted region) is preferred over the full `output` — "把选中输出附加到下
 * 一轮". Whatever is chosen is ANSI-stripped, secret-redacted and scrollback-
 * capped before it becomes context.
 *
 * @param {object} args
 * @param {string} [args.output]     full captured terminal buffer
 * @param {string} [args.selection]  user-highlighted region (preferred)
 * @param {boolean} [args.optIn]     explicit "include this in context" intent
 * @param {number} [args.maxLines]   scrollback cap for the attached text
 * @returns {null | {source:"selection"|"output", text:string, truncated:boolean, redacted:boolean}}
 */
export function selectTerminalContextForModel(args = {}) {
  const a = args && typeof args === "object" ? args : {};
  if (a.optIn !== true) {
    return null; // fail-closed: no ambient terminal output in the prompt
  }
  const hasSelection =
    typeof a.selection === "string" && a.selection.trim() !== "";
  const source = hasSelection ? "selection" : "output";
  const raw = hasSelection ? a.selection : a.output;
  if (typeof raw !== "string" || raw.trim() === "") {
    return null; // opted in but nothing to attach
  }

  const clean = stripAnsi(raw);
  const redactedText = redactSecrets(clean);
  const capped = truncateScrollback(redactedText, a.maxLines);
  return {
    source,
    text: capped.text,
    truncated: capped.truncated,
    redacted: redactedText !== clean,
  };
}

/** Canonical health states for a backgrounded terminal command. */
export const HEALTH_STATUS = Object.freeze({
  STARTING: "starting",
  RUNNING: "running",
  HEALTHY: "healthy",
  UNHEALTHY: "unhealthy",
  EXITED: "exited",
  UNKNOWN: "unknown",
});

const HEALTH_ALIASES = new Map([
  ["starting", HEALTH_STATUS.STARTING],
  ["running", HEALTH_STATUS.RUNNING],
  ["up", HEALTH_STATUS.RUNNING],
  ["healthy", HEALTH_STATUS.HEALTHY],
  ["ok", HEALTH_STATUS.HEALTHY],
  ["unhealthy", HEALTH_STATUS.UNHEALTHY],
  ["degraded", HEALTH_STATUS.UNHEALTHY],
  ["exited", HEALTH_STATUS.EXITED],
  ["stopped", HEALTH_STATUS.EXITED],
  ["dead", HEALTH_STATUS.EXITED],
]);

/** Normalize a health label; anything unrecognized → UNKNOWN (fail-closed). */
export function normalizeHealthStatus(value) {
  if (typeof value !== "string") return HEALTH_STATUS.UNKNOWN;
  return (
    HEALTH_ALIASES.get(value.trim().toLowerCase()) || HEALTH_STATUS.UNKNOWN
  );
}

function normalizePorts(ports) {
  const list = Array.isArray(ports) ? ports : [];
  const out = [];
  for (const p of list) {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n <= 65535 && !out.includes(n)) {
      out.push(n);
    }
  }
  return out;
}

/**
 * Build a safe descriptor for a backgrounded terminal command — the "后台命令显示
 * PID、端口、健康状态并可安全停止" surface. The command string is secret-redacted
 * (a `FOO=token cmd` invocation must not leak the token into a status pill), PID
 * is coerced to a positive integer or null, ports are validated, and the health
 * status is normalized fail-closed. `stoppable` is true only when we hold a real
 * PID to signal.
 *
 * @param {object} cmd {command?, pid?, ports?, status?}
 * @returns {{command:string|null, pid:number|null, ports:number[], status:string, stoppable:boolean}}
 */
export function describeBackgroundCommand(cmd = {}) {
  const c = cmd && typeof cmd === "object" ? cmd : {};
  const pidNum = Number(c.pid);
  const pid = Number.isInteger(pidNum) && pidNum > 0 ? pidNum : null;
  return {
    command: typeof c.command === "string" ? redactSecrets(c.command) : null,
    pid,
    ports: normalizePorts(c.ports),
    status: normalizeHealthStatus(c.status),
    stoppable: pid !== null,
  };
}
