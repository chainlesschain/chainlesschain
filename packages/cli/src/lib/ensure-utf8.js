/**
 * Ensure UTF-8 encoding on Windows to prevent Chinese character garbling (乱码).
 *
 * Windows console defaults to the system codepage (e.g. CP936/GBK for Chinese),
 * which causes UTF-8 output from Node.js to display as garbled text.
 * This module sets the console codepage to 65001 (UTF-8) and configures
 * Node.js streams to use UTF-8 encoding.
 */

import { execSync } from "child_process";

// Injectable so tests can assert whether the (expensive) chcp spawn happened
// without actually spawning cmd.exe. See cli-dev.md `_deps` pattern.
export const _deps = { execSync };

/**
 * Call this as early as possible in the process entry point.
 */
export function ensureUtf8() {
  if (process.platform !== "win32") return;

  // Setting the Windows console codepage to UTF-8 requires spawning cmd.exe
  // (`chcp 65001`), which costs ~280ms per invocation — a Windows process
  // creation, paid on EVERY `cc` run. But the codepage only affects how an
  // *interactive console* renders bytes; when stdout/stderr are piped or
  // redirected (JSON output, headless runs, `cc` spawned as a subprocess by the
  // desktop app / Android / spawnSync test harnesses), the bytes flow through
  // the pipe as raw UTF-8 regardless of codepage, so the spawn is pure startup
  // tax. Only pay it when a console is actually attached — the 乱码 fix is
  // preserved exactly where it matters. Set CC_FORCE_CHCP=1 to restore the
  // unconditional old behavior if some console edge case needs it.
  const consoleAttached =
    Boolean(process.stdout && process.stdout.isTTY) ||
    Boolean(process.stderr && process.stderr.isTTY);
  if (consoleAttached || process.env.CC_FORCE_CHCP === "1") {
    try {
      _deps.execSync("chcp 65001", { stdio: "ignore" });
    } catch (_err) {
      // Ignore - may fail in non-interactive environments
    }
  }

  // Ensure stdout/stderr use UTF-8 encoding (cheap; always)
  if (process.stdout.setDefaultEncoding) {
    process.stdout.setDefaultEncoding("utf8");
  }
  if (process.stderr.setDefaultEncoding) {
    process.stderr.setDefaultEncoding("utf8");
  }

  // Set environment variable so child processes inherit UTF-8 (always)
  process.env.PYTHONIOENCODING = "utf-8";
  process.env.LANG = "en_US.UTF-8";
}

/**
 * Get spawn options that ensure UTF-8 output from child processes on Windows.
 * Use this when spawning cmd.exe or other system processes.
 *
 * @param {object} [opts] - Additional spawn options to merge
 * @returns {object} Spawn options with encoding set to utf-8
 */
export function getUtf8SpawnOptions(opts = {}) {
  if (process.platform !== "win32") return { encoding: "utf-8", ...opts };

  // NOTE: spread `...opts` BEFORE the `env` key so the merged UTF-8 env wins.
  // If `...opts` came last, a caller passing `opts.env` would clobber the whole
  // merge (losing process.env + PYTHONIOENCODING + CHCP) — silently defeating
  // the entire point of this helper. opts.env is still merged in last *within*
  // the env object so caller overrides for individual vars are honored.
  return {
    encoding: "utf-8",
    ...opts,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      // Force cmd.exe to use UTF-8 codepage
      CHCP: "65001",
      ...opts.env,
    },
  };
}
