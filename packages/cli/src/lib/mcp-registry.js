/**
 * MCP community server registry — pure read-only catalog.
 *
 * Ships a bundled list of well-known community MCP servers so users can
 * discover, search, and one-shot install them without maintaining a
 * remote index. Mirrors the curated catalog from
 * `desktop-app-vue/src/main/mcp/community-registry.js` but pared down
 * to what the CLI actually needs: browse + search + hand the chosen
 * entry to `mcp add`.
 *
 * The catalog is intentionally small (the 8 first-party
 * `@modelcontextprotocol/server-*` packages). Users who want more can
 * still `cc mcp add` any server by hand — the registry is a
 * convenience, not the source of truth for which servers exist.
 */

/* ── constants ──────────────────────────────────────────────── */

export const CATEGORIES = Object.freeze([
  "database",
  "filesystem",
  "version-control",
  "search",
  "automation",
  "communication",
  "cloud",
  "productivity",
]);

export const TRANSPORTS = Object.freeze(["stdio", "http"]);

/**
 * Bundled catalog. Frozen at module load — treat as read-only. Each
 * entry carries enough for `cc mcp add` to wire it up verbatim
 * (command + args) plus prose/examples that help the agent REPL
 * decide when to use it.
 */
export const CATALOG = Object.freeze([
  {
    id: "mcp-server-filesystem",
    name: "filesystem",
    displayName: "File System",
    description:
      "File system access — read, write, list, and manage files and directories.",
    version: "1.0.0",
    author: "Anthropic",
    category: "filesystem",
    tags: ["file", "directory", "read", "write", "filesystem"],
    npmPackage: "@modelcontextprotocol/server-filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    transport: "stdio",
    tools: [
      "read_file",
      "write_file",
      "list_directory",
      "create_directory",
      "move_file",
      "search_files",
      "get_file_info",
    ],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    rating: 5.0,
  },
  {
    id: "mcp-server-postgresql",
    name: "postgresql",
    displayName: "PostgreSQL",
    description:
      "PostgreSQL database — execute queries, inspect schema, manage data.",
    version: "1.0.0",
    author: "Anthropic",
    category: "database",
    tags: ["database", "sql", "postgresql", "postgres", "query"],
    npmPackage: "@modelcontextprotocol/server-postgres",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    transport: "stdio",
    tools: ["query", "list_tables", "describe_table"],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    rating: 4.8,
  },
  {
    id: "mcp-server-sqlite",
    name: "sqlite",
    displayName: "SQLite",
    description:
      "SQLite database — local, embedded query execution and schema management.",
    version: "1.0.0",
    author: "Anthropic",
    category: "database",
    tags: ["database", "sql", "sqlite", "local", "embedded"],
    npmPackage: "@modelcontextprotocol/server-sqlite",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    transport: "stdio",
    tools: [
      "read_query",
      "write_query",
      "create_table",
      "list_tables",
      "describe_table",
      "append_insight",
    ],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    rating: 4.7,
  },
  {
    id: "mcp-server-git",
    name: "git",
    displayName: "Git",
    description:
      "Git version control — status, diff, log, commit, branch management.",
    version: "1.0.0",
    author: "Anthropic",
    category: "version-control",
    tags: ["git", "version-control", "diff", "commit", "branch"],
    npmPackage: "@modelcontextprotocol/server-git",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    transport: "stdio",
    tools: [
      "git_status",
      "git_diff",
      "git_log",
      "git_commit",
      "git_branch_list",
      "git_checkout",
    ],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    rating: 4.9,
  },
  {
    id: "mcp-server-brave-search",
    name: "brave-search",
    displayName: "Brave Search",
    description:
      "Web search via Brave Search API — general web + local business queries.",
    version: "1.0.0",
    author: "Anthropic",
    category: "search",
    tags: ["search", "web", "brave", "internet", "query"],
    npmPackage: "@modelcontextprotocol/server-brave-search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    transport: "stdio",
    tools: ["brave_web_search", "brave_local_search"],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    rating: 4.6,
  },
  {
    id: "mcp-server-puppeteer",
    name: "puppeteer",
    displayName: "Puppeteer",
    description:
      "Browser automation — navigate, screenshot, click, fill forms, evaluate JS.",
    version: "1.0.0",
    author: "Anthropic",
    category: "automation",
    tags: ["browser", "automation", "puppeteer", "scraping", "screenshot"],
    npmPackage: "@modelcontextprotocol/server-puppeteer",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    transport: "stdio",
    tools: [
      "puppeteer_navigate",
      "puppeteer_screenshot",
      "puppeteer_click",
      "puppeteer_fill",
      "puppeteer_evaluate",
    ],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    rating: 4.5,
  },
  {
    id: "mcp-server-slack",
    name: "slack",
    displayName: "Slack",
    description:
      "Slack workspace — read messages, post updates, manage channels and threads.",
    version: "1.0.0",
    author: "Anthropic",
    category: "communication",
    tags: ["slack", "messaging", "chat", "communication", "team"],
    npmPackage: "@modelcontextprotocol/server-slack",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    transport: "stdio",
    tools: [
      "slack_list_channels",
      "slack_post_message",
      "slack_reply_to_thread",
      "slack_get_channel_history",
      "slack_search_messages",
    ],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    rating: 4.4,
  },
  {
    id: "mcp-server-github",
    name: "github",
    displayName: "GitHub",
    description:
      "GitHub API — manage repositories, issues, pull requests, and actions.",
    version: "1.0.0",
    author: "Anthropic",
    category: "version-control",
    tags: ["github", "repository", "issues", "pull-request", "api"],
    npmPackage: "@modelcontextprotocol/server-github",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    transport: "stdio",
    tools: [
      "create_or_update_file",
      "search_repositories",
      "create_repository",
      "get_file_contents",
      "push_files",
      "create_issue",
      "create_pull_request",
      "list_issues",
      "list_commits",
    ],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    rating: 4.8,
  },
]);

