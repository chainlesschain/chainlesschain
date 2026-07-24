/**
 * WPS 云文档文件列表采集器。
 *
 * 快照模式复用 document-base；在线模式使用 WPS 365 OpenAPI 的用户授权
 * access_token，并在应用开启接口签名时支持瞬时 APPID/APPKEY KSO-1 签名。
 * token 与 APPKEY 不保存在 adapter、LocalVault、审计或水位作用域中。
 */

"use strict";

const crypto = require("node:crypto");
const {
  createDocumentAdapter,
  parseTime,
  SNAPSHOT_SCHEMA_VERSION,
  KIND_DOCUMENT,
} = require("../_document-base");
const { buildSourceUrl } = require("../../source-http");
const { extractRecognizedArray } = require("../../source-page");

const NAME = "doc-wps";
const VERSION = "0.2.0";
const WPS_OPENAPI_ORIGIN = "https://openapi.wps.cn";
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;
const DEFAULT_PARENT_ID = "0";
const CONTENT_TYPE = "application/json";
const MAX_RUNTIME_SECRET_BYTES = 16 * 1024;

function mapWpsType(d) {
  if (d.type === "folder" || d.file_type === "folder") return "folder";

  const explicit = String(d.ftype || d.file_type || d.type || "").toLowerCase();
  const explicitMap = {
    ap: "doc",
    db: "database",
    dbt: "database",
    doc: "doc",
    document: "doc",
    et: "sheet",
    file: null,
    folder: "folder",
    ksheet: "sheet",
    mind: "mind",
    otl: "doc",
    pdf: "pdf",
    presentation: "slide",
    sheet: "sheet",
    slide: "slide",
    spreadsheet: "sheet",
    wpp: "slide",
    wps: "doc",
  };
  if (Object.hasOwn(explicitMap, explicit) && explicitMap[explicit]) {
    return explicitMap[explicit];
  }

  const name = String(d.fname || d.name || "").toLowerCase();
  if (/\.(xlsx?|et|csv)$/u.test(name)) return "sheet";
  if (/\.(pptx?|dps|wpp)$/u.test(name)) return "slide";
  if (/\.pdf$/u.test(name)) return "pdf";
  if (/\.(docx?|wps|otl)$/u.test(name)) return "doc";
  return "file";
}

function extractDocs(resp, stream = "document") {
  return extractRecognizedArray(
    resp,
    [["files"], ["data"], ["data", "files"], ["data", "items"], ["list"]],
    { source: NAME, stream },
  );
}

function parseOfficialListResponse(resp) {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) {
    throw wpsError(
      "WPS_INVALID_RESPONSE",
      "WPS returned an invalid file-list response",
    );
  }
  const code = Number(resp.code);
  if (!Number.isInteger(code)) {
    throw wpsError(
      "WPS_INVALID_RESPONSE",
      "WPS file-list response is missing code",
    );
  }
  if (code !== 0) {
    const error = wpsError(
      "WPS_API_ERROR",
      `WPS file-list request failed with code ${code}`,
    );
    error.wpsCode = code;
    throw error;
  }
  if (
    !resp.data ||
    typeof resp.data !== "object" ||
    !Array.isArray(resp.data.items)
  ) {
    throw wpsError(
      "WPS_INVALID_RESPONSE",
      "WPS file-list response is missing data.items",
    );
  }
  if (
    resp.data.next_page_token != null &&
    typeof resp.data.next_page_token !== "string"
  ) {
    throw wpsError(
      "WPS_INVALID_RESPONSE",
      "WPS file-list response has an invalid next_page_token",
    );
  }
  const nextPageToken =
    typeof resp.data.next_page_token === "string"
      ? resp.data.next_page_token
      : "";
  return { items: resp.data.items, nextPageToken };
}

function mapDoc(d) {
  if (!d || typeof d !== "object") return null;
  const docId = d.id ?? d.fileid ?? d.file_id ?? d.fid;
  if (docId == null || docId === "") return null;
  return {
    docId: String(docId),
    title: d.name || d.fname || d.title || "(未命名)",
    docType: mapWpsType(d),
    url:
      d.link_url ||
      d.url ||
      (d.id ? `https://www.kdocs.cn/p/${encodeURIComponent(d.id)}` : null),
    createdMs: parseTime(d.ctime || d.create_time || d.created),
    updatedMs: parseTime(d.mtime || d.modify_time || d.updated || d.utime),
    extra: {
      size: d.size ?? d.fsize ?? null,
      driveId: d.drive_id || d.drive?.id || d.group_id || d.groupid || null,
      parentId: d.parent_id || null,
      fileType: d.type || d.file_type || d.ftype || null,
      shared: typeof d.shared === "boolean" ? d.shared : null,
      version: d.version ?? null,
    },
  };
}

