/**
 * Sub-Agent Profiles — declarative registry of subagent roles.
 *
 * Inspired by open-agents SUBAGENT_REGISTRY. Separate from the runtime
 * `sub-agent-registry.js` which tracks *instances*; this module describes
 * the *kinds* (explorer/executor/design) a parent agent may delegate to.
 *
 * Each profile defines:
 *  - name           stable identifier used by spawn_sub_agent
 *  - shortDescription  one-line hook for the parent prompt
 *  - systemPrompt      prepended to sub-agent messages[0]
 *  - toolAllowlist     array of tool names the sub-agent may call
 *                      (null = inherit all)
 *  - maxIterations     optional per-profile iteration cap
 *  - modelHint         optional { category } hint for llm-manager
 */

const READONLY_TOOLS = Object.freeze([
  "read_file",
  "list_dir",
  "search_files",
  "search_sessions",
  "web_fetch",
  "list_skills",
]);

const FULL_TOOLS = Object.freeze([
  "read_file",
  "write_file",
  "edit_file",
  "edit_file_hashed",
  "list_dir",
  "search_files",
  "search_sessions",
  "run_shell",
  "git",
  "run_code",
  "run_skill",
  "list_skills",
  "web_fetch",
  "todo_write",
  "ask_user_question",
]);

const DESIGN_TOOLS = Object.freeze([
  "read_file",
  "write_file",
  "edit_file",
  "edit_file_hashed",
  "list_dir",
  "search_files",
  "web_fetch",
  "run_skill",
  "list_skills",
  "todo_write",
]);

const _builtinProfiles = {
  explorer: {
    name: "explorer",
    shortDescription:
      "Read-only researcher. Investigates code, searches files/sessions, fetches web docs. Cannot write or execute.",
    systemPrompt:
      "You are a read-only research sub-agent. Your job is to gather facts and report back concisely. You MUST NOT write files or execute commands. When done, return a structured summary of findings.",
    toolAllowlist: READONLY_TOOLS,
    maxIterations: 20,
    modelHint: { category: "quick" },
  },
  executor: {
    name: "executor",
    shortDescription:
      "Full-permission implementer. Writes code, runs tests, executes shell/git. Use for end-to-end task completion.",
    systemPrompt:
      "You are a full-permission execution sub-agent. Implement the task to completion. Prefer edit_file_hashed over edit_file. Always verify with tests/build when relevant. Return a summary plus list of files changed.",
    toolAllowlist: FULL_TOOLS,
    maxIterations: 40,
    modelHint: { category: "deep" },
  },
  design: {
    name: "design",
    shortDescription:
      "Frontend/UI specialist. Produces polished Vue/React/HTML with distinctive aesthetics. No shell/git access.",
    systemPrompt:
      "You are a frontend design sub-agent. Produce high-quality, production-grade UI code. Avoid generic AI aesthetics. Prefer semantic HTML, accessible components, and thoughtful typography. You may read/write files and fetch references from the web, but cannot run shell or git.",
    toolAllowlist: DESIGN_TOOLS,
    maxIterations: 30,
    modelHint: { category: "creative" },
  },
};

const _registry = new Map(Object.entries(_builtinProfiles));

export function getSubAgentProfile(name) {
  if (!name) return null;
  const entry = _registry.get(name);
  if (!entry) return null;
  return {
    ...entry,
    toolAllowlist: Array.isArray(entry.toolAllowlist)
      ? [...entry.toolAllowlist]
      : null,
  };
}

export function listSubAgentProfiles() {
  return Array.from(_registry.values()).map((p) => ({
    ...p,
    toolAllowlist: Array.isArray(p.toolAllowlist) ? [...p.toolAllowlist] : null,
  }));
}

/**
 * Register a custom profile (or override a built-in).
 * Returns true on success, false on invalid input.
 */
export function registerSubAgentProfile(profile) {
  if (!profile || typeof profile.name !== "string" || !profile.name) {
    return false;
  }
  if (typeof profile.shortDescription !== "string") return false;
  if (typeof profile.systemPrompt !== "string") return false;
  const toolAllowlist = Array.isArray(profile.toolAllowlist)
    ? [...profile.toolAllowlist]
    : null;
  _registry.set(profile.name, {
    name: profile.name,
    shortDescription: profile.shortDescription,
    systemPrompt: profile.systemPrompt,
    toolAllowlist,
    maxIterations:
      typeof profile.maxIterations === "number" ? profile.maxIterations : 20,
    modelHint: profile.modelHint || null,
  });
  return true;
}

