/**
 * Multi-layer skill loader for CLI
 *
 * 4-layer priority system (highest wins on name collision):
 *   0 (lowest)  bundled     — desktop-app-vue/.../skills/builtin/
 *   1           marketplace — <userData>/marketplace/skills/
 *   2           managed     — <userData>/skills/
 *   3 (highest) workspace   — <projectRoot>/.chainlesschain/skills/
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getElectronUserDataDir } from "./paths.js";
import { findProjectRoot } from "./project-detector.js";
import { parseSkillMcpServers } from "./skill-mcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Layer names in priority order (lowest → highest) */
export const LAYER_NAMES = ["bundled", "marketplace", "managed", "workspace"];

/**
 * Simple YAML frontmatter parser (no dependencies)
 * Shared utility extracted from skill.js
 */
export function parseSkillMd(content) {
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return { data: {}, body: content };

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) return { data: {}, body: content };

  const yamlLines = lines.slice(1, endIndex);
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();
  const data = {};

  let currentKey = null;
  let currentArray = null;

  for (const line of yamlLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      const value = trimmed
        .slice(2)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (currentArray) currentArray.push(value);
      continue;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Convert kebab-case to camelCase
      const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

      if (value === "") {
        currentKey = camelKey;
        currentArray = null;
        continue;
      }

      // Handle inline arrays [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        data[camelKey] = value
          .slice(1, -1)
          .split(",")
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        currentArray = null;
        currentKey = null;
        continue;
      }

      // Handle booleans and numbers
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (/^\d+(\.\d+)?$/.test(value)) value = parseFloat(value);
      else value = value.replace(/^['"]|['"]$/g, "");

      data[camelKey] = value;

      if (Array.isArray(data[camelKey])) {
        currentArray = data[camelKey];
      } else {
        currentArray = null;
      }
      currentKey = camelKey;
    }
  }

  return { data, body };
}

/**
 * Substitute $ARGUMENTS / $1 / $2 / ... placeholders in a skill body.
 * Inspired by open-agents substituteArguments.
 *
 * Rules:
 *  - $ARGUMENTS → full args string (joined by space if array)
 *  - $1, $2, ... → positional args (shell-like; split on whitespace if string)
 *  - Escape $ via $$ → literal $
 *  - Unmatched placeholders are left as-is (non-destructive)
 *
 * @param {string} body - Skill body text
 * @param {string|string[]} args - Args as raw string or pre-split array
 * @returns {string}
 */
export function substituteArguments(body, args) {
  if (typeof body !== "string" || body.length === 0) return body || "";
  let full = "";
  let positional = [];
  if (Array.isArray(args)) {
    positional = args.map((a) => String(a));
    full = positional.join(" ");
  } else if (typeof args === "string") {
    full = args;
    positional = args.trim() === "" ? [] : args.trim().split(/\s+/);
  }
  // Protect literal $$
  const MARKER = "\u0000DOLLAR\u0000";
  let out = body.replace(/\$\$/g, MARKER);
  out = out.replace(/\$ARGUMENTS\b/g, full);
  out = out.replace(/\$(\d+)/g, (match, idx) => {
    const i = parseInt(idx, 10) - 1;
    if (i < 0 || i >= positional.length) return match;
    return positional[i];
  });
  return out.replace(new RegExp(MARKER, "g"), "$");
}

/**
 * Prepend `Skill directory: <abs>` line to body so the LLM can resolve
 * relative paths declared inside the SKILL.md.
 * Inspired by open-agents injectSkillDirectory.
 *
 * @param {string} body
 * @param {string} skillDir - Absolute path to the skill directory
 * @returns {string}
 */
export function injectSkillDirectory(body, skillDir) {
  if (!skillDir) return body || "";
  const header = `Skill directory: ${skillDir}\n\n`;
  return header + (body || "");
}

/**
 * Prepare a skill body for execution: substitute $ARGUMENTS / $N placeholders
 * and prepend the skill directory header.
 *
 * @param {object} skill - Skill metadata (must have .body and .skillDir)
 * @param {string|string[]} args - Runtime args
 * @returns {string}
 */
export function prepareSkillBody(skill, args) {
  const withArgs = substituteArguments(skill?.body || "", args);
  return injectSkillDirectory(withArgs, skill?.skillDir);
}

/**
 * Multi-layer CLI skill loader
 */