const BaseWpsDocAdapter = createDocumentAdapter({
  NAME,
  VERSION,
  platform: "wps",
  defaultListUrl: WPS_OPENAPI_ORIGIN,
  extractDocs,
  mapDoc,
});

class WpsDocAdapter extends BaseWpsDocAdapter {
  constructor(opts = {}) {
    super(opts);
    this._now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this.runtimeCredentialOption = "accessToken";
    this.runtimeScopeIdentityKey = "userId";
    this.runtimeScopeDiscriminatorKeys = ["driveId", "parentId", "recursive"];
    this.runtimeScopeDiscriminatorDefaults = {
      parentId: DEFAULT_PARENT_ID,
      recursive: true,
    };
    this.capabilities = [
      "sync:snapshot",
      "sync:oauth-api",
      "auth:kso1-optional",
      "parse:wps-documents",
    ];
    // The official child-list endpoint declares no platform limit. Keep a
    // local one-request-per-second floor while allowing large drives to finish.
    this.rateLimits = {
      perMinute: 60,
      perDay: 10_000,
      minIntervalMs: 1_000,
    };
    this.initialPageBudget = 20;
    this.dataDisclosure = {
      fields: [
        "wps:document (title / type / link / timestamps / size / drive / parent)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { document: true },
    };
  }

  async authenticate(ctx = {}) {
    if (hasInputPath(ctx)) return super.authenticate(ctx);
    if (!readSecret(ctx.accessToken)) {
      return unhealthy(
        "NO_ACCESS_TOKEN",
        `${NAME}.authenticate: needs opts.accessToken for WPS user OAuth`,
      );
    }
    if (!readRuntimeIdentity(ctx)) {
      return unhealthy(
        "NO_ACCOUNT_ID",
        `${NAME}.authenticate: needs opts.accountId to isolate the OAuth cursor`,
      );
    }
    if (!readIdentifier(ctx.driveId)) {
      return unhealthy(
        "NO_DRIVE_ID",
        `${NAME}.authenticate: needs opts.driveId for the WPS drive`,
      );
    }
    const hasAppId = Boolean(readIdentifier(ctx.appId));
    const hasAppKey = Boolean(readSecret(ctx.appKey));
    if (hasAppId !== hasAppKey) {
      return unhealthy(
        "INCOMPLETE_KSO1_CREDENTIALS",
        `${NAME}.authenticate: opts.appId and opts.appKey must be provided together`,
      );
    }
    return {
      ok: true,
      mode: hasAppKey ? "oauth-kso1" : "oauth-bearer",
    };
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
    yield* this._syncViaOfficialApi(opts);
  }

  async *_syncViaOfficialApi(opts) {
    const include = opts.include || {};
    if (include[KIND_DOCUMENT] === false) return;

    const accessToken = readSecret(opts.accessToken);
    const appId = readIdentifier(opts.appId);
    const appKey = readSecret(opts.appKey);
    const driveId = requireIdentifier("driveId", opts.driveId);
    const parentId =
      opts.parentId == null || opts.parentId === ""
        ? DEFAULT_PARENT_ID
        : requireIdentifier("parentId", opts.parentId);
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
    let scanComplete = false;
    const pendingFolders = [
      { parentId, pageToken: "", seenPageTokens: new Set() },
    ];
    const seenFolders = new Set([parentId]);
    while (page < maxPages && pendingFolders.length > 0) {
      const current = pendingFolders[0];
      const url =
        `${WPS_OPENAPI_ORIGIN}/v7/drives/${encodeURIComponent(driveId)}` +
        `/files/${encodeURIComponent(current.parentId)}/children`;
      const query = {
        order_by: "mtime",
        order: "desc",
        page_size: pageSize,
        ...(current.pageToken ? { page_token: current.pageToken } : {}),
      };
      const headers = createOfficialHeaders({
        accessToken,
        appId,
        appKey,
        url,
        query,
        nowMs: this._now(),
      });
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: KIND_DOCUMENT,
          page,
        });
      }
      const response = await this._fetchFn({
        url,
        query,
        headers,
      });
      const { items, nextPageToken } = parseOfficialListResponse(response);

