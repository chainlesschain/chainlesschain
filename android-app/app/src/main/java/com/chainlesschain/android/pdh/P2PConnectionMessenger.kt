package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.flow.Flow
import java.util.UUID

/**
 * §8.3 [PdhP2PResponder.P2PMessenger] 的真实现 —— module 101 Phase 7.
 *
 * 把备份请求/响应信封挂到 core-p2p 的连接层:[P2PConnectionManager.receivedMessages] 作
 * incoming、[P2PConnectionManager.sendMessage] 作 send。MessageType 用 KNOWLEDGE_SYNC
 * (协议在 [PdhP2PResponder.Envelope] 里、不靠 MessageType;[PdhP2PResponder] 解析不到信封
 * 的消息会忽略,故与其它 KNOWLEDGE_SYNC 用途共存安全)。
 *
 * 薄适配(无逻辑分支)→ 用 mockk 验转发即可;真实收发由 core-p2p 负责。DI 侧 @Provides
 * 本类(注入 P2PConnectionManager + 本机 DID)并在连接建立后 [PdhP2PResponder.start]。
 */
class P2PConnectionMessenger(
    private val connectionManager: P2PConnectionManager,
    private val ownDeviceId: String,
) : PdhP2PResponder.P2PMessenger {

    override val incoming: Flow<P2PMessage> = connectionManager.receivedMessages

    override suspend fun send(toDeviceId: String, payload: String) {
        connectionManager.sendMessage(
            toDeviceId,
            P2PMessage(
                id = UUID.randomUUID().toString(),
                fromDeviceId = ownDeviceId,
                toDeviceId = toDeviceId,
                type = MessageType.KNOWLEDGE_SYNC,
                payload = payload,
            ),
        )
    }
}
