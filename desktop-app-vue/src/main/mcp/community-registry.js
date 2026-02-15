/**
 * Community Registry
 *
 * Discovers and installs community-contributed MCP servers.
 * Manages a catalog of well-known MCP servers and supports
 * searching, installing, updating, and uninstalling servers.
 *
 * @module CommunityRegistry
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

/**
 * Server status constants
 */
const SERVER_STATUS = {
  AVAILABLE: 'available',
  INSTALLED: 'installed',
  UPDATING: 'updating',
  ERROR: 'error',
};

/**
 * Server category constants
 */
const SERVER_CATEGORIES = {
  DATABASE: 'database',
  FILESYSTEM: 'filesystem',
  VERSION_CONTROL: 'version-control',
  SEARCH: 'search',
  AUTOMATION: 'automation',
  COMMUNICATION: 'communication',
  CLOUD: 'cloud',
  PRODUCTIVITY: 'productivity',
};

/**
 * Built-in catalog of well-known MCP servers
 */
const BUILTIN_CATALOG = [
  {
    id: 'mcp-server-filesystem',
    name: 'filesystem',
    displayName: 'File System',
    description: 'Provides file system access capabilities including reading, writing, and managing files and directories',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.FILESYSTEM,
    tags: ['file', 'directory', 'read', 'write', 'filesystem'],
    npmPackage: '@modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        allowedPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories the server can access',
        },
      },
    },
    tools: ['read_file', 'write_file', 'list_directory', 'create_directory', 'move_file', 'search_files', 'get_file_info'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    downloads: 0,
    rating: 5.0,
  },
  {
    id: 'mcp-server-postgresql',
    name: 'postgresql',
    displayName: 'PostgreSQL',
    description: 'PostgreSQL database integration with query execution, schema inspection, and data management',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.DATABASE,
    tags: ['database', 'sql', 'postgresql', 'postgres', 'query'],
    npmPackage: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', default: 'localhost' },
        port: { type: 'number', default: 5432 },
        database: { type: 'string' },
        user: { type: 'string' },
        password: { type: 'string' },
      },
      required: ['database', 'user'],
    },
    tools: ['query', 'list_tables', 'describe_table'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    downloads: 0,
    rating: 4.8,
  },
  {
    id: 'mcp-server-sqlite',
    name: 'sqlite',
    displayName: 'SQLite',
    description: 'SQLite database integration with query execution and schema management for local databases',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.DATABASE,
    tags: ['database', 'sql', 'sqlite', 'local', 'embedded'],
    npmPackage: '@modelcontextprotocol/server-sqlite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        databasePath: { type: 'string', description: 'Path to SQLite database file' },
      },
      required: ['databasePath'],
    },
    tools: ['read_query', 'write_query', 'create_table', 'list_tables', 'describe_table', 'append_insight'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    downloads: 0,
    rating: 4.7,
  },
  {
    id: 'mcp-server-git',
    name: 'git',
    displayName: 'Git',
    description: 'Git version control operations including status, diff, log, commit, and branch management',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.VERSION_CONTROL,
    tags: ['git', 'version-control', 'diff', 'commit', 'branch'],
    npmPackage: '@modelcontextprotocol/server-git',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string', description: 'Path to Git repository' },
      },
      required: ['repositoryPath'],
    },
    tools: ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_branch_list', 'git_checkout'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    downloads: 0,
    rating: 4.9,
  },
  {
    id: 'mcp-server-brave-search',
    name: 'brave-search',
    displayName: 'Brave Search',
    description: 'Web search capabilities powered by Brave Search API for finding information online',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.SEARCH,
    tags: ['search', 'web', 'brave', 'internet', 'query'],
    npmPackage: '@modelcontextprotocol/server-brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', description: 'Brave Search API key' },
      },
      required: ['apiKey'],
    },
    tools: ['brave_web_search', 'brave_local_search'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    downloads: 0,
    rating: 4.6,
  },
  {
    id: 'mcp-server-puppeteer',
    name: 'puppeteer',
    displayName: 'Puppeteer',
    description: 'Browser automation with Puppeteer for web scraping, screenshots, and page interaction',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.AUTOMATION,
    tags: ['browser', 'automation', 'puppeteer', 'scraping', 'screenshot'],
    npmPackage: '@modelcontextprotocol/server-puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', default: true, description: 'Run browser in headless mode' },
        launchTimeout: { type: 'number', default: 30000, description: 'Browser launch timeout in ms' },
      },
    },
    tools: ['puppeteer_navigate', 'puppeteer_screenshot', 'puppeteer_click', 'puppeteer_fill', 'puppeteer_evaluate'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    downloads: 0,
    rating: 4.5,
  },
  {
    id: 'mcp-server-slack',
    name: 'slack',
    displayName: 'Slack',
    description: 'Slack workspace integration for reading messages, posting updates, and managing channels',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.COMMUNICATION,
    tags: ['slack', 'messaging', 'chat', 'communication', 'team'],
    npmPackage: '@modelcontextprotocol/server-slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        botToken: { type: 'string', description: 'Slack Bot User OAuth Token (xoxb-...)' },
        teamId: { type: 'string', description: 'Slack Team/Workspace ID' },
      },
      required: ['botToken'],
    },
    tools: ['slack_list_channels', 'slack_post_message', 'slack_reply_to_thread', 'slack_get_channel_history', 'slack_search_messages'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    downloads: 0,
    rating: 4.4,
  },
  {
    id: 'mcp-server-github',
    name: 'github',
    displayName: 'GitHub',
    description: 'GitHub API integration for managing repositories, issues, pull requests, and actions',
    version: '1.0.0',
    author: 'Anthropic',
    category: SERVER_CATEGORIES.VERSION_CONTROL,
    tags: ['github', 'repository', 'issues', 'pull-request', 'api'],
    npmPackage: '@modelcontextprotocol/server-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    transport: 'stdio',
    configSchema: {
      type: 'object',
      properties: {
        personalAccessToken: { type: 'string', description: 'GitHub Personal Access Token' },
      },
      required: ['personalAccessToken'],
    },
    tools: ['create_or_update_file', 'search_repositories', 'create_repository', 'get_file_contents', 'push_files', 'create_issue', 'create_pull_request', 'list_issues', 'list_commits'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    downloads: 0,
    rating: 4.8,
  },
];