      let reachedWatermark = false;
      for (const rawDoc of items) {
        const record = mapDoc(rawDoc);
        if (!record) continue;
        if (
          recursive &&
          record.docType === "folder" &&
          !seenFolders.has(record.docId)
        ) {
          seenFolders.add(record.docId);
          pendingFolders.push({
            parentId: record.docId,
            pageToken: "",
            seenPageTokens: new Set(),
          });
        }
        const capturedAt = record.updatedMs || record.createdMs || null;
        if (sinceMs && capturedAt && capturedAt < sinceMs) {
          if (!recursive) {
            reachedWatermark = true;
            break;
          }
          continue;
        }
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          kind: KIND_DOCUMENT,
          originalId: `wps:document:${record.docId}`,
          capturedAt: capturedAt || Date.now(),
          payload: { record },
        };
        emitted += 1;
      }

      page += 1;
      if (reachedWatermark) {
        pendingFolders.shift();
      } else if (!nextPageToken) {
        pendingFolders.shift();
      } else if (
        current.seenPageTokens.has(nextPageToken) ||
        nextPageToken === current.pageToken
      ) {
        throw wpsError(
          "WPS_PAGINATION_LOOP",
          "WPS returned a repeated page token",
        );
      } else {
        current.seenPageTokens.add(nextPageToken);
        current.pageToken = nextPageToken;
      }
    }
    scanComplete = pendingFolders.length === 0;

    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }
}

function createOfficialHeaders({
  accessToken,
  appId,
  appKey,
  url,
  query,
  nowMs,
}) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "content-type": CONTENT_TYPE,
  };
  if (!appId || !appKey) return headers;

  const ksoDate = new Date(nowMs).toUTCString();
  const builtUrl = buildSourceUrl({ url, query });
  const requestUri = `${builtUrl.pathname}${builtUrl.search}`;
  headers["x-kso-date"] = ksoDate;
  headers["x-kso-authorization"] = createKso1Authorization({
    appId,
    appKey,
    method: "GET",
    requestUri,
    contentType: CONTENT_TYPE,
    ksoDate,
    requestBody: "",
  });
  return headers;
}

function createKso1Authorization({
  appId,
  appKey,
  method,
  requestUri,
  contentType,
  ksoDate,
  requestBody = "",
}) {
  const bodyHash =
    requestBody.length > 0
      ? crypto.createHash("sha256").update(requestBody, "utf8").digest("hex")
      : "";
  const signature = crypto
    .createHmac("sha256", appKey)
    .update(
      `KSO-1${method}${requestUri}${contentType}${ksoDate}${bodyHash}`,
      "utf8",
    )
    .digest("hex");
  return `KSO-1 ${appId}:${signature}`;
}

function hasInputPath(opts) {
  return (
    opts &&
    typeof opts.inputPath === "string" &&
    opts.inputPath.trim().length > 0
  );
}

function readSecret(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    /[\0\r\n]/u.test(normalized) ||
    Buffer.byteLength(normalized, "utf8") > MAX_RUNTIME_SECRET_BYTES
  ) {
    return null;
  }
  return normalized;
}

function readIdentifier(value) {
  if (value == null) return null;
  const normalized = String(value).normalize("NFKC").trim();
  if (!normalized || normalized.length > 1024 || /[\0\r\n]/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function readRuntimeIdentity(opts) {
  if (!opts || typeof opts !== "object") return null;
  return readIdentifier(opts.userId ?? opts.accountId);
}

function requireIdentifier(name, value) {
  const normalized = readIdentifier(value);
  if (!normalized) {
    throw new Error(`WPS ${name} must be a non-empty identifier`);
  }
  return normalized;
}

function normalizePageSize(value) {
  if (value == null || value === "") return DEFAULT_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new Error(
      `WPS pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  return parsed;
}

function normalizeMaxPages(value) {
  if (value == null || value === "") return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("WPS maxPages must be a positive integer");
  }
  return parsed;
}

function unhealthy(reason, message) {
  return { ok: false, reason, message };
}

function wpsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  WpsDocAdapter,
  extractDocs,
  parseOfficialListResponse,
  mapDoc,
  mapWpsType,
  createOfficialHeaders,
  createKso1Authorization,
  NAME,
  VERSION,
  WPS_OPENAPI_ORIGIN,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DEFAULT_PARENT_ID,
  SNAPSHOT_SCHEMA_VERSION,
};
