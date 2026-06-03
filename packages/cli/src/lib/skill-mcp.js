/**
 * Skill-Embedded MCP — skills declare their MCP servers inline (v5.0.2.9)
 *
 * Inspired by oh-my-openagent's "Skill-Embedded MCPs" design: instead of
 * forcing users to pre-register MCP servers in a DB, a skill can declare
 * the MCP servers it needs directly in its SKILL.md body. When the skill
 * is activated, its servers are mounted; when the skill exits, they are
 * unmounted. This keeps the agent's tool list scoped and avoids tool
 * explosion across 130+ skills.
 *
 * Declaration format — a fenced code block tagged `mcp-servers` in the
 * SKILL.md body (NOT frontmatter, so no YAML parser changes are needed):
 *
 *   ```mcp-servers
 *   [
 *     {
 *       "name": "weather",
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-weather"]
 *     }
 *   ]
 *   ```
 *
 * The block content must be a JSON array of server configs. Each config
 * requires `name` and `command`; `args`, `env`, and `cwd` are optional.
 *
 * Pure functions only (except mount/unmount which take an MCPClient dep).
 */

/**
 * Parse MCP server declarations from a SKILL.md body.
 * Returns an empty array if no `mcp-servers` code block is present.
 *
 * @param {string} body - The markdown body after YAML frontmatter
 * @returns {Array<object>} Array of validated server configs (may be empty)
 */
export function parseSkillMcpServers(body) {
  if (typeof body !== "string" || body.length === 0) return [];

  // Match fenced code blocks with info string "mcp-servers" or
  // "json mcp-servers". We accept both because some users default to
  // json-tagged blocks for editor highlighting.
  const fenceRegex = /```(?:json\s+)?mcp-servers\s*\n([\s\S]*?)\n```/i;
  const match = body.match(fenceRegex);
  if (!match) return [];

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    // Malformed JSON — return empty, let caller decide whether to warn
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const validated = [];
  for (const entry of parsed) {
    const normalized = validateMcpServerConfig(entry);
    if (normalized) validated.push(normalized);
  }
  return validated;
}

/**
 * Validate a single server config. Returns a normalized frozen object on
 * success, or null on validation failure.
 *
 * @param {object} entry
 * @returns {object | null}
 */
export function validateMcpServerConfig(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
    return null;
  }
  if (typeof entry.command !== "string" || entry.command.trim().length === 0) {
    return null;
  }

  const normalized = {
    name: entry.name.trim(),
    command: entry.command.trim(),
    args: Array.isArray(entry.args)
      ? entry.args.filter((a) => typeof a === "string")
      : [],
  };
  if (entry.env && typeof entry.env === "object" && !Array.isArray(entry.env)) {
    normalized.env = { ...entry.env };
  }
  if (typeof entry.cwd === "string" && entry.cwd.length > 0) {
    normalized.cwd = entry.cwd;
  }
  return Object.freeze(normalized);
}

/**
 * Mount a skill's declared MCP servers on an existing MCPClient.
 * Servers that fail to connect are skipped (errors collected in the
 * result). Returns a handle that can be passed to unmountSkillMcpServers.
 *
 * @param {object} mcpClient - An instance of MCPClient (must expose .connect)
 * @param {object} skill - Skill metadata with `mcpServers` array
 * @param {object} [opts]
 * @param {(msg: string, err?: Error) => void} [opts.onWarn] - Warning hook
 * @returns {Promise<{ mounted: string[], skipped: Array<{ name: string, error: string }> }>}
 */
export async function mountSkillMcpServers(mcpClient, skill, opts = {}) {
  const declared = Array.isArray(skill?.mcpServers) ? skill.mcpServers : [];
  const mounted = [];
  const skipped = [];

  if (declared.length === 0) return { mounted, skipped };
  if (!mcpClient || typeof mcpClient.connect !== "function") {
    throw new Error("mountSkillMcpServers requires an MCPClient with .connect");
  }

  for (const server of declared) {
    const normalized = validateMcpServerConfig(server);
    if (!normalized) {
      skipped.push({
        name: server?.name || "(invalid)",
        error: "invalid config",
      });
      continue;
    }
    try {
      await mcpClient.connect(normalized.name, normalized);
      mounted.push(normalized.name);
    } catch (err) {
      const message = err?.message || String(err);
      skipped.push({ name: normalized.name, error: message });
      if (typeof opts.onWarn === "function") {
        opts.onWarn(
          `[skill-mcp] Failed to mount "${normalized.name}" for skill "${skill?.id || skill?.name}": ${message}`,
          err,
        );
      }
    }
  }

  return { mounted, skipped };
}

/**
 * Unmount previously-mounted skill MCP servers. Safe to call with an
 * empty list or a handle from a failed mount.
 *
 * @param {object} mcpClient - An instance of MCPClient (must expose .disconnect)
 * @param {string[]} mountedNames - Server names to unmount
 * @returns {Promise<{ unmounted: string[], errors: Array<{ name: string, error: string }> }>}
 */
