package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.sign.ApprovalCategory
import com.chainlesschain.android.sign.ApprovalGate
import com.chainlesschain.android.sign.MultisigState
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
 *   multisig?: {                   // optional, v1.2 #20 P0.3 m-of-n 提案快照
 *     m: Int, n: Int,
 *     collected: Int,              // 本设备签名*之前*已收到的有效 partial 数
 *     signerDids: [String],        // 完整 signer 列表（长度 = n）
 *     pendingSigners: [String],    // 还未签的 DID 子集，包含本设备
 *   },
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

        val originalMethod = params["method"] as? String
        val description = (params["payloadDescription"] as? String)
            ?: originalMethod
            ?: throw IllegalArgumentException(
                "approval.request: missing both 'payloadDescription' and 'method' params"
            )

        val hash = (params["payloadHash"] as? String) ?: ""

        val requireBiometric = (params["requireBiometric"] as? Boolean) ?: true

        // M4 ApprovalUI: 从原 method 推断 category 让 dialog 渲染适配
        val category = ApprovalCategory.fromMethod(originalMethod)

        val multisig = parseMultisig(params["multisig"])

        Timber.d(
            "approval.request routed: id=%s category=%s description=%s requireBio=%s multisig=%s",
            requestId, category, description, requireBiometric,
            multisig?.let { "${it.m}-of-${it.n}" } ?: "none",
        )

        val result = approvalGate.requestApproval(
            category = category,
            payloadDescription = description,
            payloadHash = hash,
            requireBiometric = requireBiometric,
            multisig = multisig,
        )

        return mapOf(
            "requestId" to requestId,
            "approved" to result.approved,
            "deniedReason" to result.deniedReason,
        )
    }

    /**
     * 反序列化 wire-format `multisig` 字段。容错策略：
     *  - null / 不存在 → null（非多签请求）
     *  - 非 Map → null + log warn（防御桌面侧 schema 漂移）
     *  - 字段缺失 / 类型错 → 抛 IllegalArgumentException（这是协议 bug，应该 fail-fast）
     *  - 业务约束（m in 1..n 等） → 由 [MultisigState.init] 抛 IllegalArgumentException
     */
    private fun parseMultisig(raw: Any?): MultisigState? {
        if (raw == null) return null
        if (raw !is Map<*, *>) {
            Timber.w("approval.request: 'multisig' is not a Map (got %s), ignoring", raw::class.simpleName)
            return null
        }
        val m = (raw["m"] as? Number)?.toInt()
            ?: throw IllegalArgumentException("approval.request.multisig: missing or non-numeric 'm'")
        val n = (raw["n"] as? Number)?.toInt()
            ?: throw IllegalArgumentException("approval.request.multisig: missing or non-numeric 'n'")
        val collected = (raw["collected"] as? Number)?.toInt() ?: 0
        @Suppress("UNCHECKED_CAST")
        val signerDids = (raw["signerDids"] as? List<*>)?.map { it as? String ?: "" }
            ?: throw IllegalArgumentException("approval.request.multisig: missing 'signerDids' (List<String>)")
        @Suppress("UNCHECKED_CAST")
        val pendingSigners = (raw["pendingSigners"] as? List<*>)?.map { it as? String ?: "" }
            ?: emptyList()
        return MultisigState(
            m = m,
            n = n,
            collected = collected,
            signerDids = signerDids,
            pendingSigners = pendingSigners,
        )
    }
}
