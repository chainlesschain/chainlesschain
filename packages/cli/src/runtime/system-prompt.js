/**
 * System-prompt overrides for `cc agent` — Claude-Code `--system-prompt` /
 * `--append-system-prompt` parity.
 *
 *  - `--system-prompt`        replaces the built-in system prompt entirely.
 *  - `--append-system-prompt` appends extra guidance after the built-in one.
 *
 * Both accept a literal string OR `@path` (read the file as the prompt text),
 * so a reusable persona can live in a file without a full `--bundle`.
 *
 * Split into two pure-ish functions so each is unit-testable:
 *  - resolvePromptText : CLI value (literal / @file) → text   [does fs I/O]
 *  - composeSystemPrompt: (base, {systemPrompt, appendSystemPrompt}) → text
 */

import fsDefault from "fs";
import pathDefault from "path";

/**
 * Resolve a CLI prompt value. A leading `@` means "read this file"; anything
 * else (or an unreadable @path) is returned verbatim as literal text.
 *
 * @param {string|null|undefined} value
 * @param {object} [opts] { cwd, deps:{ fs, path } }
 * @returns {string|null}  null only when value is null/undefined
 */
export function resolvePromptText(value, opts = {}) {
  if (value == null) return null;
  const str = String(value);
  if (!str.startsWith("@")) return str;

  const fs = opts.deps?.fs || fsDefault;
  const path = opts.deps?.path || pathDefault;
  const cwd = opts.cwd || process.cwd();
  const abs = path.resolve(cwd, str.slice(1));
  try {
    return fs.readFileSync(abs, "utf-8");
  } catch {
    // Not a readable file → treat the whole token as literal text.
    return str;
  }
}

/**
 * Compose the effective system prompt.
 *  - a (truthy) override replaces the base entirely;
 *  - an append is added after, separated by a blank line.
 *
 * @param {string} base
 * @param {object} [opts] { systemPrompt, appendSystemPrompt }
 * @returns {string}
 */
export function composeSystemPrompt(base, opts = {}) {
  const { systemPrompt, appendSystemPrompt } = opts;
  let result = systemPrompt ? systemPrompt : base || "";
  if (appendSystemPrompt) {
    result = result ? `${result}\n\n${appendSystemPrompt}` : appendSystemPrompt;
  }
  return result;
}