export async function unmountSkillMcpServers(mcpClient, mountedNames) {
  const names = Array.isArray(mountedNames) ? mountedNames : [];
  const unmounted = [];
  const errors = [];

  if (names.length === 0) return { unmounted, errors };
  if (!mcpClient || typeof mcpClient.disconnect !== "function") {
    // Fall back to disconnectAll if present — still not a hard failure
    if (typeof mcpClient?.disconnectAll === "function") {
      try {
        await mcpClient.disconnectAll();
        return { unmounted: names.slice(), errors };
      } catch (err) {
        return {
          unmounted,
          errors: names.map((name) => ({
            name,
            error: err?.message || String(err),
          })),
        };
      }
    }
    throw new Error(
      "unmountSkillMcpServers requires an MCPClient with .disconnect or .disconnectAll",
    );
  }

  for (const name of names) {
    try {
      await mcpClient.disconnect(name);
      unmounted.push(name);
    } catch (err) {
      errors.push({ name, error: err?.message || String(err) });
    }
  }

  return { unmounted, errors };
}

// =====================================================================
// skill-mcp V2 governance overlay (iter27)
// =====================================================================
export const SMCPGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const SMCPGOV_CALL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  INVOKING: "invoking",
  INVOKED: "invoked",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _smcpgovPTrans = new Map([
  [
    SMCPGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SMCPGOV_PROFILE_MATURITY_V2.ACTIVE,
      SMCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SMCPGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SMCPGOV_PROFILE_MATURITY_V2.STALE,
      SMCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SMCPGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      SMCPGOV_PROFILE_MATURITY_V2.ACTIVE,
      SMCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SMCPGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _smcpgovPTerminal = new Set([SMCPGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _smcpgovJTrans = new Map([
  [
    SMCPGOV_CALL_LIFECYCLE_V2.QUEUED,
    new Set([
      SMCPGOV_CALL_LIFECYCLE_V2.INVOKING,
      SMCPGOV_CALL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SMCPGOV_CALL_LIFECYCLE_V2.INVOKING,
    new Set([
      SMCPGOV_CALL_LIFECYCLE_V2.INVOKED,
      SMCPGOV_CALL_LIFECYCLE_V2.FAILED,
      SMCPGOV_CALL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SMCPGOV_CALL_LIFECYCLE_V2.INVOKED, new Set()],
  [SMCPGOV_CALL_LIFECYCLE_V2.FAILED, new Set()],
  [SMCPGOV_CALL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _smcpgovPsV2 = new Map();
const _smcpgovJsV2 = new Map();
let _smcpgovMaxActive = 6,
  _smcpgovMaxPending = 15,
  _smcpgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _smcpgovStuckMs = 60 * 1000;
function _smcpgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _smcpgovCheckP(from, to) {
  const a = _smcpgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid smcpgov profile transition ${from} → ${to}`);
}
function _smcpgovCheckJ(from, to) {
  const a = _smcpgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid smcpgov call transition ${from} → ${to}`);
}
function _smcpgovCountActive(owner) {
  let c = 0;
  for (const p of _smcpgovPsV2.values())
    if (p.owner === owner && p.status === SMCPGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _smcpgovCountPending(profileId) {
  let c = 0;
  for (const j of _smcpgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SMCPGOV_CALL_LIFECYCLE_V2.QUEUED ||
        j.status === SMCPGOV_CALL_LIFECYCLE_V2.INVOKING)
    )
      c++;
  return c;
}
export function setMaxActiveSmcpgovProfilesPerOwnerV2(n) {
  _smcpgovMaxActive = _smcpgovPos(n, "maxActiveSmcpgovProfilesPerOwner");
}
export function getMaxActiveSmcpgovProfilesPerOwnerV2() {
  return _smcpgovMaxActive;
}
export function setMaxPendingSmcpgovCallsPerProfileV2(n) {
  _smcpgovMaxPending = _smcpgovPos(n, "maxPendingSmcpgovCallsPerProfile");
}
export function getMaxPendingSmcpgovCallsPerProfileV2() {
  return _smcpgovMaxPending;
}
export function setSmcpgovProfileIdleMsV2(n) {
  _smcpgovIdleMs = _smcpgovPos(n, "smcpgovProfileIdleMs");
}
export function getSmcpgovProfileIdleMsV2() {
  return _smcpgovIdleMs;
}
export function setSmcpgovCallStuckMsV2(n) {
  _smcpgovStuckMs = _smcpgovPos(n, "smcpgovCallStuckMs");
}
export function getSmcpgovCallStuckMsV2() {
  return _smcpgovStuckMs;
}
export function _resetStateSkillMcpGovV2() {
  _smcpgovPsV2.clear();
  _smcpgovJsV2.clear();
  _smcpgovMaxActive = 6;
  _smcpgovMaxPending = 15;
  _smcpgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _smcpgovStuckMs = 60 * 1000;
}
export function registerSmcpgovProfileV2({ id, owner, server, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_smcpgovPsV2.has(id))
    throw new Error(`smcpgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    server: server || "default",
    status: SMCPGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _smcpgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateSmcpgovProfileV2(id) {
  const p = _smcpgovPsV2.get(id);
  if (!p) throw new Error(`smcpgov profile ${id} not found`);
  const isInitial = p.status === SMCPGOV_PROFILE_MATURITY_V2.PENDING;
  _smcpgovCheckP(p.status, SMCPGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _smcpgovCountActive(p.owner) >= _smcpgovMaxActive)
    throw new Error(`max active smcpgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SMCPGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleSmcpgovProfileV2(id) {
  const p = _smcpgovPsV2.get(id);
  if (!p) throw new Error(`smcpgov profile ${id} not found`);
  _smcpgovCheckP(p.status, SMCPGOV_PROFILE_MATURITY_V2.STALE);
  p.status = SMCPGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSmcpgovProfileV2(id) {
  const p = _smcpgovPsV2.get(id);
  if (!p) throw new Error(`smcpgov profile ${id} not found`);
  _smcpgovCheckP(p.status, SMCPGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SMCPGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSmcpgovProfileV2(id) {
  const p = _smcpgovPsV2.get(id);
  if (!p) throw new Error(`smcpgov profile ${id} not found`);
  if (_smcpgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal smcpgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSmcpgovProfileV2(id) {
  const p = _smcpgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSmcpgovProfilesV2() {
  return [..._smcpgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createSmcpgovCallV2({ id, profileId, tool, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_smcpgovJsV2.has(id))
    throw new Error(`smcpgov call ${id} already exists`);
  if (!_smcpgovPsV2.has(profileId))
    throw new Error(`smcpgov profile ${profileId} not found`);
  if (_smcpgovCountPending(profileId) >= _smcpgovMaxPending)
    throw new Error(
      `max pending smcpgov calls for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    tool: tool || "",
    status: SMCPGOV_CALL_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _smcpgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function invokingSmcpgovCallV2(id) {
  const j = _smcpgovJsV2.get(id);
  if (!j) throw new Error(`smcpgov call ${id} not found`);
  _smcpgovCheckJ(j.status, SMCPGOV_CALL_LIFECYCLE_V2.INVOKING);
  const now = Date.now();
  j.status = SMCPGOV_CALL_LIFECYCLE_V2.INVOKING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeCallSmcpgovV2(id) {
  const j = _smcpgovJsV2.get(id);
  if (!j) throw new Error(`smcpgov call ${id} not found`);
  _smcpgovCheckJ(j.status, SMCPGOV_CALL_LIFECYCLE_V2.INVOKED);
  const now = Date.now();
  j.status = SMCPGOV_CALL_LIFECYCLE_V2.INVOKED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failSmcpgovCallV2(id, reason) {
  const j = _smcpgovJsV2.get(id);
  if (!j) throw new Error(`smcpgov call ${id} not found`);
  _smcpgovCheckJ(j.status, SMCPGOV_CALL_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SMCPGOV_CALL_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelSmcpgovCallV2(id, reason) {
  const j = _smcpgovJsV2.get(id);
  if (!j) throw new Error(`smcpgov call ${id} not found`);
  _smcpgovCheckJ(j.status, SMCPGOV_CALL_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SMCPGOV_CALL_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getSmcpgovCallV2(id) {
  const j = _smcpgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listSmcpgovCallsV2() {
  return [..._smcpgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleSmcpgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _smcpgovPsV2.values())
    if (
      p.status === SMCPGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _smcpgovIdleMs
    ) {
      p.status = SMCPGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSmcpgovCallsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _smcpgovJsV2.values())
    if (
      j.status === SMCPGOV_CALL_LIFECYCLE_V2.INVOKING &&
      j.startedAt != null &&
      t - j.startedAt >= _smcpgovStuckMs
    ) {
      j.status = SMCPGOV_CALL_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSkillMcpGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SMCPGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _smcpgovPsV2.values()) profilesByStatus[p.status]++;
  const callsByStatus = {};
  for (const v of Object.values(SMCPGOV_CALL_LIFECYCLE_V2))
    callsByStatus[v] = 0;
  for (const j of _smcpgovJsV2.values()) callsByStatus[j.status]++;
  return {
    totalSmcpgovProfilesV2: _smcpgovPsV2.size,
    totalSmcpgovCallsV2: _smcpgovJsV2.size,
    maxActiveSmcpgovProfilesPerOwner: _smcpgovMaxActive,
    maxPendingSmcpgovCallsPerProfile: _smcpgovMaxPending,
    smcpgovProfileIdleMs: _smcpgovIdleMs,
    smcpgovCallStuckMs: _smcpgovStuckMs,
    profilesByStatus,
    callsByStatus,
  };
}
