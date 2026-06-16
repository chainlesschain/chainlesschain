package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.remote.p2p.e2ee.E2EEHandshakeCodec
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * FAMILY-67: `e2ee.*` 命名空间路由（**响应方**侧）。
 *
 * 背景：好友聊天 ([P2PChatViewModel] / [P2PMessageRepository]) 发消息前硬闸
 * `sessionManager.getSession(peerId)`，无 E2EE 会话即报"设备未连接，请先建立安全连接"。但
 * 会话此前**从未建立**（`PairingViewModel.exchangeKeys()` 是桩、应用从不调 `SessionManager.initialize()`）。
 *
 * 好友 P2P 连接（[FriendSyncConnector] → [P2PClient.connectFamilyPeer]）建立后，由 offerer
 * （DID 字典序较小方，见 `FamilyGuardSyncConnector.electOfferer`）经 [FriendSessionHandshake]
 * 发起 X3DH 握手。本路由处理对端（responder）收到的两个请求：
 *  - `e2ee.getBundle` → 返回本机 [PreKeyBundle]（JSON 字符串），供发起方 `createSession`。
 *  - `e2ee.init {fromDid, initialMessage}` → `acceptSession`，建立本机会话。
 *
 * 建好会话后双方 `getSession(peerId)` 即非空，好友聊天可发送；消息经 `ResourceType.MESSAGE`
 * sync 投递（与家庭遥测同栈，已验证）。auth 已在 [P2PClient] 层强制验签（见 handleIncomingCommandRequest）。
 *
 * 加进 [CompositeCommandRouter] 的 `e2ee.*` 分支。
 *
 * ⚠️ 用 [PersistentSessionManager]（**不是** SessionManager）：好友聊天 [P2PMessageRepository] /
 * [P2PChatViewModel] 的发送闸 `getSession`/`hasSession` + `encrypt`/`decrypt` 全走
 * PersistentSessionManager（@Singleton），握手必须把会话建在**同一个**管理器里聊天才看得见。
 * 它还会把会话持久化到磁盘 → 进程重启后 `initialize(autoRestore=true)` 自动恢复，免重握手。
 */
@Singleton
class E2EEHandshakeCommandRouter @Inject constructor(
    private val sessionManager: PersistentSessionManager,
) : CommandRouter {

    override suspend fun route(method: String, params: Map<String, Any>): Any? {
        return when (method) {
            "e2ee.getBundle" -> handleGetBundle()
            "e2ee.init" -> handleInit(params)
            else -> {
                if (method.startsWith("e2ee.")) {
                    throw IllegalArgumentException("Unknown e2ee method: $method")
                }
                throw IllegalArgumentException("Method namespace not handled: $method")
            }
        }
    }

    private suspend fun handleGetBundle(): Map<String, Any> {
        sessionManager.initialize()
        val bundle = sessionManager.getPreKeyBundle()
        return mapOf("bundle" to E2EEHandshakeCodec.encodeBundle(bundle))
    }

    private suspend fun handleInit(params: Map<String, Any>): Map<String, Any> {
        val fromDid = params["fromDid"] as? String
            ?: throw IllegalArgumentException("e2ee.init: missing 'fromDid' param")
        val initialMessageJson = params["initialMessage"] as? String
            ?: throw IllegalArgumentException("e2ee.init: missing 'initialMessage' param")

        sessionManager.initialize()
        val initialMessage = E2EEHandshakeCodec.decodeInitialMessage(initialMessageJson)
        sessionManager.acceptSession(fromDid, initialMessage)
        Timber.i("[E2EEHandshake] session accepted from peer=${fromDid.take(20)}…")
        return mapOf("ok" to true)
    }
}
