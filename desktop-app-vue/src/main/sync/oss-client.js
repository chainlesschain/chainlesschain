/**
 * S3 / OSS 客户端薄包装 (Phase 3c follow-up — Phase 3c.3 OSS provider)
 *
 * 包 `@aws-sdk/client-s3` v3 (~140kb gz)，dynamic import 在 CJS 主进程里
 * 使用（同 `webdav-client.js` 的 webdav v5 ESM-only 模式）。
 *
 * 覆盖范围（S3-compat 协议）：
 *   - AWS S3       : default
 *   - 阿里云 OSS   : endpoint = "https://oss-<region>.aliyuncs.com" + region + forcePathStyle=false
 *   - Cloudflare R2: endpoint = "https://<account-id>.r2.cloudflarestorage.com" + region="auto" + forcePathStyle=true
 *   - Backblaze B2 : endpoint = "https://s3.<region>.backblazeb2.com" + region + forcePathStyle=false
 *   - MinIO 自建   : endpoint = "http(s)://host:port" + forcePathStyle=true
 *
 * 与 WebDAVClient 接口完全对齐（testConnection / putFile / deleteFile /
 * getEtag / listRemote）——sync-engine 不感知 transport 差异。
 *
 * 与 WebDAV 不同点：
 *   - PUT 用 If-Match header (AWS S3 / 阿里云 OSS 均支持) → 412 视作 conflict
 *     注：部分 S3-compat (Backblaze B2 旧 endpoint) 不支持 If-Match；
 *     v1 默认走 If-Match，遇到 501 Not Implemented 标 warning 仍 advance
 *     cursor (与 WebDAV 412 advance 等价)
 *   - LIST 用 ListObjectsV2 + Prefix=remotePath
 *   - DELETE 不带 etag （S3 DeleteObject 无 If-Match 语义，依赖 versioning；
 *     v1 不做对象版本检测，直接幂等删）
 *
 * 不在范围：
 *   - 业务编排（cursor / tombstone / KB walker）— oss-engine 干（实质 reuse
 *     webdav-engine.runWebDAVSync 接 OSSClient 实例）
 *   - presigned URL / 分片上传 — Knowledge .md 文件 KB 级别，PutObject 足够
 */

"use strict";

const { logger } = require("../utils/logger.js");

const RETRY_MAX = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8000;

/**
 * 测试钩子：用 _setS3LoaderForTest 注入 fake @aws-sdk/client-s3 module。
 * 默认走 `await import("@aws-sdk/client-s3")`。
 */
let _s3Loader = async () => import("@aws-sdk/client-s3");

function _setS3LoaderForTest(loader) {
  _s3Loader = loader;
}

function _resetS3LoaderForTest() {
  _s3Loader = async () => import("@aws-sdk/client-s3");
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
  // AWS SDK v3 errors carry $metadata.httpStatusCode
  return (
    err?.$metadata?.httpStatusCode ??
    err?.statusCode ??
    err?.status ??
    err?.response?.status ??
    null
  );
}

function _extractEtag(headers) {
  if (!headers) {
    return null;
  }
  if (typeof headers.get === "function") {
    return headers.get("etag") || headers.get("ETag") || null;
  }
  // ETag from S3 is quoted: "abc123"; normalize to unquoted lowercase
  const raw = headers.ETag || headers.etag || null;
  if (typeof raw !== "string") {
    return null;
  }
  return raw.replace(/^"|"$/g, "");
}

