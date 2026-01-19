package com.chainlesschain.android.core.p2p.sync

import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

/**
 * ConflictResolver单元测试
 */
class ConflictResolverTest {

    private lateinit var conflictResolver: ConflictResolver

    @Before
    fun setup() {
        conflictResolver = ConflictResolver()
    }

    @Test
    fun `test Last-Write-Wins strategy - remote newer`() {
        // Given
        val localItem = createSyncItem(
            resourceId = "item1",
            timestamp = 1000L,
            data = "local data"
        )
        val remoteItem = createSyncItem(
            resourceId = "item1",
            timestamp = 2000L,
            data = "remote data"
        )

        val conflict = SyncConflict(
            resourceId = "item1",
            localItem = localItem,
            remoteItem = remoteItem,
            strategy = ConflictStrategy.LAST_WRITE_WINS
        )

        // When
        val resolution = conflictResolver.resolve(conflict)

        // Then
        assertEquals(ConflictStrategy.LAST_WRITE_WINS, resolution.strategy)
        assertEquals(remoteItem, resolution.resolvedItem)
        assertEquals("remote data", resolution.resolvedItem.data)
        assertFalse(resolution.requiresUserIntervention)
    }

    @Test
    fun `test Last-Write-Wins strategy - local newer`() {
        // Given
        val localItem = createSyncItem(
            resourceId = "item1",
            timestamp = 3000L,
            data = "local data"
        )
        val remoteItem = createSyncItem(
            resourceId = "item1",
            timestamp = 2000L,
            data = "remote data"
        )

        val conflict = SyncConflict(
            resourceId = "item1",
            localItem = localItem,
            remoteItem = remoteItem,
            strategy = ConflictStrategy.LAST_WRITE_WINS
        )

        // When
        val resolution = conflictResolver.resolve(conflict)

        // Then
        assertEquals(localItem, resolution.resolvedItem)
        assertEquals("local data", resolution.resolvedItem.data)
    }

    @Test
    fun `test First-Write-Wins strategy`() {
        // Given
        val localItem = createSyncItem(
            resourceId = "item1",
            timestamp = 1000L,
            data = "local data"
        )
        val remoteItem = createSyncItem(
            resourceId = "item1",
            timestamp = 2000L,
            data = "remote data"
        )

        val conflict = SyncConflict(
            resourceId = "item1",
            localItem = localItem,
            remoteItem = remoteItem,
            strategy = ConflictStrategy.FIRST_WRITE_WINS
        )

        // When
        val resolution = conflictResolver.resolve(conflict)

        // Then
        assertEquals(ConflictStrategy.FIRST_WRITE_WINS, resolution.strategy)
        assertEquals(localItem, resolution.resolvedItem)
        assertEquals("local data", resolution.resolvedItem.data)
    }

    @Test
    fun `test Manual strategy`() {
        // Given
        val localItem = createSyncItem(resourceId = "item1")
        val remoteItem = createSyncItem(resourceId = "item1")

        val conflict = SyncConflict(
            resourceId = "item1",
            localItem = localItem,
            remoteItem = remoteItem,
            strategy = ConflictStrategy.MANUAL
        )

        // When
        val resolution = conflictResolver.resolve(conflict)

        // Then
        assertEquals(ConflictStrategy.MANUAL, resolution.strategy)
        assertTrue(resolution.requiresUserIntervention)
        assertEquals(localItem, resolution.resolvedItem) // Keeps local temporarily
    }

    @Test
    fun `test Custom strategy for SETTING resource`() {
        // Given
        val localItem = createSyncItem(
            resourceId = "setting1",
            resourceType = ResourceType.SETTING,
            data = "local setting"
        )
        val remoteItem = createSyncItem(
            resourceId = "setting1",
            resourceType = ResourceType.SETTING,
            data = "remote setting"
        )

        val conflict = SyncConflict(
            resourceId = "setting1",
            localItem = localItem,
            remoteItem = remoteItem,
            strategy = ConflictStrategy.CUSTOM
        )

        // When
        val resolution = conflictResolver.resolve(conflict)

        // Then
        assertEquals(ConflictStrategy.CUSTOM, resolution.strategy)
        assertEquals(localItem, resolution.resolvedItem) // Settings are device-specific
        assertTrue(resolution.description.contains("device-specific"))
    }

