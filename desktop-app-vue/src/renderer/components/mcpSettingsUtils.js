/**
 * Pure helpers extracted from MCPSettings.vue (opportunistic split).
 *
 * `buildDefaultServerConfig` is the default per-server MCP config template
 * (was the big inline `getDefaultConfig` switch). It takes the resolved paths
 * as plain args instead of reading component refs, so it is pure/testable; the
 * SFC keeps a thin wrapper that passes `userDataPath.value` / `projectPath.value`.
 */

export function buildDefaultServerConfig(serverId, refs = {}) {
  const { userDataPath = "", projectPath = "" } = refs;
  const baseConfig = {
    enabled: false,
    autoConnect: false,
    transport: "stdio",
    timeout: 30000,
  };

  // 计算默认路径
  const dataPath = userDataPath
    ? `${userDataPath}/data`.replace(/\\/g, "/")
    : "";
  const dbPath = dataPath ? `${dataPath}/chainlesschain.db` : "";

  switch (serverId) {
    case "filesystem":
      return {
        ...baseConfig,
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          dataPath || ".",
        ],
        rootPath: dataPath,
        permissions: {
          allowedPaths: ["notes/", "imports/", "exports/", "projects/"],
          forbiddenPaths: [
            "chainlesschain.db",
            "ukey/",
            "did/private-keys/",
            "p2p/keys/",
          ],
          readOnly: false,
          maxFileSizeMB: 100,
        },
      };
    case "postgres":
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        connection: {
          host: "localhost",
          port: 5432,
          database: "chainlesschain",
          user: "chainlesschain",
          password: "chainlesschain_pwd_2024",
        },
        permissions: {
          allowedSchemas: ["public"],
          forbiddenTables: ["users", "credentials", "api_keys"],
          readOnly: true,
          maxResultRows: 1000,
        },
      };
    case "sqlite":
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sqlite", dbPath || ""],
        databasePath: dbPath,
        permissions: {
          allowedTables: [
            "notes",
            "tags",
            "bookmarks",
            "projects",
            "project_categories",
            "chat_conversations",
            "knowledge_base",
          ],
          forbiddenTables: [
            "did_identities",
            "p2p_keys",
            "ukey_data",
            "credentials",
          ],
          readOnly: true,
          maxResultRows: 1000,
        },
        features: {
          enableFTS: true,
          enableJSON: true,
        },
      };
    case "git":
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-git"],
        repositoryPath: projectPath || "",
        permissions: {
          allowedOperations: ["status", "log", "diff", "show"],
          readOnly: true,
        },
        features: {
          enableCommits: false,
          enablePush: false,
          enableBranching: false,
        },
      };
    case "fetch":
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-fetch"],
        permissions: {
          allowedDomains: [],
          forbiddenDomains: ["localhost", "127.0.0.1"],
          allowedMethods: ["GET", "POST"],
        },
        timeout: 30,
      };
    case "github":
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        authentication: {
          personalAccessToken: "",
        },
        permissions: {
          allowedRepos: [],
          forbiddenRepos: [],
          allowedOperations: [
            "read_repo",
            "read_issues",
            "read_pulls",
            "read_actions",
          ],
          readOnly: true,
        },
        features: {
          enableSearch: true,
          enableGists: false,
          enableOrganizations: false,
        },
      };
    default:
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", `@modelcontextprotocol/server-${serverId}`],
      };
  }
}

// 安全等级颜色
export function getSecurityColor(level) {
  const colors = {
    low: "green",
    medium: "orange",
    high: "red",
  };
  return colors[level] || "default";
}

// 安全等级标签
export function getSecurityLabel(level) {
  const labels = {
    low: "低",
    medium: "中",
    high: "高",
  };
  return labels[level] || level;
}
