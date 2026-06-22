package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

/**
 * §8.3 P2P messenger 适配器测试:incoming 直通 receivedMessages、send 构造正确的 P2PMessage
 * (from=本机 / to=对端 / type=KNOWLEDGE_SYNC / payload 原样)转发给 connectionManager。
 * 薄转发 → mockk 验证。
 */
class P2PConnectionMessengerTest {

    @Test
    fun incoming_delegates_to_received_messages() {
        val flow = MutableSharedFlow<P2PMessage>()
        val cm = mockk<P2PConnectionManager>(relaxed = true)
        every { cm.receivedMessages } returns flow
        val messenger = P2PConnectionMessenger(cm) { "did:me" }
        assertSame(flow, messenger.incoming) // 直通
    }

    @Test
    fun send_builds_and_forwards_a_p2p_message() = runTest {
        val cm = mockk<P2PConnectionManager>(relaxed = true)
        val msgSlot = slot<P2PMessage>()
        coVerify(exactly = 0) { cm.sendMessage(any(), any()) }

        P2PConnectionMessenger(cm) { "did:me" }.send("did:peer", "envelope-payload")

        coVerify(exactly = 1) { cm.sendMessage("did:peer", capture(msgSlot)) }
        val m = msgSlot.captured
        assertEquals("did:me", m.fromDeviceId)
        assertEquals("did:peer", m.toDeviceId)
        assertEquals(MessageType.KNOWLEDGE_SYNC, m.type)
        assertEquals("envelope-payload", m.payload)
    }
}
