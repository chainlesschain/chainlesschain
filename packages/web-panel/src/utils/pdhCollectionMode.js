/**
 * Resolve the Personal Data Hub's primary collection action from the
 * backend adapter contract. Keep this pure so catalog drift is testable
 * without mounting the large PersonalDataHub view.
 */

export const COLLECTION_MODE = Object.freeze({
  SYNC: "sync",
  FILE: "file",
  DIRECTORY: "directory",
  COOKIE: "cookie",
  OAUTH: "oauth",
  ADB: "adb",
  SETUP: "setup",
});

export const ADB_ONE_CLICK_ADAPTERS = new Set([
  "social-bilibili",
  "social-weibo",
  "social-douyin",
  "social-xiaohongshu",
  "social-toutiao",
  "social-kuaishou",
]);

export const EXPLICIT_SOURCE_URL_COOKIE_ADAPTERS = new Set([
  "travel-didi-consumer",
]);

const FILE_COLLECTION_CAPABILITIES = new Set([
  "sync:file-import",
  "sync:snapshot",
  "sync:sqlite",
]);

const COOKIE_COLLECTION_CAPABILITIES = new Set([
  "sync:cookie",
  "sync:cookie-api",
]);

export const OAUTH_COLLECTION_SPECS = Object.freeze({
  "doc-baidu-netdisk": Object.freeze({
    fields: Object.freeze([
      Object.freeze({
        key: "accessToken",
        label: "OAuth access token",
        placeholder: "百度网盘开放平台 access token",
        required: true,
        secret: true,
      }),
      Object.freeze({
        key: "accountId",
        label: "稳定账号标识",
        placeholder: "仅用于生成隔离水位的哈希作用域",
        required: true,
      }),
      Object.freeze({
        key: "dir",
        label: "应用目录",
        placeholder: "/apps/你的应用目录",
        required: true,
      }),
    ]),
  }),
  "doc-wps": Object.freeze({
    fields: Object.freeze([
      Object.freeze({
        key: "accessToken",
        label: "OAuth access token",
        placeholder: "WPS 365 用户授权 access token",
        required: true,
        secret: true,
      }),
      Object.freeze({
        key: "accountId",
        label: "稳定账号标识",
        placeholder: "仅用于生成隔离水位的哈希作用域",
        required: true,
      }),
      Object.freeze({
        key: "driveId",
        label: "云盘 ID",
        placeholder: "WPS driveId",
        required: true,
      }),
      Object.freeze({
        key: "parentId",
        label: "起始目录 ID",
        placeholder: "默认 0（根目录）",
        defaultValue: "0",
      }),
      Object.freeze({
        key: "appId",
        label: "KSO-1 App ID（可选）",
        placeholder: "启用接口签名时填写",
      }),
      Object.freeze({
        key: "appKey",
        label: "KSO-1 App Key（可选）",
        placeholder: "必须与 App ID 同时填写",
        secret: true,
      }),
    ]),
  }),
});

const SETUP_REQUIRED_REASONS = new Set([
  "NO_KEY_PROVIDER",
  "EMPTY_KEY",
  "KEY_PROVIDER_THREW",
  "ENV_UNSUPPORTED",
  "CUSTOM_FETCH_REQUIRED",
]);

function capabilitiesOf(source) {
  return Array.isArray(source?.capabilities) ? source.capabilities : [];
}

export function oauthCollectionSpec(source) {
  if (
    !source ||
    !capabilitiesOf(source).includes("sync:oauth-api") ||
    !Object.prototype.hasOwnProperty.call(OAUTH_COLLECTION_SPECS, source.name)
  ) {
    return null;
  }
  return OAUTH_COLLECTION_SPECS[source.name];
}

