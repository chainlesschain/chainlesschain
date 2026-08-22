/**
 * Claude-Code-compatible project storage layout.
 *
 * This module intentionally has no dependency on `paths.js`: session storage,
 * config-root resolution, and the write guard all need the same small
 * environment-only decision without creating an import cycle.  The caller
 * supplies the already-validated configuration root.
 */

import { join } from "node:path";

export const CLAUDE_PROJECT_DIR_NAME_ENV = "CLAUDE_CODE_PROJECT_DIR_NAME";
export const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
export const CLAUDE_PROJECT_DIR_NAME_MAX_BYTES = 128;

const SAFE_PROJECT_DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const WINDOWS_RESERVED_SEGMENTS = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function layoutError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * A native explicit storage root always wins.  This prevents an ambient
 * Claude-compatible variable from silently splitting canonical CLI state.
 */
export function usesClaudeConfigDirectory(env = process.env) {
  if (env?.CHAINLESSCHAIN_HOME) return false;
  return (
    typeof env?.[CLAUDE_CONFIG_DIR_ENV] === "string" &&
    env[CLAUDE_CONFIG_DIR_ENV].trim().length > 0
  );
}

/**
 * Normalize a project directory name to one portable path segment.  Project
 * names arrive only from the launcher environment; accepting a filesystem
 * spelling here would turn a transcript selector into a path traversal input.
 */
export function validateClaudeProjectDirectoryName(value) {
  if (typeof value !== "string") {
    throw layoutError(
      "CLAUDE_CODE_PROJECT_DIR_NAME must be a string",
      "CLAUDE_PROJECT_DIR_NAME_UNSAFE",
    );
  }
  const name = value.normalize("NFC");
  if (
    name !== value ||
    !name ||
    Buffer.byteLength(name, "utf8") > CLAUDE_PROJECT_DIR_NAME_MAX_BYTES ||
    !SAFE_PROJECT_DIR_NAME.test(name) ||
    name === "." ||
    name === ".." ||
    name.endsWith(".") ||
    name.endsWith(" ") ||
    WINDOWS_RESERVED_SEGMENTS.has(name.split(".")[0].toUpperCase())
  ) {
    throw layoutError(
      "CLAUDE_CODE_PROJECT_DIR_NAME must be a bounded portable path segment",
      "CLAUDE_PROJECT_DIR_NAME_UNSAFE",
    );
  }
  return name;
}

/**
 * Return null when the Claude-compatible project layout is not active.  In
 * particular, a project name alone does nothing: Claude Code only honors it
 * alongside CLAUDE_CONFIG_DIR, and CHAINLESSCHAIN_HOME retains precedence.
 */
export function resolveClaudeProjectStorageDir(homeDir, options = {}) {
  const env = options.env || process.env;
  if (!usesClaudeConfigDirectory(env)) return null;
  const rawName = env[CLAUDE_PROJECT_DIR_NAME_ENV];
  if (rawName === undefined || rawName === null || rawName === "") return null;
  const name = validateClaudeProjectDirectoryName(rawName);
  return join(String(homeDir), "projects", name);
}