export class CLISkillLoader {
  constructor() {
    this._cache = null;
  }

  /**
   * Get paths for each layer
   * @returns {{ layer: string, path: string, exists: boolean }[]}
   */
  getLayerPaths() {
    const layers = [];

    // Layer 0: bundled — desktop-app-vue builtin skills
    const bundledCandidates = [
      path.resolve(
        __dirname,
        "../../../../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
      ),
      path.resolve(
        process.cwd(),
        "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
      ),
    ];
    let bundledPath = null;
    for (const c of bundledCandidates) {
      if (fs.existsSync(c)) {
        bundledPath = c;
        break;
      }
    }
    layers.push({
      layer: "bundled",
      path: bundledPath || bundledCandidates[0],
      exists: bundledPath !== null,
    });

    // Layer 1: marketplace — <userData>/marketplace/skills/
    const userData = getElectronUserDataDir();
    const marketplacePath = path.join(userData, "marketplace", "skills");
    layers.push({
      layer: "marketplace",
      path: marketplacePath,
      exists: fs.existsSync(marketplacePath),
    });

    // Layer 2: managed — <userData>/skills/
    const managedPath = path.join(userData, "skills");
    layers.push({
      layer: "managed",
      path: managedPath,
      exists: fs.existsSync(managedPath),
    });

    // Layer 3: workspace — <projectRoot>/.chainlesschain/skills/
    const projectRoot = findProjectRoot();
    if (projectRoot) {
      const workspacePath = path.join(projectRoot, ".chainlesschain", "skills");
      layers.push({
        layer: "workspace",
        path: workspacePath,
        exists: fs.existsSync(workspacePath),
      });
    } else {
      layers.push({
        layer: "workspace",
        path: null,
        exists: false,
      });
    }

    return layers;
  }

  /**
   * Load skills from a single directory
   * @param {string} dir - Directory to scan
   * @param {string} layer - Layer name for source tracking
   * @returns {object[]} Array of skill metadata
   */
  _loadFromDir(dir, layer) {
    const skills = [];
    if (!dir || !fs.existsSync(dir)) return skills;

    try {
      const dirs = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;

        const skillMd = path.join(dir, entry.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;

        try {
          const content = fs.readFileSync(skillMd, "utf-8");
          const { data, body } = parseSkillMd(content);

          skills.push({
            id: data.name || entry.name,
            displayName: data.displayName || entry.name,
            description: data.description || "",
            version: data.version || "1.0.0",
            category: data.category || "uncategorized",
            activation: data.activation || "manual",
            tags: data.tags || [],
            userInvocable: data.userInvocable !== false,
            handler: data.handler || null,
            capabilities: data.capabilities || [],
            os: data.os || [],
            // CLI pack extended fields
            executionMode: data.executionMode || null,
            cliDomain: data.cliDomain || null,
            cliVersionHash: data.cliVersionHash || null,
            dirName: entry.name,
            hasHandler: fs.existsSync(path.join(dir, entry.name, "handler.js")),
            body,
            // Skill-Embedded MCP: inline server declarations in a
            // ```mcp-servers fenced code block. Empty array if absent.
            mcpServers: parseSkillMcpServers(body),
            source: layer,
            skillDir: path.join(dir, entry.name),
          });
        } catch {
          // Skip malformed skill files
        }
      }
    } catch {
      // Directory unreadable
    }

    return skills;
  }

  /**
   * Load all skills from all layers, applying priority override
   * Higher-priority layers override same-name skills from lower layers.
   * @returns {object[]} Resolved skill list
   */
  loadAll() {
    const layers = this.getLayerPaths();
    const skillMap = new Map();

    // Process in priority order (lowest first, so higher layers overwrite)
    for (const { layer, path: layerPath, exists } of layers) {
      if (!exists) continue;
      const skills = this._loadFromDir(layerPath, layer);
      for (const skill of skills) {
        skillMap.set(skill.id, skill);
      }
    }

    this._cache = Array.from(skillMap.values());
    return this._cache;
  }

  /**
   * Get resolved skills (uses cache if available)
   * @returns {object[]}
   */
  getResolvedSkills() {
    if (this._cache) return this._cache;
    return this.loadAll();
  }

  /**
   * Get auto-activated persona skills
   * @returns {object[]} skills with category "persona" and activation "auto"
   */
  getAutoActivatedPersonas() {
    return this.getResolvedSkills().filter(
      (s) => s.category === "persona" && s.activation === "auto",
    );
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this._cache = null;
  }
}

