/**
 * REPL `!` bash passthrough + `#` quick-memorize (Claude-Code parity).
 *
 * Pure logic for two agent-REPL input prefixes, extracted so it is unit
 * testable without driving readline:
 *
 *  - `! <cmd>`  — run the shell command immediately (no LLM round-trip) and
 *    return a `<bash-input>/<bash-output>` context message so the model sees
 *    what happened on the next turn. Windows runs through `cmd.exe /d /s /c`
 *    with a `chcp 65001` prefix (encoding.md rule); POSIX through `/bin/sh -c`.
 *
 *  - `# <note>` — append a one-line note to the project memory file (cc.md at
 *    the git root — the file project-instructions.js auto-loads). Creates the
 *    file/`## Notes` section when missing; next sessions pick it up
 *    automatically and the caller can also inject it into the live context.
 *
 * All process/fs access goes through `_deps` for tests.
 */

import { spawnSync as spawnSyncDefault } from "child_process";
import fsDefault from "fs";
import pathDefault from "path";
import { findProjectRoot } from "./project-instructions.js";

export const BANG_TIMEOUT_MS = 120_000;
export const BANG_MAX_BUFFER = 10 * 1024 * 1024;
export const BANG_OUTPUT_CAP = 30_000;
// A `#` note is a terse one-liner, but readline accepts a long pasted line and
// the note lands verbatim in cc.md — which is auto-loaded into EVERY future
// session's system prompt. Without a cap, an accidental fat paste silently
// bloats every later session's context. Truncate to a sane single-note size.
export const MEMO_NOTE_MAX = 4_000;

export const _deps = {
  spawnSync: spawnSyncDefault,
  fs: fsDefault,
  path: pathDefault,
};

function cap(s) {
  const str = s || "";
  return str.length > BANG_OUTPUT_CAP
    ? `${str.slice(0, BANG_OUTPUT_CAP)}\n… [truncated]`
    : str;
}

/** True when the REPL line is a `!` bash passthrough. */
export function isBangCommand(trimmed) {
  return (
    typeof trimmed === "string" &&
    trimmed.startsWith("!") &&
    trimmed.slice(1).trim().length > 0
  );
}

/** True when the REPL line is a `#` quick-memorize. */
export function isMemorizeLine(trimmed) {
  return (
    typeof trimmed === "string" &&
    trimmed.startsWith("#") &&
    trimmed.slice(1).trim().length > 0
  );
}

/**
 * Run a `!` command synchronously.
 *
 * @returns {{ cmd, stdout, stderr, exitCode, error, contextMessage }}
 *          `contextMessage` is ready to push as a user-role message.
 */
export function runBangCommand(line, opts = {}) {
  const spawnSync = opts.deps?.spawnSync || _deps.spawnSync;
  const cwd = opts.cwd || process.cwd();
  const isWin =
    opts.platform != null
      ? opts.platform === "win32"
      : process.platform === "win32";
  const cmd = String(line).replace(/^!/, "").trim();

  const res = isWin
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `chcp 65001 >nul && ${cmd}`], {
        encoding: "utf-8",
        timeout: BANG_TIMEOUT_MS,
        maxBuffer: BANG_MAX_BUFFER,
        cwd,
      })
    : spawnSync("/bin/sh", ["-c", cmd], {
        encoding: "utf-8",
        timeout: BANG_TIMEOUT_MS,
        maxBuffer: BANG_MAX_BUFFER,
        cwd,
      });

  const exitCode = res.status == null ? (res.error ? -1 : 0) : res.status;
  const stdout = cap(res.stdout);
  const stderr = cap(res.stderr);
  const body = [stdout, stderr].filter(Boolean).join("\n");
  return {
    cmd,
    stdout,
    stderr,
    exitCode,
    error: res.error || null,
    contextMessage: {
      role: "user",
      content: `<bash-input>${cmd}</bash-input>\n<bash-output exit-code="${exitCode}">\n${body}\n</bash-output>`,
    },
  };
}

/**
 * Whether a `!command` in the REPL should auto-trigger an assistant response to
 * its output (Claude-Code 2.1.186 `respondToBashCommands`). Opt-IN — default
 * OFF: by default the command output is folded into context but no LLM turn
 * fires, so a quick `!ls` / `!git status` never spends a turn. (cc intentionally
 * diverges from upstream's default-on here.)
 *
 * Precedence: `CC_RESPOND_TO_BASH` env (1/true/yes/on → on, else off) overrides
 * the settings.json `respondToBashCommands` boolean, which overrides the default
 * (false). Pure — the caller passes the resolved settings value + env.
 *
 * @param {{ settingValue?: boolean, env?: object }} [opts]
 * @returns {boolean}
 */
export function shouldRespondToBashCommands(opts = {}) {
  const env = opts.env || process.env;
  const raw = env.CC_RESPOND_TO_BASH;
  if (raw != null && String(raw).trim() !== "") {
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
  }
  if (typeof opts.settingValue === "boolean") return opts.settingValue;
  return false;
}

/**
 * Append a `#` note to the project cc.md (created at the git root — falls
 * back to cwd outside a repo). Inserts under a `## Notes` heading, creating
 * file/section as needed.
 *
 * @returns {{ target, line, created }}
 */
export function appendMemoryNote(rawLine, opts = {}) {
  const fs = opts.deps?.fs || _deps.fs;
  const path = opts.deps?.path || _deps.path;
  const cwd = opts.cwd || process.cwd();
  let note = String(rawLine).replace(/^#/, "").trim();
  if (note.length > MEMO_NOTE_MAX) {
    note = `${note.slice(0, MEMO_NOTE_MAX)} …[truncated]`;
  }
  const stamp = opts.date || new Date().toISOString().slice(0, 10);

  const root =
    findProjectRoot(cwd, { deps: { fs, path } }) || path.resolve(cwd);
  const target = opts.target || path.join(root, "cc.md");
  const line = `- ${note} _(noted ${stamp})_`;

  let text = null;
  try {
    text = fs.readFileSync(target, "utf-8");
  } catch {
    /* file does not exist yet */
  }

  let created = false;
  if (text == null) {
    text = `# Project Memory\n\n## Notes\n\n${line}\n`;
    created = true;
  } else if (/^## Notes\s*$/m.test(text)) {
    // insert right after the heading (keeps newest notes on top)
    text = text.replace(/^## Notes\s*$/m, (m) => `${m}\n\n${line}`);
  } else {
    text = `${text.trimEnd()}\n\n## Notes\n\n${line}\n`;
  }
  fs.writeFileSync(target, text, "utf-8");
  return { target, line, note, created };
}
