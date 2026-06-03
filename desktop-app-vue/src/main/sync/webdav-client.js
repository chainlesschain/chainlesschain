/**
 * WebDAV 客户端薄包装（Phase 3c.2，task #3）
 *
 * 包 `webdav` npm v5（ESM-only），通过 dynamic import 在 CJS 主进程里使用
 * （同 `ipfs/ipfs-manager.js` 调 helia 的模式）。
 *
 * 职责（最小集）：
 *   - 配置 + 懒连接（首次调 method 时 import webdav + createClient）
 *   - testConnection / putFile / deleteFile / getEtag / listRemote
 *   - 4xx → 立即返回结构化 error（不抛）
 *   - 5xx / 429 → 指数退避 3 次重试
 *   - 412 Precondition Failed → 不算"错误"，标 `conflict: true` 让 engine
 *     计 items_skipped
 *
 * 不在范围：
 *   - 业务编排（看到 tombstone / cursor / KB 都没听过）— webdav-engine 干
 *   - UI 状态管理 — provider 干
 */

const { logger } = require("../utils/logger.js");

const RETRY_MAX = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8000;

/**
 * 测试钩子：用 _setWebdavLoaderForTest 注入 fake webdav module。
 * 默认走 `await import("webdav")`。
 */
let _webdavLoader = async () => import("webdav");

function _setWebdavLoaderForTest(loader) {
  _webdavLoader = loader;
}

function _resetWebdavLoaderForTest() {
  _webdavLoader = async () => import("webdav");
}

function _isRetriable(status) {
  return status === 429 || (status >= 500 && status < 600);
}

function _backoffMs(attempt) {
  const base = RETRY_BASE_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * base;
  return Math.min(RETRY_MAX_MS, Math.floor(base + jitter));
}

function _sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function _extractStatus(err) {
  return err?.status ?? err?.response?.status ?? err?.statusCode ?? null;
}

function _extractEtag(headers) {
  if (!headers) {
    return null;
  }
  // headers 可能是 plain object 或 Headers-like；webdav v5 的 stat 返回
  // 直接含 etag 字段，但 putFileContents 返回 Headers
  if (typeof headers.get === "function") {
    return headers.get("etag") || headers.get("ETag") || null;
  }
  return headers.etag || headers.ETag || null;
}

/**
 * WebDAV 客户端。一个 provider × account 对应一个实例。
 *
 * @example
 *   const client = new WebDAVClient({
 *     url: "https://nas.example.com/dav",
 *     username: "u", password: "p",
 *     remotePath: "/chainlesschain"
 *   });
 *   const ok = await client.testConnection();
 */
class WebDAVClient {
  constructor(opts = {}) {
    this.url = String(opts.url || "").trim();
    this.username = opts.username || "";
    this.password = opts.password || "";
    this.remotePath = (opts.remotePath || "/").replace(/\/+$/, "") || "/";
    this._client = null;
    if (!this.url) {
      throw new Error("WebDAVClient: url 必填");
    }
  }

  async _ensureClient() {
    if (this._client) {
      return this._client;
    }
    const mod = await _webdavLoader();
    const createClient = mod.createClient || mod.default?.createClient;
    if (typeof createClient !== "function") {
      throw new Error("webdav 模块缺少 createClient");
    }
    this._client = createClient(this.url, {
      username: this.username,
      password: this.password,
    });
    return this._client;
  }

  /** 拼远端路径：`<remotePath>/<filename>`，去重斜杠 */
  _resolveRemote(filename) {
    const safe = String(filename || "").replace(/^\/+/, "");
    return `${this.remotePath}/${safe}`.replace(/\/{2,}/g, "/");
  }

