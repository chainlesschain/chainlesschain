/**
 * Adapter readiness — turn an adapter's `authenticate()` reason code into a
 * human-facing "can I collect right now, and if not why" descriptor.
 *
 * Why this exists: `AdapterRegistry.list()` only reports static metadata
 * (name / version / sensitivity). Every adapter's `healthCheck()` returns a
 * lenient `{ ok: true }` (snapshot-mode adapters MUST stay healthy so the
 * registry's pre-sync health gate doesn't block a legitimate
 * `sync-adapter --input <path>` call — the inputPath only arrives at sync
 * time, after the gate). The upshot: the UI showed "healthy" for adapters
 * that in fact cannot collect a single row because no snapshot / cookie /
 * device DB has been provided yet. Users saw "配置正常却采不到数据".
 *
 * The real readiness signal already lives in `authenticate()` — it returns
 * `{ ok: false, reason: "NO_INPUT" | "DB_NOT_PULLED" | ... }`. This module
 * is the lookup table that maps those reason codes to:
 *   - status:     ready | needs_setup | unavailable | error
 *   - category:   how this source is collected (local / snapshot / device / ...)
 *   - message:    short Chinese explanation for the UI
 *   - actionHint: what the user should do next
 *
 * `AdapterRegistry.readiness()` calls `authenticate({ readinessOnly: true })`
 * (a cheap, no-network probe — adapters with expensive auth, e.g. email IMAP
 * login / WeChat frida key extraction, short-circuit on that flag) and feeds
 * the reason through `describeReadiness()`.
 */

"use strict";

// Collection-strategy categories (drives the UI grouping + what action the
// user must take). Distinct from extractMode, which is the adapter's
// internal "where do bytes come from" classifier.
const READINESS_CATEGORY = Object.freeze({
  LOCAL: "local", // 本机直接读取（浏览器/VSCode/git/本地文件…）
  SNAPSHOT: "snapshot", // 需手机端 App 内采集后回传快照
  DEVICE: "device", // 需 root / 本地 DB 解密后拉取数据库
  CREDENTIAL: "credential", // 需登录态 / 账号凭据
  PLATFORM: "platform", // 平台或运行环境不支持
});

// status taxonomy
const READINESS_STATUS = Object.freeze({
  READY: "ready",
  NEEDS_SETUP: "needs_setup",
  UNAVAILABLE: "unavailable",
  ERROR: "error",
});

/**
 * reason code → descriptor. `appendDetail: true` means the caller may append
 * the adapter's own `message`/`error` string in parentheses for extra context.
 */
