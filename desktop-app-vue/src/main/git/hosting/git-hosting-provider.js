/**
 * Git Hosting Provider
 * Base class + 8 provider adapters for multi-platform Git hosting
 * GitHub, GitLab, Gitea, Gitee, Coding, Bitbucket, AzureDevOps, GenericGit
 *
 * @module git/hosting/git-hosting-provider
 * @version 1.3.0
 */

const { logger } = require("../../utils/logger.js");

/**
 * Base class for all Git hosting providers
 */
class GitHostingProvider {
  /**
   * @param {Object} config
   * @param {string} config.type - Provider type
   * @param {string} [config.apiUrl] - API base URL
   * @param {Object} [config.auth] - Authentication config
   */
  constructor(config = {}) {
    this.type = config.type || "generic";
    this.apiUrl = config.apiUrl || "";
    this.auth = config.auth || {};
    this.name = config.name || this.type;
  }

  /**
   * Test connection to the hosting provider
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async testConnection() {
    throw new Error("Not implemented: testConnection");
  }

  /**
   * Get list of repositories
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  async getRepoList(options = {}) {
    throw new Error("Not implemented: getRepoList");
  }

  /**
   * Create a new repository
   * @param {Object} repoConfig
   * @returns {Promise<Object>}
   */
  async createRepo(repoConfig) {
    throw new Error("Not implemented: createRepo");
  }

  /**
   * Get SSH keys for the authenticated user
   * @returns {Promise<Array>}
   */
  async getSSHKeys() {
    throw new Error("Not implemented: getSSHKeys");
  }

  /**
   * Add an SSH key to the hosting platform
   * @param {string} title
   * @param {string} publicKey
   * @returns {Promise<Object>}
   */
  async addSSHKey(title, publicKey) {
    throw new Error("Not implemented: addSSHKey");
  }

  /**
   * Get OAuth configuration for this provider
   * @returns {Object}
   */
  getOAuthConfig() {
    return null;
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async _apiRequest(endpoint, options = {}) {
    const https = require("https");
    const http = require("http");
    const url = new URL(endpoint, this.apiUrl);

    const headers = {
      "User-Agent": "ChainlessChain/1.0",
      Accept: "application/json",
      ...this._getAuthHeaders(),
      ...(options.headers || {}),
    };

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === "https:" ? https : http;
      const req = protocol.request(
        url,
        {
          method: options.method || "GET",
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = data ? JSON.parse(data) : {};
              if (res.statusCode >= 400) {
                reject(
                  new Error(
                    `API error ${res.statusCode}: ${parsed.message || data}`,
                  ),
                );
              } else {
                resolve(parsed);
              }
            } catch (e) {
              resolve({ raw: data, statusCode: res.statusCode });
            }
          });
        },
      );

      req.on("error", reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error("API request timeout"));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  /**
   * Get authentication headers
   */
  _getAuthHeaders() {
    if (this.auth.token) {
      return { Authorization: `token ${this.auth.token}` };
    }
    if (this.auth.bearer) {
      return { Authorization: `Bearer ${this.auth.bearer}` };
    }
    if (this.auth.username && this.auth.password) {
      const basic = Buffer.from(
        `${this.auth.username}:${this.auth.password}`,
      ).toString("base64");
      return { Authorization: `Basic ${basic}` };
    }
    return {};
  }

  /**
   * Get clone URL for a repository
   * @param {string} owner
   * @param {string} repo
   * @param {'https'|'ssh'} [protocol='https']
   */
  getCloneUrl(owner, repo, protocol = "https") {
    throw new Error("Not implemented: getCloneUrl");
  }
}

// ============================================================
// GitHub Provider
// ============================================================

class GitHubProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({
      ...config,
      type: "github",
      apiUrl: config.apiUrl || "https://api.github.com",
    });
  }

  async testConnection() {
    try {
      const user = await this._apiRequest("/user");
      return { success: true, message: `Connected as ${user.login}`, user };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getRepoList(options = {}) {
    const perPage = options.perPage || 30;
    const page = options.page || 1;
    return this._apiRequest(
      `/user/repos?per_page=${perPage}&page=${page}&sort=updated`,
    );
  }

  async createRepo(repoConfig) {
    return this._apiRequest("/user/repos", {
      method: "POST",
      body: {
        name: repoConfig.name,
        description: repoConfig.description || "ChainlessChain data repository",
        private: repoConfig.private !== false,
        auto_init: repoConfig.autoInit !== false,
      },
    });
  }

  async getSSHKeys() {
    return this._apiRequest("/user/keys");
  }

  async addSSHKey(title, publicKey) {
    return this._apiRequest("/user/keys", {
      method: "POST",
      body: { title, key: publicKey },
    });
  }

  getOAuthConfig() {
    return {
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "user:email"],
    };
  }

  getCloneUrl(owner, repo, protocol = "https") {
    if (protocol === "ssh") {
      return `git@github.com:${owner}/${repo}.git`;
    }
    return `https://github.com/${owner}/${repo}.git`;
  }
}