/* ── public API ─────────────────────────────────────────────── */

/**
 * Return the catalog filtered, sorted, and paginated.
 *
 * @param {object} [filters]
 * @param {string} [filters.category]
 * @param {string[]} [filters.tags]        — any-match
 * @param {string} [filters.author]        — substring, case-insensitive
 * @param {"name"|"rating"|"category"} [filters.sortBy="name"]
 * @param {"asc"|"desc"} [filters.sortOrder="asc"]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {{ servers: object[], total: number }}
 */
export function listServers(filters = {}) {
  let servers = CATALOG.slice();

  if (filters.category) {
    const cat = String(filters.category).toLowerCase();
    servers = servers.filter((s) => s.category === cat);
  }

  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    const wanted = new Set(filters.tags.map((t) => String(t).toLowerCase()));
    servers = servers.filter(
      (s) => s.tags && s.tags.some((tag) => wanted.has(tag.toLowerCase())),
    );
  }

  if (filters.author) {
    const a = String(filters.author).toLowerCase();
    servers = servers.filter(
      (s) => s.author && s.author.toLowerCase().includes(a),
    );
  }

  const total = servers.length;

  const sortBy = filters.sortBy || "name";
  const sortDir = filters.sortOrder === "desc" ? -1 : 1;
  servers = servers.slice().sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * sortDir;
    }
    return String(av ?? "").localeCompare(String(bv ?? "")) * sortDir;
  });

  const offset =
    Number.isInteger(filters.offset) && filters.offset > 0 ? filters.offset : 0;
  const limit =
    Number.isInteger(filters.limit) && filters.limit > 0
      ? filters.limit
      : servers.length;
  servers = servers.slice(offset, offset + limit);

  return { servers, total };
}

/**
 * Keyword search across `name`, `displayName`, `description`, and `tags`.
 * Returns matches ranked by a simple weighted score — name/id are
 * weighted highest, then tags, then description.
 */
