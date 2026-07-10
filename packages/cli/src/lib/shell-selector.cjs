"use strict";

/**
 * shell-selector — Windows / PowerShell first-class shell selection
 * (gap-analysis P1 #8).
 *
 * Decides WHICH shell a `run_shell` command (or a settings hook with a
 * `shell` field) executes under:
 *
 *   - per-call:   run_shell `{ shell: "powershell" | "pwsh" | "cmd" | "default" }`
 *   - configured: settings `shell.windowsDefault` ("cmd" | "powershell" | "pwsh",
 *                 layered .claude/settings.json, closest wins) or the
 *                 CC_WINDOWS_SHELL env var (wins over settings)
 *   - default:    unchanged platform default (cmd.exe via ComSpec on Windows,
 *                 /bin/sh elsewhere) — the unconfigured path is byte-identical.
 *
 * PowerShell runs go through explicit argv (`powershell.exe -NoProfile
 * [-ExecutionPolicy <p>] -Command <command>`), NOT `shell: "powershell.exe"`,
 * so the enterprise ExecutionPolicy override (settings
 * `shell.powershell.executionPolicy`) can be applied per-invocation without
 * touching machine state. The policy value is validated against the fixed
 * PowerShell enum — a settings typo can NOT smuggle extra argv.
 *
 * Scope notes:
 *   - `windowsDefault` only applies on win32 (hence the name). A per-call
 *     `pwsh` request is honored on any platform (PowerShell 7 is
 *     cross-platform); `powershell`/`cmd` requests outside Windows fall back
 *     to the platform default with a note.
 *   - `-ExecutionPolicy` is only attached on win32 (POSIX pwsh has no policy).
 *   - Hooks opt in per-hook via `{ "shell": "powershell" }` — the configured
 *     windowsDefault deliberately does NOT rewrite existing hooks.
 */

const settingsLoader = require("./settings-loader.cjs");

const SHELL_KINDS = Object.freeze(["default", "cmd", "powershell", "pwsh"]);

/** The fixed PowerShell ExecutionPolicy enum (canonical casing). */
const EXECUTION_POLICIES = Object.freeze([
  "Restricted",
  "AllSigned",
  "RemoteSigned",
  "Unrestricted",
  "Bypass",
  "Undefined",
]);

/** Normalize a shell kind; unknown/empty → null (fail to default). */
function normalizeShellKind(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "powershell.exe" || v === "windowspowershell") return "powershell";
  if (v === "pwsh.exe") return "pwsh";
  if (v === "cmd.exe") return "cmd";
  return SHELL_KINDS.includes(v) ? v : null;
}

/** Normalize an ExecutionPolicy to canonical casing; unknown → null. */
function normalizeExecutionPolicy(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return EXECUTION_POLICIES.find((p) => p.toLowerCase() === v) || null;
}

/**
 * Layered `shell` settings: `{ windowsDefault, powershell: { executionPolicy } }`.
 * Closest layer wins per key; invalid values are ignored (fail-to-default).
 * CC_WINDOWS_SHELL env overrides the settings-provided windowsDefault.
 *
 * @param {{ cwd?: string, env?: object, settingsFile?: string, onWarn?: Function }} [opts]
 * @returns {{ windowsDefault: string|null, executionPolicy: string|null, files: string[] }}
 */
// Per-process memo: run_shell resolves the config on EVERY call, and the
// layered settings walk is filesystem I/O. A short TTL keeps mid-session
// settings edits honored without re-reading per tool call.
const _configCache = new Map(); // key → { at, value }
const CONFIG_CACHE_TTL_MS = 3000;

