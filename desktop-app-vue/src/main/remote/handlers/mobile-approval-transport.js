/**
 * Mobile Approval Transport — 把 [MobileApprovalChannel] 的 onRequest 回调
 * 桥到 mobile-bridge 的反向 JSON-RPC（M4 D2 桌面胶水的最后一段）。
 *
 * 设计：
 *   desktop command-router (whitelist gate, requiresApproval=true)
 *     ↓
 *   channel.requestApproval({peerId, method, params}) → channel.onRequestCallback(payload)
 *     ↓ (本模块）
 *   mobileBridge.sendReverseRpcRequest(peerId, {jsonrpc:"2.0", id:requestId, method:"approval.request", params:payload})
 *     ↓ Android `approval.request` → ApprovalGate.requestApproval → 用户点 / Biometric
 *     ↑
 *   response = {jsonrpc:"2.0", id:requestId, result:{requestId, approved, deniedReason}}
 *     ↓
 *   channel.resolveApproval(requestId, response.result) → 桌面 command-router continue
 *
 * Why a standalone module: channel 和 bridge 处在不同初始化时序（RemoteGateway
 * vs MobileBridge in index.js），又都需要 lazy wire；把 glue 单独写避免循环依赖
 * 和 init 顺序耦合。
 *
 * @module remote/handlers/mobile-approval-transport
 */

const { logger } = require("../../utils/logger.js");

const DEFAULT_REVERSE_RPC_TIMEOUT_MS = 60_000;

class MobileApprovalTransport {
  /**
   * 把 channel 接到 bridge。返回 unwire 函数（测试 / 关停用）。
   *
   * @param {Object} approvalChannel - {setOnRequest, resolveApproval}
   * @param {Object} mobileBridge    - {sendReverseRpcRequest(peerId, request, timeoutMs)}
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=60000] - 反向 RPC 超时（应略短于 channel 内置超时以让 channel 先 surface deniedReason='timeout'）
   * @returns {() => void} unwire — 清空 channel.onRequestCallback
   */
  static wire(approvalChannel, mobileBridge, options = {}) {
    if (
      !approvalChannel ||
      typeof approvalChannel.setOnRequest !== "function"
    ) {
      throw new TypeError(
        "MobileApprovalTransport.wire: approvalChannel.setOnRequest is required",
      );
    }
    if (
      !mobileBridge ||
      typeof mobileBridge.sendReverseRpcRequest !== "function"
    ) {
      throw new TypeError(
        "MobileApprovalTransport.wire: mobileBridge.sendReverseRpcRequest is required",
      );
    }

    const timeoutMs = options.timeoutMs || DEFAULT_REVERSE_RPC_TIMEOUT_MS;

    const onRequest = (payload) => {
      // 异步发起，但同步返回 — channel 不等本回调 await，超时由 channel 内部计时器兜底。
      const rpcRequest = {
        jsonrpc: "2.0",
        id: payload.requestId,
        method: "approval.request",
        params: payload,
      };

      let pending;
      try {
        pending = mobileBridge.sendReverseRpcRequest(
          payload.peerId,
          rpcRequest,
          timeoutMs,
        );
      } catch (err) {
        // sendReverseRpcRequest 同步 throw（异步函数应该不该出现这里，但 unit 测试
        // 或非 async 实现可能直接 throw）。统一转 deniedReason 让 channel 出口收敛。
        approvalChannel.resolveApproval(payload.requestId, {
          approved: false,
          deniedReason:
            err && err.message ? `transport:${err.message}` : "transport-error",
        });
        return;
      }
      if (!pending || typeof pending.then !== "function") {
        approvalChannel.resolveApproval(payload.requestId, {
          approved: false,
          deniedReason: "transport-non-promise-return",
        });
        return;
      }

      pending.then(
        (response) => {
          if (!response) {
            approvalChannel.resolveApproval(payload.requestId, {
              approved: false,
              deniedReason: "rpc-empty-response",
            });
            return;
          }
          if (response.error) {
            const msg =
              (response.error &&
                (response.error.message || response.error.code)) ||
              "rpc-error";
            approvalChannel.resolveApproval(payload.requestId, {
              approved: false,
              deniedReason: `rpc-error:${msg}`,
            });
            return;
          }
          const result = response.result || {};
          approvalChannel.resolveApproval(payload.requestId, {
            approved: !!result.approved,
            signature: result.signature || null,
            deniedReason: result.deniedReason || null,
          });
        },
        (err) => {
          logger.warn(
            "[MobileApprovalTransport] 反向 RPC 失败 requestId=%s: %s",
            payload.requestId,
            err && err.message ? err.message : String(err),
          );
          approvalChannel.resolveApproval(payload.requestId, {
            approved: false,
            deniedReason:
              err && err.message
                ? `transport:${err.message}`
                : "transport-error",
          });
        },
      );
    };

    approvalChannel.setOnRequest(onRequest);

    return function unwire() {
      // 给 channel 注入 noop 回调 — 避免 stale closure 仍触发 bridge。
      approvalChannel.setOnRequest(null);
    };
  }
}

module.exports = { MobileApprovalTransport };
