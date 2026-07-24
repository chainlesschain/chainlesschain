/**
 * 百度网盘文件列表采集器。
 *
 * 快照模式复用 document-base；在线模式严格使用百度网盘开放平台的 OAuth
 * 文件列表接口。access_token 只从单次 sync/authenticate 调用读取，不写入
 * adapter 实例、LocalVault、审计或水位作用域。
 */

"use strict";

const {
  createDocumentAdapter,
  parseTime,
  SNAPSHOT_SCHEMA_VERSION,
  KIND_DOCUMENT,
} = require("../_document-base");
const { extractRecognizedArray } = require("../../source-page");

const NAME = "doc-baidu-netdisk";
const VERSION = "0.3.0";

const NETDISK_LIST_URL = "https://pan.baidu.com/rest/2.0/xpan/file";
const NETDISK_LIST_ALL_URL = "https://pan.baidu.com/rest/2.0/xpan/multimedia";
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;
const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;
const MAX_DIRECTORY_BYTES = 4 * 1024;

// Baidu Netdisk `category` codes → normalized docType.
const CATEGORY_MAP = {
  1: "video",
  2: "audio",
  3: "image",
  4: "doc",
  5: "app",
  6: "other",
  7: "seed",
};

function mapNetdiskType(d) {
  if (d.isdir === 1 || d.isdir === true) return "folder";
  const cat = d.category != null ? d.category : d.file_category;
  if (cat != null && CATEGORY_MAP[cat]) return CATEGORY_MAP[cat];
  const name = String(d.server_filename || d.filename || "").toLowerCase();
  if (/\.(mp4|mkv|avi|mov)$/.test(name)) return "video";
  if (/\.(mp3|flac|wav|m4a)$/.test(name)) return "audio";
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(name)) return "image";
  if (/\.(docx?|xlsx?|pptx?|pdf|txt)$/.test(name)) return "doc";
  return "file";
}

function extractDocs(resp, stream = "document") {
  return extractRecognizedArray(resp, [["list"], ["data"], ["data", "list"]], {
    source: NAME,
    stream,
  });
}

function parseOfficialListResponse(resp) {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) {
    throw netdiskError(
      "BAIDU_NETDISK_INVALID_RESPONSE",
      "Baidu Netdisk returned an invalid list response",
    );
  }
  const errno = Number(resp.errno);
  if (!Number.isInteger(errno)) {
    throw netdiskError(
      "BAIDU_NETDISK_INVALID_RESPONSE",
      "Baidu Netdisk list response is missing errno",
    );
  }
  if (errno !== 0) {
    const error = netdiskError(
      "BAIDU_NETDISK_API_ERROR",
      `Baidu Netdisk list request failed with errno ${errno}`,
    );
    error.errno = errno;
    throw error;
  }
  if (!Array.isArray(resp.list)) {
    throw netdiskError(
      "BAIDU_NETDISK_INVALID_RESPONSE",
      "Baidu Netdisk list response is missing list",
    );
  }
  return resp.list;
}

function parseOfficialListAllResponse(resp) {
  const docs = parseOfficialListResponse(resp);
  const hasMore = Number(resp.has_more);
  if (hasMore !== 0 && hasMore !== 1) {
    throw netdiskError(
      "BAIDU_NETDISK_INVALID_RESPONSE",
      "Baidu Netdisk listall response is missing has_more",
    );
  }
  if (hasMore === 0) {
    return { docs, hasMore: false, cursor: null };
  }
  const cursor = Number(resp.cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw netdiskError(
      "BAIDU_NETDISK_INVALID_RESPONSE",
      "Baidu Netdisk listall response has an invalid cursor",
    );
  }
  return { docs, hasMore: true, cursor };
}

function mapDoc(d) {
  if (!d || typeof d !== "object") return null;
  const docId = d.fs_id ?? d.fsId ?? d.id ?? d.path;
  if (docId == null || docId === "") return null;
  return {
    docId: String(docId),
    title: d.server_filename || d.filename || d.title || "(未命名)",
    docType: mapNetdiskType(d),
    url: d.path || d.dlink || null,
    createdMs: parseTime(d.server_ctime || d.local_ctime || d.ctime),
    updatedMs: parseTime(d.server_mtime || d.local_mtime || d.mtime),
    extra: {
      size: d.size != null ? d.size : null,
      isDir: d.isdir === 1 || d.isdir === true ? true : false,
      path: d.path || null,
      category: d.category != null ? d.category : null,
      md5: typeof d.md5 === "string" ? d.md5 : null,
    },
  };
}

