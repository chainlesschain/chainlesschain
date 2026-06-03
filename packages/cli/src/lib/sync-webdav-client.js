/**
 * WebDAV client for CLI (Phase 3c follow-up Phase 2).
 *
 * ESM port of desktop-app-vue/src/main/sync/webdav-client.js — same API:
 *   testConnection / putFile / deleteFile / getEtag / listRemote
 *
 * Lazy-imports `webdav` v5 (ESM-only) so the CLI doesn't pay the cost
 * for non-sync commands. Test seam `_setWebdavLoaderForTest` injects
 * a fake module without touching the real binding.
 */

"use strict";

const RETRY_MAX = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8000;

let _webdavLoader = async () => await import("webdav");

function _setWebdavLoaderForTest(loader) {
  _webdavLoader = loader;
}

function _resetWebdavLoaderForTest() {
  _webdavLoader = async () => await import("webdav");
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

class WebDAVClient {
  constructor(opts = {}) {
    this.url = String(opts.url || "").trim();
    this.username = opts.username || "";
    this.password = opts.password || "";
    this.remotePath = (opts.remotePath || "/").replace(/\/+$/, "") || "/";
    this._client = null;
    if (!this.url) throw new Error("WebDAVClient: url 必填");
  }

  async _ensureClient() {
    if (this._client) return this._client;
    const mod = await _webdavLoader();
    const createClient = mod.createClient || mod.default?.createClient;
    if (typeof createClient !== "function") {
      throw new Error("webdav module missing createClient");
    }
    this._client = createClient(this.url, {
      username: this.username,
      password: this.password,
    });
    return this._client;
  }

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
        if (!_isRetriable(status) || attempt === RETRY_MAX) throw err;
        await _sleep(_backoffMs(attempt));
      }
    }
    throw lastErr;
  }

  async testConnection() {
    try {
      const client = await this._ensureClient();
      await this._withRetry("testConnection", () =>
        client.stat(this.remotePath),
      );
      return { ok: true };
    } catch (err) {
      const status = _extractStatus(err);
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
      return { ok: false, status, error: err?.message || String(err) };
    }
  }

  async putFile(filename, content, etag = null) {
    const target = this._resolveRemote(filename);
    try {
      const client = await this._ensureClient();
      const headers = {};
      if (etag) headers["If-Match"] = etag;
      const res = await this._withRetry("putFile", () =>
        client.putFileContents(target, content, { overwrite: true, headers }),
      );
      let newEtag = null;
      try {
        const stat = await client.stat(target);
        newEtag = stat?.etag ?? stat?.props?.getetag ?? null;
      } catch (_e) {
        /* non-fatal */
      }
      return { ok: true, etag: newEtag, raw: res };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 412) return { ok: false, conflict: true, status };
      return { ok: false, error: err?.message || String(err), status };
    }
  }

  async deleteFile(filename, etag = null) {
    const target = this._resolveRemote(filename);
    try {
      const client = await this._ensureClient();
      const headers = {};
      if (etag) headers["If-Match"] = etag;
      await this._withRetry("deleteFile", () =>
        client.deleteFile(target, { headers }),
      );
      return { ok: true };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 404) return { ok: true, alreadyAbsent: true };
      if (status === 412) return { ok: false, conflict: true, status };
      return { ok: false, error: err?.message || String(err), status };
    }
  }

  async getEtag(filename) {
    const target = this._resolveRemote(filename);
    try {
      const client = await this._ensureClient();
      const stat = await this._withRetry("getEtag", () => client.stat(target));
      return stat?.etag ?? stat?.props?.getetag ?? null;
    } catch (err) {
      if (_extractStatus(err) === 404) return null;
      throw err;
    }
  }

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

export {
  WebDAVClient,
  RETRY_MAX,
  RETRY_BASE_MS,
  _setWebdavLoaderForTest,
  _resetWebdavLoaderForTest,
};