export function resolveCollectionMode(source) {
  if (!source || typeof source !== "object") return COLLECTION_MODE.SETUP;

  // Registry readiness marks these sources ready when an ADB device is
  // connected, but the actual pull lives in their dedicated *AdbSync topic.
  // Therefore ADB must win even over source.ready.
  if (ADB_ONE_CLICK_ADAPTERS.has(source.name)) return COLLECTION_MODE.ADB;

  const capabilities = capabilitiesOf(source);
  // A scan-directory source needs an explicit user-selected scope for each
  // collection action. Readiness may only mean that broad default folders are
  // readable, which is not consent to scan them parameterlessly.
  if (capabilities.includes("sync:scan-directory")) {
    return COLLECTION_MODE.DIRECTORY;
  }

  // A configured cookie, local profile, or constructor-supplied snapshot can
  // be reused without asking the user for the same input again.
  if (source.ready === true) return COLLECTION_MODE.SYNC;

  if (SETUP_REQUIRED_REASONS.has(source.reason)) return COLLECTION_MODE.SETUP;
  if (
    capabilities.some((capability) =>
      COOKIE_COLLECTION_CAPABILITIES.has(capability),
    ) ||
    (EXPLICIT_SOURCE_URL_COOKIE_ADAPTERS.has(source.name) &&
      capabilities.includes("sync:custom-cookie-api"))
  ) {
    return COLLECTION_MODE.COOKIE;
  }
  if (oauthCollectionSpec(source)) {
    return COLLECTION_MODE.OAUTH;
  }
  if (
    capabilities.includes("sync:scan-directory") ||
    capabilities.includes("sync:export-directory") ||
    capabilities.includes("sync:profile-directory")
  ) {
    return COLLECTION_MODE.DIRECTORY;
  }
  if (
    capabilities.some((capability) =>
      FILE_COLLECTION_CAPABILITIES.has(capability),
    )
  ) {
    return COLLECTION_MODE.FILE;
  }

  // Compatibility fallback for an older registry that reports readiness but
  // not capabilities. Unknown/non-local sources open their setup guide rather
  // than attempting a parameterless sync that is guaranteed to fail.
  if (source.ready == null && source.category === "local") {
    return COLLECTION_MODE.SYNC;
  }
  return COLLECTION_MODE.SETUP;
}

export function collectionActionLabel(source) {
  switch (resolveCollectionMode(source)) {
    case COLLECTION_MODE.FILE:
      return "📂 选择文件采集";
    case COLLECTION_MODE.DIRECTORY:
      if (capabilitiesOf(source).includes("sync:scan-directory")) {
        return "\ud83d\udcc1 \u9009\u62e9\u626b\u63cf\u76ee\u5f55";
      }
      return capabilitiesOf(source).includes("sync:profile-directory")
        ? "📁 选择配置目录"
        : "📁 选择导出目录";
    case COLLECTION_MODE.COOKIE:
      return "🔑 登录采集";
    case COLLECTION_MODE.OAUTH:
      return "🔐 OAuth 授权采集";
    case COLLECTION_MODE.ADB:
      return "📱 USB 一键采集";
    case COLLECTION_MODE.SYNC:
      return "⚡ 立即采集";
    default:
      return "查看采集步骤";
  }
}

export function collectionButtonLabel(source) {
  switch (resolveCollectionMode(source)) {
    case COLLECTION_MODE.FILE:
      return "📂 采集";
    case COLLECTION_MODE.DIRECTORY:
      return "📁 采集";
    case COLLECTION_MODE.COOKIE:
      return "🔑 采集";
    case COLLECTION_MODE.OAUTH:
      return "🔐 授权采集";
    case COLLECTION_MODE.ADB:
      return "📱 采集";
    case COLLECTION_MODE.SYNC:
      return "采集";
    default:
      return "查看步骤";
  }
}

export function collectionActionDescription(source) {
  if (
    resolveCollectionMode(source) === COLLECTION_MODE.COOKIE &&
    requiresExplicitSourceUrl(source)
  ) {
    return "粘贴登录 Cookie、稳定账号标识和本次使用的滴滴 HTTPS 订单接口后采集入库";
  }
  switch (resolveCollectionMode(source)) {
    case COLLECTION_MODE.FILE:
      return "选择导出或解密好的文件，自动入库";
    case COLLECTION_MODE.DIRECTORY:
      if (capabilitiesOf(source).includes("sync:scan-directory")) {
        return "\u9009\u62e9\u672c\u5730\u76ee\u5f55\uff0c\u4ec5\u91c7\u96c6\u5176\u4e2d\u7684\u6587\u4ef6\u6d3b\u52a8\u5143\u6570\u636e";
      }
      return capabilitiesOf(source).includes("sync:profile-directory")
        ? "选择本地配置目录，读取其中的数据文件"
        : "选择本地导出目录，递归扫描支持的文件";
    case COLLECTION_MODE.COOKIE:
      return "粘贴当前登录 Cookie 后采集入库";
    case COLLECTION_MODE.OAUTH:
      return "临时输入官方 OAuth 凭据后采集；凭据不会保存到本地配置、数据中台或同步水位";
    case COLLECTION_MODE.ADB:
      return "连接已授权的 Android 手机后自动采集";
    case COLLECTION_MODE.SYNC:
      return "复用当前配置，直接采集入库";
    default:
      return "先按上述步骤完成采集配置";
  }
}

