/**
 * Private Plugin Registry Client
 *
 * 面向企业私有 Registry 的拉取客户端：
 *   - listPlugins({ channel })    列出可用插件
 *   - getPlugin(id, version?)     获取单个插件的元信息
 *   - downloadPlugin(id, version, destDir) 下载并校验单个插件
 *
 * 下载校验：
 *   1. Registry 返回每个插件的 sha256
 *   2. 下载后本地重算 sha256，对不上立刻删除目录
 *   3. 可选：Registry 返回 ed25519 签名 + 公钥，必须在
 *      trustedPublicKeys 白名单里
 *
 * 支持两种传输：
 *   - 内置 http/https（简单 JSON API）
 *   - 注入的 transport（便于测试 & 脱机镜像）
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function defaultFetch(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        method: options.method || "GET",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: options.headers || {},
        timeout: options.timeout || 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(`HTTP ${res.statusCode}: ${body.toString("utf-8")}`),
            );
            return;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

class RegistryClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl           Registry 根 URL
   * @param {string} [opts.apiToken]        可选 Bearer token
   * @param {string[]} [opts.trustedPublicKeys]  ed25519 公钥白名单（PEM 或 base64 DER）
   * @param {Function} [opts.fetch]         注入的 fetch(url, options) 实现
   */
  constructor(opts = {}) {
    if (!opts.baseUrl) {
      throw new Error("RegistryClient: baseUrl is required");
    }
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiToken = opts.apiToken || null;
    this.trustedPublicKeys = Array.isArray(opts.trustedPublicKeys)
      ? opts.trustedPublicKeys
      : [];
    this.fetch = opts.fetch || defaultFetch;
  }

  _headers(extra = {}) {
    const h = { Accept: "application/json", ...extra };
    if (this.apiToken) {
      h.Authorization = `Bearer ${this.apiToken}`;
    }
    return h;
  }

  async _getJson(pathname) {
    const res = await this.fetch(`${this.baseUrl}${pathname}`, {
      method: "GET",
      headers: this._headers(),
    });
    const text = res.body.toString("utf-8");
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(
        `registry returned non-JSON for ${pathname}: ${err.message}`,
      );
    }
  }

  /**
   * 列出可用插件
   * @param {object} [filter] { channel?: "stable"|"beta", query?: string }
   */
  async listPlugins(filter = {}) {
    const params = new URLSearchParams();
    if (filter.channel) {
      params.set("channel", filter.channel);
    }
    if (filter.query) {
      params.set("q", filter.query);
    }
    const qs = params.toString();
    const data = await this._getJson(`/plugins${qs ? `?${qs}` : ""}`);
    if (!data || !Array.isArray(data.plugins)) {
      throw new Error("registry list response missing plugins[]");
    }
    return data.plugins;
  }

  /**
   * 获取单个插件的元信息（含 sha256 / signature / tarballUrl）
   */
  async getPlugin(id, version = "latest") {
    if (!id) {
      throw new Error("getPlugin: id required");
    }
    const data = await this._getJson(
      `/plugins/${encodeURIComponent(id)}/${encodeURIComponent(version)}`,
    );
    if (!data || !data.plugin) {
      throw new Error(`registry response missing plugin for ${id}@${version}`);
    }
    return data.plugin;
  }

  _isTrustedPublicKey(pubKeyInput) {
    if (this.trustedPublicKeys.length === 0) {
      return true;
    }
    let actualSpki;
    try {
      if (pubKeyInput.includes && pubKeyInput.includes("BEGIN PUBLIC KEY")) {
        actualSpki = crypto
          .createPublicKey(pubKeyInput)
          .export({ type: "spki", format: "der" })
          .toString("base64");
      } else {
        actualSpki = crypto
          .createPublicKey({
            key: Buffer.from(pubKeyInput, "base64"),
            format: "der",
            type: "spki",
          })
          .export({ type: "spki", format: "der" })
          .toString("base64");
      }
    } catch (_err) {
      return false;
    }
    return this.trustedPublicKeys.some((pk) => {
      try {
        const candidate = pk.includes("BEGIN PUBLIC KEY")
          ? crypto
              .createPublicKey(pk)
              .export({ type: "spki", format: "der" })
              .toString("base64")
          : pk;
        return candidate === actualSpki;
      } catch (_err) {
        return false;
      }
    });
  }

  /**
   * 下载插件 tarball（或单文件 payload），校验 sha256 + 可选签名，
   * 解压到 destDir/<id>-<version>/
   *
   * Registry 返回 plugin 需包含：
   *   { id, version, sha256, payload: "<base64 of json {files: {...}}>",
   *     signature?: { alg:"ed25519", value:"<b64>", publicKey:"<b64 DER | PEM>" } }
   *
   * 本函数不处理真实 tar/zip，只解 JSON payload；后续可替换为流式 tar。
   */
  async downloadPlugin(id, version, destDir) {
    const meta = await this.getPlugin(id, version);
    if (!meta.sha256) {
      throw new Error(`registry did not return sha256 for ${id}`);
    }
    if (!meta.payload) {
      throw new Error(`registry did not return payload for ${id}`);
    }

    const payloadBuf = Buffer.from(meta.payload, "base64");
    const actualHash = sha256Hex(payloadBuf);
    if (actualHash !== meta.sha256) {
      throw new Error(
        `plugin ${id} hash mismatch: expected ${meta.sha256}, got ${actualHash}`,
      );
    }

    if (meta.signature) {
      const sig = meta.signature;
      if (sig.alg !== "ed25519") {
        throw new Error(`unsupported signature algorithm: ${sig.alg}`);
      }
      if (!this._isTrustedPublicKey(sig.publicKey)) {
        throw new Error(`plugin ${id} signer is not in trustedPublicKeys`);
      }
      let pubKey;
      try {
        pubKey =
          sig.publicKey.includes && sig.publicKey.includes("BEGIN PUBLIC KEY")
            ? crypto.createPublicKey(sig.publicKey)
            : crypto.createPublicKey({
                key: Buffer.from(sig.publicKey, "base64"),
                format: "der",
                type: "spki",
              });
      } catch (err) {
        throw new Error(`plugin ${id} invalid public key: ${err.message}`);
      }
      const ok = crypto.verify(
        null,
        payloadBuf,
        pubKey,
        Buffer.from(sig.value, "base64"),
      );
      if (!ok) {
        throw new Error(`plugin ${id} signature verification failed`);
      }
    } else if (this.trustedPublicKeys.length > 0) {
      throw new Error(
        `plugin ${id} has no signature but trustedPublicKeys is enforced`,
      );
    }

    let payload;
    try {
      payload = JSON.parse(payloadBuf.toString("utf-8"));
    } catch (err) {
      throw new Error(`plugin ${id} payload is not valid JSON: ${err.message}`);
    }
    if (!payload.files || typeof payload.files !== "object") {
      throw new Error(`plugin ${id} payload missing files{}`);
    }

    const pluginDir = path.join(destDir, `${meta.id}-${meta.version}`);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    fs.mkdirSync(pluginDir, { recursive: true });

    try {
      for (const [rel, b64] of Object.entries(payload.files)) {
        if (rel.includes("..") || path.isAbsolute(rel)) {
          throw new Error(`unsafe path in payload: ${rel}`);
        }
        const full = path.join(pluginDir, rel);
        const parent = path.dirname(full);
        if (!fs.existsSync(parent)) {
          fs.mkdirSync(parent, { recursive: true });
        }
        fs.writeFileSync(full, Buffer.from(b64, "base64"));
      }
    } catch (err) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      throw err;
    }

    return {
      id: meta.id,
      version: meta.version,
      sha256: meta.sha256,
      dir: pluginDir,
      signed: Boolean(meta.signature),
    };
  }
}

module.exports = {
  RegistryClient,
};
