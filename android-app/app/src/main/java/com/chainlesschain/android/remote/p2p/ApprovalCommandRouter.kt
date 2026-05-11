package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.sign.ApprovalGate
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * `approval.*` 命名空间的 [CommandRouter] 实现（M4 D2 Android 端 RPC 接收器）。
 *
 * 接桌面 `mobile-approval-channel.js` 的反向 RPC。桌面端在 command-router 命中
 * `requiresApproval(method) === true` 的高风险 method 时调 `MobileApprovalChannel
 * .requestApproval({peerId, method, params})`，channel 用 onRequestCallback 把
 * payload 推过来，wire 上 envelope 是：
 * ```
 * method = "approval.request"
 * params = {
 *   requestId: "apr-...",          // 桌面生成
 *   peerId:    "desktop-...",
 *   method:    "marketplace.purchase",  // 原始 high-risk method
 *   params:    {...},              // 原始 method params
 *   requestedAt: 1234567890,
 *   payloadDescription?: String,   // optional, 桌面预生成的用户可读一行描述
 *   payloadHash?: String,          // optional, SHA-256 hex
 *   requireBiometric?: Boolean,    // optional, 默认 true（高风险 default-deny）
 * }
 * ```
 *
 * 路由 → [ApprovalGate.requestApproval]（[com.chainlesschain.android.sign.AndroidApprovalGate]
 * 已被 [com.chainlesschain.android.sign.di.SignModule] 绑成 Singleton 实现）→
 * suspend 等用户决策 → 返回 result map，由 [P2PClient] 包成 CommandResponse 反向
 * 送回桌面 → 桌面 inbound handler 调 `MobileApprovalChannel.resolveApproval`。
 *
 * v1.0 scope：仅 `approval.request`。后续：
 *  - `approval.cancel`：桌面端 admin / 超时撤回（v1.1）
 *  - `approval.list`：桌面查 pending（v1.1）
 *
 * @see com.chainlesschain.android.sign.AndroidApprovalGate
 * @see CompositeCommandRouter 把本路由器和 [SyncCommandRouter] 组合按命名空间分发
 */
@Singleton
class ApprovalCommandRouter @Inject constructor(
    private val approvalGate: ApprovalGate,
) : CommandRouter {

    override suspend fun route(method: String, params: Map<String, Any>): Any? {
        return when (method) {
            "approval.request" -> handleApprovalRequest(params)
            else -> {
                if (method.startsWith("approval.")) {
                    throw IllegalArgumentException("Unknown approval method: $method")
                }
                throw IllegalArgumentException("Method namespace not handled: $method")
            }
        }
    }

    private suspend fun handleApprovalRequest(params: Map<String, Any>): Map<String, Any?> {
        val requestId = params["requestId"] as? String
            ?: throw IllegalArgumentException("approval.request: missing 'requestId' param")

        val description = (params["payloadDescription"] as? String)
            ?: (params["method"] as? String)
            ?: throw IllegalArgumentException(
                "approval.request: missing both 'payloadDescription' and 'method' params"
            )

        val hash = (params["payloadHash"] as? String) ?: ""

        val requireBiometric = (params["requireBiometric"] as? Boolean) ?: true

        Timber.d(
            "approval.request routed: id=%s description=%s requireBio=%s",
            requestId, description, requireBiometric
        )

        val result = approvalGate.requestApproval(
            payloadDescription = description,
            payloadHash = hash,
            requireBiometric = requireBiometric,
        )

        return mapOf(
            "requestId" to requestId,
            "approved" to result.approved,
            "deniedReason" to result.deniedReason,
        )
    }
}