export function searchServers(keyword) {
  if (typeof keyword !== "string" || !keyword.trim()) return [];
  const q = keyword.trim().toLowerCase();

  const scored = [];
  for (const entry of CATALOG) {
    let score = 0;
    if (entry.name && entry.name.toLowerCase() === q) score += 100;
    else if (entry.name && entry.name.toLowerCase().includes(q)) score += 40;
    if (entry.id.toLowerCase().includes(q)) score += 20;
    if (entry.displayName && entry.displayName.toLowerCase().includes(q)) {
      score += 30;
    }
    if (Array.isArray(entry.tags)) {
      for (const tag of entry.tags) {
        if (tag.toLowerCase() === q) score += 25;
        else if (tag.toLowerCase().includes(q)) score += 10;
      }
    }
    if (entry.description && entry.description.toLowerCase().includes(q)) {
      score += 15;
    }
    if (entry.category && entry.category.toLowerCase().includes(q)) {
      score += 10;
    }
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

/**
 * Look up a catalog entry by `id` or by `name`. Returns `null` if
 * neither matches. Matching is case-insensitive.
 */
export function getServer(idOrName) {
  if (typeof idOrName !== "string" || !idOrName.trim()) return null;
  const needle = idOrName.trim().toLowerCase();
  return (
    CATALOG.find(
      (s) => s.id.toLowerCase() === needle || s.name.toLowerCase() === needle,
    ) || null
  );
}

// ===== V2 Surface (cli 0.131.0) — in-memory governance =====
export const MCP_SERVER_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  RETIRED: "retired",
});
export const MCP_INVOCATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _MS_V2 = MCP_SERVER_MATURITY_V2;
const _MI_V2 = MCP_INVOCATION_LIFECYCLE_V2;
const _MS_TRANS_V2 = new Map([
  [_MS_V2.PENDING, new Set([_MS_V2.ACTIVE, _MS_V2.RETIRED])],
  [_MS_V2.ACTIVE, new Set([_MS_V2.DEGRADED, _MS_V2.RETIRED])],
  [_MS_V2.DEGRADED, new Set([_MS_V2.ACTIVE, _MS_V2.RETIRED])],
  [_MS_V2.RETIRED, new Set()],
]);
const _MI_TRANS_V2 = new Map([
  [_MI_V2.QUEUED, new Set([_MI_V2.DISPATCHING, _MI_V2.CANCELLED])],
  [
    _MI_V2.DISPATCHING,
    new Set([_MI_V2.COMPLETED, _MI_V2.FAILED, _MI_V2.CANCELLED]),
  ],
  [_MI_V2.COMPLETED, new Set()],
  [_MI_V2.FAILED, new Set()],
  [_MI_V2.CANCELLED, new Set()],
]);
const _MI_TERM_V2 = new Set([
  _MI_V2.COMPLETED,
  _MI_V2.FAILED,
  _MI_V2.CANCELLED,
]);

const MCP_DEFAULT_MAX_ACTIVE_SERVERS_PER_OWNER = 10;
const MCP_DEFAULT_MAX_PENDING_INVOCATIONS_PER_SERVER = 20;
const MCP_DEFAULT_SERVER_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const MCP_DEFAULT_INVOCATION_STUCK_MS = 2 * 60 * 1000;

const _mcpServersV2 = new Map();
const _mcpInvocationsV2 = new Map();
let _mcpConfigV2 = {
  maxActiveServersPerOwner: MCP_DEFAULT_MAX_ACTIVE_SERVERS_PER_OWNER,
  maxPendingInvocationsPerServer:
    MCP_DEFAULT_MAX_PENDING_INVOCATIONS_PER_SERVER,
  serverIdleMs: MCP_DEFAULT_SERVER_IDLE_MS,
  invocationStuckMs: MCP_DEFAULT_INVOCATION_STUCK_MS,
};

function _mcpPosIntV2(n, label) {
  if (typeof n !== "number" || !isFinite(n) || isNaN(n))
    throw new Error(`${label} must be positive integer`);
  const v = Math.floor(n);
  if (v <= 0) throw new Error(`${label} must be positive integer`);
  return v;
}

export function _resetStateMcpRegistryV2() {
  _mcpServersV2.clear();
  _mcpInvocationsV2.clear();
  _mcpConfigV2 = {
    maxActiveServersPerOwner: MCP_DEFAULT_MAX_ACTIVE_SERVERS_PER_OWNER,
    maxPendingInvocationsPerServer:
      MCP_DEFAULT_MAX_PENDING_INVOCATIONS_PER_SERVER,
    serverIdleMs: MCP_DEFAULT_SERVER_IDLE_MS,
    invocationStuckMs: MCP_DEFAULT_INVOCATION_STUCK_MS,
  };
}