    @Test
    fun `test detectConflict - no local item`() {
        // Given
        val remoteItem = createSyncItem(resourceId = "item1")

        // When
        val conflict = conflictResolver.detectConflict(null, remoteItem)

        // Then
        assertNull(conflict) // No conflict if local doesn't exist
    }

    @Test
    fun `test detectConflict - same version and timestamp`() {
        // Given
        val localItem = createSyncItem(
            resourceId = "item1",
            timestamp = 1000L,
            version = 1
        )
        val remoteItem = createSyncItem(
            resourceId = "item1",
            timestamp = 1000L,
            version = 1
        )

        // When
        val conflict = conflictResolver.detectConflict(localItem, remoteItem)

        // Then
        assertNull(conflict) // No conflict if version and timestamp match
    }

    @Test
    fun `test detectConflict - same data`() {
        // Given
        val localItem = createSyncItem(
            resourceId = "item1",
            data = "same data",
            timestamp = 1000L
        )
        val remoteItem = createSyncItem(
            resourceId = "item1",
            data = "same data",
            timestamp = 2000L
        )

        // When
        val conflict = conflictResolver.detectConflict(localItem, remoteItem)

        // Then
        assertNull(conflict) // No conflict if data is the same
    }

    @Test
    fun `test detectConflict - remote DELETE operation`() {
        // Given
        val localItem = createSyncItem(resourceId = "item1")
        val remoteItem = createSyncItem(
            resourceId = "item1",
            operation = SyncOperation.DELETE
        )

        // When
        val conflict = conflictResolver.detectConflict(localItem, remoteItem)

        // Then
        assertNull(conflict) // DELETE operations don't cause conflicts
    }

    @Test
    fun `test detectConflict - actual conflict`() {
        // Given
        val localItem = createSyncItem(
            resourceId = "item1",
            data = "local data",
            timestamp = 1000L
        )
        val remoteItem = createSyncItem(
            resourceId = "item1",
            data = "remote data",
            timestamp = 2000L
        )

        // When
        val conflict = conflictResolver.detectConflict(localItem, remoteItem)

        // Then
        assertNotNull(conflict)
        assertEquals("item1", conflict!!.resourceId)
        assertEquals(localItem, conflict.localItem)
        assertEquals(remoteItem, conflict.remoteItem)
    }

    @Test
    fun `test getDefaultStrategy for different resource types`() {
        // When & Then
        assertEquals(
            ConflictStrategy.LAST_WRITE_WINS,
            conflictResolver.getDefaultStrategy(ResourceType.KNOWLEDGE_ITEM)
        )
        assertEquals(
            ConflictStrategy.CUSTOM,
            conflictResolver.getDefaultStrategy(ResourceType.CONVERSATION)
        )
        assertEquals(
            ConflictStrategy.LAST_WRITE_WINS,
            conflictResolver.getDefaultStrategy(ResourceType.MESSAGE)
        )
        assertEquals(
            ConflictStrategy.CUSTOM,
            conflictResolver.getDefaultStrategy(ResourceType.CONTACT)
        )
        assertEquals(
            ConflictStrategy.CUSTOM,
            conflictResolver.getDefaultStrategy(ResourceType.SETTING)
        )
    }

    @Test
    fun `test resolution contains proper metadata`() {
        // Given
        val localItem = createSyncItem(resourceId = "item1", timestamp = 1000L)
        val remoteItem = createSyncItem(resourceId = "item1", timestamp = 2000L)
        val conflict = SyncConflict(
            resourceId = "item1",
            localItem = localItem,
            remoteItem = remoteItem,
            strategy = ConflictStrategy.LAST_WRITE_WINS
        )

        // When
        val resolution = conflictResolver.resolve(conflict)

        // Then
        assertNotNull(resolution.description)
        assertTrue(resolution.description.isNotEmpty())
        assertEquals(localItem, resolution.localItem)
        assertEquals(remoteItem, resolution.remoteItem)
        assertTrue(resolution.resolvedAt > 0)
    }

    // Helper function
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
}