// ─── V2 Governance Layer ────────────────────────────────────────────
//
// In-memory governance for skill registrations + execution tickets,
// independent of the file-based 4-layer CLISkillLoader (which scans
// bundled/marketplace/managed/workspace dirs). V2 tracks maturity
// transitions, per-owner active-skill caps, per-skill pending-execution
// caps, stamp-once timestamps, and bulk auto-flip routines.

export const SKILL_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived",
});

export const EXECUTION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _SKILL_TRANSITIONS_V2 = new Map([
  [
    SKILL_MATURITY_V2.PENDING,
    new Set([SKILL_MATURITY_V2.ACTIVE, SKILL_MATURITY_V2.ARCHIVED]),
  ],
  [
    SKILL_MATURITY_V2.ACTIVE,
    new Set([SKILL_MATURITY_V2.DEPRECATED, SKILL_MATURITY_V2.ARCHIVED]),
  ],
  [
    SKILL_MATURITY_V2.DEPRECATED,
    new Set([SKILL_MATURITY_V2.ACTIVE, SKILL_MATURITY_V2.ARCHIVED]),
  ],
  [SKILL_MATURITY_V2.ARCHIVED, new Set()],
]);

const _SKILL_TERMINALS_V2 = new Set([SKILL_MATURITY_V2.ARCHIVED]);

