/**
 * CLI-Anything Bridge — discovers and registers CLI-Anything generated tools
 * as ChainlessChain managed-layer skills.
 *
 * CLI-Anything (https://github.com/HKUDS/CLI-Anything) generates Agent-native
 * CLI wrappers for arbitrary software.  This bridge scans for those wrappers
 * on the user's PATH and turns each one into a SKILL.md + handler.js pair
 * that the existing 4-layer skill-loader picks up automatically.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getElectronUserDataDir } from "./paths.js";

/* ---------- _deps injection (Vitest CJS mock pattern) ---------- */
export const _deps = { execSync, fs, path };

/* ----------------------------------------------------------------
 * Database helpers
 * ---------------------------------------------------------------- */

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS cli_anything_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  software_path TEXT,
  cli_command TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  description TEXT,
  subcommands TEXT,
  skill_name TEXT,
  status TEXT DEFAULT 'discovered',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;

export function ensureCliAnythingTables(db) {
  db.exec(CREATE_TABLE_SQL);
}

/* ----------------------------------------------------------------
 * Python / CLI-Anything detection
 * ---------------------------------------------------------------- */

/**
 * Detect a usable Python interpreter.
 * Returns { found: boolean, command?: string, version?: string }.
 */
export function detectPython() {
  const candidates =
    process.platform === "win32"
      ? ["python", "python3", "py"]
      : ["python3", "python"];

  for (const cmd of candidates) {
    try {
      const ver = _deps
        .execSync(`${cmd} --version`, {
          encoding: "utf-8",
          timeout: 10000,
          stdio: ["pipe", "pipe", "pipe"],
        })
        .trim();
      const match = ver.match(/Python\s+([\d.]+)/i);
      if (match) {
        return { found: true, command: cmd, version: match[1] };
      }
    } catch (_err) {
      // This candidate not available — try next
    }
  }
  return { found: false };
}

/**
 * Check whether the `cli-anything` Python package is installed.
 * Returns { installed: boolean, version?: string }.
 */
export function detectCliAnything() {
  const py = detectPython();
  if (!py.found) return { installed: false };

  try {
    const out = _deps.execSync(`${py.command} -m pip show cli-anything`, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const verMatch = out.match(/Version:\s*([\d.]+)/i);
    return {
      installed: true,
      version: verMatch ? verMatch[1] : "unknown",
      pythonCommand: py.command,
    };
  } catch (_err) {
    return { installed: false, pythonCommand: py.command };
  }
}

/**
 * Install CLI-Anything via pip.
 */
export function installCliAnything(pythonCmd) {
  _deps.execSync(`${pythonCmd} -m pip install cli-anything`, {
    encoding: "utf-8",
    timeout: 120000,
    stdio: "inherit",
  });
}

/* ----------------------------------------------------------------
 * Tool scanning
 * ---------------------------------------------------------------- */

/**
 * Scan PATH for executables matching `cli-anything-*`.
 * Returns an array of { name, command, path }.
 */
export function scanPathForTools() {
  const results = [];
  const seen = new Set();
  const dirs = (process.env.PATH || "").split(_deps.path.delimiter);

  for (const dir of dirs) {
    try {
      const entries = _deps.fs.readdirSync(dir);
      for (const entry of entries) {
        const baseName = entry.replace(/\.exe$/i, "");
        if (!baseName.startsWith("cli-anything-")) continue;
        if (seen.has(baseName)) continue;
        seen.add(baseName);

        const toolName = baseName.replace(/^cli-anything-/, "");
        results.push({
          name: toolName,
          command: baseName,
          path: _deps.path.join(dir, entry),
        });
      }
    } catch (_err) {
      // Directory not readable — skip
    }
  }
  return results;
}

/**
 * Parse `--help` output of a cli-anything generated tool.
 * Returns { description, subcommands: [{ name, description }] }.
 */
export function parseToolHelp(command) {
  let helpText;
  try {
    helpText = _deps.execSync(`${command} --help`, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const raw = err.stdout || err.stderr || "";
    helpText = typeof raw === "string" ? raw : raw.toString("utf-8");
  }

  const lines = helpText.split("\n").map((l) => l.trimEnd());

  // First non-empty, non-"usage:" line is typically the description
  let description = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^usage:/i.test(trimmed)) continue;
    if (/^options?:/i.test(trimmed)) break;
    if (/^commands?:/i.test(trimmed)) break;
    description = trimmed;
    break;
  }

  // Parse subcommands section
  const subcommands = [];
  let inCommands = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^commands?:/i.test(trimmed) || /^subcommands?:/i.test(trimmed)) {
      inCommands = true;
      continue;
    }
    if (inCommands) {
      if (!trimmed || /^options?:/i.test(trimmed)) break;
      const match = trimmed.match(/^(\S+)\s+(.*)/);
      if (match) {
        subcommands.push({ name: match[1], description: match[2].trim() });
      }
    }
  }

  return {
    description: description || `CLI-Anything tool: ${command}`,
    subcommands,
  };
}

