/**
 * Multi-Repo Manager
 * Multi-remote mirror management, repository migration,
 * proxy support, and China CDN auto-detection
 *
 * @module git/hosting/multi-repo-manager
 * @version 1.3.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { createProvider } = require("./git-hosting-provider");

/**
 * Multi-Repo Manager
 * Manages multiple Git remotes for mirroring and migration
 */
class MultiRepoManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.gitManager - GitManager instance
   * @param {Object} options.gitConfig - GitConfig instance
   */
  constructor(options = {}) {
    super();
    this.gitManager = options.gitManager || null;
    this.gitConfig = options.gitConfig || null;

    // Configured providers
    this.providers = new Map(); // name -> { provider, config }

    // Proxy configuration
    this.proxyConfig = {
      enabled: false,
      type: "http", // 'http' | 'socks5'
      host: "127.0.0.1",
      port: 7890,
    };
  }

  /**
   * Initialize with configured providers from git-config
   */
  async initialize() {
    if (this.gitConfig) {
      const config = this.gitConfig.getAll();
      const providerConfigs = config.providers || [];

      for (const provConfig of providerConfigs) {
        this.addProvider(provConfig.name, provConfig);
      }

      // Load proxy config
      if (config.proxy) {
        Object.assign(this.proxyConfig, config.proxy);
      }
    }

    logger.info(
      `[MultiRepoManager] Initialized with ${this.providers.size} providers`,
    );
  }

  /**
   * Add a hosting provider
   * @param {string} name - Unique provider name
   * @param {Object} config - Provider configuration
   */
  addProvider(name, config) {
    const provider = createProvider(config.type, config);
    this.providers.set(name, {
      provider,
      config: {
        primary: config.primary || false,
        mirror: config.mirror || false,
        syncDirection: config.syncDirection || "bidirectional",
        remoteUrl: config.remoteUrl,
        ...config,
      },
    });

    logger.info(`[MultiRepoManager] Added provider: ${name} (${config.type})`);
    return provider;
  }

  /**
   * Remove a provider
   * @param {string} name
   */
  removeProvider(name) {
    this.providers.delete(name);
    logger.info(`[MultiRepoManager] Removed provider: ${name}`);
  }

  /**
   * Get primary provider
   * @returns {Object|null}
   */
  getPrimaryProvider() {
    for (const [name, entry] of this.providers) {
      if (entry.config.primary) {
        return { name, ...entry };
      }
    }
    // Return first provider if no primary
    const first = this.providers.entries().next().value;
    return first ? { name: first[0], ...first[1] } : null;
  }

  /**
   * Test all provider connections
   * @returns {Promise<Object>}
   */
  async testAllConnections() {
    const results = {};

    for (const [name, entry] of this.providers) {
      try {
        const result = await entry.provider.testConnection();
        results[name] = result;
      } catch (error) {
        results[name] = { success: false, message: error.message };
      }
    }

    return results;
  }

  /**
   * Push to all mirror remotes
   * @param {Object} [options]
   * @param {string} [options.ref] - Specific ref to push
   * @returns {Promise<Object>}
   */
  async pushToAllMirrors(options = {}) {
    const results = {};

    for (const [name, entry] of this.providers) {
      if (!entry.config.mirror && !entry.config.primary) {
        continue;
      }
      if (entry.config.syncDirection === "pull-only") {
        continue;
      }

      try {
        const result = await this._pushToRemote(name, entry, options);
        results[name] = { success: true, ...result };
      } catch (error) {
        results[name] = { success: false, error: error.message };
        logger.warn(
          `[MultiRepoManager] Push to ${name} failed:`,
          error.message,
        );
      }
    }

    this.emit("mirror:push-complete", results);
    return results;
  }

  /**
   * Push to a specific remote
   */
  async _pushToRemote(name, entry, options = {}) {
    if (!this.gitManager) {
      throw new Error("GitManager not available");
    }

    const git = require("isomorphic-git");
    const fs = require("fs");
    const repoPath =
      this.gitManager.repoPath || this.gitManager.config?.repoPath;

    if (!repoPath) {
      throw new Error("Repository path not configured");
    }

    const httpPlugin = this._getHttpPlugin(entry.config);

    await git.push({
      fs,
      dir: repoPath,
      http: httpPlugin,
      url: entry.config.remoteUrl,
      ref: options.ref || undefined,
      onAuth: () => entry.config.auth || {},
      onProgress: (progress) => {
        this.emit("push:progress", { name, ...progress });
      },
    });

    return { remote: name, url: entry.config.remoteUrl };
  }

  /**
   * Get HTTP plugin with proxy support
   * @param {Object} providerConfig
   * @returns {Object}
   */
  _getHttpPlugin(providerConfig) {
    const http = require("isomorphic-git/http/node");

    if (!this.proxyConfig.enabled) {
      return http;
    }

    // Create proxy agent based on type
    let agent;
    try {
      if (this.proxyConfig.type === "socks5") {
        const { SocksProxyAgent } = require("socks-proxy-agent");
        agent = new SocksProxyAgent(
          `socks5://${this.proxyConfig.host}:${this.proxyConfig.port}`,
        );
      } else {
        const { HttpsProxyAgent } = require("https-proxy-agent");
        agent = new HttpsProxyAgent(
          `http://${this.proxyConfig.host}:${this.proxyConfig.port}`,
        );
      }
    } catch (error) {
      logger.warn(
        "[MultiRepoManager] Proxy agent not available:",
        error.message,
      );
      return http;
    }

    // Wrap the HTTP plugin with proxy agent
    return {
      request: async (params) => {
        return http.request({
          ...params,
          agent,
        });
      },
    };
  }

  /**
   * Migrate repository from one platform to another
   *
   * @param {Object} options
   * @param {string} options.sourceProvider - Source provider name
   * @param {string} options.targetProvider - Target provider name
   * @param {string} options.repoName - Repository name
   * @returns {Promise<Object>}
   */
  async migrateRepository(options) {
    const { sourceProvider, targetProvider, repoName } = options;

    const source = this.providers.get(sourceProvider);
    const target = this.providers.get(targetProvider);

    if (!source || !target) {
      throw new Error("Source or target provider not found");
    }

    logger.info(
      `[MultiRepoManager] Migrating ${repoName}: ${sourceProvider} → ${targetProvider}`,
    );

    try {
      // Step 1: Create repo on target
      this.emit("migration:step", {
        step: 1,
        message: "Creating target repository",
      });
      await target.provider.createRepo({
        name: repoName,
        private: true,
        description: `Migrated from ${sourceProvider}`,
      });

      // Step 2: Add target as a remote and push
      this.emit("migration:step", { step: 2, message: "Pushing to target" });
      await this._pushToRemote(targetProvider, target);

      // Step 3: Update configuration
      this.emit("migration:step", {
        step: 3,
        message: "Updating configuration",
      });
      target.config.primary = true;
      source.config.primary = false;
      source.config.mirror = true;

      // Save config
      if (this.gitConfig) {
        this.gitConfig.set(
          "providers",
          Array.from(this.providers.entries()).map(([name, entry]) => ({
            name,
            ...entry.config,
          })),
        );
        this.gitConfig.save();
      }

      const result = {
        success: true,
        source: sourceProvider,
        target: targetProvider,
        repoName,
      };

      this.emit("migration:complete", result);
      return result;
    } catch (error) {
      logger.error(`[MultiRepoManager] Migration failed:`, error.message);
      this.emit("migration:error", { error: error.message });
      throw error;
    }
  }

  /**
   * Auto-detect if user is in China and suggest China-optimized providers
   * @returns {{ isChinaNetwork: boolean, recommendedProviders: string[] }}
   */
  detectChinaCDN() {
    // Detect based on timezone and locale
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;

    const isChinaNetwork =
      timezone === "Asia/Shanghai" ||
      timezone === "Asia/Chongqing" ||
      locale.startsWith("zh-CN");

    const recommendedProviders = isChinaNetwork
      ? ["gitee", "coding", "gitlab"]
      : ["github", "gitlab", "bitbucket"];

    return { isChinaNetwork, recommendedProviders };
  }

  /**
   * Set proxy configuration
   * @param {Object} config
   */
  setProxy(config) {
    Object.assign(this.proxyConfig, config);

    if (this.gitConfig) {
      this.gitConfig.set("proxy", this.proxyConfig);
      this.gitConfig.save();
    }

    logger.info(
      `[MultiRepoManager] Proxy ${config.enabled ? "enabled" : "disabled"}: ${config.type}://${config.host}:${config.port}`,
    );
  }

  /**
   * Get proxy configuration
   */
  getProxy() {
    return { ...this.proxyConfig };
  }

  /**
   * Get all configured providers
   * @returns {Array}
   */
  getProviders() {
    return Array.from(this.providers.entries()).map(([name, entry]) => ({
      name,
      type: entry.config.type,
      primary: entry.config.primary,
      mirror: entry.config.mirror,
      syncDirection: entry.config.syncDirection,
      remoteUrl: entry.config.remoteUrl,
    }));
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    this.providers.clear();
    this.removeAllListeners();
    logger.info("[MultiRepoManager] Destroyed");
  }
}

module.exports = { MultiRepoManager };