export function requiresExplicitSourceUrl(source) {
  return EXPLICIT_SOURCE_URL_COOKIE_ADAPTERS.has(source?.name);
}

function normalizeRuntimeValue(value, maxLength, { normalize = false } = {}) {
  if (typeof value !== "string") return "";
  const normalized = (normalize ? value.normalize("NFKC") : value).trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\0\r\n]/u.test(normalized)
  ) {
    return "";
  }
  return normalized;
}

export function oauthCollectionOptions(source, values = {}) {
  if (!oauthCollectionSpec(source)) return null;

  const accessToken = normalizeRuntimeValue(values.accessToken, 16 * 1024);
  const accountId = normalizeRuntimeValue(values.accountId, 1024, {
    normalize: true,
  });
  if (!accessToken || !accountId) return null;

  if (source.name === "doc-baidu-netdisk") {
    const dir = normalizeRuntimeValue(values.dir, 4096, { normalize: true });
    if (!/^\/apps\/[^/\0\r\n]+(?:\/[^\0\r\n]*)?$/u.test(dir)) return null;
    return {
      accessToken,
      accountId,
      dir,
      recursive: values.recursive !== false,
    };
  }

  if (source.name === "doc-wps") {
    const driveId = normalizeRuntimeValue(values.driveId, 1024, {
      normalize: true,
    });
    const parentId =
      normalizeRuntimeValue(values.parentId, 1024, { normalize: true }) || "0";
    const appId = normalizeRuntimeValue(values.appId, 1024, {
      normalize: true,
    });
    const appKey = normalizeRuntimeValue(values.appKey, 16 * 1024);
    if (!driveId || Boolean(appId) !== Boolean(appKey)) return null;
    return {
      accessToken,
      accountId,
      driveId,
      parentId,
      recursive: values.recursive !== false,
      ...(appId ? { appId, appKey } : {}),
    };
  }

  return null;
}

export function cookieCollectionOptions(source, cookie, accountId, sourceUrl) {
  const normalizedCookie = typeof cookie === "string" ? cookie.trim() : "";
  const normalizedAccountId =
    typeof accountId === "string" ? accountId.trim() : "";
  if (!normalizedCookie || !normalizedAccountId) return null;

  const options = {
    cookie: normalizedCookie,
    accountId: normalizedAccountId,
  };
  if (!requiresExplicitSourceUrl(source)) return options;

  const normalizedSourceUrl =
    typeof sourceUrl === "string" ? sourceUrl.trim() : "";
  if (!normalizedSourceUrl) return null;
  try {
    const parsed = new URL(normalizedSourceUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      (parsed.port && parsed.port !== "443") ||
      !(
        parsed.hostname === "xiaojukeji.com" ||
        parsed.hostname.endsWith(".xiaojukeji.com")
      )
    ) {
      return null;
    }
    options.sourceUrl = parsed.href;
  } catch (_error) {
    return null;
  }
  return options;
}

export function directoryCollectionOptions(source, directory, accountId) {
  if (typeof directory !== "string" || directory.length === 0) return null;
  const capabilities = capabilitiesOf(source);
  if (capabilities.includes("sync:scan-directory")) {
    return { roots: [directory] };
  }
  if (capabilities.includes("sync:profile-directory")) {
    return { profilePath: directory };
  }
  if (capabilities.includes("sync:export-directory")) {
    const normalizedAccountId =
      typeof accountId === "string" ? accountId.trim() : "";
    return normalizedAccountId
      ? { exportDir: directory, accountId: normalizedAccountId }
      : null;
  }
  return null;
}
