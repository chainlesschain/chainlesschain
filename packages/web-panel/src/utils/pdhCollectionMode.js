/**
 * Resolve the Personal Data Hub's primary collection action from the
 * backend adapter contract. Keep this pure so catalog drift is testable
 * without mounting the large PersonalDataHub view.
 */

export const COLLECTION_MODE = Object.freeze({
  SYNC: "sync",
  FILE: "file",
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

const FILE_COLLECTION_CAPABILITIES = new Set([
  "sync:file-import",
  "sync:snapshot",
  "sync:sqlite",
]);

const SETUP_REQUIRED_REASONS = new Set([
  "NO_KEY_PROVIDER",
  "EMPTY_KEY",
  "KEY_PROVIDER_THREW",
  "ENV_UNSUPPORTED",
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

  // A configured cookie, local profile, or constructor-supplied snapshot can
  // be reused without asking the user for the same input again.
  if (source.ready === true) return COLLECTION_MODE.SYNC;

  const capabilities = capabilitiesOf(source);
  if (SETUP_REQUIRED_REASONS.has(source.reason)) return COLLECTION_MODE.SETUP;
  if (capabilities.includes("sync:cookie")) return COLLECTION_MODE.COOKIE;
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
  switch (resolveCollectionMode(source)) {
    case COLLECTION_MODE.FILE:
      return "选择导出或解密好的文件，自动入库";
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