export function setMaxActiveServersPerOwnerV2(n) {
  _mcpConfigV2.maxActiveServersPerOwner = _mcpPosIntV2(
    n,
    "maxActiveServersPerOwner",
  );
}
export function setMaxPendingInvocationsPerServerV2(n) {
  _mcpConfigV2.maxPendingInvocationsPerServer = _mcpPosIntV2(
    n,
    "maxPendingInvocationsPerServer",
  );
}
export function setServerIdleMsV2(n) {
  _mcpConfigV2.serverIdleMs = _mcpPosIntV2(n, "serverIdleMs");
}
export function setInvocationStuckMsV2(n) {
  _mcpConfigV2.invocationStuckMs = _mcpPosIntV2(n, "invocationStuckMs");
}
export function getMaxActiveServersPerOwnerV2() {
  return _mcpConfigV2.maxActiveServersPerOwner;
}
export function getMaxPendingInvocationsPerServerV2() {
  return _mcpConfigV2.maxPendingInvocationsPerServer;
}
export function getServerIdleMsV2() {
  return _mcpConfigV2.serverIdleMs;
}
export function getInvocationStuckMsV2() {
  return _mcpConfigV2.invocationStuckMs;
}

function _copyServerV2(s) {
  return { ...s, metadata: { ...(s.metadata || {}) } };
}
function _copyInvocationV2(i) {
  return { ...i, metadata: { ...(i.metadata || {}) } };
}