const BaseBaiduNetdiskAdapter = createDocumentAdapter({
  NAME,
  VERSION,
  platform: "baidu-netdisk",
  defaultListUrl: NETDISK_LIST_URL,
  extractDocs,
  mapDoc,
});

class BaiduNetdiskAdapter extends BaseBaiduNetdiskAdapter {
  constructor(opts = {}) {
    super(opts);
    // Do not allow a caller-supplied endpoint to receive an OAuth token.
    this._listUrl = NETDISK_LIST_URL;
    this._listAllUrl = NETDISK_LIST_ALL_URL;
    this.runtimeCredentialOption = "accessToken";
    this.runtimeScopeIdentityKey = "userId";
    this.runtimeScopeDiscriminatorKeys = ["dir", "recursive"];
    this.runtimeScopeDiscriminatorDefaults = { recursive: true };
    this.capabilities = [
      "sync:snapshot",
      "sync:oauth-api",
      "sync:recursive",
      "parse:baidu-netdisk-documents",
    ];
    // The public documentation does not publish a platform-wide rate limit.
    // Keep a polite local one-request-per-second floor and a bounded initial
    // page window; incomplete scans retain their previous watermark.
    this.rateLimits = {
      perMinute: 60,
      perDay: 10_000,
      minIntervalMs: 1_000,
    };
    this.initialPageBudget = 20;
    this.dataDisclosure = {
      fields: [
        "baidu-netdisk:document (title / type / path / timestamps / size / md5)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { document: true },
    };
  }

  async authenticate(ctx = {}) {
    if (hasInputPath(ctx)) return super.authenticate(ctx);
    try {
      if (!readAccessToken(ctx)) {
        return {
          ok: false,
          reason: "NO_ACCESS_TOKEN",
          message: `${NAME}.authenticate: needs opts.accessToken for official OAuth API mode`,
        };
      }
    } catch (_error) {
      return {
        ok: false,
        reason: "INVALID_ACCESS_TOKEN",
        message: `${NAME}.authenticate: opts.accessToken is invalid`,
      };
    }
    if (!readRuntimeIdentity(ctx)) {
      return {
        ok: false,
        reason: "NO_ACCOUNT_ID",
        message: `${NAME}.authenticate: needs opts.accountId to isolate the OAuth cursor`,
      };
    }
    try {
      normalizeDirectory(ctx.dir);
    } catch (_error) {
      return {
        ok: false,
        reason: "INVALID_DIRECTORY",
        message: `${NAME}.authenticate: opts.dir must be inside /apps/{appname}`,
      };
    }
    return { ok: true, mode: "oauth-access-token" };
  }

  async healthCheck(ctx = {}) {
    const result = await this.authenticate(ctx);
    return result.ok
      ? { ok: true, lastChecked: Date.now(), mode: result.mode }
      : {
          ok: false,
          reason: result.reason,
          error: result.message || result.error,
        };
  }

  async *sync(opts = {}) {
    if (hasInputPath(opts)) {
      yield* super.sync(opts);
      return;
    }
    const readiness = await this.authenticate(opts);
    if (!readiness.ok) {
      throw new Error(readiness.message || readiness.reason);
    }
    yield* this._syncViaAccessToken(opts);
  }

  async *_syncViaAccessToken(opts) {
    const accessToken = readAccessToken(opts);
    const include = opts.include || {};
    if (include[KIND_DOCUMENT] === false) return;

    const dir = normalizeDirectory(opts.dir);
    const pageSize = normalizePageSize(opts.pageSize);
    const maxPages = normalizeMaxPages(opts.maxPages);
    const recursive = opts.recursive !== false;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const sinceMs =
      opts.sinceWatermark != null
        ? Number.parseInt(String(opts.sinceWatermark), 10) || 0
        : 0;

    let emitted = 0;
    let page = 0;
    let start = 0;
    let scanComplete = false;
    const seenStarts = new Set([start]);
    while (page < maxPages) {
      const query = recursive
        ? {
            method: "listall",
            path: dir,
            recursion: 1,
            order: "time",
            desc: 1,
            start,
            limit: pageSize,
            web: 0,
            ...(sinceMs
              ? { mtime: Math.max(0, Math.floor(sinceMs / 1000) - 1) }
              : {}),
          }
        : {
            method: "list",
            dir,
            order: "time",
            desc: 1,
            start,
            limit: pageSize,
            folder: 0,
          };
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: KIND_DOCUMENT,
          page,
          dir,
          start,
          recursive,
        });
      }
      const response = await this._fetchFn({
        url: recursive ? this._listAllUrl : this._listUrl,
        query,
        credentialQuery: { access_token: accessToken },
        headers: { "user-agent": "pan.baidu.com" },
      });
      const parsed = recursive
        ? parseOfficialListAllResponse(response)
        : {
            docs: parseOfficialListResponse(response),
            hasMore: null,
            cursor: null,
          };
      const docs = parsed.docs;
      if (docs.length === 0 && !recursive) {
        scanComplete = true;
        break;
      }

