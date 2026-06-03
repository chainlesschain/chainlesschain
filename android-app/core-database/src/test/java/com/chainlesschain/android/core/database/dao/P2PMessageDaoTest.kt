package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.MessageSendStatus
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * P2PMessageDao Unit Tests - E2EE Encrypted Messaging
 *
 * Tests: CRUD, delivery receipts, unread count, message status tracking
 * Target: 13 tests, 90% coverage
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class P2PMessageDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var p2pMessageDao: P2PMessageDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, ChainlessChainDatabase::class.java)
            .allowMainThreadQueries().build()
        p2pMessageDao = database.p2pMessageDao()
    }

    @After
    fun tearDown() = database.close()

    @Test
    fun `insert and retrieve P2P message`() = runTest {
        val msg = createTestMessage(id = "msg-1", peerId = "peer-A", content = "Hello")
        p2pMessageDao.insertMessage(msg)
        val retrieved = p2pMessageDao.getMessageById("msg-1")
        assertEquals("Hello", retrieved?.content)
    }

    @Test
    fun `getRecentMessages returns messages ordered by timestamp DESC`() = runTest {
        val now = System.currentTimeMillis()
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", timestamp = now - 3000),
            createTestMessage(id = "msg-2", timestamp = now - 1000),
            createTestMessage(id = "msg-3", timestamp = now - 2000)
        ))
        val recent = p2pMessageDao.getRecentMessages("peer-A", limit = 10)
        assertEquals("msg-2", recent[0].id) // Most recent first
    }

    @Test
    fun `getUnreadCount returns count of unacknowledged incoming messages`() = runTest {
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", isOutgoing = false, isAcknowledged = false),
            createTestMessage(id = "msg-2", isOutgoing = false, isAcknowledged = true),
            createTestMessage(id = "msg-3", isOutgoing = true, isAcknowledged = false)
        ))
        p2pMessageDao.getUnreadCount("peer-A").test {
            assertEquals(1, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `markAsDelivered updates message status`() = runTest {
        val msg = createTestMessage(id = "msg-1", sendStatus = MessageSendStatus.SENT)
        p2pMessageDao.insertMessage(msg)
        p2pMessageDao.updateSendStatus("msg-1", MessageSendStatus.DELIVERED)
        val updated = p2pMessageDao.getMessageById("msg-1")
        assertEquals(MessageSendStatus.DELIVERED, updated?.sendStatus)
    }

    @Test
    fun `getPendingMessages returns only undelivered outgoing messages`() = runTest {
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", isOutgoing = true, sendStatus = MessageSendStatus.PENDING),
            createTestMessage(id = "msg-2", isOutgoing = true, sendStatus = MessageSendStatus.DELIVERED),
            createTestMessage(id = "msg-3", isOutgoing = false, sendStatus = MessageSendStatus.PENDING)
        ))
        val pending = p2pMessageDao.getPendingMessages("peer-A")
        assertEquals(1, pending.size)
        assertEquals("msg-1", pending[0].id)
    }

    @Test
    fun `searchMessages filters by content`() = runTest {
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", content = "Hello world"),
            createTestMessage(id = "msg-2", content = "Goodbye"),
            createTestMessage(id = "msg-3", content = "Hello again")
        ))
        val results = p2pMessageDao.searchMessages("peer-A", "Hello")
        assertEquals(2, results.size)
    }

    @Test
    fun `markAllAsRead updates all unacknowledged incoming messages`() = runTest {
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", isOutgoing = false, isAcknowledged = false),
            createTestMessage(id = "msg-2", isOutgoing = false, isAcknowledged = false)
        ))
        p2pMessageDao.markAllAsRead("peer-A")
        val unread = p2pMessageDao.getUnreadCount("peer-A")
        unread.test {
            assertEquals(0, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `deleteMessagesByPeer removes all messages for peer`() = runTest {
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", peerId = "peer-A"),
            createTestMessage(id = "msg-2", peerId = "peer-B")
        ))
        p2pMessageDao.deleteMessagesByPeer("peer-A")
        val remaining = p2pMessageDao.getRecentMessages("peer-A", 10)
        assertTrue(remaining.isEmpty())
    }

    @Test
    fun `messages are ordered by timestamp ASC in conversation view`() = runTest {
        val now = System.currentTimeMillis()
        p2pMessageDao.insertMessages((1..5).map {
            createTestMessage(id = "msg-$it", timestamp = now + it * 1000)
        })
        p2pMessageDao.getMessagesByPeer("peer-A").test {
            val messages = awaitItem()
            assertEquals(5, messages.size)
            assertEquals("msg-1", messages[0].id) // Earliest first
            assertEquals("msg-5", messages[4].id) // Latest last
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `markAsAcknowledged marks message as read and delivered`() = runTest {
        val msg = createTestMessage(id = "msg-1", isAcknowledged = false, sendStatus = MessageSendStatus.SENT)
        p2pMessageDao.insertMessage(msg)
        p2pMessageDao.markAsAcknowledged("msg-1")
        val updated = p2pMessageDao.getMessageById("msg-1")
        assertTrue(updated?.isAcknowledged == true)
        assertEquals(MessageSendStatus.DELIVERED, updated?.sendStatus)
    }

    @Test
    fun `batch insert 100+ messages performs well`() = runTest {
        val messages = (1..100).map { createTestMessage(id = "msg-$it") }
        p2pMessageDao.insertMessages(messages)
        val count = p2pMessageDao.getRecentMessages("peer-A", 200).size
        assertEquals(100, count)
    }

    @Test
    fun `getLastMessagePerPeer returns most recent message per peer`() = runTest {
        val now = System.currentTimeMillis()
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", peerId = "peer-A", timestamp = now - 2000),
            createTestMessage(id = "msg-2", peerId = "peer-A", timestamp = now - 1000),
            createTestMessage(id = "msg-3", peerId = "peer-B", timestamp = now - 500)
        ))
        p2pMessageDao.getLastMessagePerPeer().test {
            val lastMessages = awaitItem()
            assertEquals(2, lastMessages.size)
            assertEquals("msg-3", lastMessages[0].id) // peer-B most recent overall
            assertEquals("msg-2", lastMessages[1].id) // peer-A most recent for that peer
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `deleteOldMessages keeps only most recent messages`() = runTest {
        val now = System.currentTimeMillis()
        // Insert 5 messages with different timestamps
        p2pMessageDao.insertMessages(listOf(
            createTestMessage(id = "msg-1", peerId = "peer-A", timestamp = now - 5000),
            createTestMessage(id = "msg-2", peerId = "peer-A", timestamp = now - 4000),
            createTestMessage(id = "msg-3", peerId = "peer-A", timestamp = now - 3000),
            createTestMessage(id = "msg-4", peerId = "peer-A", timestamp = now - 2000),
            createTestMessage(id = "msg-5", peerId = "peer-A", timestamp = now - 1000)
        ))

        // When: Keep only 2 most recent messages
        p2pMessageDao.deleteOldMessages("peer-A", keepCount = 2)
        val remaining = p2pMessageDao.getRecentMessages("peer-A", 10)

        // Then: Only 2 most recent remain (msg-4 and msg-5)
        assertEquals(2, remaining.size)
        assertTrue(remaining.any { it.id == "msg-4" })
        assertTrue(remaining.any { it.id == "msg-5" })
    }

    private fun createTestMessage(
        id: String = "msg-${System.currentTimeMillis()}",
        peerId: String = "peer-A",
        fromDeviceId: String = "device-1",
        toDeviceId: String = "device-2",
        type: String = "TEXT",
        content: String = "Test message",
        timestamp: Long = System.currentTimeMillis(),
        isOutgoing: Boolean = true,
        isAcknowledged: Boolean = false,
        sendStatus: String = MessageSendStatus.PENDING
    ) = P2PMessageEntity(
        id, peerId, fromDeviceId, toDeviceId, type, content, null,
        timestamp, isOutgoing, true, isAcknowledged, sendStatus
    )
}
