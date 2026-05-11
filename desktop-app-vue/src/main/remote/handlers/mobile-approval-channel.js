/**
 * Mobile Approval Channel — 高风险 mobile REMOTE 调用的审批回路。
 *
 * 流程（设计文档 v0.2 §5.5 + §架构图 反向 RPC）：
 *  1. Android 调 `marketplace.purchase` 类高风险 method
 *  2. 桌面 command-router 经 mobile-skill-whitelist 检查白名单通过
 *  3. whitelist.requiresApproval(method) === true → 进入本 channel
 *  4. 本 channel `requestApproval()` 创建 pending request，存内存 + 向 Android 推送
 *  5. Android ApprovalUI 弹窗 → 用户确认 → StrongBox 签名 → 反向 RPC 回桌面
 *  6. 桌面收到 approval 回复 → `resolveApproval()` 释放等待的 Promise → command-router 继续
 *
 * v1.0 D2 范围（本模块）：
 *  - 内存 PendingRequests map（peerId+method+ts → resolver）
 *  - 60s 超时自动拒绝
 *  - Pub/Sub 接口（外部 transport 注入 onRequest 回调）
 *
 * 不在本模块：
 *  - WebRTC 反向 RPC 真实传输（mobile-bridge.js）
 *  - StrongBox 签名验证（mobile-bridge-sync 的 SyncAuthVerifier）
 *  - ApprovalUI compose screen（Android M2 D3 范围）
 *
 * @module remote/handlers/mobile-approval-channel
 */

const crypto = require("crypto");

const DEFAULT_TIMEOUT_MS = 60_000;

class MobileApprovalChannel {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    /** @type {(request: object) => void} */
    this.onRequestCallback = options.onRequest || null;

    /** @type {Map<string, {resolve, reject, timer, method, peerId, requestedAt}>} */
    this.pending = new Map();
  }

  /**
   * 注入外部 transport 回调：当新审批请求产生，本 channel 会调此函数把 ApprovalPayload
   * 推送到对端（mobile-bridge.js 负责真实 transport）。
   */
  setOnRequest(callback) {
    this.onRequestCallback = callback;
  }

  /**
   * 请求审批。返回 Promise<{approved, signature?, deniedReason?}>。
   *
   * @param {Object} args
   * @param {string} args.peerId - 目标 Android 设备 ID
   * @param {string} args.method - 待审批的 REMOTE method
   * @param {Object} args.params - 原始 RPC params（用于 ApprovalUI 展示）
   * @returns {Promise<{approved: boolean, signature?: string, deniedReason?: string, requestId: string}>}
   */
  requestApproval({ peerId, method, params }) {
    if (!peerId || !method) {
      return Promise.reject(new Error("peerId and method are required"));
    }
    const requestId = `apr-${crypto.randomUUID()}`;
    const payload = {
      requestId,
      peerId,
      method,
      params: params || {},
      requestedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          resolve({
            approved: false,
            deniedReason: "timeout",
            requestId,
          });
        }
      }, this.timeoutMs);

      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        method,
        peerId,
        requestedAt: payload.requestedAt,
      });

      if (this.onRequestCallback) {
        try {
          this.onRequestCallback(payload);
        } catch (err) {
          // transport throw 不应破坏 channel；记 reject 但不清掉 pending（等超时）
          // 调用方需自行检查 onRequest 失败时 fallback
        }
      }
    });
  }

  /**
   * 外部 transport 收到 Android 端的回复后调此方法解锁等待的 Promise。
   *
   * @param {string} requestId - requestApproval 返回的 ID
   * @param {Object} response
   * @param {boolean} response.approved
   * @param {string} [response.signature] - StrongBox Ed25519 签名（hex / base64）
   * @param {string} [response.deniedReason] - 用户拒绝时的原因
   * @returns {boolean} true 表示成功 resolve；false 表示 requestId 不存在（已超时 / 已处理）
   */
  resolveApproval(requestId, response) {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return false;
    }
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve({
      approved: !!response.approved,
      signature: response.signature || null,
      deniedReason: response.approved
        ? null
        : response.deniedReason || "denied-by-user",
      requestId,
    });
    return true;
  }

  /** 取消一个 pending request（管理员撤回 / 设备失联）。 */
  cancelApproval(requestId, reason = "cancelled") {
    return this.resolveApproval(requestId, {
      approved: false,
      deniedReason: reason,
    });
  }

  /** 返回当前 pending 数量。 */
  pendingCount() {
    return this.pending.size;
  }

  /** 清空所有 pending（resolve 为 denied）。测试 / 紧急退出用。 */
  clearAll(reason = "cleared") {
    for (const [requestId] of this.pending) {
      this.cancelApproval(requestId, reason);
    }
  }
}

module.exports = { MobileApprovalChannel };
