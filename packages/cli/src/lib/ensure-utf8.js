/**
 * Ensure UTF-8 encoding on Windows to prevent Chinese character garbling (乱码).
 *
 * Windows console defaults to the system codepage (e.g. CP936/GBK for Chinese),
 * which causes UTF-8 output from Node.js to display as garbled text.
 * This module sets the console codepage to 65001 (UTF-8) and configures
 * Node.js streams to use UTF-8 encoding.
 */

import { execSync } from "child_process";

/**
 * Call this as early as possible in the process entry point.
 */
export function ensureUtf8() {
  if (process.platform !== "win32") return;

  // Set Windows console codepage to UTF-8
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch (_err) {
    // Ignore - may fail in non-interactive environments
  }

  // Ensure stdout/stderr use UTF-8 encoding
  if (process.stdout.setDefaultEncoding) {
    process.stdout.setDefaultEncoding("utf8");
  }
  if (process.stderr.setDefaultEncoding) {
    process.stderr.setDefaultEncoding("utf8");
  }

  // Set environment variable so child processes inherit UTF-8
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

  return {
    encoding: "utf-8",
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      // Force cmd.exe to use UTF-8 codepage
      CHCP: "65001",
      ...opts.env,
    },
    ...opts,
  };
}
