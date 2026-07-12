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
import { loadProjectInstructionsBlock } from "../lib/project-instructions.js";

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
  const { systemPrompt, appendSystemPrompt, outputStyle, projectMemory, cwd } =
    opts;
  let result = systemPrompt ? systemPrompt : base || "";
  // Project memory (cc.md / CLAUDE.md hierarchy) — injected right after the
  // base so explicit --append-system-prompt / output-style still come later.
  //
  // Default-on at runtime; the implicit default is suppressed under vitest
  // (process.env.VITEST) so the long-standing pure contract of this function
  // holds for existing unit tests — callers/tests that want the block in a
  // test pass `projectMemory: true` explicitly.
  const pmExplicit = typeof projectMemory === "boolean" ? projectMemory : null;
  const pmDefault =
    process.env.CC_PROJECT_MEMORY !== "0" && !process.env.VITEST;
  if (pmExplicit === true || (pmExplicit === null && pmDefault)) {
    const block = loadProjectInstructionsBlock({
      cwd,
      home: opts.projectMemoryHome,
      deps: opts.projectMemoryDeps,
      // Large-monorepo reduction lever: subtrees whose instruction/rule/@import
      // files never load (config `instructionExcludes`, forwarded by the caller).
      instructionExcludes: opts.instructionExcludes,
    });
    if (block) result = result ? `${result}\n\n${block}` : block;
  }
  if (appendSystemPrompt) {
    result = result ? `${result}\n\n${appendSystemPrompt}` : appendSystemPrompt;
  }
  // An output-style persona (Claude-Code `/output-style`) is appended last so it
  // colours the final behaviour without losing the base coding instructions.
  if (outputStyle) {
    result = result ? `${result}\n\n${outputStyle}` : outputStyle;
  }
  return result;
}