export function unregisterSubAgentProfile(name) {
  return _registry.delete(name);
}

export function resetToBuiltins() {
  _registry.clear();
  for (const [k, v] of Object.entries(_builtinProfiles)) {
    _registry.set(k, v);
  }
}

/**
 * Build a one-section system-prompt snippet listing available subagents.
 * Inspired by open-agents buildSubagentSummaryLines.
 *
 * @returns {string}
 */
export function buildSubagentSummaryLines() {
  const profiles = listSubAgentProfiles();
  if (profiles.length === 0) return "";
  const lines = ["## Available sub-agents (via spawn_sub_agent)"];
  for (const p of profiles) {
    lines.push(`- **${p.name}**: ${p.shortDescription}`);
  }
  return lines.join("\n");
}

export const _deps = { _registry, _builtinProfiles };

// =====================================================================
// sub-agent-profiles V2 governance overlay (iter27)
// =====================================================================
export const SAPGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const SAPGOV_APPLY_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  APPLYING: "applying",
  APPLIED: "applied",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _sapgovPTrans = new Map([
  [
    SAPGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SAPGOV_PROFILE_MATURITY_V2.ACTIVE,
      SAPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SAPGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SAPGOV_PROFILE_MATURITY_V2.SUSPENDED,
      SAPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SAPGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      SAPGOV_PROFILE_MATURITY_V2.ACTIVE,
      SAPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SAPGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _sapgovPTerminal = new Set([SAPGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _sapgovJTrans = new Map([
  [
    SAPGOV_APPLY_LIFECYCLE_V2.QUEUED,
    new Set([
      SAPGOV_APPLY_LIFECYCLE_V2.APPLYING,
      SAPGOV_APPLY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SAPGOV_APPLY_LIFECYCLE_V2.APPLYING,
    new Set([
      SAPGOV_APPLY_LIFECYCLE_V2.APPLIED,
      SAPGOV_APPLY_LIFECYCLE_V2.FAILED,
      SAPGOV_APPLY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SAPGOV_APPLY_LIFECYCLE_V2.APPLIED, new Set()],
  [SAPGOV_APPLY_LIFECYCLE_V2.FAILED, new Set()],
  [SAPGOV_APPLY_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _sapgovPsV2 = new Map();
const _sapgovJsV2 = new Map();
let _sapgovMaxActive = 8,
  _sapgovMaxPending = 20,
  _sapgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _sapgovStuckMs = 60 * 1000;
function _sapgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _sapgovCheckP(from, to) {
  const a = _sapgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid sapgov profile transition ${from} → ${to}`);
}
function _sapgovCheckJ(from, to) {
  const a = _sapgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid sapgov apply transition ${from} → ${to}`);
}
function _sapgovCountActive(owner) {
  let c = 0;
  for (const p of _sapgovPsV2.values())
    if (p.owner === owner && p.status === SAPGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _sapgovCountPending(profileId) {
  let c = 0;
  for (const j of _sapgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SAPGOV_APPLY_LIFECYCLE_V2.QUEUED ||
        j.status === SAPGOV_APPLY_LIFECYCLE_V2.APPLYING)
    )
      c++;
  return c;
}
export function setMaxActiveSapgovProfilesPerOwnerV2(n) {
  _sapgovMaxActive = _sapgovPos(n, "maxActiveSapgovProfilesPerOwner");
}
export function getMaxActiveSapgovProfilesPerOwnerV2() {
  return _sapgovMaxActive;
}
export function setMaxPendingSapgovApplysPerProfileV2(n) {
  _sapgovMaxPending = _sapgovPos(n, "maxPendingSapgovApplysPerProfile");
}
export function getMaxPendingSapgovApplysPerProfileV2() {
  return _sapgovMaxPending;
}
export function setSapgovProfileIdleMsV2(n) {
  _sapgovIdleMs = _sapgovPos(n, "sapgovProfileIdleMs");
}
export function getSapgovProfileIdleMsV2() {
  return _sapgovIdleMs;
}
export function setSapgovApplyStuckMsV2(n) {
  _sapgovStuckMs = _sapgovPos(n, "sapgovApplyStuckMs");
}
export function getSapgovApplyStuckMsV2() {
  return _sapgovStuckMs;
}
export function _resetStateSubAgentProfilesGovV2() {
  _sapgovPsV2.clear();
  _sapgovJsV2.clear();
  _sapgovMaxActive = 8;
  _sapgovMaxPending = 20;
  _sapgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _sapgovStuckMs = 60 * 1000;
}
export function registerSapgovProfileV2({ id, owner, role, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_sapgovPsV2.has(id))
    throw new Error(`sapgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    role: role || "general",
    status: SAPGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _sapgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateSapgovProfileV2(id) {
  const p = _sapgovPsV2.get(id);
  if (!p) throw new Error(`sapgov profile ${id} not found`);
  const isInitial = p.status === SAPGOV_PROFILE_MATURITY_V2.PENDING;
  _sapgovCheckP(p.status, SAPGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _sapgovCountActive(p.owner) >= _sapgovMaxActive)
    throw new Error(`max active sapgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SAPGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendSapgovProfileV2(id) {
  const p = _sapgovPsV2.get(id);
  if (!p) throw new Error(`sapgov profile ${id} not found`);
  _sapgovCheckP(p.status, SAPGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = SAPGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSapgovProfileV2(id) {
  const p = _sapgovPsV2.get(id);
  if (!p) throw new Error(`sapgov profile ${id} not found`);
  _sapgovCheckP(p.status, SAPGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SAPGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSapgovProfileV2(id) {
  const p = _sapgovPsV2.get(id);
  if (!p) throw new Error(`sapgov profile ${id} not found`);
  if (_sapgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal sapgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSapgovProfileV2(id) {
  const p = _sapgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSapgovProfilesV2() {
  return [..._sapgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createSapgovApplyV2({ id, profileId, agentId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_sapgovJsV2.has(id)) throw new Error(`sapgov apply ${id} already exists`);
  if (!_sapgovPsV2.has(profileId))
    throw new Error(`sapgov profile ${profileId} not found`);
  if (_sapgovCountPending(profileId) >= _sapgovMaxPending)
    throw new Error(
      `max pending sapgov applys for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    agentId: agentId || "",
    status: SAPGOV_APPLY_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _sapgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function applyingSapgovApplyV2(id) {
  const j = _sapgovJsV2.get(id);
  if (!j) throw new Error(`sapgov apply ${id} not found`);
  _sapgovCheckJ(j.status, SAPGOV_APPLY_LIFECYCLE_V2.APPLYING);
  const now = Date.now();
  j.status = SAPGOV_APPLY_LIFECYCLE_V2.APPLYING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeApplySapgovV2(id) {
  const j = _sapgovJsV2.get(id);
  if (!j) throw new Error(`sapgov apply ${id} not found`);
  _sapgovCheckJ(j.status, SAPGOV_APPLY_LIFECYCLE_V2.APPLIED);
  const now = Date.now();
  j.status = SAPGOV_APPLY_LIFECYCLE_V2.APPLIED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failSapgovApplyV2(id, reason) {
  const j = _sapgovJsV2.get(id);
  if (!j) throw new Error(`sapgov apply ${id} not found`);
  _sapgovCheckJ(j.status, SAPGOV_APPLY_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SAPGOV_APPLY_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelSapgovApplyV2(id, reason) {
  const j = _sapgovJsV2.get(id);
  if (!j) throw new Error(`sapgov apply ${id} not found`);
  _sapgovCheckJ(j.status, SAPGOV_APPLY_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SAPGOV_APPLY_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getSapgovApplyV2(id) {
  const j = _sapgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listSapgovApplysV2() {
  return [..._sapgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleSapgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _sapgovPsV2.values())
    if (
      p.status === SAPGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _sapgovIdleMs
    ) {
      p.status = SAPGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSapgovApplysV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _sapgovJsV2.values())
    if (
      j.status === SAPGOV_APPLY_LIFECYCLE_V2.APPLYING &&
      j.startedAt != null &&
      t - j.startedAt >= _sapgovStuckMs
    ) {
      j.status = SAPGOV_APPLY_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSubAgentProfilesGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SAPGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _sapgovPsV2.values()) profilesByStatus[p.status]++;
  const applysByStatus = {};
  for (const v of Object.values(SAPGOV_APPLY_LIFECYCLE_V2))
    applysByStatus[v] = 0;
  for (const j of _sapgovJsV2.values()) applysByStatus[j.status]++;
  return {
    totalSapgovProfilesV2: _sapgovPsV2.size,
    totalSapgovApplysV2: _sapgovJsV2.size,
    maxActiveSapgovProfilesPerOwner: _sapgovMaxActive,
    maxPendingSapgovApplysPerProfile: _sapgovMaxPending,
    sapgovProfileIdleMs: _sapgovIdleMs,
    sapgovApplyStuckMs: _sapgovStuckMs,
    profilesByStatus,
    applysByStatus,
  };
}
