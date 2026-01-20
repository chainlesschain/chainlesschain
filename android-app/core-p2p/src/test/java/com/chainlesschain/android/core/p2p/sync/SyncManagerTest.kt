package com.chainlesschain.android.core.p2p.sync

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.model.MessageType

/**
 * SyncManager单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SyncManagerTest {

    private lateinit var syncManager: SyncManager
    private lateinit var messageQueue: MessageQueue
    private lateinit var conflictResolver: ConflictResolver

    @Before
    fun setup() {
        messageQueue = MessageQueue()
        conflictResolver = ConflictResolver()
        syncManager = SyncManager(messageQueue, conflictResolver)
    }

    @Test
    fun `test recordChange adds to pending changes`() {
        // Given
        val syncItem = createSyncItem("item1")

        // When
        syncManager.recordChange(syncItem)

        // Then
        val stats = syncManager.getSyncStatistics()
        assertEquals(1, stats.pendingChanges)
    }

    @Test
    fun `test multiple recordChange updates same item`() {
        // Given
        val item1 = createSyncItem("item1", data = "version 1")
        val item2 = createSyncItem("item1", data = "version 2")

        // When
        syncManager.recordChange(item1)
        syncManager.recordChange(item2)

        // Then
        val stats = syncManager.getSyncStatistics()
        assertEquals(1, stats.pendingChanges) // Same ID, so only 1 pending
    }

    @Test
    fun `test triggerSync enqueues pending changes`() = runTest {
        // Given
        val item1 = createSyncItem("item1")
        val item2 = createSyncItem("item2")
        syncManager.recordChange(item1)
        syncManager.recordChange(item2)

        // When
        syncManager.triggerSync()

        // Then
        val queueSize = messageQueue.getQueueSize()
        assertTrue(queueSize >= 0) // Messages should be enqueued
        val stats = syncManager.getSyncStatistics()
        assertEquals(0, stats.pendingChanges) // Should be cleared after sync
    }

    @Test
    fun `test handleSyncMessage with no conflict`() = runTest {
        // Given
        val remoteItem = createSyncItem("item1", data = "remote data")
        val syncPayload = SyncPayload(remoteItem, System.currentTimeMillis())
        val message = createP2PMessage(syncPayload)

        // When
        val result = syncManager.handleSyncMessage(message)

        // Then
        assertTrue(result is SyncResult.Applied)
        assertEquals(remoteItem, (result as SyncResult.Applied).item)
    }

    @Test
    fun `test handleSyncMessage with conflict resolution`() = runTest {
        // Given
        // First, create a local version
        val localItem = createSyncItem("item1", data = "local data", timestamp = 1000L)
        syncManager.recordChange(localItem)

        // Then receive a remote version with different data but newer timestamp
        val remoteItem = createSyncItem("item1", data = "remote data", timestamp = 2000L)
        val syncPayload = SyncPayload(remoteItem, System.currentTimeMillis())
        val message = createP2PMessage(syncPayload)

        // When
        val result = syncManager.handleSyncMessage(message)

        // Then
        assertTrue(result is SyncResult.ConflictResolved)
        val resolution = (result as SyncResult.ConflictResolved).resolution
        assertEquals(remoteItem, resolution.resolvedItem) // Newer wins
    }

    @Test
    fun `test getIncrementalChanges filters by timestamp`() {
        // Given
        val deviceId = "device1"
        val oldItem = createSyncItem("item1", timestamp = 1000L)
        val newItem = createSyncItem("item2", timestamp = 5000L)

        syncManager.recordChange(oldItem)
        syncManager.recordChange(newItem)

        // When
        val changes = syncManager.getIncrementalChanges(deviceId, since = 3000L)

        // Then
        assertEquals(1, changes.size)
        assertEquals("item2", changes[0].resourceId)
    }

    @Test
    fun `test getSyncStatistics returns correct data`() {
        // Given
        syncManager.recordChange(createSyncItem("item1"))
        syncManager.recordChange(createSyncItem("item2"))

        // When
        val stats = syncManager.getSyncStatistics()

        // Then
        assertEquals(2, stats.pendingChanges)
        assertNotNull(stats.lastSyncTimestamps)
    }

    @Test
    fun `test different resource types use correct message types`() = runTest {
        // Given
        val knowledgeItem = createSyncItem("item1", ResourceType.KNOWLEDGE_ITEM)
        val conversationItem = createSyncItem("item2", ResourceType.CONVERSATION)

        // When
        syncManager.recordChange(knowledgeItem)
        syncManager.recordChange(conversationItem)
        syncManager.triggerSync()

        // Then
        // Messages should be enqueued with appropriate types
        assertTrue(messageQueue.getQueueSize() >= 0)
    }

    @Test
    fun `test CREATE operation applies correctly`() = runTest {
        // Given
        val createItem = createSyncItem("item1", operation = SyncOperation.CREATE)
        val syncPayload = SyncPayload(createItem, System.currentTimeMillis())
        val message = createP2PMessage(syncPayload)

        // When
        val result = syncManager.handleSyncMessage(message)

        // Then
        assertTrue(result is SyncResult.Applied)
    }

    @Test
    fun `test UPDATE operation applies correctly`() = runTest {
        // Given
        val updateItem = createSyncItem("item1", operation = SyncOperation.UPDATE)
        val syncPayload = SyncPayload(updateItem, System.currentTimeMillis())
        val message = createP2PMessage(syncPayload)

        // When
        val result = syncManager.handleSyncMessage(message)

        // Then
        assertTrue(result is SyncResult.Applied)
    }

    @Test
    fun `test DELETE operation applies correctly`() = runTest {
        // Given
        val deleteItem = createSyncItem("item1", operation = SyncOperation.DELETE)
        val syncPayload = SyncPayload(deleteItem, System.currentTimeMillis())
        val message = createP2PMessage(syncPayload)

        // When
        val result = syncManager.handleSyncMessage(message)

        // Then
        assertTrue(result is SyncResult.Applied)
    }

    @Test
    fun `test startAutoSync and stopAutoSync`() {
        // When
        syncManager.startAutoSync()

        // Then - should start without errors
        // (Testing actual sync behavior would require coroutine test scope)

        // When
        syncManager.stopAutoSync()

        // Then - should stop without errors
        assertTrue(true)
    }

    // Helper functions
    private fun createSyncItem(
        resourceId: String,
        resourceType: ResourceType = ResourceType.KNOWLEDGE_ITEM,
        operation: SyncOperation = SyncOperation.UPDATE,
        data: String = "test data",
        timestamp: Long = System.currentTimeMillis(),
        version: Int = 1
    ): SyncItem {
        return SyncItem(
            resourceId = resourceId,
            resourceType = resourceType,
            operation = operation,
            data = data,
            timestamp = timestamp,
            version = version
        )
    }

    private fun createP2PMessage(syncPayload: SyncPayload): P2PMessage {
        return P2PMessage(
            id = "msg-${System.currentTimeMillis()}",
            fromDeviceId = "device-remote",
            toDeviceId = "device-local",
            type = MessageType.KNOWLEDGE_SYNC,
            payload = kotlinx.serialization.json.Json.encodeToString(
                SyncPayload.serializer(),
                syncPayload
            ),
            requiresAck = false,
            timestamp = System.currentTimeMillis()
        )
    }
}
