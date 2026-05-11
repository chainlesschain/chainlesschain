package com.chainlesschain.android.sign

/**
 * 来自桌面 MobileSignClient 的反向 RPC 请求（M5 ADR-6）。
 *
 * 桌面 envelope `method: "sign.request"` 的 params 字段映射到本类。
 *
 * @property payloadHash 待签名内容的 SHA-256 hex（64 chars，**已 lowercase**）
 * @property description UI 展示用一行描述，如 "购买 X，金额 25"
 * @property requireStrongBox 是否强制要求 StrongBox 硬件等级（false 也可由 TEE / 软件兜底）
 */
data class SignAsRequest(
    val payloadHash: String,
    val description: String,
    val requireStrongBox: Boolean = false,
) {
    init {
        require(payloadHash.length == PAYLOAD_HASH_HEX_LEN) {
            "payloadHash must be $PAYLOAD_HASH_HEX_LEN-char hex, got ${payloadHash.length}"
        }
        require(payloadHash.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
            "payloadHash must be valid hex"
        }
    }

    companion object {
        const val PAYLOAD_HASH_HEX_LEN = 64 // SHA-256 = 32 bytes = 64 hex chars
    }
}

/**
 * SignAsService 的回复，被回送到桌面 MobileSignClient。
 *
 * @property approved 用户是否通过 ApprovalUI + 硬件签名
 * @property did 当时签名所用的 DID（仅 approved=true 时有效）
 * @property signatureBase64 Ed25519 签名 base64（64 字节签名 → ~88 char base64）
 * @property signedAt 签名时间戳，ms
 * @property deniedReason 失败原因（approved=false 时填）。常见值：
 *   - "no-active-did"：钱包未初始化或当前 DID 为 null
 *   - "user-declined"：用户在 ApprovalUI 拒绝
 *   - "biometric-failed"：BiometricPrompt 校验失败 / 取消
 *   - "no-strongbox"：requireStrongBox=true 但设备无硬件等级
 *   - "sign-failed"：内部签名异常（一般是 Keystore 损坏）
 */
data class SignAsResponse(
    val approved: Boolean,
    val did: String? = null,
    val signatureBase64: String? = null,
    val signedAt: Long? = null,
    val deniedReason: String? = null,
)

/**
 * 上层 ApprovalUI 注入：把用户的同意/拒绝/取消的结果以 suspend fun 形式提供给本服务。
 *
 * v1.0 真实实现：BiometricAuthenticator + Compose ApprovalDialog 组合（M5 follow-up）。
 * 测试实现：FakeApprovalGate 返回 scripted 结果。
 */
interface ApprovalGate {
    /** v1.0 原签名 — Sign 类审批走这条；调用方默认场景。 */
    suspend fun requestApproval(
        payloadDescription: String,
        payloadHash: String,
        requireBiometric: Boolean,
    ): ApprovalResult

    /**
     * M4 ApprovalUI — 带 [ApprovalCategory] 的扩展签名。Cowork / Marketplace /
     * SystemCritical 场景的 dialog 渲染按 category 适配。
     *
     * 默认 impl forward 到 3-arg 版本（fake gate / 旧 test 兼容）；
     * [AndroidApprovalGate] 真实装把 category 透传到 PendingRequest，UI 端切换 dialog UX。
     */
    suspend fun requestApproval(
        category: ApprovalCategory,
        payloadDescription: String,
        payloadHash: String,
        requireBiometric: Boolean,
    ): ApprovalResult = requestApproval(payloadDescription, payloadHash, requireBiometric)
}

/** [ApprovalGate.requestApproval] 的返回结果。 */
data class ApprovalResult(
    val approved: Boolean,
    val deniedReason: String? = null,
)