export function registerServerV2({
  id,
  owner,
  transport,
  name,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!owner || typeof owner !== "string") throw new Error("owner required");
  if (!transport || typeof transport !== "string")
    throw new Error("transport required");
  if (_mcpServersV2.has(id)) throw new Error(`server ${id} already registered`);
  const now = Date.now();
  const s = {
    id,
    owner,
    transport,
    name: name || id,
    status: _MS_V2.PENDING,
    activatedAt: null,
    retiredAt: null,
    lastSeenAt: now,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _mcpServersV2.set(id, s);
  return _copyServerV2(s);
}

function _activeServerCountForOwnerV2(owner) {
  let c = 0;
  for (const s of _mcpServersV2.values())
    if (s.owner === owner && s.status === _MS_V2.ACTIVE) c++;
  return c;
}

function _transitionServerV2(id, next) {
  const s = _mcpServersV2.get(id);
  if (!s) throw new Error(`server ${id} not found`);
  const allowed = _MS_TRANS_V2.get(s.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${s.status} -> ${next}`);
  if (next === _MS_V2.ACTIVE && s.status === _MS_V2.PENDING) {
    if (
      _activeServerCountForOwnerV2(s.owner) >=
      _mcpConfigV2.maxActiveServersPerOwner
    ) {
      throw new Error(
        `owner ${s.owner} active-server cap reached (${_mcpConfigV2.maxActiveServersPerOwner})`,
      );
    }
  }
  const now = Date.now();
  s.status = next;
  if (next === _MS_V2.ACTIVE && !s.activatedAt) s.activatedAt = now;
  if (next === _MS_V2.RETIRED && !s.retiredAt) s.retiredAt = now;
  s.lastSeenAt = now;
  return _copyServerV2(s);
}

export function activateServerV2(id) {
  return _transitionServerV2(id, _MS_V2.ACTIVE);
}
export function degradeServerV2(id) {
  return _transitionServerV2(id, _MS_V2.DEGRADED);
}
export function retireServerV2(id) {
  return _transitionServerV2(id, _MS_V2.RETIRED);
}
export function touchServerV2(id) {
  const s = _mcpServersV2.get(id);
  if (!s) throw new Error(`server ${id} not found`);
  s.lastSeenAt = Date.now();
  return _copyServerV2(s);
}
export function getServerV2(id) {
  const s = _mcpServersV2.get(id);
  return s ? _copyServerV2(s) : null;
}
export function listServersV2({ owner, status, transport } = {}) {
  const out = [];
  for (const s of _mcpServersV2.values()) {
    if (owner && s.owner !== owner) continue;
    if (status && s.status !== status) continue;
    if (transport && s.transport !== transport) continue;
    out.push(_copyServerV2(s));
  }
  return out;
}

function _pendingInvocationCountForServerV2(serverId) {
  let c = 0;
  for (const i of _mcpInvocationsV2.values()) {
    if (i.serverId !== serverId) continue;
    if (i.status === _MI_V2.QUEUED || i.status === _MI_V2.DISPATCHING) c++;
  }
  return c;
}

export function createInvocationV2({ id, serverId, tool, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!serverId || typeof serverId !== "string")
    throw new Error("serverId required");
  if (_mcpInvocationsV2.has(id))
    throw new Error(`invocation ${id} already exists`);
  const server = _mcpServersV2.get(serverId);
  if (!server) throw new Error(`server ${serverId} not found`);
  if (server.status === _MS_V2.RETIRED)
    throw new Error(`server ${serverId} retired`);
  if (
    _pendingInvocationCountForServerV2(serverId) >=
    _mcpConfigV2.maxPendingInvocationsPerServer
  ) {
    throw new Error(
      `server ${serverId} pending-invocation cap reached (${_mcpConfigV2.maxPendingInvocationsPerServer})`,
    );
  }
  const now = Date.now();
  const i = {
    id,
    serverId,
    tool: tool || "unknown",
    status: _MI_V2.QUEUED,
    startedAt: null,
    settledAt: null,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _mcpInvocationsV2.set(id, i);
  return _copyInvocationV2(i);
}

function _transitionInvocationV2(id, next, extra = {}) {
  const inv = _mcpInvocationsV2.get(id);
  if (!inv) throw new Error(`invocation ${id} not found`);
  const allowed = _MI_TRANS_V2.get(inv.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${inv.status} -> ${next}`);
  const now = Date.now();
  inv.status = next;
  if (next === _MI_V2.DISPATCHING && !inv.startedAt) inv.startedAt = now;
  if (_MI_TERM_V2.has(next) && !inv.settledAt) inv.settledAt = now;
  if (extra.error) inv.metadata.error = extra.error;
  return _copyInvocationV2(inv);
}

export function dispatchInvocationV2(id) {
  return _transitionInvocationV2(id, _MI_V2.DISPATCHING);
}
export function completeInvocationV2(id) {
  return _transitionInvocationV2(id, _MI_V2.COMPLETED);
}
export function failInvocationV2(id, error) {
  return _transitionInvocationV2(id, _MI_V2.FAILED, { error });
}
export function cancelInvocationV2(id) {
  return _transitionInvocationV2(id, _MI_V2.CANCELLED);
}
export function getInvocationV2(id) {
  const i = _mcpInvocationsV2.get(id);
  return i ? _copyInvocationV2(i) : null;
}
export function listInvocationsV2({ serverId, status, tool } = {}) {
  const out = [];
  for (const i of _mcpInvocationsV2.values()) {
    if (serverId && i.serverId !== serverId) continue;
    if (status && i.status !== status) continue;
    if (tool && i.tool !== tool) continue;
    out.push(_copyInvocationV2(i));
  }
  return out;
}

export function autoDegradeIdleServersV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const s of _mcpServersV2.values()) {
    if (s.status !== _MS_V2.ACTIVE) continue;
    if (t - s.lastSeenAt > _mcpConfigV2.serverIdleMs) {
      s.status = _MS_V2.DEGRADED;
      s.lastSeenAt = t;
      flipped.push(_copyServerV2(s));
    }
  }
  return flipped;
}

export function autoFailStuckInvocationsV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const i of _mcpInvocationsV2.values()) {
    if (i.status !== _MI_V2.DISPATCHING) continue;
    if (i.startedAt && t - i.startedAt > _mcpConfigV2.invocationStuckMs) {
      i.status = _MI_V2.FAILED;
      i.settledAt = t;
      i.metadata.error = "stuck-timeout";
      flipped.push(_copyInvocationV2(i));
    }
  }
  return flipped;
}

export function getMcpRegistryStatsV2() {
  const serversByStatus = {};
  for (const s of Object.values(_MS_V2)) serversByStatus[s] = 0;
  for (const s of _mcpServersV2.values()) serversByStatus[s.status]++;
  const invocationsByStatus = {};
  for (const s of Object.values(_MI_V2)) invocationsByStatus[s] = 0;
  for (const i of _mcpInvocationsV2.values()) invocationsByStatus[i.status]++;
  return {
    totalServersV2: _mcpServersV2.size,
    totalInvocationsV2: _mcpInvocationsV2.size,
    maxActiveServersPerOwner: _mcpConfigV2.maxActiveServersPerOwner,
    maxPendingInvocationsPerServer: _mcpConfigV2.maxPendingInvocationsPerServer,
    serverIdleMs: _mcpConfigV2.serverIdleMs,
    invocationStuckMs: _mcpConfigV2.invocationStuckMs,
    serversByStatus,
    invocationsByStatus,
  };
}

