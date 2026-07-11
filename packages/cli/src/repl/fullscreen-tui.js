/**
 * Fullscreen / no-flicker TUI helpers (gap-2026-07-11 P1#10).
 *
 * cc's REPL streams to the scrollback buffer with chalk. On long conversations
 * that scrollback grows without bound and every repaint re-emits the whole
 * screen, which flickers and jumps. Claude Code's fullscreen renderer fixes
 * this with the alternate screen buffer + a windowed, diff-based repaint:
 *
 *   - `/tui fullscreen` enters the alternate screen buffer (`?1049h`), so the
 *     user's scrollback is preserved and the view is a fixed window.
 *   - only the messages that fit the viewport are painted; older ones move to
 *     "transcript mode" (searchable, scrollable) instead of re-emitting.
 *   - repaints diff against the previously painted lines and rewrite only the
 *     rows that changed — no full clear, so no flicker.
 *   - `CC_NO_FLICKER=1` forces fullscreen on at startup.
 *
 * This module is the pure, testable core (mode resolution, alt-screen escape
 * sequences, message windowing, diff repaint, transcript search, OSC-8
 * hyperlinks). The controller (a thin `/tui` handler in agent-repl) owns the
 * TTY writes and config persistence.
 */

const ESC = "\x1b";

export const TUI_MODES = Object.freeze(["default", "fullscreen"]);
export const DEFAULT_TUI_MODE = "default";

/** Alternate screen buffer control sequences. */
export const ALT_SCREEN_ENTER = `${ESC}[?1049h${ESC}[H`;
export const ALT_SCREEN_LEAVE = `${ESC}[?1049l`;
export const HIDE_CURSOR = `${ESC}[?25l`;
export const SHOW_CURSOR = `${ESC}[?25h`;

/**
 * Resolve the effective TUI mode. Precedence:
 *   explicit arg > CC_NO_FLICKER env > persisted setting > default.
 * `CC_NO_FLICKER=1` forces fullscreen and cannot be overridden by the setting,
 * but an explicit `/tui default` this session still wins (arg is highest).
 * Returns a canonical mode name; unknown args fall through to the next source.
 * Pure.
 */
export function resolveTuiMode({
  arg = null,
  env = false,
  setting = null,
} = {}) {
  const canon = (v) => {
    const n = String(v || "")
      .toLowerCase()
      .trim();
    return TUI_MODES.includes(n) ? n : null;
  };
  const fromArg = canon(arg);
  if (fromArg) return fromArg;
  if (envNoFlicker(env)) return "fullscreen";
  const fromSetting = canon(setting);
  if (fromSetting) return fromSetting;
  return DEFAULT_TUI_MODE;
}

/** Whether a CC_NO_FLICKER-style value means "on". Pure. */
export function envNoFlicker(value) {
  const n = String(value == null ? "" : value)
    .toLowerCase()
    .trim();
  return n === "1" || n === "true" || n === "on" || n === "yes";
}

/**
 * Window a list of message lines to the visible viewport. Everything above the
 * window is "in transcript" (hidden but searchable). The newest lines always
 * stay visible (tail-anchored), leaving `reserveBottom` rows for the prompt.
 * @param {string[]} lines  already-rendered transcript lines
 * @param {object} opts { rows, reserveBottom }
 * @returns {{ visible:string[], hiddenCount:number, firstVisible:number }}
 * Pure.
 */
export function windowLines(lines, { rows = 24, reserveBottom = 2 } = {}) {
  const all = Array.isArray(lines) ? lines : [];
  const capacity = Math.max(1, rows - Math.max(0, reserveBottom));
  if (all.length <= capacity) {
    return { visible: all.slice(), hiddenCount: 0, firstVisible: 0 };
  }
  const firstVisible = all.length - capacity;
  return {
    visible: all.slice(firstVisible),
    hiddenCount: firstVisible,
    firstVisible,
  };
}

/**
 * Compute the minimal cursor-addressed repaint to turn `prev` lines into
 * `next`. Only rows that differ are rewritten (no full-screen clear → no
 * flicker). Rows that shrank get a clear-to-end-of-line. Returns the escape
 * string to write; empty string when nothing changed.
 *
 * `origin` is the 1-based screen row where line 0 is painted.
 * Pure.
 */
export function diffRepaint(prev, next, { origin = 1 } = {}) {
  const a = Array.isArray(prev) ? prev : [];
  const b = Array.isArray(next) ? next : [];
  const max = Math.max(a.length, b.length);
  let out = "";
  for (let i = 0; i < max; i++) {
    const before = a[i];
    const after = b[i] ?? "";
    if (before === after) continue;
    const row = origin + i;
    // Move to row start, clear the line, write the new content.
    out += `${ESC}[${row};1H${ESC}[2K${after}`;
  }
  return out;
}

/**
 * Search transcript messages for a query. Each message is `{role, text}`.
 * Returns matches with the message index, a 0-based line offset within the
 * message, and a trimmed snippet. Case-insensitive unless `caseSensitive`.
 * Pure.
 */
export function searchTranscript(
  messages,
  query,
  { caseSensitive = false } = {},
) {
  const q = String(query || "");
  if (!q) return [];
  const needle = caseSensitive ? q : q.toLowerCase();
  const matches = [];
  const msgs = Array.isArray(messages) ? messages : [];
  for (let mi = 0; mi < msgs.length; mi++) {
    const text = String(msgs[mi]?.text ?? "");
    const lines = text.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const hay = caseSensitive ? lines[li] : lines[li].toLowerCase();
      const col = hay.indexOf(needle);
      if (col >= 0) {
        matches.push({
          index: mi,
          line: li,
          column: col,
          role: msgs[mi]?.role || "",
          snippet: lines[li].trim().slice(0, 200),
        });
      }
    }
  }
  return matches;
}

/**
 * OSC-8 terminal hyperlink. When the terminal supports it, renders clickable
 * `text` linking to `url`; otherwise degrades to `text (url)` (or just text
 * when they're equal). Pure.
 */
export function formatHyperlink(text, url, { supported = true } = {}) {
  const label = String(text ?? "");
  const href = String(url ?? "");
  if (!href) return label;
  if (!supported) {
    return label && label !== href ? `${label} (${href})` : href;
  }
  return `${ESC}]8;;${href}${ESC}\\${label || href}${ESC}]8;;${ESC}\\`;
}

/**
 * Whether the environment likely supports OSC-8 hyperlinks. Conservative:
 * honors FORCE_HYPERLINK / NO_HYPERLINK overrides, otherwise trusts known
 * terminals. Pure over the passed env object.
 */
export function supportsHyperlinks(env = {}) {
  if (envNoFlicker(env.FORCE_HYPERLINK)) return true;
  if (env.NO_HYPERLINK != null && env.NO_HYPERLINK !== "") return false;
  const term = String(env.TERM_PROGRAM || "").toLowerCase();
  if (
    term.includes("iterm") ||
    term.includes("wezterm") ||
    term.includes("vscode") ||
    term.includes("hyper")
  ) {
    return true;
  }
  if (env.WT_SESSION) return true; // Windows Terminal
  if (env.KITTY_WINDOW_ID) return true;
  return false;
}

/** One-line status describing the current TUI mode. Pure. */
export function renderTuiStatus(mode) {
  const m = TUI_MODES.includes(mode) ? mode : DEFAULT_TUI_MODE;
  if (m === "fullscreen") {
    return "TUI: fullscreen (alternate screen, windowed no-flicker repaint). /tui default to exit.";
  }
  return "TUI: default (streaming scrollback). /tui fullscreen for a no-flicker window.";
}
