/**
 * Cowork Template MCP Tools — mount a template's declared MCP servers and
 * expose their tools to the sub-agent's LLM.
 *
 * A template can declare `mcpServers: [{ name, command, args, env, cwd }]`
 * (same shape accepted by skill-mcp's validateMcpServerConfig). At task
 * start we spawn an MCPClient, connect each server, list their tools, and
 * build three parallel maps the agent-core runtime already consumes:
 *
 *  - `extraToolDefinitions`    — OpenAI-style function definitions appended
 *    to the tool list the LLM sees.
 *  - `externalToolDescriptors` — descriptor metadata keyed by tool name.
 *  - `externalToolExecutors`   — { kind: "mcp", serverName, toolName } routing
 *    handles that agent-core's default-case switch dispatches through
 *    `mcpClient.callTool(serverName, toolName, args)`.
 *
 * Tool names are prefixed `mcp__<serverName>__<toolName>` to avoid collisions
 * across servers and with built-in AGENT_TOOLS.
 *
 * @module cowork-mcp-tools
 */
import { validateMcpServerConfig } from "./skill-mcp.js";

export const _deps = {
  importMcpClient: async () => {
    const mod = await import("../harness/mcp-client.js");
    return mod.MCPClient;
  },
};

/** Build the namespaced tool name used on the wire. */
export function buildToolName(serverName, toolName) {
  return `mcp__${serverName}__${toolName}`;
}

/**
 * Convert a single MCP tool (from tools/list) into the three shapes
 * agent-core consumes.
 *
 * @param {string} serverName
 * @param {{ name: string, description?: string, inputSchema?: object }} tool
 * @returns {{ definition: object, descriptor: object, executor: object }}
 */
export function toAgentTool(serverName, tool) {
  const wireName = buildToolName(serverName, tool.name);
  return {
    definition: {
      type: "function",
      function: {
        name: wireName,
        description:
          tool.description ||
          `MCP tool "${tool.name}" from server "${serverName}"`,
        parameters: tool.inputSchema || {
          type: "object",
          properties: {},
        },
      },
    },
    descriptor: {
      name: wireName,
      kind: "mcp",
      category: "mcp",
      source: "cowork-template-mcp",
      serverName,
      originalName: tool.name,
    },
    executor: {
      kind: "mcp",
      serverName,
      toolName: tool.name,
    },
  };
}