function loadShellConfig(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const cacheable = !opts.env && !opts.onWarn;
  const cacheKey = cacheable ? `${cwd}|${opts.settingsFile || ""}` : null;
  if (cacheKey) {
    const hit = _configCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CONFIG_CACHE_TTL_MS) return hit.value;
  }
  let windowsDefault = null;
  let executionPolicy = null;
  const files = [];
  try {
    for (const file of settingsLoader.settingsPaths(cwd, opts.settingsFile)) {
      const data = settingsLoader.readSettingsFile(file, {
        onWarn: opts.onWarn,
      });
      const shell = data && typeof data === "object" ? data.shell : null;
      if (!shell || typeof shell !== "object" || Array.isArray(shell)) continue;
      const kind = normalizeShellKind(shell.windowsDefault);
      if (kind) windowsDefault = kind;
      const pol = normalizeExecutionPolicy(shell.powershell?.executionPolicy);
      if (pol) executionPolicy = pol;
      files.push(file);
    }
  } catch {
    /* settings are best-effort — never fail shell resolution over them */
  }
  const envKind = normalizeShellKind(env.CC_WINDOWS_SHELL);
  if (envKind) windowsDefault = envKind;
  const value = { windowsDefault, executionPolicy, files };
  if (cacheKey) _configCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Test hook: drop the config memo. */
function _clearShellConfigCache() {
  _configCache.clear();
}

/**
 * Build the explicit argv for a PowerShell invocation of `command`.
 * @param {string} command
 * @param {"powershell"|"pwsh"} kind
 * @param {{ executionPolicy?: string|null, platform?: string }} [opts]
 * @returns {{ file: string, argv: string[] }}
 */
function buildPowershellArgv(command, kind, opts = {}) {
  const platform = opts.platform || process.platform;
  const file = kind === "pwsh" ? "pwsh" : "powershell.exe";
  const policy =
    platform === "win32"
      ? normalizeExecutionPolicy(opts.executionPolicy)
      : null;
  return {
    file,
    argv: [
      "-NoProfile",
      ...(policy ? ["-ExecutionPolicy", policy] : []),
      "-Command",
      String(command ?? ""),
    ],
  };
}

/**
 * Resolve how to run one shell command.
 *
 * Precedence: per-call `requested` > configured windowsDefault (win32 only)
 * > platform default. Returns either the default-shell marker (caller keeps
 * its existing exec/spawn `shell: true` path — byte-identical) or an explicit
 * `{ file, argv }` PowerShell invocation.
 *
 * @param {{ command: string, requested?: string, cwd?: string, env?: object,
 *           platform?: string, settingsFile?: string,
 *           config?: { windowsDefault?: string|null, executionPolicy?: string|null } }} opts
 * @returns {{ kind: string, useDefaultShell: boolean, file?: string,
 *            argv?: string[], note?: string }}
 */
function resolveShellInvocation(opts = {}) {
  const platform = opts.platform || process.platform;
  const config = opts.config || loadShellConfig(opts);
  const requested = normalizeShellKind(opts.requested);
  let kind =
    requested ||
    (platform === "win32" ? config.windowsDefault : null) ||
    "default";
  let note;

  if (kind === "cmd") {
    if (platform === "win32") {
      // cmd IS the Windows default shell — take the untouched default path so
      // an explicit `shell:"cmd"` opt-out of a PowerShell windowsDefault stays
      // byte-identical to the historical behavior.
      return { kind: "cmd", useDefaultShell: true };
    }
    note = "cmd is Windows-only; using the platform default shell";
    return { kind: "default", useDefaultShell: true, note };
  }
  if (kind === "powershell" && platform !== "win32") {
    // Windows PowerShell 5.1 doesn't exist off-Windows; pwsh might.
    note =
      "powershell (5.1) is Windows-only; using the platform default shell (request pwsh for PowerShell 7)";
    return { kind: "default", useDefaultShell: true, note };
  }
  if (kind === "powershell" || kind === "pwsh") {
    const { file, argv } = buildPowershellArgv(opts.command, kind, {
      executionPolicy: config.executionPolicy,
      platform,
    });
    return { kind, useDefaultShell: false, file, argv };
  }
  return { kind: "default", useDefaultShell: true };
}

module.exports = {
  SHELL_KINDS,
  EXECUTION_POLICIES,
  normalizeShellKind,
  normalizeExecutionPolicy,
  loadShellConfig,
  buildPowershellArgv,
  resolveShellInvocation,
  _clearShellConfigCache,
};
