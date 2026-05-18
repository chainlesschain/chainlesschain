/**
 * MDM Manager — 企业设备管理集成
 *
 * 目标：让企业 IT 通过中央 MDM 服务器推送 `.ccprofile`，并在客户端做：
 *   1. 定期拉取当前指派的 profile 元信息（signer + version + url + sha256）
 *   2. 下载 .ccprofile，调用 profile-packager.loadProfile 做签名/哈希校验
 *   3. 把通过校验的 profile 缓存到 `<userData>/mdm-cache/` 下
 *   4. 在 PluginManager 初始化前，把缓存 profile 里的插件解包到
 *      `plugins-builtin-mdm/` 覆盖目录，由 first-party 加载流程接管
 *
 * 本模块只负责 MDM 交互 + 缓存 + 解包，不直接改动 PluginManager。
 * 调用方在 initialize() 之前先调用 `applyPinnedProfile()`。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { loadProfile, extractPluginsTo } = require("./profile-packager");

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

class MDMManager {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl              MDM 服务器根 URL
   * @param {string} opts.deviceId             设备唯一标识（上报给 MDM）
   * @param {string} [opts.apiToken]           Bearer token
   * @param {string[]} [opts.trustedPublicKeys]  profile 签名白名单
   * @param {string} opts.cacheDir             本地缓存目录（已校验 profile 存放处）
   * @param {string} opts.extractDir           profile 插件解包目标目录
   * @param {Function} [opts.fetch]            注入的 fetch(url, options)
   */
  constructor(opts = {}) {
    if (!opts.baseUrl) {
      throw new Error("MDMManager: baseUrl is required");
    }
    if (!opts.deviceId) {
      throw new Error("MDMManager: deviceId is required");
    }
    if (!opts.cacheDir) {
      throw new Error("MDMManager: cacheDir is required");
    }
    if (!opts.extractDir) {
      throw new Error("MDMManager: extractDir is required");
    }

    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.deviceId = opts.deviceId;
    this.apiToken = opts.apiToken || null;
    this.trustedPublicKeys = Array.isArray(opts.trustedPublicKeys)
      ? opts.trustedPublicKeys
      : [];
    this.cacheDir = opts.cacheDir;
    this.extractDir = opts.extractDir;
    this.fetch = opts.fetch || null;

    this.lastAssignment = null;
    this.lastAppliedProfileId = null;
    this.lastAppliedAt = 0;

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async _fetch(urlStr, options = {}) {
    if (!this.fetch) {
      throw new Error("MDMManager: no fetch implementation configured");
    }
    const headers = options.headers || {};
    if (this.apiToken) {
      headers.Authorization = `Bearer ${this.apiToken}`;
    }
    headers["X-CC-Device-Id"] = this.deviceId;
    return this.fetch(urlStr, { ...options, headers });
  }

  /**
   * 从 MDM 服务器拉取当前设备被指派的 profile 元信息
   * 期望响应：
   *   { assignment: { profileId, version, url, sha256, signer, signature? } | null }
   */
  async fetchAssignment() {
    const res = await this._fetch(
      `${this.baseUrl}/mdm/assignments/${encodeURIComponent(this.deviceId)}`,
    );
    const data = JSON.parse(res.body.toString("utf-8"));
    this.lastAssignment = data.assignment || null;
    return this.lastAssignment;
  }

  /**
   * 从 MDM 服务器下载 .ccprofile 原始字节，校验 sha256
   * @returns {Promise<Buffer>}
   */
  async downloadProfileBytes(assignment) {
    if (!assignment || !assignment.url || !assignment.sha256) {
      throw new Error("invalid assignment: url + sha256 required");
    }
    const res = await this._fetch(assignment.url);
    const actual = sha256Hex(res.body);
    if (actual !== assignment.sha256) {
      throw new Error(
        `profile hash mismatch: expected ${assignment.sha256}, got ${actual}`,
      );
    }
    return res.body;
  }

  _profileCachePath(profileId, version) {
    const safe = `${profileId}-${version}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.cacheDir, `${safe}.ccprofile`);
  }

  /**
   * 下载 + 校验 + 缓存一个被指派的 profile。若本地已有且哈希匹配则跳过下载。
   */
  async syncAssignedProfile() {
    const assignment = await this.fetchAssignment();
    if (!assignment) {
      return null;
    }

    const cachedPath = this._profileCachePath(
      assignment.profileId,
      assignment.version,
    );
    if (fs.existsSync(cachedPath)) {
      const existingHash = sha256Hex(fs.readFileSync(cachedPath));
      if (existingHash === assignment.sha256) {
        return { ...assignment, path: cachedPath, cached: true };
      }
    }

    const bytes = await this.downloadProfileBytes(assignment);
    fs.writeFileSync(cachedPath, bytes);
    return { ...assignment, path: cachedPath, cached: false };
  }

  /**
   * 校验 + 应用一个本地 profile 文件：
   *   1. loadProfile（签名 + 插件 hash）
   *   2. 清空 extractDir
   *   3. 把插件解包到 extractDir
   *
   * PluginManager.loadFirstPartyPlugins 应在 `src/main/plugins-builtin/` 之后
   * 也扫描 extractDir，实现企业 Profile 对默认插件的覆盖。
   */
  async applyProfileFile(profilePath) {
    const loaded = await loadProfile(profilePath, {
      trustedPublicKeys: this.trustedPublicKeys,
    });
    if (fs.existsSync(this.extractDir)) {
      fs.rmSync(this.extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.extractDir, { recursive: true });
    extractPluginsTo(loaded.plugins, this.extractDir);

    this.lastAppliedProfileId = loaded.manifest.id;
    this.lastAppliedAt = Date.now();
    return {
      profileId: loaded.manifest.id,
      version: loaded.manifest.version,
      pluginCount: Object.keys(loaded.plugins).length,
      brand: loaded.manifest.brand || null,
      policies: loaded.manifest.policies || {},
    };
  }

  /**
   * 一站式：拉取 + 下载 + 应用。适合在 app 启动、PluginManager 初始化前调用。
   * 如果 MDM 无指派或网络失败，则不应用并返回 null（app 继续用内置默认）。
   */
  async applyPinnedProfile() {
    let assigned;
    try {
      assigned = await this.syncAssignedProfile();
    } catch (err) {
      return { ok: false, reason: "sync-failed", error: err.message };
    }
    if (!assigned) {
      return { ok: false, reason: "no-assignment" };
    }
    const applied = await this.applyProfileFile(assigned.path);
    return { ok: true, assignment: assigned, applied };
  }

  /**
   * 查询当前应用的 profile 状态（供渲染进程通过 IPC 读取）
   */
  getStatus() {
    return {
      deviceId: this.deviceId,
      baseUrl: this.baseUrl,
      lastAssignment: this.lastAssignment,
      lastAppliedProfileId: this.lastAppliedProfileId,
      lastAppliedAt: this.lastAppliedAt,
      cacheDir: this.cacheDir,
      extractDir: this.extractDir,
    };
  }
}

module.exports = {
  MDMManager,
};