/* ----------------------------------------------------------------
 * Skill registration / removal
 * ---------------------------------------------------------------- */

function _skillDir(toolName) {
  const userData = getElectronUserDataDir();
  return _deps.path.join(userData, "skills", `cli-anything-${toolName}`);
}

/**
 * Generate SKILL.md content for a CLI-Anything tool.
 */
export function _generateSkillMd(name, helpData) {
  const subs = (helpData.subcommands || [])
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");

  return `---
name: cli-anything-${name}
display-name: CLI-Anything ${name}
description: ${helpData.description || `Agent-native CLI for ${name}`}
version: 1.0.0
category: integration
tags: [cli-anything, ${name}, external-tool]
user-invocable: true
handler: handler.js
capabilities: [shell-exec]
os: [linux, darwin, win32]
---

# cli-anything-${name}

Auto-registered by \`chainlesschain cli-anything register ${name}\`.

${helpData.description || ""}

${subs ? `## Subcommands\n\n${subs}\n` : ""}
## Usage

Pass the subcommand and arguments as plain text input:

\`\`\`
/skill cli-anything-${name} <subcommand> [args...]
\`\`\`
`;
}

/**
 * Generate handler.js content for a CLI-Anything tool.
 */
export function _generateHandlerJs(name, command) {
  return `"use strict";
const { execSync } = require("child_process");

module.exports = {
  async execute(task, context) {
    const input = (task?.params?.input || task?.action || "").trim();
    if (!input) return { success: false, error: "No input provided" };
    try {
      const output = execSync(\`${command} \${input}\`, {
        encoding: "utf-8",
        timeout: 60000,
        cwd: context?.projectRoot || process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let result;
      try { result = JSON.parse(output); } catch (_e) { result = { output: output.trim() }; }
      return { success: true, result, message: "Completed" };
    } catch (err) {
      const errMsg = typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") || "");
      return { success: false, error: errMsg || err.message };
    }
  },
};
`;
}

/**
 * Register a CLI-Anything tool as a managed-layer skill.
 */
export function registerTool(db, toolName, opts = {}) {
  const command = opts.command || `cli-anything-${toolName}`;
  const helpData = opts.helpData || parseToolHelp(command);
  const force = opts.force || false;

  const dir = _skillDir(toolName);

  // Check existing
  const existing = db
    .prepare("SELECT id FROM cli_anything_tools WHERE name = ?")
    .get(toolName);
  if (existing && !force) {
    throw new Error(
      `Tool "${toolName}" already registered. Use --force to overwrite.`,
    );
  }

  // Write skill files
  _deps.fs.mkdirSync(dir, { recursive: true });
  _deps.fs.writeFileSync(
    _deps.path.join(dir, "SKILL.md"),
    _generateSkillMd(toolName, helpData),
    "utf-8",
  );
  _deps.fs.writeFileSync(
    _deps.path.join(dir, "handler.js"),
    _generateHandlerJs(toolName, command),
    "utf-8",
  );

  // Upsert DB record
  const id = existing ? existing.id : `clia-${toolName}-${Date.now()}`;
  const skillName = `cli-anything-${toolName}`;
  const subcommandsJson = JSON.stringify(helpData.subcommands || []);

  if (existing) {
    db.prepare(
      `
      UPDATE cli_anything_tools
      SET cli_command = ?, description = ?, subcommands = ?,
          skill_name = ?, status = 'registered', updated_at = datetime('now')
      WHERE name = ?
    `,
    ).run(command, helpData.description, subcommandsJson, skillName, toolName);
  } else {
    db.prepare(
      `
      INSERT INTO cli_anything_tools (id, name, software_path, cli_command, description, subcommands, skill_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'registered')
    `,
    ).run(
      id,
      toolName,
      opts.softwarePath || null,
      command,
      helpData.description,
      subcommandsJson,
      skillName,
    );
  }

  return { id, skillName, dir, subcommands: helpData.subcommands || [] };
}

/**
 * Remove a registered CLI-Anything tool.
 */
