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
  SNAPSHOT_SYMBOLIC_LINK: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "快照来源不能是符号链接",
    actionHint: "选择设备直接导出的普通文件",
  },
  SNAPSHOT_NOT_REGULAR_FILE: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "选择的快照来源不是普通文件",
    actionHint: "重新选择一个 JSON 快照文件",
  },
  SNAPSHOT_TOO_LARGE: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "快照文件超过安全导入上限",
    actionHint: "缩小导出范围或拆分快照后重试",
    appendDetail: true,
  },
  SNAPSHOT_JSON_INVALID: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "快照不是有效的 JSON 文件",
    actionHint: "重新从来源导出快照",
  },
  SNAPSHOT_SCHEMA_MISMATCH: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "快照版本与当前采集器不兼容",
    actionHint: "使用当前版本重新导出快照",
    appendDetail: true,
  },
  SNAPSHOT_SHAPE_INVALID: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "快照结构不完整或不合法",
    actionHint: "重新从来源导出完整快照",
    appendDetail: true,
  },
  SNAPSHOT_CHANGED: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "读取期间快照文件发生了变化",
    actionHint: "等待导出完成后重新选择文件",
  },
  SNAPSHOT_LIMIT_INVALID: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "快照导入上限配置不合法",
    actionHint: "恢复默认导入上限后重试",
  },
  SNAPSHOT_SIZE_INVALID: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.SNAPSHOT,
    message: "无法确认快照文件大小",
    actionHint: "重新导出快照后重试",
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
  NO_EXPORT_DIR: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.LOCAL,
    message: "尚未选择本地导出目录",
    actionHint: "先从来源导出文件，再选择导出目录",
  },
  EXPORT_DIR_NOT_DIRECTORY: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.LOCAL,
    message: "选择的导出路径不是目录",
    actionHint: "重新选择包含导出文件的目录",
  },
  EXPORT_DIR_SYMBOLIC_LINK: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.LOCAL,
    message: "导出目录不能是符号链接",
    actionHint: "选择导出文件实际所在的本地目录",
  },
  EXPORT_DIR_UNREADABLE: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.LOCAL,
    message: "导出目录不存在或不可读",
    actionHint: "检查目录路径和本机读取权限",
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
    message:
      "可从 Android 自动拉取 WhatsApp 加密备份，还需连接手机并提供自己的备份密钥",
    actionHint:
      "开启 USB 调试并连接手机，填写 crypt15 64 位密钥（或 crypt14 key 文件）后同步",
    appendDetail: true,
  },
  KEY_REQUIRED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "已找到加密备份，但尚未提供用户自己的解密密钥",
    actionHint:
      "填写 crypt15 64 位密钥，或选择 crypt14 key / encrypted_backup.key 文件",
    appendDetail: true,
  },
  // 自动发现：已在本机找到 App 的加密数据库，只差解密密钥即可一键采集。
  DB_FOUND_NEEDS_KEY: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "已自动找到本机数据库（已加密），仅需解密密钥即可一键采集",
    actionHint:
      "提取该 App 的数据库密钥后点「一键采集」（密钥可从运行中的 App 提取）",
    appendDetail: true,
  },
  // ADB 一键平台：后端支持 root 手机 USB 一键采集，但当前未检测到设备。
  ADB_DEVICE_NEEDED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message:
      "可通过 USB 采集：请连接安卓手机并开启 USB 调试（部分 App 数据需要 root）",
    actionHint: "连接并授权手机后刷新，即可开始采集",
  },
  ADB_NOT_INSTALLED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "未找到 ADB，当前无法从 Android 设备采集",
    actionHint:
      "安装 Android Platform Tools，或通过 ADB_PATH 指定 adb 可执行文件",
  },
  ADB_PROBE_FAILED: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.DEVICE,
    message: "ADB 状态探测失败，尚不能确认设备是否可采集",
    actionHint: "检查 adb devices 输出、USB 连接及本机执行权限后重试",
  },
  ADB_DEVICE_UNAUTHORIZED: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "Android 设备尚未授权当前电脑进行 USB 调试",
    actionHint: "在手机上确认 USB 调试授权弹窗，然后重新探测",
  },
  ADB_DEVICE_OFFLINE: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "Android 设备处于 offline 状态，当前无法采集",
    actionHint: "重新连接 USB、重启 adb 服务并确认设备恢复为 device 状态",
  },
  ADB_SELECTED_DEVICE_NOT_FOUND: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "指定的 Android 设备不存在或当前未连接",
    actionHint: "检查 ADB_SERIAL/--serial，并从 adb devices 中选择已授权设备",
  },
  ADB_MULTIPLE_DEVICES: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.DEVICE,
    message: "检测到多台已授权的安卓设备，无法确定要从哪一台采集",
    actionHint: "断开其它安卓设备，仅保留一台已授权设备后刷新",
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
  NO_ACCESS_TOKEN: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "OAuth 授权后才能开始在线采集",
    actionHint: "为本次采集提供短期 access token",
  },
  INVALID_ACCESS_TOKEN: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "OAuth access token 无效或已过期",
    actionHint: "重新授权并提供新的 access token",
  },
  NO_DRIVE_ID: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "OAuth 采集缺少云盘标识",
    actionHint: "填写已授权账号对应的 drive id",
  },
  INCOMPLETE_KSO1_CREDENTIALS: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "可选的 KSO-1 凭据不完整",
    actionHint: "同时填写两个 KSO-1 字段，或将两者都留空",
  },
  INVALID_DIRECTORY: {
    status: READINESS_STATUS.NEEDS_SETUP,
    category: READINESS_CATEGORY.CREDENTIAL,
    message: "所选云端目录无效",
    actionHint: "选择已授权的目录后重新采集",
  },
  NO_ACCOUNT_ID: accountReason("缺少用于隔离同步水位的本地账号标识"),
  NO_ACCOUNT_PIN: accountReason("缺少账号标识（pin）"),
  NO_ACCOUNT_USER_ID: accountReason("缺少账号标识（user id）"),
  NO_ACCOUNT_USERID: accountReason("缺少账号标识（userId）"),
  NO_ACCOUNT_UID: accountReason("缺少账号标识（uid）"),
  NO_ACCOUNT_QQ: accountReason("缺少 QQ 账号标识"),
  NO_ACCOUNT_USERNAME: accountReason("缺少账号用户名"),
  NO_ACCOUNT_DEVICE_ID: accountReason("缺少设备标识（device id）"),

  // ── local (host filesystem present?) ────────────────────────────────────
  NO_DATA_ROOTS: localMissing("未配置可扫描的数据目录"),
  LOCAL_FILES_ROOT_UNRESOLVED: localMissing("未找到可扫描的本地文件目录"),
  LOCAL_FILES_NETWORK_ROOT_UNSUPPORTED:
    localMissing("本地文件采集不支持网络或设备路径"),
  LOCAL_FILES_REPARSE_ROOT_UNSUPPORTED:
    localMissing("本地文件采集不支持重解析点目录"),
  LOCAL_FILES_NOT_READABLE: localError("无法读取本地文件目录"),
  NO_CODE_ROOTS: localMissing("未配置可扫描的代码目录"),
  NO_GIT_REPOS: localMissing("未发现 git 仓库"),
  REPOSITORY_SCAN_FAILED: localError("无法扫描本地 Git 仓库"),
  NO_HISTORY_SOURCES: localMissing("未发现命令行历史文件"),
  INVALID_HISTORY_SOURCE: localError("命令行历史数据源配置无效"),
  PROFILE_NOT_FOUND: localMissing("未找到浏览器配置（未安装或从未登录）"),
  PROFILE_PATH_UNRESOLVED: localError("无法解析浏览器配置路径"),
  SAFARI_PERMISSION_DENIED: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.LOCAL,
    message: "macOS 拒绝读取 Safari 数据",
    actionHint:
      "在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中允许 ChainlessChain，然后重新打开应用",
  },
  MEETING_DATA_NOT_FOUND: localMissing("未找到腾讯会议历史数据"),
  MEETING_SCHEMA_MISMATCH: localError("所选数据库不是受支持的腾讯会议历史库"),
  MEETING_PERMISSION_DENIED: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.LOCAL,
    message: "无法读取腾讯会议本地数据",
    actionHint:
      "退出腾讯会议后重试，或检查 ChainlessChain 对腾讯会议数据目录的读取权限",
  },
  VSCODE_NOT_FOUND: localMissing("未找到 VSCode 数据"),
  VSCODE_ROOT_UNRESOLVED: localError("无法解析 VSCode 路径"),
  HBUILDERX_ROOT_UNRESOLVED: localMissing("未找到 HBuilderX 数据目录"),
  HBUILDERX_FILE_ACTIVITY_NOT_FOUND: localMissing(
    "未找到 HBuilderX 文件活动记录",
  ),
  HBUILDERX_NOT_READABLE: localError("无法读取 HBuilderX 本地数据"),
  HBUILDERX_TIMEZONE_INVALID: {
    status: READINESS_STATUS.ERROR,
    category: READINESS_CATEGORY.LOCAL,
    message: "HBuilderX 源时区配置无效",
    actionHint: "检查 HBuilderX 数据源的 sourceTimezone 配置",
  },
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
      message:
        "This adapter exposes a custom web-API seam but has no verified built-in fetch implementation",
      actionHint:
        "Use snapshot/file import, or configure a fetch implementation for your authorized session",
      appendDetail: true,
    };
  }
  if (reason === "EXPLICIT_SCHEMA_REQUIRED") {
    return {
      status: READINESS_STATUS.NEEDS_SETUP,
      category: READINESS_CATEGORY.SNAPSHOT,
      message:
        "SQLite schema is not field-verified for this app version; verified snapshot/file import remains available",
      actionHint:
        "Import an exported snapshot, or provide table names confirmed against your own app database",
      appendDetail: true,
    };
  }
  if (reason === "EXPLICIT_ENDPOINT_REQUIRED") {
    return {
      status: READINESS_STATUS.NEEDS_SETUP,
      category: READINESS_CATEGORY.SNAPSHOT,
      message:
        "Live collection is not field-verified; verified snapshot/file import remains available",
      actionHint:
        "Import an exported snapshot, or provide endpoint URLs captured from your own authorized session",
      appendDetail: true,
    };
  }
  if (
    reason === "INVALID_SOURCE_URL" ||
    (typeof reason === "string" && reason.startsWith("SOURCE_URL_"))
  ) {
    return {
      status: READINESS_STATUS.NEEDS_SETUP,
      category: READINESS_CATEGORY.CREDENTIAL,
      message: "The one-shot live source URL is invalid or not allowed",
      actionHint:
        "Use a credential-free HTTPS URL on an explicitly allowed official platform domain",
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