// ============================================================
// GitLab Provider
// ============================================================

class GitLabProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({
      ...config,
      type: "gitlab",
      apiUrl: config.apiUrl || "https://gitlab.com/api/v4",
    });
  }

  async testConnection() {
    try {
      const user = await this._apiRequest("/user");
      return { success: true, message: `Connected as ${user.username}`, user };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  _getAuthHeaders() {
    if (this.auth.token) {
      return { "PRIVATE-TOKEN": this.auth.token };
    }
    if (this.auth.bearer) {
      return { Authorization: `Bearer ${this.auth.bearer}` };
    }
    return {};
  }

  async getRepoList(options = {}) {
    const perPage = options.perPage || 30;
    return this._apiRequest(
      `/projects?membership=true&per_page=${perPage}&order_by=updated_at`,
    );
  }

  async createRepo(repoConfig) {
    return this._apiRequest("/projects", {
      method: "POST",
      body: {
        name: repoConfig.name,
        description: repoConfig.description || "ChainlessChain data repository",
        visibility: repoConfig.private !== false ? "private" : "public",
        initialize_with_readme: repoConfig.autoInit !== false,
      },
    });
  }

  async getSSHKeys() {
    return this._apiRequest("/user/keys");
  }

  async addSSHKey(title, publicKey) {
    return this._apiRequest("/user/keys", {
      method: "POST",
      body: { title, key: publicKey },
    });
  }

  getOAuthConfig() {
    return {
      authorizeUrl: `${this.apiUrl.replace("/api/v4", "")}/oauth/authorize`,
      tokenUrl: `${this.apiUrl.replace("/api/v4", "")}/oauth/token`,
      scopes: ["api", "read_user"],
    };
  }

  getCloneUrl(owner, repo, protocol = "https") {
    const host = new URL(this.apiUrl).host.replace("api.", "");
    if (protocol === "ssh") {
      return `git@${host}:${owner}/${repo}.git`;
    }
    return `https://${host}/${owner}/${repo}.git`;
  }
}

// ============================================================
// Gitea Provider
// ============================================================

class GiteaProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({
      ...config,
      type: "gitea",
      apiUrl: config.apiUrl || "https://gitea.com/api/v1",
    });
  }

  async testConnection() {
    try {
      const user = await this._apiRequest("/user");
      return { success: true, message: `Connected as ${user.login}`, user };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getRepoList(options = {}) {
    const limit = options.perPage || 30;
    return this._apiRequest(`/user/repos?limit=${limit}&sort=updated`);
  }

  async createRepo(repoConfig) {
    return this._apiRequest("/user/repos", {
      method: "POST",
      body: {
        name: repoConfig.name,
        description: repoConfig.description || "ChainlessChain data repository",
        private: repoConfig.private !== false,
        auto_init: repoConfig.autoInit !== false,
      },
    });
  }

  async getSSHKeys() {
    return this._apiRequest("/user/keys");
  }

  async addSSHKey(title, publicKey) {
    return this._apiRequest("/user/keys", {
      method: "POST",
      body: { title, key: publicKey },
    });
  }

  getCloneUrl(owner, repo, protocol = "https") {
    const host = new URL(this.apiUrl).host;
    if (protocol === "ssh") {
      return `git@${host}:${owner}/${repo}.git`;
    }
    return `https://${host}/${owner}/${repo}.git`;
  }
}

// ============================================================
// Gitee Provider (码云)
// ============================================================

class GiteeProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({
      ...config,
      type: "gitee",
      apiUrl: config.apiUrl || "https://gitee.com/api/v5",
    });
  }

  async testConnection() {
    try {
      const user = await this._apiRequest(
        `/user?access_token=${this.auth.token}`,
      );
      return { success: true, message: `Connected as ${user.login}`, user };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  _getAuthHeaders() {
    // Gitee uses query parameter for token
    return {};
  }

  async _apiRequest(endpoint, options = {}) {
    // Append token to URL for Gitee
    const separator = endpoint.includes("?") ? "&" : "?";
    const tokenParam = this.auth.token
      ? `${separator}access_token=${this.auth.token}`
      : "";
    return super._apiRequest(`${endpoint}${tokenParam}`, options);
  }

  async getRepoList(options = {}) {
    const perPage = options.perPage || 30;
    return this._apiRequest(`/user/repos?per_page=${perPage}&sort=updated`);
  }

  async createRepo(repoConfig) {
    return this._apiRequest("/user/repos", {
      method: "POST",
      body: {
        name: repoConfig.name,
        description: repoConfig.description || "ChainlessChain数据仓库",
        private: repoConfig.private !== false,
        auto_init: repoConfig.autoInit !== false,
      },
    });
  }

  async getSSHKeys() {
    return this._apiRequest("/user/keys");
  }

  async addSSHKey(title, publicKey) {
    return this._apiRequest("/user/keys", {
      method: "POST",
      body: { title, key: publicKey },
    });
  }

  getOAuthConfig() {
    return {
      authorizeUrl: "https://gitee.com/oauth/authorize",
      tokenUrl: "https://gitee.com/oauth/token",
      scopes: ["projects", "user_info"],
    };
  }

  getCloneUrl(owner, repo, protocol = "https") {
    if (protocol === "ssh") {
      return `git@gitee.com:${owner}/${repo}.git`;
    }
    return `https://gitee.com/${owner}/${repo}.git`;
  }
}

// ============================================================
// Coding Provider
// ============================================================

class CodingProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({
      ...config,
      type: "coding",
      apiUrl: config.apiUrl || "https://e.coding.net/open-api",
    });
    this.team = config.team || "";
  }

  async testConnection() {
    try {
      const user = await this._apiRequest("/user/me");
      return {
        success: true,
        message: `Connected as ${user.data?.Name || "user"}`,
        user,
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  _getAuthHeaders() {
    if (this.auth.token) {
      return { Authorization: `token ${this.auth.token}` };
    }
    return {};
  }

  async getRepoList() {
    return this._apiRequest(`/team/${this.team}/depot/list`);
  }

  async createRepo(repoConfig) {
    return this._apiRequest("/user/repos", {
      method: "POST",
      body: {
        name: repoConfig.name,
        description: repoConfig.description || "ChainlessChain数据仓库",
        private: repoConfig.private !== false,
      },
    });
  }

  async getSSHKeys() {
    return this._apiRequest("/user/keys");
  }

  async addSSHKey(title, publicKey) {
    return this._apiRequest("/user/keys", {
      method: "POST",
      body: { title, key: publicKey },
    });
  }

  getCloneUrl(owner, repo, protocol = "https") {
    if (protocol === "ssh") {
      return `git@e.coding.net:${this.team}/${owner}/${repo}.git`;
    }
    return `https://e.coding.net/${this.team}/${owner}/${repo}.git`;
  }
}

// ============================================================
// Bitbucket Provider
// ============================================================

class BitbucketProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({
      ...config,
      type: "bitbucket",
      apiUrl: config.apiUrl || "https://api.bitbucket.org/2.0",
    });
  }

  async testConnection() {
    try {
      const user = await this._apiRequest("/user");
      return {
        success: true,
        message: `Connected as ${user.display_name || user.username}`,
        user,
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  _getAuthHeaders() {
    if (this.auth.appPassword && this.auth.username) {
      const basic = Buffer.from(
        `${this.auth.username}:${this.auth.appPassword}`,
      ).toString("base64");
      return { Authorization: `Basic ${basic}` };
    }
    if (this.auth.bearer) {
      return { Authorization: `Bearer ${this.auth.bearer}` };
    }
    return {};
  }

  async getRepoList(options = {}) {
    const pagelen = options.perPage || 25;
    return this._apiRequest(
      `/repositories/${this.auth.username}?pagelen=${pagelen}&sort=-updated_on`,
    );
  }

  async createRepo(repoConfig) {
    return this._apiRequest(
      `/repositories/${this.auth.username}/${repoConfig.name}`,
      {
        method: "POST",
        body: {
          scm: "git",
          is_private: repoConfig.private !== false,
          description:
            repoConfig.description || "ChainlessChain data repository",
        },
      },
    );
  }

  async getSSHKeys() {
    return this._apiRequest(`/users/${this.auth.username}/ssh-keys`);
  }

  async addSSHKey(title, publicKey) {
    return this._apiRequest(`/users/${this.auth.username}/ssh-keys`, {
      method: "POST",
      body: { label: title, key: publicKey },
    });
  }

  getOAuthConfig() {
    return {
      authorizeUrl: "https://bitbucket.org/site/oauth2/authorize",
      tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
      scopes: ["repository", "account"],
    };
  }

  getCloneUrl(owner, repo, protocol = "https") {
    if (protocol === "ssh") {
      return `git@bitbucket.org:${owner}/${repo}.git`;
    }
    return `https://bitbucket.org/${owner}/${repo}.git`;
  }
}

// ============================================================
// Azure DevOps Provider
// ============================================================

class AzureDevOpsProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({
      ...config,
      type: "azure-devops",
      apiUrl:
        config.apiUrl || `https://dev.azure.com/${config.organization || ""}`,
    });
    this.organization = config.organization || "";
    this.project = config.project || "";
  }

  async testConnection() {
    try {
      const result = await this._apiRequest(
        `/${this.organization}/_apis/projects?api-version=7.0`,
      );
      return {
        success: true,
        message: `Connected to ${this.organization}`,
        projects: result,
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  _getAuthHeaders() {
    if (this.auth.pat) {
      const basic = Buffer.from(`:${this.auth.pat}`).toString("base64");
      return { Authorization: `Basic ${basic}` };
    }
    return {};
  }

  async getRepoList() {
    return this._apiRequest(
      `/${this.organization}/${this.project}/_apis/git/repositories?api-version=7.0`,
    );
  }

  async createRepo(repoConfig) {
    return this._apiRequest(
      `/${this.organization}/${this.project}/_apis/git/repositories?api-version=7.0`,
      {
        method: "POST",
        body: { name: repoConfig.name },
      },
    );
  }

  async getSSHKeys() {
    return [];
  }

  async addSSHKey(title, publicKey) {
    logger.warn("[AzureDevOps] SSH key management not supported via API");
    return { success: false, message: "Not supported" };
  }

  getCloneUrl(owner, repo, protocol = "https") {
    if (protocol === "ssh") {
      return `git@ssh.dev.azure.com:v3/${this.organization}/${this.project}/${repo}`;
    }
    return `https://dev.azure.com/${this.organization}/${this.project}/_git/${repo}`;
  }
}

// ============================================================
// Generic Git Provider (SSH/HTTPS)
// ============================================================

class GenericGitProvider extends GitHostingProvider {
  constructor(config = {}) {
    super({ ...config, type: "generic" });
    this.remoteUrl = config.remoteUrl || "";
  }

  async testConnection() {
    try {
      // Try a simple ls-remote via isomorphic-git
      const git = require("isomorphic-git");
      const http = require("isomorphic-git/http/node");
      const fs = require("fs");

      const refs = await git.listServerRefs({
        http,
        url: this.remoteUrl,
        onAuth: () => this.auth,
      });

      return {
        success: true,
        message: `Connected, ${refs.length} refs found`,
        refs: refs.slice(0, 5),
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getRepoList() {
    return [{ name: "current", url: this.remoteUrl }];
  }

  async createRepo() {
    return {
      success: false,
      message: "Cannot create repos on generic Git servers",
    };
  }

  async getSSHKeys() {
    return [];
  }

  async addSSHKey() {
    return { success: false, message: "Not supported for generic Git" };
  }

  getCloneUrl() {
    return this.remoteUrl;
  }
}

// ============================================================
// Factory function
// ============================================================

/**
 * Create a Git hosting provider instance
 * @param {string} type - Provider type
 * @param {Object} config - Provider configuration
 * @returns {GitHostingProvider}
 */
function createProvider(type, config = {}) {
  const providers = {
    github: GitHubProvider,
    gitlab: GitLabProvider,
    gitea: GiteaProvider,
    gitee: GiteeProvider,
    coding: CodingProvider,
    bitbucket: BitbucketProvider,
    "azure-devops": AzureDevOpsProvider,
    generic: GenericGitProvider,
  };

  const ProviderClass = providers[type] || GenericGitProvider;
  return new ProviderClass(config);
}

/**
 * Get list of supported provider types
 * @returns {Array<{type: string, name: string, authMethods: string[]}>}
 */
function getSupportedProviders() {
  return [
    { type: "github", name: "GitHub", authMethods: ["token", "oauth", "ssh"] },
    { type: "gitlab", name: "GitLab", authMethods: ["token", "oauth", "ssh"] },
    { type: "gitea", name: "Gitea", authMethods: ["token", "basic", "ssh"] },
    { type: "gitee", name: "Gitee (码云)", authMethods: ["token", "oauth"] },
    { type: "coding", name: "Coding", authMethods: ["token", "oauth"] },
    {
      type: "bitbucket",
      name: "Bitbucket",
      authMethods: ["app-password", "oauth", "ssh"],
    },
    {
      type: "azure-devops",
      name: "Azure DevOps",
      authMethods: ["pat", "azure-ad"],
    },
    {
      type: "generic",
      name: "Generic Git Server",
      authMethods: ["https", "ssh"],
    },
  ];
}

module.exports = {
  GitHostingProvider,
  GitHubProvider,
  GitLabProvider,
  GiteaProvider,
  GiteeProvider,
  CodingProvider,
  BitbucketProvider,
  AzureDevOpsProvider,
  GenericGitProvider,
  createProvider,
  getSupportedProviders,
};