// =====================================================================
// mcp-registry V2 governance overlay (iter24)
// =====================================================================
export const MCPGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const MCPGOV_INVOCATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  INVOKING: "invoking",
  INVOKED: "invoked",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _mcpgovPTrans = new Map([
  [
    MCPGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      MCPGOV_PROFILE_MATURITY_V2.ACTIVE,
      MCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MCPGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      MCPGOV_PROFILE_MATURITY_V2.SUSPENDED,
      MCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MCPGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      MCPGOV_PROFILE_MATURITY_V2.ACTIVE,
      MCPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [MCPGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _mcpgovPTerminal = new Set([MCPGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _mcpgovJTrans = new Map([
  [
    MCPGOV_INVOCATION_LIFECYCLE_V2.QUEUED,
    new Set([
      MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKING,
      MCPGOV_INVOCATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKING,
    new Set([
      MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKED,
      MCPGOV_INVOCATION_LIFECYCLE_V2.FAILED,
      MCPGOV_INVOCATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKED, new Set()],
  [MCPGOV_INVOCATION_LIFECYCLE_V2.FAILED, new Set()],
  [MCPGOV_INVOCATION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _mcpgovPsV2 = new Map();
const _mcpgovJsV2 = new Map();
let _mcpgovMaxActive = 10,
  _mcpgovMaxPending = 25,
  _mcpgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _mcpgovStuckMs = 60 * 1000;
function _mcpgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _mcpgovCheckP(from, to) {
  const a = _mcpgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid mcpgov profile transition ${from} → ${to}`);
}
function _mcpgovCheckJ(from, to) {
  const a = _mcpgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid mcpgov invocation transition ${from} → ${to}`);
}
function _mcpgovCountActive(owner) {
  let c = 0;
  for (const p of _mcpgovPsV2.values())
    if (p.owner === owner && p.status === MCPGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _mcpgovCountPending(profileId) {
  let c = 0;
  for (const j of _mcpgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === MCPGOV_INVOCATION_LIFECYCLE_V2.QUEUED ||
        j.status === MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKING)
    )
      c++;
  return c;
}
export function setMaxActiveMcpgovProfilesPerOwnerV2(n) {
  _mcpgovMaxActive = _mcpgovPos(n, "maxActiveMcpgovProfilesPerOwner");
}
export function getMaxActiveMcpgovProfilesPerOwnerV2() {
  return _mcpgovMaxActive;
}
export function setMaxPendingMcpgovInvocationsPerProfileV2(n) {
  _mcpgovMaxPending = _mcpgovPos(n, "maxPendingMcpgovInvocationsPerProfile");
}
export function getMaxPendingMcpgovInvocationsPerProfileV2() {
  return _mcpgovMaxPending;
}
export function setMcpgovProfileIdleMsV2(n) {
  _mcpgovIdleMs = _mcpgovPos(n, "mcpgovProfileIdleMs");
}
export function getMcpgovProfileIdleMsV2() {
  return _mcpgovIdleMs;
}
export function setMcpgovInvocationStuckMsV2(n) {
  _mcpgovStuckMs = _mcpgovPos(n, "mcpgovInvocationStuckMs");
}
export function getMcpgovInvocationStuckMsV2() {
  return _mcpgovStuckMs;
}
export function _resetStateMcpRegistryGovV2() {
  _mcpgovPsV2.clear();
  _mcpgovJsV2.clear();
  _mcpgovMaxActive = 10;
  _mcpgovMaxPending = 25;
  _mcpgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _mcpgovStuckMs = 60 * 1000;
}
export function registerMcpgovProfileV2({
  id,
  owner,
  transport,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_mcpgovPsV2.has(id))
    throw new Error(`mcpgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    transport: transport || "stdio",
    status: MCPGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _mcpgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateMcpgovProfileV2(id) {
  const p = _mcpgovPsV2.get(id);
  if (!p) throw new Error(`mcpgov profile ${id} not found`);
  const isInitial = p.status === MCPGOV_PROFILE_MATURITY_V2.PENDING;
  _mcpgovCheckP(p.status, MCPGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _mcpgovCountActive(p.owner) >= _mcpgovMaxActive)
    throw new Error(`max active mcpgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = MCPGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendMcpgovProfileV2(id) {
  const p = _mcpgovPsV2.get(id);
  if (!p) throw new Error(`mcpgov profile ${id} not found`);
  _mcpgovCheckP(p.status, MCPGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = MCPGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveMcpgovProfileV2(id) {
  const p = _mcpgovPsV2.get(id);
  if (!p) throw new Error(`mcpgov profile ${id} not found`);
  _mcpgovCheckP(p.status, MCPGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = MCPGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchMcpgovProfileV2(id) {
  const p = _mcpgovPsV2.get(id);
  if (!p) throw new Error(`mcpgov profile ${id} not found`);
  if (_mcpgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal mcpgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getMcpgovProfileV2(id) {
  const p = _mcpgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listMcpgovProfilesV2() {
  return [..._mcpgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createMcpgovInvocationV2({
  id,
  profileId,
  tool,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_mcpgovJsV2.has(id))
    throw new Error(`mcpgov invocation ${id} already exists`);
  if (!_mcpgovPsV2.has(profileId))
    throw new Error(`mcpgov profile ${profileId} not found`);
  if (_mcpgovCountPending(profileId) >= _mcpgovMaxPending)
    throw new Error(
      `max pending mcpgov invocations for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    tool: tool || "",
    status: MCPGOV_INVOCATION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _mcpgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function invokingMcpgovInvocationV2(id) {
  const j = _mcpgovJsV2.get(id);
  if (!j) throw new Error(`mcpgov invocation ${id} not found`);
  _mcpgovCheckJ(j.status, MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKING);
  const now = Date.now();
  j.status = MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeInvocationMcpgovV2(id) {
  const j = _mcpgovJsV2.get(id);
  if (!j) throw new Error(`mcpgov invocation ${id} not found`);
  _mcpgovCheckJ(j.status, MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKED);
  const now = Date.now();
  j.status = MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failMcpgovInvocationV2(id, reason) {
  const j = _mcpgovJsV2.get(id);
  if (!j) throw new Error(`mcpgov invocation ${id} not found`);
  _mcpgovCheckJ(j.status, MCPGOV_INVOCATION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = MCPGOV_INVOCATION_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelMcpgovInvocationV2(id, reason) {
  const j = _mcpgovJsV2.get(id);
  if (!j) throw new Error(`mcpgov invocation ${id} not found`);
  _mcpgovCheckJ(j.status, MCPGOV_INVOCATION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = MCPGOV_INVOCATION_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getMcpgovInvocationV2(id) {
  const j = _mcpgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listMcpgovInvocationsV2() {
  return [..._mcpgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleMcpgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _mcpgovPsV2.values())
    if (
      p.status === MCPGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _mcpgovIdleMs
    ) {
      p.status = MCPGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckMcpgovInvocationsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _mcpgovJsV2.values())
    if (
      j.status === MCPGOV_INVOCATION_LIFECYCLE_V2.INVOKING &&
      j.startedAt != null &&
      t - j.startedAt >= _mcpgovStuckMs
    ) {
      j.status = MCPGOV_INVOCATION_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getMcpRegistryGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(MCPGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _mcpgovPsV2.values()) profilesByStatus[p.status]++;
  const invocationsByStatus = {};
  for (const v of Object.values(MCPGOV_INVOCATION_LIFECYCLE_V2))
    invocationsByStatus[v] = 0;
  for (const j of _mcpgovJsV2.values()) invocationsByStatus[j.status]++;
  return {
    totalMcpgovProfilesV2: _mcpgovPsV2.size,
    totalMcpgovInvocationsV2: _mcpgovJsV2.size,
    maxActiveMcpgovProfilesPerOwner: _mcpgovMaxActive,
    maxPendingMcpgovInvocationsPerProfile: _mcpgovMaxPending,
    mcpgovProfileIdleMs: _mcpgovIdleMs,
    mcpgovInvocationStuckMs: _mcpgovStuckMs,
    profilesByStatus,
    invocationsByStatus,
  };
}
