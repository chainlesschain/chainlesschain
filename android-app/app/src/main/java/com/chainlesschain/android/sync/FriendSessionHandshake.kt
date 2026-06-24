package com.chainlesschain.android.sync

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.e2ee.verification.VerificationMethod
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.e2ee.E2EEHandshakeCodec
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * FAMILY-67: 好友 E2EE 会话握手（**发起方**侧驱动）。
 *
 * 好友 P2P 连接建立后（[FriendSyncConnector] → [P2PClient.connectFamilyPeer]），由 offerer
 * （DID 字典序较小方）调用 [initiate] 跑 X3DH 三步：
 *  1. `e2ee.getBundle` 取对端 [com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle]。
 *  2. `sessionManager.createSession(peer, bundle)` 本地建会话 → 产出 InitialMessage。
 *  3. `e2ee.init {fromDid, initialMessage}` 发给对端 → 对端 `acceptSession`。
 *
 * 两步均经已认证的 [P2PClient.sendCommand]（与遥测 `sync.push` 同栈，core-did auth）。完成后双方
 * `getSession(peerId)` 非空，[P2PChatViewModel] 的发送闸打开，好友可聊天（消息经 ResourceType.MESSAGE
 * sync 投递）。响应方逻辑见 [com.chainlesschain.android.remote.p2p.E2EEHandshakeCommandRouter]。
 *
 * ⚠️ 用 [PersistentSessionManager]（**不是** SessionManager）：好友聊天发送闸 + encrypt/decrypt 全走
 * 它（@Singleton），会话必须建在同一个管理器聊天才看得见。它持久化到磁盘 → 进程重启后
 * `initialize(autoRestore=true)` 自动恢复会话，不必每次重启都重握手。
 *
 * 幂等（已有会话直接返回）；失败仅记日志、清半建会话，下轮 connector 重连时自动重试。
 */
@Singleton
class FriendSessionHandshake @Inject constructor(
    private val p2pClient: P2PClient,
    private val sessionManager: PersistentSessionManager,
    private val didManager: DIDManager,
    private val verificationManager: VerificationManager,
) {

    /**
     * 命令发送 seam。默认走 [P2PClient.sendCommand]（生产路径不变）；单测替换为 fake，
     * 避免在 mockk 上触发 `sendCommand` 默认参数 `timeout = config.requestTimeout` 的
     * `$default` 合成方法读取未初始化的 config 字段而 NPE。
     */
    internal var commandSender: suspend (String, Map<String, Any>) -> Result<Map<String, Any>> =
        { method, params -> p2pClient.sendCommand(method, params) }

    suspend fun initiate(peerDid: String): Boolean {
        if (sessionManager.hasSession(peerDid)) {
            runCatching { verificationManager.markAsVerified(peerDid, VerificationMethod.MUTUAL_HANDSHAKE) }
            return true
        }
        val myDid = runCatching { didManager.getCurrentDID() }.getOrNull()
        if (myDid.isNullOrBlank()) {
            Timber.d("[FriendSessionHandshake] no local DID yet — skip")
            return false
        }
        return try {
            sessionManager.initialize()

            // 关键：在 initialize() 恢复磁盘会话**之后**再查一次。顶部那次检查发生在恢复前，
            // 若本调用早于启动时的 initialize() 完成（并发竞态），顶部会误判「无会话」。这里若
            // 已有（恢复出的）会话就直接复用，绝不再 createSession 覆盖它——否则会用全新棘轮
            // 覆盖已恢复的棘轮，与对端不一致 → 重启后解密 MAC 失败。
            if (sessionManager.hasSession(peerDid)) {
                runCatching { verificationManager.markAsVerified(peerDid, VerificationMethod.MUTUAL_HANDSHAKE) }
                Timber.d("[FriendSessionHandshake] session already present after restore — skip re-handshake")
                return true
            }

            // 1. 取对端 PreKeyBundle
            val bundleResp = commandSender(
                "e2ee.getBundle",
                mapOf("fromDid" to myDid),
            ).getOrThrow()
            val bundleJson = bundleResp["bundle"] as? String
                ?: error("e2ee.getBundle: response missing 'bundle'")
            val peerBundle = E2EEHandshakeCodec.decodeBundle(bundleJson)

            // 2. 本地建会话（发起方）→ InitialMessage
            val (_, initialMessage) = sessionManager.createSession(peerDid, peerBundle)

            // 3. 把 InitialMessage 发给对端 → 对端 acceptSession
            commandSender(
                "e2ee.init",
                mapOf(
                    "fromDid" to myDid,
                    "initialMessage" to E2EEHandshakeCodec.encodeInitialMessage(initialMessage),
                ),
            ).getOrThrow()

            // FAMILY-67: DID 验签认证的握手即视为已验证 → 清「设备未验证」横幅（P2PChatViewModel 读
            // 同一 @Singleton VerificationManager.isVerified）。手动 Safety Numbers 验证仍可叠加。
            runCatching { verificationManager.markAsVerified(peerDid, VerificationMethod.MUTUAL_HANDSHAKE) }

            Timber.i("[FriendSessionHandshake] E2EE session established with ${peerDid.take(20)}…")
            true
        } catch (e: Exception) {
            runCatching { sessionManager.deleteSession(peerDid) }
            Timber.w(e, "[FriendSessionHandshake] handshake with ${peerDid.take(20)}… failed (will retry)")
            false
        }
    }
}