const _EXEC_TRANSITIONS_V2 = new Map([
  [
    EXECUTION_LIFECYCLE_V2.QUEUED,
    new Set([EXECUTION_LIFECYCLE_V2.RUNNING, EXECUTION_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    EXECUTION_LIFECYCLE_V2.RUNNING,
    new Set([
      EXECUTION_LIFECYCLE_V2.SUCCEEDED,
      EXECUTION_LIFECYCLE_V2.FAILED,
      EXECUTION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EXECUTION_LIFECYCLE_V2.SUCCEEDED, new Set()],
  [EXECUTION_LIFECYCLE_V2.FAILED, new Set()],
  [EXECUTION_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _EXEC_TERMINALS_V2 = new Set([
  EXECUTION_LIFECYCLE_V2.SUCCEEDED,
  EXECUTION_LIFECYCLE_V2.FAILED,
  EXECUTION_LIFECYCLE_V2.CANCELLED,
]);

export const SKILL_DEFAULT_MAX_ACTIVE_PER_OWNER = 30;
export const SKILL_DEFAULT_MAX_PENDING_EXECUTIONS_PER_SKILL = 5;
export const SKILL_DEFAULT_SKILL_IDLE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SKILL_DEFAULT_EXEC_STUCK_MS = 15 * 60 * 1000; // 15 min

const _stateV2 = {
  skills: new Map(),
  executions: new Map(),
  maxActiveSkillsPerOwner: SKILL_DEFAULT_MAX_ACTIVE_PER_OWNER,
  maxPendingExecutionsPerSkill: SKILL_DEFAULT_MAX_PENDING_EXECUTIONS_PER_SKILL,
  skillIdleMs: SKILL_DEFAULT_SKILL_IDLE_MS,
  execStuckMs: SKILL_DEFAULT_EXEC_STUCK_MS,
};

function _posIntSkillV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer, got ${n}`);
  }
  return v;
}

export function getMaxActiveSkillsPerOwnerV2() {
  return _stateV2.maxActiveSkillsPerOwner;
}

export function setMaxActiveSkillsPerOwnerV2(n) {
  _stateV2.maxActiveSkillsPerOwner = _posIntSkillV2(
    n,
    "maxActiveSkillsPerOwner",
  );
}

export function getMaxPendingExecutionsPerSkillV2() {
  return _stateV2.maxPendingExecutionsPerSkill;
}

export function setMaxPendingExecutionsPerSkillV2(n) {
  _stateV2.maxPendingExecutionsPerSkill = _posIntSkillV2(
    n,
    "maxPendingExecutionsPerSkill",
  );
}

export function getSkillIdleMsV2() {
  return _stateV2.skillIdleMs;
}

export function setSkillIdleMsV2(ms) {
  _stateV2.skillIdleMs = _posIntSkillV2(ms, "skillIdleMs");
}

export function getExecStuckMsV2() {
  return _stateV2.execStuckMs;
}

export function setExecStuckMsV2(ms) {
  _stateV2.execStuckMs = _posIntSkillV2(ms, "execStuckMs");
}

function _copySkillV2(s) {
  return { ...s, metadata: { ...s.metadata } };
}

function _copyExecV2(e) {
  return { ...e, metadata: { ...e.metadata } };
}

export function getActiveSkillCountV2(ownerId) {
  let count = 0;
  for (const s of _stateV2.skills.values()) {
    if (s.ownerId === ownerId && s.status === SKILL_MATURITY_V2.ACTIVE) count++;
  }
  return count;
}

export function getPendingExecutionCountV2(skillId) {
  let count = 0;
  for (const e of _stateV2.executions.values()) {
    if (
      e.skillId === skillId &&
      (e.status === EXECUTION_LIFECYCLE_V2.QUEUED ||
        e.status === EXECUTION_LIFECYCLE_V2.RUNNING)
    ) {
      count++;
    }
  }
  return count;
}

export function registerSkillV2(id, { ownerId, name, layer, metadata } = {}) {
  if (!id) throw new Error("skill id is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (!name) throw new Error("name is required");
  if (_stateV2.skills.has(id)) throw new Error(`skill ${id} already exists`);
  const now = Date.now();
  const skill = {
    id,
    ownerId,
    name,
    layer: layer || "workspace",
    status: SKILL_MATURITY_V2.PENDING,
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateV2.skills.set(id, skill);
  return _copySkillV2(skill);
}

export function getSkillV2(id) {
  const s = _stateV2.skills.get(id);
  return s ? _copySkillV2(s) : null;
}

export function listSkillsV2({ ownerId, status, layer } = {}) {
  const out = [];
  for (const s of _stateV2.skills.values()) {
    if (ownerId && s.ownerId !== ownerId) continue;
    if (status && s.status !== status) continue;
    if (layer && s.layer !== layer) continue;
    out.push(_copySkillV2(s));
  }
  return out;
}

export function setSkillStatusV2(id, next) {
  const s = _stateV2.skills.get(id);
  if (!s) throw new Error(`skill ${id} not found`);
  const allowed = _SKILL_TRANSITIONS_V2.get(s.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid skill transition: ${s.status} → ${next}`);
  }
  if (
    s.status === SKILL_MATURITY_V2.PENDING &&
    next === SKILL_MATURITY_V2.ACTIVE
  ) {
    const count = getActiveSkillCountV2(s.ownerId);
    if (count >= _stateV2.maxActiveSkillsPerOwner) {
      throw new Error(
        `owner ${s.ownerId} active-skill cap reached (${count}/${_stateV2.maxActiveSkillsPerOwner})`,
      );
    }
  }
  const now = Date.now();
  s.status = next;
  s.lastSeenAt = now;
  if (next === SKILL_MATURITY_V2.ACTIVE && !s.activatedAt) s.activatedAt = now;
  if (_SKILL_TERMINALS_V2.has(next) && !s.archivedAt) s.archivedAt = now;
  return _copySkillV2(s);
}

export function activateSkillV2(id) {
  return setSkillStatusV2(id, SKILL_MATURITY_V2.ACTIVE);
}

export function deprecateSkillV2(id) {
  return setSkillStatusV2(id, SKILL_MATURITY_V2.DEPRECATED);
}

export function archiveSkillV2(id) {
  return setSkillStatusV2(id, SKILL_MATURITY_V2.ARCHIVED);
}

export function touchSkillV2(id) {
  const s = _stateV2.skills.get(id);
  if (!s) throw new Error(`skill ${id} not found`);
  s.lastSeenAt = Date.now();
  return _copySkillV2(s);
}

export function createExecutionV2(id, { skillId, kind, metadata } = {}) {
  if (!id) throw new Error("execution id is required");
  if (!skillId) throw new Error("skillId is required");
  if (_stateV2.executions.has(id))
    throw new Error(`execution ${id} already exists`);
  const skill = _stateV2.skills.get(skillId);
  if (!skill) throw new Error(`skill ${skillId} not found`);
  const pending = getPendingExecutionCountV2(skillId);
  if (pending >= _stateV2.maxPendingExecutionsPerSkill) {
    throw new Error(
      `skill ${skillId} pending-execution cap reached (${pending}/${_stateV2.maxPendingExecutionsPerSkill})`,
    );
  }
  const now = Date.now();
  const exec = {
    id,
    skillId,
    kind: kind || "invoke",
    status: EXECUTION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateV2.executions.set(id, exec);
  return _copyExecV2(exec);
}

export function getExecutionV2(id) {
  const e = _stateV2.executions.get(id);
  return e ? _copyExecV2(e) : null;
}

export function listExecutionsV2({ skillId, status } = {}) {
  const out = [];
  for (const e of _stateV2.executions.values()) {
    if (skillId && e.skillId !== skillId) continue;
    if (status && e.status !== status) continue;
    out.push(_copyExecV2(e));
  }
  return out;
}

export function setExecutionStatusV2(id, next) {
  const e = _stateV2.executions.get(id);
  if (!e) throw new Error(`execution ${id} not found`);
  const allowed = _EXEC_TRANSITIONS_V2.get(e.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid execution transition: ${e.status} → ${next}`);
  }
  const now = Date.now();
  e.status = next;
  e.lastSeenAt = now;
  if (next === EXECUTION_LIFECYCLE_V2.RUNNING && !e.startedAt)
    e.startedAt = now;
  if (_EXEC_TERMINALS_V2.has(next) && !e.settledAt) e.settledAt = now;
  return _copyExecV2(e);
}

export function startExecutionV2(id) {
  return setExecutionStatusV2(id, EXECUTION_LIFECYCLE_V2.RUNNING);
}

export function succeedExecutionV2(id) {
  return setExecutionStatusV2(id, EXECUTION_LIFECYCLE_V2.SUCCEEDED);
}

export function failExecutionV2(id) {
  return setExecutionStatusV2(id, EXECUTION_LIFECYCLE_V2.FAILED);
}

export function cancelExecutionV2(id) {
  return setExecutionStatusV2(id, EXECUTION_LIFECYCLE_V2.CANCELLED);
}

export function autoDeprecateIdleSkillsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const s of _stateV2.skills.values()) {
    if (
      s.status === SKILL_MATURITY_V2.ACTIVE &&
      now - s.lastSeenAt > _stateV2.skillIdleMs
    ) {
      s.status = SKILL_MATURITY_V2.DEPRECATED;
      s.lastSeenAt = now;
      flipped.push(_copySkillV2(s));
    }
  }
  return flipped;
}

export function autoFailStuckExecutionsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const e of _stateV2.executions.values()) {
    if (
      e.status === EXECUTION_LIFECYCLE_V2.RUNNING &&
      now - e.lastSeenAt > _stateV2.execStuckMs
    ) {
      e.status = EXECUTION_LIFECYCLE_V2.FAILED;
      e.lastSeenAt = now;
      if (!e.settledAt) e.settledAt = now;
      flipped.push(_copyExecV2(e));
    }
  }
  return flipped;
}

export function getSkillLoaderStatsV2() {
  const skillsByStatus = {};
  for (const v of Object.values(SKILL_MATURITY_V2)) skillsByStatus[v] = 0;
  for (const s of _stateV2.skills.values()) skillsByStatus[s.status]++;

  const executionsByStatus = {};
  for (const v of Object.values(EXECUTION_LIFECYCLE_V2))
    executionsByStatus[v] = 0;
  for (const e of _stateV2.executions.values()) executionsByStatus[e.status]++;

  return {
    totalSkillsV2: _stateV2.skills.size,
    totalExecutionsV2: _stateV2.executions.size,
    maxActiveSkillsPerOwner: _stateV2.maxActiveSkillsPerOwner,
    maxPendingExecutionsPerSkill: _stateV2.maxPendingExecutionsPerSkill,
    skillIdleMs: _stateV2.skillIdleMs,
    execStuckMs: _stateV2.execStuckMs,
    skillsByStatus,
    executionsByStatus,
  };
}

export function _resetStateSkillLoaderV2() {
  _stateV2.skills.clear();
  _stateV2.executions.clear();
  _stateV2.maxActiveSkillsPerOwner = SKILL_DEFAULT_MAX_ACTIVE_PER_OWNER;
  _stateV2.maxPendingExecutionsPerSkill =
    SKILL_DEFAULT_MAX_PENDING_EXECUTIONS_PER_SKILL;
  _stateV2.skillIdleMs = SKILL_DEFAULT_SKILL_IDLE_MS;
  _stateV2.execStuckMs = SKILL_DEFAULT_EXEC_STUCK_MS;
}