      for (const rawDoc of docs) {
        const record = mapDoc(rawDoc);
        if (!record) continue;
        const capturedAt = record.updatedMs || record.createdMs || null;
        if (sinceMs && capturedAt && capturedAt < sinceMs) {
          continue;
        }
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          kind: KIND_DOCUMENT,
          originalId: `baidu-netdisk:document:${record.docId}`,
          capturedAt: capturedAt || Date.now(),
          payload: { record },
        };
        emitted += 1;
      }

      if (recursive) {
        if (!parsed.hasMore) {
          scanComplete = true;
          break;
        }
        if (seenStarts.has(parsed.cursor)) {
          throw netdiskError(
            "BAIDU_NETDISK_PAGINATION_LOOP",
            "Baidu Netdisk listall cursor repeated",
          );
        }
        seenStarts.add(parsed.cursor);
        start = parsed.cursor;
        page += 1;
        continue;
      }

      start += docs.length;
      page += 1;
    }

    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }
}

function hasInputPath(opts) {
  return (
    opts &&
    typeof opts.inputPath === "string" &&
    opts.inputPath.trim().length > 0
  );
}

function readAccessToken(opts) {
  if (!opts || typeof opts.accessToken !== "string") return null;
  const value = opts.accessToken.trim();
  if (!value) return null;
  if (
    /[\0\r\n]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > MAX_ACCESS_TOKEN_BYTES
  ) {
    throw netdiskError(
      "BAIDU_NETDISK_INVALID_ACCESS_TOKEN",
      "Baidu Netdisk access token is invalid",
    );
  }
  return value;
}

function readRuntimeIdentity(opts) {
  if (!opts || typeof opts !== "object") return null;
  const value = opts.userId ?? opts.accountId;
  return value != null && String(value).trim().length > 0
    ? String(value).trim()
    : null;
}

function normalizeDirectory(value) {
  const dir = typeof value === "string" ? value.trim() : "";
  if (
    !/^\/apps\/[^/\0\r\n]+(?:\/[^\0\r\n]*)?$/u.test(dir) ||
    Buffer.byteLength(dir, "utf8") > MAX_DIRECTORY_BYTES
  ) {
    throw netdiskError(
      "BAIDU_NETDISK_INVALID_DIRECTORY",
      "Baidu Netdisk dir must be inside /apps/{appname}",
    );
  }
  return dir;
}

function normalizePageSize(value) {
  if (value == null || value === "") return DEFAULT_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new Error(
      `Baidu Netdisk pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  return parsed;
}

function normalizeMaxPages(value) {
  if (value == null || value === "") return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Baidu Netdisk maxPages must be a positive integer");
  }
  return parsed;
}

function netdiskError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  BaiduNetdiskAdapter,
  extractDocs,
  parseOfficialListResponse,
  parseOfficialListAllResponse,
  mapDoc,
  CATEGORY_MAP,
  NAME,
  VERSION,
  NETDISK_LIST_URL,
  NETDISK_LIST_ALL_URL,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SNAPSHOT_SCHEMA_VERSION,
};
