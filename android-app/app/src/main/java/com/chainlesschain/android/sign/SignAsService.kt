package com.chainlesschain.android.sign

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import timber.log.Timber
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 反向 sign.request 服务（M5 ADR-6）：当桌面（macOS / Linux 没 U-Key 的用户）需要硬件
 * 签名时，桌面通过 mobile-bridge 反向 RPC 调到本服务。本服务：
 *  1. 检查当前钱包是否有 active DID
 *  2. 调起 [ApprovalGate] 等待用户在 Compose ApprovalDialog 中确认（含 BiometricPrompt）
 *  3. requireStrongBox=true 时，检查设备 [StrongBoxKeyManager.detectMaxTier] 是否硬件级
 *  4. 通过 [DIDManager.sign] 用 wrapper-AES 解密的 Ed25519 私钥对 payloadHash 签名
 *  5. 返回 base64 签名 + 当时 DID + 时间戳
 *
 * 解耦：transport 层（mobile-bridge.js / WebRTC DataChannel）负责把 SignAsRequest 反序列化
 * 给本服务，再把 [SignAsResponse] 序列化回桌面。本服务不接 transport 细节。
 *
 * 设计文档对应：v0.2 §5.2 SignAsService + ADR-6。
 */
@Singleton
class SignAsService @Inject constructor(
    private val didManager: DIDManager,
    private val strongBoxKeyManager: StrongBoxKeyManager,
    private val approvalGate: ApprovalGate,
) {

    /**
     * 处理来自桌面的 sign.request。
     *
     * 失败路径全部返回 approved=false + deniedReason，**不抛异常**（reverse RPC 失败
     * 应作为业务侧响应回桌面，不是 transport 异常）。
     */
    suspend fun handleSignRequest(request: SignAsRequest): SignAsResponse {
        Timber.i(
            "sign.request received: hash=%s..%s requireStrongBox=%s",
            request.payloadHash.take(8),
            request.payloadHash.takeLast(4),
            request.requireStrongBox,
        )

        // 1. active DID 检查
        val did = didManager.getCurrentDID()
        if (did.isNullOrBlank()) {
            return SignAsResponse(approved = false, deniedReason = "no-active-did")
        }

        // 2. StrongBox 等级检查（如有要求）
        if (request.requireStrongBox) {
            val tier = strongBoxKeyManager.detectMaxTier()
            if (!tier.isHardwareBacked) {
                Timber.w("sign.request requires StrongBox but device tier is %s", tier)
                return SignAsResponse(approved = false, deniedReason = "no-strongbox")
            }
        }

        // 3. ApprovalUI gate
        val needsBiometric = didManager.requiresBiometric(did)
        val approval = approvalGate.requestApproval(
            payloadDescription = request.description,
            payloadHash = request.payloadHash,
            requireBiometric = needsBiometric,
        )
        if (!approval.approved) {
            Timber.i("sign.request denied by approval gate: %s", approval.deniedReason)
            return SignAsResponse(
                approved = false,
                deniedReason = approval.deniedReason ?: "user-declined",
            )
        }

        // 4. 解码 hash → ByteArray
        val hashBytes = try {
            hexToBytes(request.payloadHash)
        } catch (e: Exception) {
            Timber.e(e, "Invalid payloadHash hex")
            return SignAsResponse(approved = false, deniedReason = "invalid-payload-hash")
        }

        // 5. 签名（DIDManager.sign 内部用 wrapper-AES 解密私钥 → BouncyCastle Ed25519 sign）
        val signatureBytes = try {
            didManager.sign(hashBytes)
        } catch (e: IllegalStateException) {
            Timber.e(e, "No DID identity when signing")
            return SignAsResponse(approved = false, deniedReason = "no-active-did")
        } catch (e: Exception) {
            Timber.e(e, "Sign failed unexpectedly")
            return SignAsResponse(approved = false, deniedReason = "sign-failed")
        }

        val sigB64 = Base64.getEncoder().encodeToString(signatureBytes)
        return SignAsResponse(
            approved = true,
            did = did,
            signatureBase64 = sigB64,
            signedAt = System.currentTimeMillis(),
        )
    }

    private fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "hex must have even length" }
        val out = ByteArray(hex.length / 2)
        for (i in out.indices) {
            val high = Character.digit(hex[i * 2], 16)
            val low = Character.digit(hex[i * 2 + 1], 16)
            require(high >= 0 && low >= 0) { "invalid hex at index ${i * 2}" }
            out[i] = ((high shl 4) or low).toByte()
        }
        return out
    }
}