export function removeTool(db, toolName) {
  const row = db
    .prepare("SELECT id FROM cli_anything_tools WHERE name = ?")
    .get(toolName);
  if (!row) {
    throw new Error(`Tool "${toolName}" is not registered.`);
  }

  // Remove skill directory
  const dir = _skillDir(toolName);
  try {
    _deps.fs.rmSync(dir, { recursive: true, force: true });
  } catch (_err) {
    // Directory may already be gone
  }

  db.prepare("DELETE FROM cli_anything_tools WHERE name = ?").run(toolName);
  return { removed: true, toolName };
}

/**
 * List all registered CLI-Anything tools.
 */
export function listTools(db) {
  return db
    .prepare(
      "SELECT id, name, cli_command, description, skill_name, status, created_at, updated_at FROM cli_anything_tools ORDER BY name",
    )
    .all();
}

// =====================================================================
// cli-anything-bridge V2 governance overlay (iter25)
// =====================================================================
export const CLIBGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  ARCHIVED: "archived",
});
export const CLIBGOV_BRIDGE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  BRIDGING: "bridging",
  BRIDGED: "bridged",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _clibgovPTrans = new Map([
  [
    CLIBGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CLIBGOV_PROFILE_MATURITY_V2.ACTIVE,
      CLIBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CLIBGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CLIBGOV_PROFILE_MATURITY_V2.DEGRADED,
      CLIBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CLIBGOV_PROFILE_MATURITY_V2.DEGRADED,
    new Set([
      CLIBGOV_PROFILE_MATURITY_V2.ACTIVE,
      CLIBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CLIBGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _clibgovPTerminal = new Set([CLIBGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _clibgovJTrans = new Map([
  [
    CLIBGOV_BRIDGE_LIFECYCLE_V2.QUEUED,
    new Set([
      CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGING,
      CLIBGOV_BRIDGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGING,
    new Set([
      CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGED,
      CLIBGOV_BRIDGE_LIFECYCLE_V2.FAILED,
      CLIBGOV_BRIDGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGED, new Set()],
  [CLIBGOV_BRIDGE_LIFECYCLE_V2.FAILED, new Set()],
  [CLIBGOV_BRIDGE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _clibgovPsV2 = new Map();
const _clibgovJsV2 = new Map();
let _clibgovMaxActive = 8,
  _clibgovMaxPending = 20,
  _clibgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _clibgovStuckMs = 60 * 1000;
function _clibgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _clibgovCheckP(from, to) {
  const a = _clibgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid clibgov profile transition ${from} → ${to}`);
}
function _clibgovCheckJ(from, to) {
  const a = _clibgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid clibgov bridge transition ${from} → ${to}`);
}
function _clibgovCountActive(owner) {
  let c = 0;
  for (const p of _clibgovPsV2.values())
    if (p.owner === owner && p.status === CLIBGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _clibgovCountPending(profileId) {
  let c = 0;
  for (const j of _clibgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CLIBGOV_BRIDGE_LIFECYCLE_V2.QUEUED ||
        j.status === CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGING)
    )
      c++;
  return c;
}
export function setMaxActiveClibgovProfilesPerOwnerV2(n) {
  _clibgovMaxActive = _clibgovPos(n, "maxActiveClibgovProfilesPerOwner");
}
export function getMaxActiveClibgovProfilesPerOwnerV2() {
  return _clibgovMaxActive;
}
export function setMaxPendingClibgovBridgesPerProfileV2(n) {
  _clibgovMaxPending = _clibgovPos(n, "maxPendingClibgovBridgesPerProfile");
}
export function getMaxPendingClibgovBridgesPerProfileV2() {
  return _clibgovMaxPending;
}
export function setClibgovProfileIdleMsV2(n) {
  _clibgovIdleMs = _clibgovPos(n, "clibgovProfileIdleMs");
}
export function getClibgovProfileIdleMsV2() {
  return _clibgovIdleMs;
}
export function setClibgovBridgeStuckMsV2(n) {
  _clibgovStuckMs = _clibgovPos(n, "clibgovBridgeStuckMs");
}
export function getClibgovBridgeStuckMsV2() {
  return _clibgovStuckMs;
}
export function _resetStateCliAnythingBridgeGovV2() {
  _clibgovPsV2.clear();
  _clibgovJsV2.clear();
  _clibgovMaxActive = 8;
  _clibgovMaxPending = 20;
  _clibgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _clibgovStuckMs = 60 * 1000;
}
export function registerClibgovProfileV2({ id, owner, tool, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_clibgovPsV2.has(id))
    throw new Error(`clibgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    tool: tool || "generic",
    status: CLIBGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _clibgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateClibgovProfileV2(id) {
  const p = _clibgovPsV2.get(id);
  if (!p) throw new Error(`clibgov profile ${id} not found`);
  const isInitial = p.status === CLIBGOV_PROFILE_MATURITY_V2.PENDING;
  _clibgovCheckP(p.status, CLIBGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _clibgovCountActive(p.owner) >= _clibgovMaxActive)
    throw new Error(`max active clibgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CLIBGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function degradeClibgovProfileV2(id) {
  const p = _clibgovPsV2.get(id);
  if (!p) throw new Error(`clibgov profile ${id} not found`);
  _clibgovCheckP(p.status, CLIBGOV_PROFILE_MATURITY_V2.DEGRADED);
  p.status = CLIBGOV_PROFILE_MATURITY_V2.DEGRADED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveClibgovProfileV2(id) {
  const p = _clibgovPsV2.get(id);
  if (!p) throw new Error(`clibgov profile ${id} not found`);
  _clibgovCheckP(p.status, CLIBGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CLIBGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchClibgovProfileV2(id) {
  const p = _clibgovPsV2.get(id);
  if (!p) throw new Error(`clibgov profile ${id} not found`);
  if (_clibgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal clibgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getClibgovProfileV2(id) {
  const p = _clibgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listClibgovProfilesV2() {
  return [..._clibgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createClibgovBridgeV2({
  id,
  profileId,
  command,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_clibgovJsV2.has(id))
    throw new Error(`clibgov bridge ${id} already exists`);
  if (!_clibgovPsV2.has(profileId))
    throw new Error(`clibgov profile ${profileId} not found`);
  if (_clibgovCountPending(profileId) >= _clibgovMaxPending)
    throw new Error(
      `max pending clibgov bridges for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    command: command || "",
    status: CLIBGOV_BRIDGE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _clibgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function bridgingClibgovBridgeV2(id) {
  const j = _clibgovJsV2.get(id);
  if (!j) throw new Error(`clibgov bridge ${id} not found`);
  _clibgovCheckJ(j.status, CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGING);
  const now = Date.now();
  j.status = CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeBridgeClibgovV2(id) {
  const j = _clibgovJsV2.get(id);
  if (!j) throw new Error(`clibgov bridge ${id} not found`);
  _clibgovCheckJ(j.status, CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGED);
  const now = Date.now();
  j.status = CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failClibgovBridgeV2(id, reason) {
  const j = _clibgovJsV2.get(id);
  if (!j) throw new Error(`clibgov bridge ${id} not found`);
  _clibgovCheckJ(j.status, CLIBGOV_BRIDGE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CLIBGOV_BRIDGE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelClibgovBridgeV2(id, reason) {
  const j = _clibgovJsV2.get(id);
  if (!j) throw new Error(`clibgov bridge ${id} not found`);
  _clibgovCheckJ(j.status, CLIBGOV_BRIDGE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CLIBGOV_BRIDGE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getClibgovBridgeV2(id) {
  const j = _clibgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listClibgovBridgesV2() {
  return [..._clibgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDegradeIdleClibgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _clibgovPsV2.values())
    if (
      p.status === CLIBGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _clibgovIdleMs
    ) {
      p.status = CLIBGOV_PROFILE_MATURITY_V2.DEGRADED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckClibgovBridgesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _clibgovJsV2.values())
    if (
      j.status === CLIBGOV_BRIDGE_LIFECYCLE_V2.BRIDGING &&
      j.startedAt != null &&
      t - j.startedAt >= _clibgovStuckMs
    ) {
      j.status = CLIBGOV_BRIDGE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCliAnythingBridgeGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CLIBGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _clibgovPsV2.values()) profilesByStatus[p.status]++;
  const bridgesByStatus = {};
  for (const v of Object.values(CLIBGOV_BRIDGE_LIFECYCLE_V2))
    bridgesByStatus[v] = 0;
  for (const j of _clibgovJsV2.values()) bridgesByStatus[j.status]++;
  return {
    totalClibgovProfilesV2: _clibgovPsV2.size,
    totalClibgovBridgesV2: _clibgovJsV2.size,
    maxActiveClibgovProfilesPerOwner: _clibgovMaxActive,
    maxPendingClibgovBridgesPerProfile: _clibgovMaxPending,
    clibgovProfileIdleMs: _clibgovIdleMs,
    clibgovBridgeStuckMs: _clibgovStuckMs,
    profilesByStatus,
    bridgesByStatus,
  };
}
