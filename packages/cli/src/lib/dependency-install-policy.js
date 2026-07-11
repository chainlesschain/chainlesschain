/**
 * Dependency-install policy for `run_code` (gap-analysis 2026-07-11,
 * docs/CLAUDE_CODE_CLI_GAP_ANALYSIS.md P0 "依赖安装与凭据").
 *
 * Auto `pip install` on a Python import error used to be unconditional. It is
 * now OPT-IN:
 *   - env `CC_RUN_CODE_AUTO_INSTALL=1|0` wins outright (kill-switch friendly)
 *   - settings.json `runCode.autoInstall: true` opts in per project/user
 *   - default: DISABLED — the tool result explains how to enable it
 *
 * When enabled, an optional `runCode.installAllowlist` (array of package
 * names, PEP 503-normalized) restricts WHICH packages may be installed, and
 * every attempt — including blocked/disabled ones — is appended to an audit
 * log at ~/.chainlesschain/audit/dependency-install.jsonl.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

/** PEP 503 name normalization: lowercase, runs of -_. collapse to "-". */
export function normalizePackageName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, "-");
}

/**
 * Resolve the effective auto-install policy.
 * @param {{cwd?:string, env?:object, settingsFile?:string|null}} opts
 * @returns {{enabled:boolean, allowlist:string[]|null, source:string}}
 */
export function resolveAutoInstallPolicy({
  cwd = process.cwd(),
  env = process.env,
  settingsFile = null,
} = {}) {
  const raw = env.CC_RUN_CODE_AUTO_INSTALL;
  if (raw === "1" || raw === "0") {
    return {
      enabled: raw === "1",
      allowlist: raw === "1" ? readAllowlist({ cwd, settingsFile }) : null,
      source: "env",
    };
  }
  let enabled = false;
  try {
    const { readBooleanSetting } = _require("./settings-loader.cjs");
    enabled =
      readBooleanSetting("runCode.autoInstall", { cwd, settingsFile }) === true;
  } catch {
    enabled = false; // fail-closed: no settings → stay disabled
  }
  return {
    enabled,
    allowlist: enabled ? readAllowlist({ cwd, settingsFile }) : null,
    source: enabled ? "settings" : "default",
  };
}

function readAllowlist({ cwd = process.cwd(), settingsFile }) {
  try {
    const { settingsPaths, readSettingsFile, loadManagedSettings } = _require(
      "./settings-loader.cjs",
    );
    let value;
    for (const file of settingsPaths(cwd, settingsFile)) {
      const node = readSettingsFile(file)?.runCode?.installAllowlist;
      if (Array.isArray(node)) value = node; // closest layer wins
    }
    const managed = loadManagedSettings({});
    const mNode = managed?.settings?.runCode?.installAllowlist;
    if (Array.isArray(mNode)) value = mNode; // managed policy wins outright
    if (!Array.isArray(value)) return null;
    const list = value.map(normalizePackageName).filter(Boolean);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/**
 * Whether a package may be installed under the policy's allowlist.
 * No allowlist configured → any (validity is checked separately).
 */
export function isPackageAllowed(name, allowlist) {
  if (!allowlist) return true;
  return allowlist.includes(normalizePackageName(name));
}

/** Human hint for the disabled-by-default path (returned in the tool result). */
export function autoInstallDisabledHint(packageName) {
  return (
    `Missing Python package "${packageName}". Auto-install is disabled by ` +
    `default; install it yourself (pip install ${packageName}), or opt in via ` +
    `settings.json {"runCode":{"autoInstall":true}} or CC_RUN_CODE_AUTO_INSTALL=1.`
  );
}

/**
 * Append an install-attempt audit record (best-effort, never throws).
 * @param {{package:string, interpreter?:string, cwd?:string,
 *          outcome:"installed"|"failed"|"blocked"|"disabled", detail?:string}} entry
 * @param {{baseDir?:string, now?:()=>number}} [opts]  injection seams
 */
export function recordInstallAudit(entry, opts = {}) {
  try {
    const baseDir =
      opts.baseDir ||
      process.env.CC_AUDIT_DIR ||
      path.join(os.homedir(), ".chainlesschain", "audit");
    fs.mkdirSync(baseDir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date(opts.now ? opts.now() : Date.now()).toISOString(),
      kind: "dependency-install",
      ...entry,
    });
    fs.appendFileSync(
      path.join(baseDir, "dependency-install.jsonl"),
      line + "\n",
      "utf-8",
    );
  } catch {
    /* audit is best-effort — never affect the run */
  }
}
