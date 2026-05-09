package com.chainlesschain.android.sync

import android.util.Base64
import com.chainlesschain.android.remote.crypto.DIDSigner
import com.chainlesschain.android.remote.crypto.NonceManager
import com.chainlesschain.android.remote.data.AuthInfo
import com.chainlesschain.android.remote.p2p.P2PClient
import timber.log.Timber
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 3d v1.1 #2: 入向 sync.* 请求的 auth 校验。
 *
 * v1 的 SyncCommandRouter 直接 dispatch 不验 auth。这层加 3 道闸：
 *   1. timestamp 窗口（±5 min，过期/未来时间均拒）—— 拦掉旧请求重放
 *   2. nonce 重放（NonceManager.isNonceUsed）—— 同 nonce 第二次出现拒
 *   3. DID 与当前已建立 P2P 连接的对端 DID 匹配 —— 拒不同 DID 假冒
 *      （这等价于"信道身份与请求身份一致"，比"DID 是否被 paired"更严
 *      —— 后者要 Android-side device registry 我们没建）
 *
 * v1.1 不验**密码学签名**：M4.5 manual pairing 没收对端公钥，无法验签；
 * v1.2 完整 QR pairing 引入 pubkey 交换后再加 signature 校验。
 *
 * WebRTC DataChannel 走 DTLS 加密信道。Check 3 与 DTLS 握手时确定的
 * 对端身份绑定 — 攻击者要伪造 sync.* 请求得先攻破 DTLS 拿到信道密钥。
 *
 * 失败抛 SecurityException，由 P2PClient.handleIncomingCommandRequest
 * catch 后包成 ErrorCodes.AUTHENTICATION_FAILED (-32008) 响应。
 */
@Singleton
class SyncAuthVerifier @Inject constructor(
    private val nonceManager: NonceManager,
    private val p2pClient: P2PClient,
    // v1.2 gate 4: Ed25519 verify
    private val didSigner: DIDSigner
) {

    private val maxTimestampSkewMs = 5 * 60 * 1000L  // ±5 min
    private val didMethodPrefix = "did:chainlesschain:"
    private val didIdentifierBytes = 20  // matches desktop did-signer DID_HASH_PREFIX_BYTES

    /**
     * 校验 auth。失败抛 SecurityException with reason；成功后将 nonce 标记为
     * 已使用阻止后续重放。
     */
    suspend fun verify(auth: AuthInfo, method: String) {
        // 1) timestamp 窗口
        val now = System.currentTimeMillis()
        val skew = kotlin.math.abs(now - auth.timestamp)
        if (skew > maxTimestampSkewMs) {
            throw SecurityException(
                "timestamp out of window: skew=${skew}ms (max=${maxTimestampSkewMs}ms) for $method"
            )
        }

        // 2) nonce 重放
        if (nonceManager.isNonceUsed(auth.did, auth.nonce)) {
            throw SecurityException(
                "nonce already used: did=${auth.did.take(20)}… nonce=${auth.nonce.take(8)}… for $method"
            )
        }

        // 3) DID 与当前 P2P 对端 DID 匹配
        val connectedDid = p2pClient.connectedPeer.value?.did
        if (connectedDid == null) {
            throw SecurityException(
                "no active P2P peer to validate against (auth.did=${auth.did.take(30)}…) for $method"
            )
        }
        if (connectedDid != auth.did) {
            throw SecurityException(
                "DID mismatch: connected=${connectedDid.take(30)}… vs auth.did=${auth.did.take(30)}… for $method"
            )
        }

        // 4) Phase 3d v1.2 gate 4: Ed25519 签名校验。
        //    senderPubkey 是 v1.2 Desktop 出向附带的 base64 公钥；为兼容 v1.1
        //    Desktop 客户端可能仍发 null，warn-log 后跳过 gate 4。
        val pubkeyB64 = auth.senderPubkey
        if (pubkeyB64 == null) {
            Timber.w(
                "[SyncAuthVerifier] gate 4 skipped: senderPubkey null (pre-v1.2 desktop?) " +
                    "did=${auth.did.take(20)}… method=$method"
            )
        } else {
            verifySignatureGate(auth, pubkeyB64, method)
        }

        // 5) 校验通过，标记 nonce 已使用
        nonceManager.markNonceSeen(auth.did, auth.nonce)
        Timber.d("[SyncAuthVerifier] auth OK: did=${auth.did.take(20)}… method=$method")
    }

    /**
     * Phase 3d v1.2 gate 4 实现：两道子检查。
     *  4a. SHA256(decodedPubkey).take(20) hex 与 auth.did 的 identifier 部分相等
     *      —— 防止攻击者声明已知 DID 但发自己 pubkey 的 impersonation
     *  4b. Ed25519 detached sig 校验：canonical bytes 同 desktop did-signer.canonicalize
     *      （平 keys 字典序，JSON 序列化值，无嵌套）
     *
     * 等价于 desktop verifyPayloadAgainstDid 的 gate 1 + gate 2。
     */
    private suspend fun verifySignatureGate(
        auth: AuthInfo,
        pubkeyB64: String,
        method: String
    ) {
        val pubkeyBytes = try {
            Base64.decode(pubkeyB64, Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
            throw SecurityException("senderPubkey not valid base64 for $method: ${e.message}")
        }
        if (pubkeyBytes.size != 32) {
            throw SecurityException(
                "senderPubkey wrong length: ${pubkeyBytes.size} bytes (need 32) for $method"
            )
        }

        // 4a: hash check
        val sha256 = MessageDigest.getInstance("SHA-256").digest(pubkeyBytes)
        val hex = sha256.take(didIdentifierBytes)
            .joinToString("") { "%02x".format(it.toInt() and 0xFF) }
        val computedDid = "$didMethodPrefix$hex"
        if (computedDid != auth.did) {
            throw SecurityException(
                "did/pubkey mismatch: claimed=${auth.did.take(40)}… " +
                    "computed=${computedDid.take(40)}… for $method"
            )
        }

        // 4b: Ed25519 verify over canonical {did, nonce, timestamp}
        val canonical = canonicalAuthPayload(auth.did, auth.nonce, auth.timestamp)
        val verified = didSigner.verify(canonical, auth.signature, pubkeyB64)
            .getOrElse { e ->
                throw SecurityException(
                    "signature verify exception for $method: ${e.message}"
                )
            }
        if (!verified) {
            throw SecurityException("signature invalid for $method")
        }
    }

    /**
     * 与 desktop did-signer.canonicalize 的 {did, nonce, timestamp} 子集严格对称：
     *   - 键按字典序：did < nonce < timestamp
     *   - 字符串走 JSON.stringify 等价转义（字符串值由 DID 格式约束，无引号/反斜杠/控制字符，
     *     这里手写最小 escape 涵盖 " 和 \）
     *   - timestamp Long 直接 toString
     */
    private fun canonicalAuthPayload(did: String, nonce: String, timestamp: Long): String {
        return buildString {
            append("{\"did\":")
            append(jsonString(did))
            append(",\"nonce\":")
            append(jsonString(nonce))
            append(",\"timestamp\":")
            append(timestamp.toString())
            append("}")
        }
    }

    private fun jsonString(s: String): String {
        val sb = StringBuilder()
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c.code < 0x20) {
                    sb.append("\\u").append("%04x".format(c.code))
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append('"')
        return sb.toString()
    }
}
