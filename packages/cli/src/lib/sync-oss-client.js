/**
 * S3 / OSS client for CLI (Phase 3c follow-up Phase 2).
 *
 * ESM port of desktop-app-vue/src/main/sync/oss-client.js — same API.
 * Lazy-imports @aws-sdk/client-s3 so non-sync commands don't pay the
 * load cost. Test seam _setS3LoaderForTest.
 */

"use strict";

const RETRY_MAX = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8000;

let _s3Loader = async () => await import("@aws-sdk/client-s3");

function _setS3LoaderForTest(loader) {
  _s3Loader = loader;
}

function _resetS3LoaderForTest() {
  _s3Loader = async () => await import("@aws-sdk/client-s3");
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
  return (
    err?.$metadata?.httpStatusCode ??
    err?.statusCode ??
    err?.status ??
    err?.response?.status ??
    null
  );
}

function _extractEtag(headers) {
  if (!headers) return null;
  const raw = headers.ETag || headers.etag || null;
  if (typeof raw !== "string") return null;
  return raw.replace(/^"|"$/g, "");
}

function _normalizePrefix(remotePath) {
  return String(remotePath || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

class OSSClient {
  constructor(opts = {}) {
    this.endpoint = String(opts.endpoint || "").trim();
    this.region = opts.region || "auto";
    this.bucket = String(opts.bucket || "").trim();
    this.accessKeyId = opts.accessKeyId || "";
    this.secretAccessKey = opts.secretAccessKey || "";
    this.remotePath = _normalizePrefix(opts.remotePath || "");
    this.forcePathStyle = opts.forcePathStyle === true;
    this._client = null;
    this._cmds = null;
    if (!this.endpoint) throw new Error("OSSClient: endpoint 必填");
    if (!this.bucket) throw new Error("OSSClient: bucket 必填");
    if (!this.accessKeyId) throw new Error("OSSClient: accessKeyId 必填");
    if (!this.secretAccessKey)
      throw new Error("OSSClient: secretAccessKey 必填");
  }

  async _ensureClient() {
    if (this._client) return this._client;
    const mod = await _s3Loader();
    const S3Client = mod.S3Client || mod.default?.S3Client;
    if (typeof S3Client !== "function") {
      throw new Error("@aws-sdk/client-s3 module missing S3Client");
    }
    this._cmds = {
      HeadBucketCommand:
        mod.HeadBucketCommand || mod.default?.HeadBucketCommand,
      PutObjectCommand: mod.PutObjectCommand || mod.default?.PutObjectCommand,
      DeleteObjectCommand:
        mod.DeleteObjectCommand || mod.default?.DeleteObjectCommand,
      HeadObjectCommand:
        mod.HeadObjectCommand || mod.default?.HeadObjectCommand,
      ListObjectsV2Command:
        mod.ListObjectsV2Command || mod.default?.ListObjectsV2Command,
    };
    for (const [name, ctor] of Object.entries(this._cmds)) {
      if (typeof ctor !== "function") {
        throw new Error(`@aws-sdk/client-s3 missing ${name}`);
      }
    }
    this._client = new S3Client({
      endpoint: this.endpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      forcePathStyle: this.forcePathStyle,
    });
    return this._client;
  }

  _resolveKey(filename) {
    const safe = String(filename || "").replace(/^\/+/, "");
    if (!this.remotePath) return safe;
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
      const cmd = new this._cmds.HeadBucketCommand({ Bucket: this.bucket });
      await this._withRetry("testConnection", () => client.send(cmd));
      return { ok: true };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 404) {
        return {
          ok: false,
          status,
          error: `Bucket ${this.bucket} 不存在；请确认名称大小写或先创建`,
        };
      }
      if (status === 403) {
        return {
          ok: false,
          status,
          error:
            "认证失败 (accessKey/secretKey 错误，或账户对该 bucket 无访问权限)",
        };
      }
      if (status === 301 || status === 400) {
        return {
          ok: false,
          status,
          error: `endpoint / region 不匹配：${err?.message || "请确认 region 与 endpoint 对应"}`,
        };
      }
      return { ok: false, status, error: err?.message || String(err) };
    }
  }

  async putFile(filename, content, etag = null) {
    const key = this._resolveKey(filename);
    try {
      const client = await this._ensureClient();
      const params = {
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: "text/markdown; charset=utf-8",
      };
      if (etag) params.IfMatch = etag;
      const cmd = new this._cmds.PutObjectCommand(params);
      const res = await this._withRetry("putFile", () => client.send(cmd));
      const newEtag = _extractEtag({ ETag: res?.ETag });
      return { ok: true, etag: newEtag, raw: res };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 412) return { ok: false, conflict: true, status };
      if (status === 501) return { ok: false, conflict: true, status };
      return { ok: false, error: err?.message || String(err), status };
    }
  }

  async deleteFile(filename, _etag = null) {
    const key = this._resolveKey(filename);
    try {
      const client = await this._ensureClient();
      const cmd = new this._cmds.DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this._withRetry("deleteFile", () => client.send(cmd));
      return { ok: true };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 404) return { ok: true, alreadyAbsent: true };
      return { ok: false, error: err?.message || String(err), status };
    }
  }

  async getEtag(filename) {
    const key = this._resolveKey(filename);
    try {
      const client = await this._ensureClient();
      const cmd = new this._cmds.HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const res = await this._withRetry("getEtag", () => client.send(cmd));
      return _extractEtag({ ETag: res?.ETag });
    } catch (err) {
      if (_extractStatus(err) === 404) return null;
      throw err;
    }
  }

  async listRemote(subPath = "") {
    const prefix = subPath
      ? this._resolveKey(subPath).replace(/\/?$/, "/")
      : this.remotePath
        ? this.remotePath + "/"
        : "";
    const client = await this._ensureClient();
    const items = [];
    let continuationToken = undefined;
    do {
      const cmd = new this._cmds.ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const res = await this._withRetry("listRemote", () => client.send(cmd));
      const contents = res?.Contents || [];
      for (const obj of contents) {
        const key = obj.Key || "";
        if (!key.endsWith(".md")) continue;
        const basename = key.includes("/")
          ? key.slice(key.lastIndexOf("/") + 1)
          : key;
        items.push({
          filename: basename,
          key,
          etag: _extractEtag({ ETag: obj.ETag }),
          size: obj.Size ?? 0,
          lastmod: obj.LastModified
            ? new Date(obj.LastModified).toISOString()
            : null,
        });
      }
      continuationToken = res?.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return items;
  }
}

export {
  OSSClient,
  RETRY_MAX,
  RETRY_BASE_MS,
  _setS3LoaderForTest,
  _resetS3LoaderForTest,
};
