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
