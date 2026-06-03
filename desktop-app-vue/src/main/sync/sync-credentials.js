/**
 * 外部 sync provider 凭证读写（Phase 3c）
 *
 * 把 WebDAV / OSS 等"非本地仓库"同步目标的所有配置（含密码 / secret）
 * 落到 LLM 那套 safeStorage 加密 blob (`secure-config.enc`)，
 * 命名空间 `config.sync.<providerId>`。
 *
 * 设计：
 *   - 不新建 credential-vault 子系统，复用 secure-config-storage
 *   - URL / username / remotePath 也一并存这里（统一备份 / 迁移 + 避免
 *     用户名泄露 infra），但只有 password / secret 类字段进
 *     SENSITIVE_FIELDS（决定 sanitizeConfig 是否 mask）
 *   - renderer 永远拿 mask 后的视图（getCredentialsSanitized），
 *     setCredentials 走 IPC 单向写入
 */

const { logger } = require("../utils/logger.js");
const secureConfigModule = require("../llm/secure-config-storage");

/**
 * 依赖注入点：测试时通过 _setDepsForTest 替换。
 * 主代码路径不直接 destructure 顶层 require — vitest fork pool 下
 * CJS destructure + vi.mock 的交互有 bug，参考 .claude/rules/testing.md。
 */
const _deps = {
  getSecureConfigStorage: () => secureConfigModule.getSecureConfigStorage(),
  sanitizeConfig: (cfg) => secureConfigModule.sanitizeConfig(cfg),
};

/** Provider id 白名单 — 防止越权写入任意路径。 */
const ALLOWED_PROVIDER_IDS = ["webdav", "oss"];

function assertProviderId(providerId) {
  if (!ALLOWED_PROVIDER_IDS.includes(providerId)) {
    throw new Error(`未知 sync provider id: ${providerId}`);
  }
}

/**
 * 读取整个 secure-config（已解密），返回 plain object。
 * 不存在时返回空对象，不抛错。
 */
function loadAll() {
  const storage = _deps.getSecureConfigStorage();
  if (!storage.exists()) {
    return {};
  }
  try {
    return storage.load() || {};
  } catch (err) {
    logger.error("[sync-credentials] secure-config load 失败:", err.message);
    return {};
  }
}

/**
 * 取回 provider 凭证 plain（含 password）。
 * 主进程内部使用 — 不应通过 IPC 直接暴露给 renderer。
 *
 * @param {string} providerId
 * @returns {Object} 配置对象，未配置时返回 {}
 */
function getCredentials(providerId) {
  assertProviderId(providerId);
  const all = loadAll();
  return all?.sync?.[providerId] ?? {};
}

/**
 * 取回 mask 后的视图 — 安全交给 renderer 显示。
 *
 * @param {string} providerId
 * @returns {Object}
 */
function getCredentialsSanitized(providerId) {
  assertProviderId(providerId);
  const all = loadAll();
  const masked = _deps.sanitizeConfig(all);
  return masked?.sync?.[providerId] ?? {};
}

/**
 * 是否已配置（至少有一个非空字段）。
 */
function hasCredentials(providerId) {
  const creds = getCredentials(providerId);
  return Object.values(creds).some(
    (v) => v !== null && v !== undefined && v !== "",
  );
}

/**
 * 写入 / 覆盖 provider 凭证。会读出全量 config，merge sync.<id>，再保存。
 *
 * @param {string} providerId
 * @param {Object} creds — 完整字段对象（不支持部分 patch；调用方应自行
 *                        getCredentials 后合并再写回，避免漏字段）
 * @returns {boolean}
 */
function setCredentials(providerId, creds) {
  assertProviderId(providerId);
  if (!creds || typeof creds !== "object") {
    throw new Error("creds 必须是对象");
  }
  const storage = _deps.getSecureConfigStorage();
  const all = loadAll();
  if (!all.sync || typeof all.sync !== "object") {
    all.sync = {};
  }
  all.sync[providerId] = { ...creds };
  return storage.save(all);
}

/**
 * 清除 provider 凭证（用户在 Settings 点"断开"时调用）。
 */
function clearCredentials(providerId) {
  assertProviderId(providerId);
  const storage = _deps.getSecureConfigStorage();
  const all = loadAll();
  if (all?.sync?.[providerId]) {
    delete all.sync[providerId];
    return storage.save(all);
  }
  return true;
}

/** 测试钩子：注入 fake getSecureConfigStorage / sanitizeConfig。 */
function _setDepsForTest(overrides) {
  Object.assign(_deps, overrides);
}

module.exports = {
  ALLOWED_PROVIDER_IDS,
  getCredentials,
  getCredentialsSanitized,
  hasCredentials,
  setCredentials,
  clearCredentials,
  _setDepsForTest,
};