/**
 * CommunityRegistry manages a registry of community-contributed MCP servers.
 * Users can discover, search, install, uninstall, and update servers.
 */
class CommunityRegistry {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database instance for persisting installed server state
   */
  constructor({ database } = {}) {
    this.database = database;

    /** @type {Map<string, Object>} Full catalog of available servers (id -> server info) */
    this.catalog = new Map();

    /** @type {Map<string, Object>} Installed servers (id -> installation info) */
    this.installedServers = new Map();

    /** @type {number|null} Timestamp of last catalog refresh */
    this.lastRefreshTime = null;

    /** @type {number} Catalog refresh interval (24 hours) */
    this.refreshInterval = 24 * 60 * 60 * 1000;

    // Load the built-in catalog on construction
    this._loadBuiltinCatalog();

    // Restore installed servers from database
    this._restoreInstalledServers();

    logger.info('[CommunityRegistry] Initialized with %d catalog entries', this.catalog.size);
  }

  // ===================================
  // Public Methods
  // ===================================

  /**
   * List available community MCP servers with optional filtering
   * @param {Object} [filters] - Optional filter criteria
   * @param {string} [filters.category] - Filter by category
   * @param {string[]} [filters.tags] - Filter by tags (any match)
   * @param {string} [filters.author] - Filter by author
   * @param {string} [filters.status] - Filter by status: 'available' | 'installed'
   * @param {string} [filters.sortBy] - Sort field: 'name' | 'rating' | 'downloads' (default: 'name')
   * @param {string} [filters.sortOrder] - Sort order: 'asc' | 'desc' (default: 'asc')
   * @param {number} [filters.limit] - Maximum number of results
   * @param {number} [filters.offset] - Result offset for pagination
   * @returns {Object} { servers: Object[], total: number }
   */
  listServers(filters = {}) {
    try {
      let servers = Array.from(this.catalog.values());

      // Apply category filter
      if (filters.category) {
        servers = servers.filter(s => s.category === filters.category);
      }

      // Apply tag filter (any tag matches)
      if (filters.tags && filters.tags.length > 0) {
        const filterTags = new Set(filters.tags.map(t => t.toLowerCase()));
        servers = servers.filter(s =>
          s.tags && s.tags.some(tag => filterTags.has(tag.toLowerCase()))
        );
      }

      // Apply author filter
      if (filters.author) {
        const authorLower = filters.author.toLowerCase();
        servers = servers.filter(s =>
          s.author && s.author.toLowerCase().includes(authorLower)
        );
      }

      // Apply status filter
      if (filters.status === SERVER_STATUS.INSTALLED) {
        servers = servers.filter(s => this.installedServers.has(s.id));
      } else if (filters.status === SERVER_STATUS.AVAILABLE) {
        servers = servers.filter(s => !this.installedServers.has(s.id));
      }

      // Annotate with installation status
      servers = servers.map(s => ({
        ...s,
        installed: this.installedServers.has(s.id),
        installInfo: this.installedServers.get(s.id) || null,
      }));

      const total = servers.length;

      // Sort
      const sortBy = filters.sortBy || 'name';
      const sortOrder = filters.sortOrder || 'asc';
      const sortMultiplier = sortOrder === 'desc' ? -1 : 1;

      servers.sort((a, b) => {
        const aVal = a[sortBy] || '';
        const bVal = b[sortBy] || '';
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * sortMultiplier;
        }
        return String(aVal).localeCompare(String(bVal)) * sortMultiplier;
      });

      // Pagination
      const offset = filters.offset || 0;
      const limit = filters.limit || servers.length;
      servers = servers.slice(offset, offset + limit);

      logger.info('[CommunityRegistry] Listed %d servers (total: %d)', servers.length, total);

      return { servers, total };
    } catch (error) {
      logger.error('[CommunityRegistry] Error listing servers:', error);
      throw error;
    }
  }

  /**
   * Search servers by keyword across name, description, and tags
   * @param {string} keyword - Search keyword
   * @returns {Object[]} Matching servers sorted by relevance
   */
  searchServers(keyword) {
    try {
      if (!keyword || typeof keyword !== 'string') {
        return [];
      }

      const normalizedKeyword = keyword.toLowerCase().trim();
      if (normalizedKeyword.length === 0) {
        return [];
      }

      const results = [];

      for (const server of this.catalog.values()) {
        let relevanceScore = 0;

        // Exact name match (highest priority)
        if (server.name.toLowerCase() === normalizedKeyword) {
          relevanceScore += 100;
        }
        // Name contains keyword
        else if (server.name.toLowerCase().includes(normalizedKeyword)) {
          relevanceScore += 50;
        }

        // Display name match
        if (server.displayName && server.displayName.toLowerCase().includes(normalizedKeyword)) {
          relevanceScore += 40;
        }

        // Description match
        if (server.description && server.description.toLowerCase().includes(normalizedKeyword)) {
          relevanceScore += 20;
        }

        // Tag match
        if (server.tags) {
          for (const tag of server.tags) {
            if (tag.toLowerCase() === normalizedKeyword) {
              relevanceScore += 30;
            } else if (tag.toLowerCase().includes(normalizedKeyword)) {
              relevanceScore += 15;
            }
          }
        }

        // Category match
        if (server.category && server.category.toLowerCase().includes(normalizedKeyword)) {
          relevanceScore += 25;
        }

        if (relevanceScore > 0) {
          results.push({
            ...server,
            relevanceScore,
            installed: this.installedServers.has(server.id),
            installInfo: this.installedServers.get(server.id) || null,
          });
        }
      }

      // Sort by relevance (descending)
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);

      logger.info('[CommunityRegistry] Search "%s" found %d results', keyword, results.length);

      return results;
    } catch (error) {
      logger.error('[CommunityRegistry] Error searching servers:', error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific server
   * @param {string} id - Server ID
   * @returns {Object|null} Server details or null if not found
   */
  getServerDetail(id) {
    try {
      const server = this.catalog.get(id);
      if (!server) {
        logger.warn('[CommunityRegistry] Server not found: %s', id);
        return null;
      }

      return {
        ...server,
        installed: this.installedServers.has(id),
        installInfo: this.installedServers.get(id) || null,
        catalogSize: this.catalog.size,
        lastRefreshTime: this.lastRefreshTime,
      };
    } catch (error) {
      logger.error('[CommunityRegistry] Error getting server detail:', error);
      throw error;
    }
  }

  /**
   * Install (register) a community MCP server
   * Downloads the npm package and creates a local configuration entry.
   * @param {string} id - Server ID from the catalog
   * @param {Object} [userConfig] - Optional user-provided configuration values
   * @returns {Object} Installation result with server config ready for MCPClientManager
   */
  async installServer(id, userConfig = {}) {
    try {
      const server = this.catalog.get(id);
      if (!server) {
        throw new Error(`Server not found in catalog: ${id}`);
      }

      if (this.installedServers.has(id)) {
        logger.warn('[CommunityRegistry] Server already installed: %s', id);
        return {
          success: true,
          alreadyInstalled: true,
          server: this.installedServers.get(id),
        };
      }

      logger.info('[CommunityRegistry] Installing server: %s (%s)', server.displayName, id);

      // Build the MCP server configuration
      const serverConfig = {
        name: server.name,
        command: server.command,
        args: [...server.args],
        transport: server.transport || 'stdio',
        enabled: true,
        autoConnect: false,
        permissions: {
          allowedTools: server.tools || [],
        },
        ...userConfig,
      };

      // If the server has a config schema with required fields, validate user config
      if (server.configSchema && server.configSchema.required) {
        const missingFields = [];
        for (const requiredField of server.configSchema.required) {
          if (!(requiredField in userConfig)) {
            missingFields.push(requiredField);
          }
        }
        if (missingFields.length > 0) {
          logger.warn(
            '[CommunityRegistry] Missing configuration fields for %s: %s',
            id,
            missingFields.join(', ')
          );
          // Do not block installation; user can configure later
        }
      }

      // Create installation record
      const installInfo = {
        id,
        serverId: id,
        serverName: server.name,
        displayName: server.displayName,
        version: server.version,
        installedAt: new Date().toISOString(),
        installedVersion: server.version,
        config: serverConfig,
        status: SERVER_STATUS.INSTALLED,
        installId: uuidv4(),
      };

      // Persist to installed servers
      this.installedServers.set(id, installInfo);

      // Save to database if available
      await this._persistInstalledServers();

      logger.info('[CommunityRegistry] Server installed successfully: %s', server.displayName);

      return {
        success: true,
        alreadyInstalled: false,
        server: installInfo,
        mcpConfig: serverConfig,
      };
    } catch (error) {
      logger.error('[CommunityRegistry] Error installing server %s:', id, error);
      throw error;
    }
  }

  /**
   * Uninstall (remove) a community MCP server
   * @param {string} id - Server ID
   * @returns {Object} Uninstallation result
   */
  async uninstallServer(id) {
    try {
      if (!this.installedServers.has(id)) {
        logger.warn('[CommunityRegistry] Server not installed: %s', id);
        return { success: false, reason: 'Server is not installed' };
      }

      const installInfo = this.installedServers.get(id);
      logger.info('[CommunityRegistry] Uninstalling server: %s', installInfo.displayName);

      // Remove from installed map
      this.installedServers.delete(id);

      // Persist changes
      await this._persistInstalledServers();

      logger.info('[CommunityRegistry] Server uninstalled: %s', installInfo.displayName);

      return {
        success: true,
        uninstalledServer: installInfo,
      };
    } catch (error) {
      logger.error('[CommunityRegistry] Error uninstalling server %s:', id, error);
      throw error;
    }
  }

  /**
   * Get all installed community servers
   * @returns {Object[]} Array of installed server information
   */
  getInstalledServers() {
    try {
      const installed = [];

      for (const [id, installInfo] of this.installedServers.entries()) {
        const catalogEntry = this.catalog.get(id);
        installed.push({
          ...installInfo,
          catalogInfo: catalogEntry || null,
          hasUpdate: catalogEntry ? this._hasUpdate(installInfo, catalogEntry) : false,
        });
      }

      logger.info('[CommunityRegistry] Found %d installed servers', installed.length);

      return installed;
    } catch (error) {
      logger.error('[CommunityRegistry] Error getting installed servers:', error);
      throw error;
    }
  }

  /**
   * Check for available updates on all installed servers
   * @returns {Object[]} Array of servers that have updates available
   */
  checkUpdates() {
    try {
      const updates = [];

      for (const [id, installInfo] of this.installedServers.entries()) {
        const catalogEntry = this.catalog.get(id);
        if (!catalogEntry) {
          continue;
        }

        if (this._hasUpdate(installInfo, catalogEntry)) {
          updates.push({
            id,
            serverName: installInfo.serverName,
            displayName: installInfo.displayName,
            currentVersion: installInfo.installedVersion,
            latestVersion: catalogEntry.version,
            changelog: catalogEntry.changelog || null,
          });
        }
      }

      logger.info('[CommunityRegistry] Found %d updates available', updates.length);

      return updates;
    } catch (error) {
      logger.error('[CommunityRegistry] Error checking updates:', error);
      throw error;
    }
  }

  /**
   * Refresh the server catalog from remote source
   * In the current implementation, this reloads the built-in catalog.
   * Future versions can fetch from a remote registry endpoint.
   * @returns {Object} Refresh result with catalog statistics
   */
  async refreshCatalog() {
    try {
      logger.info('[CommunityRegistry] Refreshing server catalog...');

      const previousSize = this.catalog.size;

      // Reload built-in catalog (preserves any custom entries)
      this._loadBuiltinCatalog();

      // TODO: In future versions, fetch from remote registry
      // const remoteServers = await this._fetchRemoteCatalog();
      // for (const server of remoteServers) {
      //   this.catalog.set(server.id, server);
      // }

      this.lastRefreshTime = Date.now();

      const result = {
        success: true,
        previousCount: previousSize,
        currentCount: this.catalog.size,
        newServers: this.catalog.size - previousSize,
        refreshedAt: new Date(this.lastRefreshTime).toISOString(),
      };

      logger.info(
        '[CommunityRegistry] Catalog refreshed: %d servers (was %d)',
        result.currentCount,
        result.previousCount
      );

      return result;
    } catch (error) {
      logger.error('[CommunityRegistry] Error refreshing catalog:', error);
      throw error;
    }
  }

  /**
   * Get catalog statistics
   * @returns {Object} Catalog and installation statistics
   */
  getStats() {
    const categoryCount = {};
    for (const server of this.catalog.values()) {
      const cat = server.category || 'uncategorized';
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }

    return {
      totalServers: this.catalog.size,
      installedCount: this.installedServers.size,
      availableCount: this.catalog.size - this.installedServers.size,
      categories: categoryCount,
      lastRefreshTime: this.lastRefreshTime
        ? new Date(this.lastRefreshTime).toISOString()
        : null,
    };
  }

  /**
   * Add a custom server entry to the catalog
   * @param {Object} serverDef - Server definition following the catalog schema
   * @returns {Object} The added server entry
   */
  addCustomServer(serverDef) {
    try {
      if (!serverDef.name) {
        throw new Error('Server definition must include a name');
      }

      const id = serverDef.id || `custom-${serverDef.name}-${uuidv4().slice(0, 8)}`;

      const entry = {
        id,
        name: serverDef.name,
        displayName: serverDef.displayName || serverDef.name,
        description: serverDef.description || '',
        version: serverDef.version || '0.1.0',
        author: serverDef.author || 'Custom',
        category: serverDef.category || 'custom',
        tags: serverDef.tags || [],
        command: serverDef.command,
        args: serverDef.args || [],
        transport: serverDef.transport || 'stdio',
        npmPackage: serverDef.npmPackage || null,
        configSchema: serverDef.configSchema || null,
        tools: serverDef.tools || [],
        homepage: serverDef.homepage || null,
        downloads: 0,
        rating: 0,
        isCustom: true,
        addedAt: new Date().toISOString(),
      };

      this.catalog.set(id, entry);

      logger.info('[CommunityRegistry] Added custom server: %s (%s)', entry.displayName, id);

      return entry;
    } catch (error) {
      logger.error('[CommunityRegistry] Error adding custom server:', error);
      throw error;
    }
  }

  /**
   * Remove a custom server from the catalog
   * @param {string} id - Server ID (only custom servers can be removed)
   * @returns {boolean} True if removed
   */
  removeCustomServer(id) {
    const server = this.catalog.get(id);
    if (!server) {
      return false;
    }

    if (!server.isCustom) {
      throw new Error('Cannot remove built-in server from catalog');
    }

    // Uninstall if installed
    if (this.installedServers.has(id)) {
      this.installedServers.delete(id);
    }

    this.catalog.delete(id);

    logger.info('[CommunityRegistry] Removed custom server: %s', id);

    return true;
  }

  // ===================================
  // Private Methods
  // ===================================

  /**
   * Load built-in catalog entries into the catalog map
   * @private
   */
  _loadBuiltinCatalog() {
    for (const entry of BUILTIN_CATALOG) {
      // Only add if not already present (preserves custom modifications)
      if (!this.catalog.has(entry.id)) {
        this.catalog.set(entry.id, { ...entry });
      }
    }
  }

  /**
   * Restore installed servers from database
   * @private
   */
  _restoreInstalledServers() {
    try {
      if (!this.database) {
        return;
      }

      const rows = this.database.prepare?.(
        `SELECT key, value FROM app_settings WHERE key LIKE 'mcp_community_installed_%'`
      )?.all?.();

      if (!rows || rows.length === 0) {
        return;
      }

      for (const row of rows) {
        try {
          const installInfo = JSON.parse(row.value);
          if (installInfo && installInfo.id) {
            this.installedServers.set(installInfo.id, installInfo);
          }
        } catch (parseError) {
          logger.warn('[CommunityRegistry] Failed to parse installed server data:', parseError.message);
        }
      }

      logger.info('[CommunityRegistry] Restored %d installed servers from database', this.installedServers.size);
    } catch (error) {
      // Database may not have the table yet - that is fine
      logger.debug('[CommunityRegistry] Could not restore installed servers: %s', error.message);
    }
  }

  /**
   * Persist installed servers to database
   * @private
   */
  async _persistInstalledServers() {
    try {
      if (!this.database) {
        return;
      }

      const upsertStmt = this.database.prepare?.(
        `INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`
      );

      if (!upsertStmt) {
        return;
      }

      // First, remove all existing community install entries
      this.database.prepare?.(
        `DELETE FROM app_settings WHERE key LIKE 'mcp_community_installed_%'`
      )?.run?.();

      // Insert current installed servers
      for (const [id, installInfo] of this.installedServers.entries()) {
        const key = `mcp_community_installed_${id}`;
        upsertStmt.run(key, JSON.stringify(installInfo));
      }

      logger.debug('[CommunityRegistry] Persisted %d installed servers to database', this.installedServers.size);
    } catch (error) {
      logger.warn('[CommunityRegistry] Failed to persist installed servers: %s', error.message);
    }
  }

  /**
   * Check if an installed server has an update available
   * @private
   * @param {Object} installInfo - Installed server info
   * @param {Object} catalogEntry - Catalog entry
   * @returns {boolean} True if update is available
   */
  _hasUpdate(installInfo, catalogEntry) {
    if (!installInfo.installedVersion || !catalogEntry.version) {
      return false;
    }
    return this._compareVersions(catalogEntry.version, installInfo.installedVersion) > 0;
  }

  /**
   * Compare two semver version strings
   * @private
   * @param {string} versionA - First version
   * @param {string} versionB - Second version
   * @returns {number} Positive if A > B, negative if A < B, 0 if equal
   */
  _compareVersions(versionA, versionB) {
    const partsA = versionA.split('.').map(Number);
    const partsB = versionB.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const a = partsA[i] || 0;
      const b = partsB[i] || 0;
      if (a !== b) {
        return a - b;
      }
    }

    return 0;
  }
}

module.exports = { CommunityRegistry, SERVER_STATUS, SERVER_CATEGORIES, BUILTIN_CATALOG };
