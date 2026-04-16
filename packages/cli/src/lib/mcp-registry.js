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