const REASONS = Object.freeze({
  // ── snapshot-mode (Android in-app capture) ──────────────────────────────
  NO_INPUT: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "尚无可采集的数据：需先在手机 App 内采集并回传快照",
    actionHint: "在 Android 端打开对应平台采集页完成一次采集",
  },
  INPUT_PATH_UNREADABLE: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "快照文件不可读（路径不存在或无权限）",
    actionHint: "重新采集生成快照，或检查文件路径",
    appendDetail: true,
  },
  INPUT_PATH_REQUIRED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "需要提供快照文件路径",
    actionHint: "先在设备端采集生成快照",
  },
  NO_FILE: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.LOCAL,
    message: "尚未选择文件：从来源导出数据后，选择文件即可采集",
    actionHint: "点「选择文件采集」选中导出的文件",
  },

  // ── device-pull (root / local DB) ───────────────────────────────────────
  DB_NOT_PULLED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "尚未拉取到本地数据库：需 root 设备或本地解密后导入 DB",
    actionHint: "通过 ADB / 本地 DB 解密导出数据库后再同步",
    appendDetail: true,
  },
  ADB_PULL_REQUIRED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "可从 Android 自动拉取 WhatsApp 加密备份，还需连接手机并提供自己的备份密钥",
    actionHint: "开启 USB 调试并连接手机，填写 crypt15 64 位密钥（或 crypt14 key 文件）后同步",
    appendDetail: true,
  },
  KEY_REQUIRED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "已找到加密备份，但尚未提供用户自己的解密密钥",
    actionHint: "填写 crypt15 64 位密钥，或选择 crypt14 key / encrypted_backup.key 文件",
    appendDetail: true,
  },
  // 自动发现：已在本机找到 App 的加密数据库，只差解密密钥即可一键采集。
  DB_FOUND_NEEDS_KEY: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "已自动找到本机数据库（已加密），仅需解密密钥即可一键采集",
    actionHint: "提取该 App 的数据库密钥后点「一键采集」（密钥可从运行中的 App 提取）",
    appendDetail: true,
  },
  // ADB 一键平台：后端支持 root 手机 USB 一键采集，但当前未检测到设备。
  ADB_DEVICE_NEEDED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "可一键采集：请插上已 root 的安卓手机并开启 USB 调试（adb 可见后点「一键采集」）",
    actionHint: "连接手机后刷新，即可一键拉取",
  },
  // 自动发现：未检测到 App 的本机数据（未安装 / 未登录 / 非默认目录）。
  APP_NOT_INSTALLED: {
    status: READINESS_STATUS.UNAVAILABLE,
    category: READINESS_CATEGORY.DEVICE,
    message: "未检测到该 App 的本机数据（可能未安装、未登录或装在非默认目录）",
    actionHint: "在本机安装并登录该 App 后重试，或改用手机端采集",
    appendDetail: true,
  },
  NO_KEY_PROVIDER: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "缺少数据库解密密钥提供方",
    actionHint: "配置密钥提取（frida / 本地密钥）后重试",
  },
  EMPTY_KEY: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.DEVICE,
    message: "解密密钥为空，无法解密数据库",
    actionHint: "重新提取数据库密钥",
  },
  KEY_PROVIDER_THREW: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.DEVICE,
    message: "提取数据库密钥失败",
    actionHint: "检查 frida / 设备连接 / 密钥来源",
    appendDetail: true,
  },
  FRIDA_NEEDS_WXID: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "frida 模式需要 wxid 才能提取密钥",
    actionHint: "提供登录账号的 wxid",
  },

  // ── credential (login / account config) ─────────────────────────────────
  AUTH_FAILED: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "登录认证失败（账号或授权码错误）",
    actionHint: "重新填写账号 / 授权码",
    appendDetail: true,
  },
  CONNECTION_FAILED: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "连接服务器失败",
    actionHint: "检查网络 / 服务器地址",
    appendDetail: true,
  },
  INVALID_COOKIE: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "登录态 Cookie 无效或已过期",
    actionHint: "重新在 App / 网页登录抓取 Cookie",
  },
  NO_ACCOUNT_PIN: accountReason("缺少账号标识（pin）"),
  NO_ACCOUNT_USER_ID: accountReason("缺少账号标识（user id）"),
  NO_ACCOUNT_USERID: accountReason("缺少账号标识（userId）"),
  NO_ACCOUNT_UID: accountReason("缺少账号标识（uid）"),
  NO_ACCOUNT_QQ: accountReason("缺少 QQ 账号标识"),
  NO_ACCOUNT_USERNAME: accountReason("缺少账号用户名"),
  NO_ACCOUNT_DEVICE_ID: accountReason("缺少设备标识（device id）"),

  // ── local (host filesystem present?) ────────────────────────────────────
  NO_DATA_ROOTS: localMissing("未配置可扫描的数据目录"),
  NO_CODE_ROOTS: localMissing("未配置可扫描的代码目录"),
  NO_GIT_REPOS: localMissing("未发现 git 仓库"),
  NO_HISTORY_SOURCES: localMissing("未发现命令行历史文件"),
  PROFILE_NOT_FOUND: localMissing("未找到浏览器配置（未安装或从未登录）"),
  PROFILE_PATH_UNRESOLVED: localError("无法解析浏览器配置路径"),
  VSCODE_NOT_FOUND: localMissing("未找到 VSCode 数据"),
  VSCODE_ROOT_UNRESOLVED: localError("无法解析 VSCode 路径"),
  RECENT_DIR_NOT_FOUND: localMissing("未找到最近使用记录目录"),

  // ── platform / environment ──────────────────────────────────────────────
  PLATFORM_UNSUPPORTED: {
    status: READINESS_STATUS.UNAVAILABLE,
    category: READINESS_CATEGORY.PLATFORM,
    message: "当前操作系统不支持此数据源",
    actionHint: null,
  },
  ENV_UNSUPPORTED: {
    status: READINESS_STATUS.UNAVAILABLE,
    category: READINESS_CATEGORY.PLATFORM,
    message: "当前运行环境不支持此数据源",
    actionHint: null,
    appendDetail: true,
  },

  // ── probe-level (set by the registry, not adapters) ─────────────────────
  PROBE_TIMEOUT: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "就绪检查超时（适配器可能已配置但探测无响应）",
    actionHint: "稍后重试，或直接尝试一次同步",
  },
  PROBE_ERROR: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "就绪检查出错",
    actionHint: "查看日志 / 直接尝试一次同步",
    appendDetail: true,
  },
  UNKNOWN: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "未就绪（未知原因）",
    actionHint: "查看 lastError / 尝试一次同步以获取详细错误",
    appendDetail: true,
  },
});

