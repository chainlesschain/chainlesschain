/**
 * Mobile Skill Whitelist — 桌面侧对 Android REMOTE 调用的"白名单 + 审批通道"前置闸。
 *
 * 设计文档 v0.2 §5.5 + ADR-3：三道闸的第一道（白名单）+ 第三道（审批通道）的路由部分。
 * 第二道（Ed25519 签名）由 mobile-bridge-sync 层的 SyncAuthVerifier 处理，本模块不重复。
 *
 * 与 Android `RemoteSkillRegistry` (M4 D1) 对端：
 *  - Android 端通过 SkillMetadata 元数据决定 UI 是否需弹 ApprovalUI
 *  - 桌面端用本 whitelist 做服务端再验证（即便 Android 端绕过，桌面也拒绝）
 *
 * 配置形态（`.chainlesschain/config.json` 的 `mobileBridge` 字段）：
 *   {
 *     "enabled": true,
 *     "exposeRemoteSkills": ["system.info.*", "knowledge.*", "ai.chat", ...],
 *     "approvalChannelsForMobile": ["marketplace.purchase", "did.delegate", "cowork.spawnTeam"],
 *     "requireMobileSignature": true,
 *     "signRequestEnabled": true,
 *     "signRequiredAbove": 10
 *   }
 *
 * Pattern 语法：
 *  - "namespace.*" — 放行 namespace 下所有 method（推荐做组级开通）
 *  - "namespace.method" — 精确放行某个 method
 *  - "*" — DANGER：放行一切（仅 dev 用，生产警告）
 *  - 不在白名单 → 拒绝
 *
 * @module remote/handlers/mobile-skill-whitelist
 */

/**
 * 检查 method 是否匹配某个 pattern。
 *
 * @param {string} method - 完整 method 名，如 "ai.chat" / "system.info.getCpu"
 * @param {string} pattern - 白名单条目
 * @returns {boolean}
 */
function matchPattern(method, pattern) {
  if (!method || typeof method !== "string") {
    return false;
  }
  if (!pattern || typeof pattern !== "string") {
    return false;
  }
  if (pattern === "*") {
    return true;
  }
  if (pattern === method) {
    return true;
  }
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    if (!prefix) {
      return false;
    }
    return method === prefix || method.startsWith(prefix + ".");
  }
  return false;
}

class MobileSkillWhitelist {
  /**
   * @param {Object} config - mobileBridge 配置子树
   * @param {boolean} [config.enabled=true]
   * @param {string[]} [config.exposeRemoteSkills=[]] - 白名单 pattern 数组
   * @param {string[]} [config.approvalChannelsForMobile=[]] - 强 ApprovalUI pattern
   */
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.exposeRemoteSkills = Array.isArray(config.exposeRemoteSkills)
      ? config.exposeRemoteSkills.filter(
          (s) => typeof s === "string" && s.length > 0,
        )
      : [];
    this.approvalChannelsForMobile = Array.isArray(
      config.approvalChannelsForMobile,
    )
      ? config.approvalChannelsForMobile.filter(
          (s) => typeof s === "string" && s.length > 0,
        )
      : [];
  }

  /**
   * 判断 method 是否被白名单允许。disabled / 空白名单一律拒绝。
   *
   * @returns {boolean}
   */
  isAllowed(method) {
    if (!this.enabled) {
      return false;
    }
    if (this.exposeRemoteSkills.length === 0) {
      return false;
    }
    return this.exposeRemoteSkills.some((pattern) =>
      matchPattern(method, pattern),
    );
  }

  /**
   * 判断 method 是否要求 ApprovalUI 二次确认（即便已通过白名单，仍可能要求审批）。
   *
   * @returns {boolean}
   */
  requiresApproval(method) {
    if (!this.enabled) {
      return false;
    }
    return this.approvalChannelsForMobile.some((pattern) =>
      matchPattern(method, pattern),
    );
  }

  /**
   * Telemetry helper: 描述拒绝原因（用于审计 / 日志）。
   *
   * @returns {string|null} null = 允许；string = 拒绝原因
   */
  describeRejection(method) {
    if (!this.enabled) {
      return "mobileBridge.enabled=false";
    }
    if (this.exposeRemoteSkills.length === 0) {
      return "mobileBridge.exposeRemoteSkills is empty";
    }
    if (!this.isAllowed(method)) {
      return `method '${method}' not matched by any whitelist pattern`;
    }
    return null;
  }
}

module.exports = { MobileSkillWhitelist, matchPattern };
