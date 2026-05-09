package com.chainlesschain.android.sync

import com.chainlesschain.android.remote.crypto.NonceManager
import com.chainlesschain.android.remote.data.AuthInfo
import com.chainlesschain.android.remote.p2p.P2PClient
import timber.log.Timber
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
    private val p2pClient: P2PClient
) {

    private val maxTimestampSkewMs = 5 * 60 * 1000L  // ±5 min

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

        // 4) 校验通过，标记 nonce 已使用
        nonceManager.markNonceSeen(auth.did, auth.nonce)
        Timber.d("[SyncAuthVerifier] auth OK: did=${auth.did.take(20)}… method=$method")
    }
}