function accountReason(message) {
  return {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.CREDENTIAL,
    message,
    actionHint: "在数据源设置中补全账号信息",
  };
}

function localMissing(message) {
  return {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.LOCAL,
    message,
    actionHint: "在设置中指定路径，或确认数据源已在本机存在",
  };
}

function localError(message) {
  return {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.LOCAL,
    message,
    actionHint: "检查本机路径配置",
  };
}

// extractMode → category fallback for the "ready" case (no failure reason).
const MODE_TO_CATEGORY = Object.freeze({
  "file-import": READINESS_CATEGORY.LOCAL,
  "device-pull": READINESS_CATEGORY.DEVICE,
  "web-api": READINESS_CATEGORY.SNAPSHOT,
});

function categoryForMode(extractMode) {
  return MODE_TO_CATEGORY[extractMode] || READINESS_CATEGORY.LOCAL;
}

/**
 * Map an adapter `authenticate()` reason code to a UI descriptor.
 * Unknown codes fall back to the UNKNOWN descriptor (so a new adapter
 * reason never crashes the readiness report — it just shows generically).
 *
 * @param {string} reason  reason code from authenticate()
 * @returns {{status: string, category: string, message: string, actionHint: string|null, appendDetail: boolean}}
 */
function describeReadiness(reason) {
  if (reason === "CUSTOM_FETCH_REQUIRED") {
    return {
      status: READINESS_STATUS.NEEDS_SETUP,
      category: READINESS_CATEGORY.SNAPSHOT,
      message: "This adapter exposes a custom web-API seam but has no verified built-in fetch implementation",
      actionHint: "Use snapshot/file import, or configure a fetch implementation for your authorized session",
      appendDetail: true,
    };
  }
  if (reason === "EXPLICIT_SCHEMA_REQUIRED") {
    return {
      status: READINESS_STATUS.NEEDS_SETUP,
      category: READINESS_CATEGORY.SNAPSHOT,
      message: "SQLite schema is not field-verified for this app version; verified snapshot/file import remains available",
      actionHint: "Import an exported snapshot, or provide table names confirmed against your own app database",
      appendDetail: true,
    };
  }
  if (reason === "EXPLICIT_ENDPOINT_REQUIRED") {
    return {
      status: READINESS_STATUS.NEEDS_SETUP,
      category: READINESS_CATEGORY.SNAPSHOT,
      message: "Live collection is not field-verified; verified snapshot/file import remains available",
      actionHint: "Import an exported snapshot, or provide endpoint URLs captured from your own authorized session",
      appendDetail: true,
    };
  }
  const d = (reason && REASONS[reason]) || REASONS.UNKNOWN;
  return {
    status: d.status,
    category: d.category,
    message: d.message,
    actionHint: d.actionHint || null,
    appendDetail: !!d.appendDetail,
  };
}

module.exports = {
  READINESS_CATEGORY,
  READINESS_STATUS,
  describeReadiness,
  categoryForMode,
  // exposed for tests / introspection
  READINESS_REASONS: REASONS,
};