/** Strip leading + trailing slashes for S3 object keys (S3 doesn't use real paths). */
function _normalizePrefix(remotePath) {
  return String(remotePath || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * S3 / OSS 客户端。一个 provider × account 对应一个实例。
 *
 * @example
 *   const client = new OSSClient({
 *     endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
 *     region: "oss-cn-hangzhou",
 *     bucket: "my-cc-backup",
 *     accessKeyId: "...",
 *     secretAccessKey: "...",
 *     remotePath: "chainlesschain/",
 *     forcePathStyle: false,
 *   });
 *   const ok = await client.testConnection();
 */
class OSSClient {
  constructor(opts = {}) {
    this.endpoint = String(opts.endpoint || "").trim();
    this.region = opts.region || "auto";
    this.bucket = String(opts.bucket || "").trim();
    this.accessKeyId = opts.accessKeyId || "";
    this.secretAccessKey = opts.secretAccessKey || "";
    this.remotePath = _normalizePrefix(opts.remotePath || "");
    this.forcePathStyle = opts.forcePathStyle === true; // R2 / MinIO need true
    this._client = null;
    this._S3Client = null;
    this._cmds = null;
    if (!this.endpoint) {
      throw new Error("OSSClient: endpoint 必填");
    }
    if (!this.bucket) {
      throw new Error("OSSClient: bucket 必填");
    }
    if (!this.accessKeyId) {
      throw new Error("OSSClient: accessKeyId 必填");
    }
    if (!this.secretAccessKey) {
      throw new Error("OSSClient: secretAccessKey 必填");
    }
  }

  async _ensureClient() {
    if (this._client) {
      return this._client;
    }
    const mod = await _s3Loader();
    const S3Client = mod.S3Client || mod.default?.S3Client;
    if (typeof S3Client !== "function") {
      throw new Error("@aws-sdk/client-s3 模块缺少 S3Client");
    }
    this._S3Client = S3Client;
    // Cache command constructors for putFile/deleteFile/getEtag/listRemote
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
        throw new Error(`@aws-sdk/client-s3 缺少 ${name}`);
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

  /** 拼远端 object key：`<remotePath>/<filename>`，去重斜杠，无 leading slash */
  _resolveKey(filename) {
    const safe = String(filename || "").replace(/^\/+/, "");
    if (!this.remotePath) {
      return safe;
    }
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
          `[oss-client] ${label} 失败 (status=${status}), ${attempt}/${RETRY_MAX}, ${wait}ms 后重试`,
        );
        await _sleep(wait);
      }
    }
    throw lastErr; // unreachable
  }

  /**
   * 测试连接。HeadBucket → 验证 endpoint / region / credentials / bucket 存在。
   *
   * @returns {Promise<{ok: boolean, error?: string, status?: number}>}
   */
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
            "认证失败（accessKey/secretKey 错误，或账户对该 bucket 无访问权限）",
        };
      }
      if (status === 301 || status === 400) {
        // Wrong region — AWS SDK auto-redirects but reports useful error message
        return {
          ok: false,
          status,
          error: `endpoint / region 不匹配：${err?.message || "请确认 region 与 endpoint 对应"}`,
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
   * PUT object. If etag 提供 → 走 IfMatch header → 远端被改 412/PreconditionFailed → conflict.
   *
   * @param {string} filename
   * @param {string} content — utf-8 文本
   * @param {string|null} etag — 上次 push 的 etag；null=首次
   * @returns {Promise<{ok: true, etag: string|null} | {ok: false, conflict: true, status: number} | {ok: false, error: string, status?: number}>}
   */
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
      if (etag) {
        // AWS S3 honors IfMatch on PutObject (conditional write).
        // Aliyun OSS uses `x-oss-forbid-overwrite` instead — v1 still sends
        // IfMatch (some flavors ignore; safe degrade), engine treats 412 as
        // conflict and 501 Not Implemented as success (graceful).
        params.IfMatch = etag;
      }
      const cmd = new this._cmds.PutObjectCommand(params);
      const res = await this._withRetry("putFile", () => client.send(cmd));
      // res.ETag is quoted "abc123" — strip quotes
      const newEtag = _extractEtag({ ETag: res?.ETag });
      return { ok: true, etag: newEtag, raw: res };
    } catch (err) {
      const status = _extractStatus(err);
      if (status === 412) {
        return { ok: false, conflict: true, status };
      }
      if (status === 501) {
        // IfMatch not supported by this S3-compat impl. Fall back to
        // unconditional put + warn. Engine still treats this as "skipped"
        // by returning conflict so cursor advances safely.
        logger.warn(
          `[oss-client] putFile: IfMatch not supported on ${this.endpoint}; v1 treats as conflict for safety. Retry with etag=null to force overwrite.`,
        );
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
   * DELETE object. S3 DeleteObject 幂等 → 不存在也返 200.
   *
   * @param {string} filename
   * @param {string|null} _etag — 接口对齐 WebDAV；v1 不使用
   *                              （S3 DeleteObject 无 IfMatch 语义）
   */
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
      if (status === 404) {
        // S3 DELETE 不会真返 404（幂等），但 fallback 兼容
        return { ok: true, alreadyAbsent: true };
      }
      return {
        ok: false,
        error: err?.message || String(err),
        status,
      };
    }
  }

  /**
   * 取远端 object 的 etag (HeadObject)。404 → null。
   */
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
      const status = _extractStatus(err);
      if (status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * 列远端目录 (ListObjectsV2 with Prefix)。返回 .md 文件 + etag。
   * 用于 Settings 页「清理远端孤儿文件」按钮（D7 兜底）。
   */
  async listRemote(subPath = "") {
    const prefix = subPath
      ? this._resolveKey(subPath).replace(/\/?$/, "/")
      : this.remotePath
        ? this.remotePath + "/"
        : "";
    const client = await this._ensureClient();
    const items = [];
    let continuationToken = undefined;
    // Page through results — typical default page size 1000
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
        if (!key.endsWith(".md")) {
          continue;
        }
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

module.exports = {
  OSSClient,
  RETRY_MAX,
  RETRY_BASE_MS,
  _setS3LoaderForTest,
  _resetS3LoaderForTest,
};
