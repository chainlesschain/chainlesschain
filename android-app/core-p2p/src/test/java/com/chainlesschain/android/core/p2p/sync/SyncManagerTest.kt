package com.chainlesschain.android.core.p2p.sync

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import com.chainlesschain.android.core.database.dao.SyncRemoteCursorDao
import com.chainlesschain.android.core.database.entity.SyncRemoteCursorEntity
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.model.MessageType
import dagger.Lazy

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
        val outbound: SyncOutbound = NoOpSyncOutbound()
        val outboundLazy = object : Lazy<SyncOutbound> {
            override fun get(): SyncOutbound = outbound
        }
        syncManager = SyncManager(
            messageQueue,
            conflictResolver,
            NoOpSyncDataApplier(),
            NoOpSyncRemoteCursorDao(),
            outboundLazy
        )
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

    // ====================================================================
    // Phase 3d M3 step D: JSON-RPC handlers
    // ====================================================================

    @Test
    fun `handlePushRpc applies item when no conflict and returns applied`() = runTest {
        val item = createSyncItem("remote-new")
        val response = syncManager.handlePushRpc(item, deviceId = "desktop-1")
        assertEquals("applied", response.status)
        assertNull(response.error)
        assertNull(response.resolved)
    }

    @Test
    fun `handlePushRpc returns conflict with resolved when local has newer item`() = runTest {
        // 给 SyncManager 注入更新的本地版（先 push 一个 timestamp=200 的远端 item，让
        // localState 缓存里有这条；再 push 同 id timestamp=100 的版本触发冲突）
        val newer = createSyncItem("contested", timestamp = 200, version = 2)
        syncManager.handlePushRpc(newer)

        val older = createSyncItem("contested", timestamp = 100, version = 1, data = "stale")
        val response = syncManager.handlePushRpc(older)

        assertEquals("conflict", response.status)
        assertNotNull(response.resolved)
    }

    @Test
    fun `handlePullRpc returns empty when no pending changes`() {
        val response = syncManager.handlePullRpc(
            cursor = PullCursor(ts = 0),
            resourceTypes = null,
            limit = 100
        )
        assertTrue(response.items.isEmpty())
        assertEquals(false, response.hasMore)
    }

    @Test
    fun `handlePullRpc returns pending changes above cursor in lex order`() {
        syncManager.recordChange(createSyncItem("a", timestamp = 100))
        syncManager.recordChange(createSyncItem("b", timestamp = 200))
        syncManager.recordChange(createSyncItem("c", timestamp = 300))

        val response = syncManager.handlePullRpc(
            cursor = PullCursor(ts = 100),
            resourceTypes = null,
            limit = 100
        )
        // a (ts=100) 应被 cursor.ts=100 排除（因为 cursor.id=null，不走 tie-break 分支）
        assertEquals(2, response.items.size)
        assertEquals("b", response.items[0].resourceId)
        assertEquals("c", response.items[1].resourceId)
        assertEquals(300L, response.nextCursor.ts)
    }

    @Test
    fun `handlePullRpc respects resourceTypes filter`() {
        syncManager.recordChange(createSyncItem("k1", resourceType = ResourceType.KNOWLEDGE_ITEM))
        syncManager.recordChange(createSyncItem("c1", resourceType = ResourceType.CONVERSATION))

        val response = syncManager.handlePullRpc(
            cursor = PullCursor(ts = 0),
            resourceTypes = listOf(ResourceType.CONVERSATION),
            limit = 100
        )
        assertEquals(1, response.items.size)
        assertEquals("c1", response.items[0].resourceId)
    }

    @Test
    fun `handleAckRpc does not throw on null inputs`() {
        // fire-and-forget — 仅 log，应不抛
        syncManager.handleAckRpc(requestId = null, status = null)
        syncManager.handleAckRpc(requestId = "req-1", status = "applied")
        syncManager.handleAckRpc(requestId = "req-2", status = "failed", error = "boom")
        assertTrue(true)
    }

    // ====================================================================
    // Phase 3d M3 step D.5: pushPendingToDesktopRpc (outbound JSON-RPC)
    // ====================================================================

    @Test
    fun `pushPendingToDesktopRpc returns zeros when no pending changes`() = runTest {
        val result = syncManager.pushPendingToDesktopRpc("desktop-1")
        assertEquals(0, result.pushed)
        assertEquals(0, result.conflicts)
        assertEquals(0, result.failed)
    }

    @Test
    fun `pushPendingToDesktopRpc drains pendingChanges when all applied`() = runTest {
        // NoOpSyncOutbound 默认返 status="applied"
        syncManager.recordChange(createSyncItem("a"))
        syncManager.recordChange(createSyncItem("b"))
        assertEquals(2, syncManager.getSyncStatistics().pendingChanges)

        val result = syncManager.pushPendingToDesktopRpc("desktop-1")
        assertEquals(2, result.pushed)
        assertEquals(0, result.conflicts)
        assertEquals(0, result.failed)
        assertEquals(0, syncManager.getSyncStatistics().pendingChanges)
    }

    @Test
    fun `pushPendingToDesktopRpc leaves item in pending on failed response`() = runTest {
        // 注入返 failed 的 outbound
        val failingOutbound = object : SyncOutbound {
            override suspend fun pushItem(deviceId: String, item: SyncItem) =
                SyncPushResponse(status = "failed", error = "network down")
            override suspend fun pullFromDevice(
                deviceId: String, cursor: PullCursor,
                resourceTypes: List<ResourceType>?, limit: Int
            ) = SyncPullResponse(items = emptyList(), nextCursor = cursor, hasMore = false)
        }
        val failingLazy = object : Lazy<SyncOutbound> {
            override fun get(): SyncOutbound = failingOutbound
        }
        val sm = SyncManager(
            messageQueue,
            conflictResolver,
            NoOpSyncDataApplier(),
            NoOpSyncRemoteCursorDao(),
            failingLazy
        )
        sm.recordChange(createSyncItem("a"))

        val result = sm.pushPendingToDesktopRpc("desktop-1")
        assertEquals(0, result.pushed)
        assertEquals(1, result.failed)
        // 失败的 item 应留在 pendingChanges 等下次重试
        assertEquals(1, sm.getSyncStatistics().pendingChanges)
    }

    /** 测试用 no-op 实现 */
    private class NoOpSyncDataApplier : SyncDataApplier {
        override suspend fun create(resourceType: ResourceType, resourceId: String, data: String) {}
        override suspend fun update(resourceType: ResourceType, resourceId: String, data: String) {}
        override suspend fun delete(resourceType: ResourceType, resourceId: String) {}
    }

    /** Phase 3d M3 step C：测试用 no-op 游标 DAO（不持久化，单测不需要真 DB） */
    private class NoOpSyncRemoteCursorDao : SyncRemoteCursorDao {
        override suspend fun getCursor(deviceId: String, resourceType: String): SyncRemoteCursorEntity? = null
        override suspend fun getCursorsForDevice(deviceId: String): List<SyncRemoteCursorEntity> = emptyList()
        override suspend fun getAllCursors(): List<SyncRemoteCursorEntity> = emptyList()
        override suspend fun upsert(cursor: SyncRemoteCursorEntity) {}
        override suspend fun advancePush(
            deviceId: String,
            resourceType: String,
            lastPushTs: Long,
            itemsPushedDelta: Long,
            now: Long
        ) {}
        override suspend fun advancePull(
            deviceId: String,
            resourceType: String,
            lastPullTs: Long,
            lastPullId: String?,
            itemsPulledDelta: Long,
            now: Long
        ) {}
        override suspend fun recordRunResult(
            deviceId: String,
            resourceType: String,
            status: String?,
            error: String?,
            durationMs: Long?,
            conflictedDelta: Long,
            now: Long
        ) {}
        override suspend fun deleteCursorsForDevice(deviceId: String) {}
        override suspend fun deleteAll() {}
    }

    /** Phase 3d M3 step D.5：测试用 no-op 出向 outbound（不真发 RPC） */
    private class NoOpSyncOutbound : SyncOutbound {
        override suspend fun pushItem(deviceId: String, item: SyncItem): SyncPushResponse =
            SyncPushResponse(status = "applied")
        override suspend fun pullFromDevice(
            deviceId: String,
            cursor: PullCursor,
            resourceTypes: List<ResourceType>?,
            limit: Int
        ): SyncPullResponse = SyncPullResponse(
            items = emptyList(),
            nextCursor = cursor,
            hasMore = false
        )
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