/**
 * Mount a template's MCP servers and expose their tools. Returns maps ready
 * to hand to SubAgentContext + a cleanup() that disconnects all servers.
 *
 * Failures connecting individual servers are tolerated — the returned
 * `skipped` array lists them with error messages. The whole call only
 * throws if `template.mcpServers` is non-empty but validation produces zero
 * valid configs (caller likely mis-configured the template).
 *
 * @param {{ mcpServers?: Array<object> }} template
 * @param {object} [opts]
 * @param {(msg: string, err?: Error) => void} [opts.onWarn]
 * @returns {Promise<{
 *   mcpClient: object|null,
 *   mounted: string[],
 *   skipped: Array<{ name: string, error: string }>,
 *   extraToolDefinitions: Array<object>,
 *   externalToolDescriptors: Record<string, object>,
 *   externalToolExecutors: Record<string, object>,
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function mountTemplateMcpTools(template, opts = {}) {
  const empty = {
    mcpClient: null,
    mounted: [],
    skipped: [],
    extraToolDefinitions: [],
    externalToolDescriptors: {},
    externalToolExecutors: {},
    cleanup: async () => {},
  };

  const declared = Array.isArray(template?.mcpServers)
    ? template.mcpServers
    : [];
  if (declared.length === 0) return empty;

  const validated = declared
    .map((entry) => validateMcpServerConfig(entry))
    .filter(Boolean);
  if (validated.length === 0) return empty;

  const MCPClient = await _deps.importMcpClient();
  const mcpClient = new MCPClient();
  const mounted = [];
  const skipped = [];
  const extraToolDefinitions = [];
  const externalToolDescriptors = {};
  const externalToolExecutors = {};

  for (const server of validated) {
    try {
      await mcpClient.connect(server.name, server);
      mounted.push(server.name);
      const tools = mcpClient.listTools(server.name);
      for (const tool of tools) {
        const { definition, descriptor, executor } = toAgentTool(
          server.name,
          tool,
        );
        extraToolDefinitions.push(definition);
        externalToolDescriptors[definition.function.name] = descriptor;
        externalToolExecutors[definition.function.name] = executor;
      }
    } catch (err) {
      const message = err?.message || String(err);
      skipped.push({ name: server.name, error: message });
      if (typeof opts.onWarn === "function") {
        opts.onWarn(
          `[cowork-mcp] Failed to mount "${server.name}": ${message}`,
          err,
        );
      }
    }
  }

  const cleanup = async () => {
    if (typeof mcpClient.disconnectAll === "function") {
      try {
        await mcpClient.disconnectAll();
        return;
      } catch (_e) {
        // fall through to per-server disconnect
      }
    }
    for (const name of mounted) {
      try {
        if (typeof mcpClient.disconnect === "function") {
          await mcpClient.disconnect(name);
        }
      } catch (_e) {
        // swallow — cleanup must not fail the task
      }
    }
  };

  return {
    mcpClient,
    mounted,
    skipped,
    extraToolDefinitions,
    externalToolDescriptors,
    externalToolExecutors,
    cleanup,
  };
}

// =====================================================================
// cowork-mcp-tools V2 governance overlay (iter27)
// =====================================================================
export const CMCPGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const CMCPGOV_EXEC_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cmcpgovPTrans = new Map([
  [
    CMCPGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CMCPGOV_PROFILE_MATURITY_V2.ACTIVE,
      CMCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CMCPGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CMCPGOV_PROFILE_MATURITY_V2.STALE,
      CMCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CMCPGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      CMCPGOV_PROFILE_MATURITY_V2.ACTIVE,
      CMCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CMCPGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cmcpgovPTerminal = new Set([CMCPGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _cmcpgovJTrans = new Map([
  [
    CMCPGOV_EXEC_LIFECYCLE_V2.QUEUED,
    new Set([
      CMCPGOV_EXEC_LIFECYCLE_V2.RUNNING,
      CMCPGOV_EXEC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CMCPGOV_EXEC_LIFECYCLE_V2.RUNNING,
    new Set([
      CMCPGOV_EXEC_LIFECYCLE_V2.COMPLETED,
      CMCPGOV_EXEC_LIFECYCLE_V2.FAILED,
      CMCPGOV_EXEC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CMCPGOV_EXEC_LIFECYCLE_V2.COMPLETED, new Set()],
  [CMCPGOV_EXEC_LIFECYCLE_V2.FAILED, new Set()],
  [CMCPGOV_EXEC_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cmcpgovPsV2 = new Map();
const _cmcpgovJsV2 = new Map();
let _cmcpgovMaxActive = 8,
  _cmcpgovMaxPending = 20,
  _cmcpgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cmcpgovStuckMs = 60 * 1000;
function _cmcpgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cmcpgovCheckP(from, to) {
  const a = _cmcpgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cmcpgov profile transition ${from} → ${to}`);
}
function _cmcpgovCheckJ(from, to) {
  const a = _cmcpgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cmcpgov exec transition ${from} → ${to}`);
}
function _cmcpgovCountActive(owner) {
  let c = 0;
  for (const p of _cmcpgovPsV2.values())
    if (p.owner === owner && p.status === CMCPGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _cmcpgovCountPending(profileId) {
  let c = 0;
  for (const j of _cmcpgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CMCPGOV_EXEC_LIFECYCLE_V2.QUEUED ||
        j.status === CMCPGOV_EXEC_LIFECYCLE_V2.RUNNING)
    )
      c++;
  return c;
}
export function setMaxActiveCmcpgovProfilesPerOwnerV2(n) {
  _cmcpgovMaxActive = _cmcpgovPos(n, "maxActiveCmcpgovProfilesPerOwner");
}
export function getMaxActiveCmcpgovProfilesPerOwnerV2() {
  return _cmcpgovMaxActive;
}
export function setMaxPendingCmcpgovExecsPerProfileV2(n) {
  _cmcpgovMaxPending = _cmcpgovPos(n, "maxPendingCmcpgovExecsPerProfile");
}
export function getMaxPendingCmcpgovExecsPerProfileV2() {
  return _cmcpgovMaxPending;
}
export function setCmcpgovProfileIdleMsV2(n) {
  _cmcpgovIdleMs = _cmcpgovPos(n, "cmcpgovProfileIdleMs");
}
export function getCmcpgovProfileIdleMsV2() {
  return _cmcpgovIdleMs;
}
export function setCmcpgovExecStuckMsV2(n) {
  _cmcpgovStuckMs = _cmcpgovPos(n, "cmcpgovExecStuckMs");
}
export function getCmcpgovExecStuckMsV2() {
  return _cmcpgovStuckMs;
}
export function _resetStateCoworkMcpToolsGovV2() {
  _cmcpgovPsV2.clear();
  _cmcpgovJsV2.clear();
  _cmcpgovMaxActive = 8;
  _cmcpgovMaxPending = 20;
  _cmcpgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cmcpgovStuckMs = 60 * 1000;
}
export function registerCmcpgovProfileV2({
  id,
  owner,
  toolset,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cmcpgovPsV2.has(id))
    throw new Error(`cmcpgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    toolset: toolset || "default",
    status: CMCPGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cmcpgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCmcpgovProfileV2(id) {
  const p = _cmcpgovPsV2.get(id);
  if (!p) throw new Error(`cmcpgov profile ${id} not found`);
  const isInitial = p.status === CMCPGOV_PROFILE_MATURITY_V2.PENDING;
  _cmcpgovCheckP(p.status, CMCPGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cmcpgovCountActive(p.owner) >= _cmcpgovMaxActive)
    throw new Error(`max active cmcpgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CMCPGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleCmcpgovProfileV2(id) {
  const p = _cmcpgovPsV2.get(id);
  if (!p) throw new Error(`cmcpgov profile ${id} not found`);
  _cmcpgovCheckP(p.status, CMCPGOV_PROFILE_MATURITY_V2.STALE);
  p.status = CMCPGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCmcpgovProfileV2(id) {
  const p = _cmcpgovPsV2.get(id);
  if (!p) throw new Error(`cmcpgov profile ${id} not found`);
  _cmcpgovCheckP(p.status, CMCPGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CMCPGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCmcpgovProfileV2(id) {
  const p = _cmcpgovPsV2.get(id);
  if (!p) throw new Error(`cmcpgov profile ${id} not found`);
  if (_cmcpgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cmcpgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCmcpgovProfileV2(id) {
  const p = _cmcpgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCmcpgovProfilesV2() {
  return [..._cmcpgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCmcpgovExecV2({ id, profileId, tool, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cmcpgovJsV2.has(id))
    throw new Error(`cmcpgov exec ${id} already exists`);
  if (!_cmcpgovPsV2.has(profileId))
    throw new Error(`cmcpgov profile ${profileId} not found`);
  if (_cmcpgovCountPending(profileId) >= _cmcpgovMaxPending)
    throw new Error(
      `max pending cmcpgov execs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    tool: tool || "",
    status: CMCPGOV_EXEC_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cmcpgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function runningCmcpgovExecV2(id) {
  const j = _cmcpgovJsV2.get(id);
  if (!j) throw new Error(`cmcpgov exec ${id} not found`);
  _cmcpgovCheckJ(j.status, CMCPGOV_EXEC_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = CMCPGOV_EXEC_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeExecCmcpgovV2(id) {
  const j = _cmcpgovJsV2.get(id);
  if (!j) throw new Error(`cmcpgov exec ${id} not found`);
  _cmcpgovCheckJ(j.status, CMCPGOV_EXEC_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  j.status = CMCPGOV_EXEC_LIFECYCLE_V2.COMPLETED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCmcpgovExecV2(id, reason) {
  const j = _cmcpgovJsV2.get(id);
  if (!j) throw new Error(`cmcpgov exec ${id} not found`);
  _cmcpgovCheckJ(j.status, CMCPGOV_EXEC_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CMCPGOV_EXEC_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCmcpgovExecV2(id, reason) {
  const j = _cmcpgovJsV2.get(id);
  if (!j) throw new Error(`cmcpgov exec ${id} not found`);
  _cmcpgovCheckJ(j.status, CMCPGOV_EXEC_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CMCPGOV_EXEC_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCmcpgovExecV2(id) {
  const j = _cmcpgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCmcpgovExecsV2() {
  return [..._cmcpgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleCmcpgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cmcpgovPsV2.values())
    if (
      p.status === CMCPGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cmcpgovIdleMs
    ) {
      p.status = CMCPGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCmcpgovExecsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cmcpgovJsV2.values())
    if (
      j.status === CMCPGOV_EXEC_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _cmcpgovStuckMs
    ) {
      j.status = CMCPGOV_EXEC_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkMcpToolsGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CMCPGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cmcpgovPsV2.values()) profilesByStatus[p.status]++;
  const execsByStatus = {};
  for (const v of Object.values(CMCPGOV_EXEC_LIFECYCLE_V2))
    execsByStatus[v] = 0;
  for (const j of _cmcpgovJsV2.values()) execsByStatus[j.status]++;
  return {
    totalCmcpgovProfilesV2: _cmcpgovPsV2.size,
    totalCmcpgovExecsV2: _cmcpgovJsV2.size,
    maxActiveCmcpgovProfilesPerOwner: _cmcpgovMaxActive,
    maxPendingCmcpgovExecsPerProfile: _cmcpgovMaxPending,
    cmcpgovProfileIdleMs: _cmcpgovIdleMs,
    cmcpgovExecStuckMs: _cmcpgovStuckMs,
    profilesByStatus,
    execsByStatus,
  };
}