  async _withRetry(label, fn) {
    let lastErr;
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = _extractStatus(err);
        if (!_isRetriable(status) || attempt === RETRY_MAX) {
          throw err;
        }
        const wait = _backoffMs(attempt);
        logger.warn(
          `[webdav-client] ${label} 失败 (status=${status}), ${attempt}/${RETRY_MAX}, ${wait}ms 后重试`,
        );
        await _sleep(wait);
      }
    }
    throw lastErr; // unreachable
  }

  /**
   * 测试连接。PROPFIND remotePath，确保认证 + 路径存在。
   *
   * @returns {Promise<{ok: boolean, error?: string, status?: number}>}
   */
  async testConnection() {
    try {
      const client = await this._ensureClient();
      // PROPFIND 顶层目录；不存在 → 尝试 createDirectory（可选）
      await this._withRetry("testConnection", () =>
        client.stat(this.remotePath),
      );
      return { ok: true };
    } catch (err) {
      const status = _extractStatus(err);
      // 404 → 目录不存在，给 caller 明确错误
      if (status === 404) {
        return {
          ok: false,
          status,
          error: `远端路径 ${this.remotePath} 不存在；请先在网盘里创建`,
        };
      }
      if (status === 401 || status === 403) {
        return {
          ok: false,
          status,
          error: "认证失败（用户名 / 密码错误，或账户无权限）",
        };
      }
      return {
        ok: false,
        status,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * PUT 文件。带 If-Match etag → 远端被改动则 412 → 返回 conflict。
   *
   * @param {string} filename — 仅文件名（不含 remotePath 前缀）
   * @param {string} content — 文本内容（utf-8）
   * @param {string|null} etag — 上次推送时的 etag；null 表示首次
   * @returns {Promise<{ok: true, etag: string|null} | {ok: false, conflict: true} | {ok: false, error: string, status?: number}>}
   */
  async putFile(filename, content, etag = null) {
    const target = this._resolveRemote(filename);
    try {
      const client = await this._ensureClient();
      const headers = {};
      if (etag) {
        headers["If-Match"] = etag;
      }
      const res = await this._withRetry("putFile", () =>
        client.putFileContents(target, content, {
          overwrite: true,
          headers,
        }),
      );
      // 推送后 stat 一次拿新 etag —— webdav v5 的 putFileContents 不一定
      // 直接返回 etag header（取决于服务端响应）
      let newEtag = null;
      try {
        const stat = await client.stat(target);
        newEtag = stat?.etag ?? stat?.props?.getetag ?? null;
      } catch (statErr) {
        logger.warn(
          `[webdav-client] putFile 后 stat 失败（不致命）: ${statErr?.message}`,
        );
      }
      return { ok: true, etag: newEtag, raw: res };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 412) {
        return { ok: false, conflict: true, status };
      }
      return {
        ok: false,
        error: err?.message || String(err),
        status,
      };
    }
  }

  /**
   * DELETE 文件。带 If-Match etag → 远端被改动则 412 → conflict。
   * 404 → 视作"已不存在"，ok: true（幂等）。
   */
  async deleteFile(filename, etag = null) {
    const target = this._resolveRemote(filename);
    try {
      const client = await this._ensureClient();
      const headers = {};
      if (etag) {
        headers["If-Match"] = etag;
      }
      await this._withRetry("deleteFile", () =>
        client.deleteFile(target, { headers }),
      );
      return { ok: true };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 404) {
        return { ok: true, alreadyAbsent: true };
      }
      if (status === 412) {
        return { ok: false, conflict: true, status };
      }
      return {
        ok: false,
        error: err?.message || String(err),
        status,
      };
    }
  }

  /**
   * 取远端单文件的 etag（PROPFIND）。404 → null。
   */
  async getEtag(filename) {
    const target = this._resolveRemote(filename);
    try {
      const client = await this._ensureClient();
      const stat = await this._withRetry("getEtag", () => client.stat(target));
      return stat?.etag ?? stat?.props?.getetag ?? null;
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * 列远端目录（PROPFIND depth=1），返回 .md 文件 + etag。
   * 用于 Settings 页「清理远端孤儿文件」按钮（D7 兜底）。
   */
  async listRemote(subPath = "") {
    const target = this._resolveRemote(subPath);
    const client = await this._ensureClient();
    const items = await this._withRetry("listRemote", () =>
      client.getDirectoryContents(target),
    );
    return (items || [])
      .filter((it) => it && it.type === "file" && it.basename?.endsWith(".md"))
      .map((it) => ({
        filename: it.basename,
        etag: it.etag ?? null,
        size: it.size ?? 0,
        lastmod: it.lastmod ?? null,
      }));
  }
}

module.exports = {
  WebDAVClient,
  RETRY_MAX,
  RETRY_BASE_MS,
  _setWebdavLoaderForTest,
  _resetWebdavLoaderForTest,
};
