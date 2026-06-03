package com.chainlesschain.android.sync

import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.feature.p2p.sync.SocialSyncWalker
import com.chainlesschain.android.feature.project.sync.ProjectSyncWalker
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for CompositeSyncRepositoryWalker (#21 P2/P3).
 *
 * Verifies the merge + sort + limit-clamp behavior. The two sub-walkers
 * (SocialSyncWalker, ProjectSyncWalker) are mocked — their own internals
 * are tested in their respective feature modules.
 */
class CompositeSyncRepositoryWalkerTest {

    private lateinit var social: SocialSyncWalker
    private lateinit var project: ProjectSyncWalker
    private lateinit var composite: CompositeSyncRepositoryWalker

    @Before
    fun setUp() {
        social = mockk(relaxed = true)
        project = mockk(relaxed = true)
        composite = CompositeSyncRepositoryWalker(social, project)
    }

    private fun item(
        type: ResourceType,
        id: String,
        ts: Long,
        op: SyncOperation = SyncOperation.UPDATE,
    ): SyncItem = SyncItem(
        resourceType = type,
        resourceId = id,
        operation = op,
        timestamp = ts,
        data = "{}",
        version = 1,
    )

    @Test
    fun `enumerate returns empty when both walkers empty`() = runTest {
        coEvery { social.enumerate(any(), any(), any()) } returns emptyList()
        coEvery { project.enumerate(any(), any(), any()) } returns emptyList()
        val items = composite.enumerate(PullCursor(0L, null), null, 50)
        assertTrue(items.isEmpty())
    }

    @Test
    fun `enumerate merges social + project items sorted by timestamp`() = runTest {
        coEvery { social.enumerate(any(), any(), any()) } returns listOf(
            item(ResourceType.FRIEND, "f1", ts = 100L),
            item(ResourceType.POST, "p1", ts = 300L),
        )
        coEvery { project.enumerate(any(), any(), any()) } returns listOf(
            item(ResourceType.PROJECT, "proj1", ts = 200L),
        )
        val items = composite.enumerate(PullCursor(0L, null), null, 50)
        assertEquals(3, items.size)
        // Should be sorted by timestamp asc: 100, 200, 300
        assertEquals(100L, items[0].timestamp)
        assertEquals(200L, items[1].timestamp)
        assertEquals(300L, items[2].timestamp)
        assertEquals(ResourceType.PROJECT, items[1].resourceType)
    }

    @Test
    fun `enumerate respects global limit by taking earliest after sort`() = runTest {
        coEvery { social.enumerate(any(), any(), any()) } returns listOf(
            item(ResourceType.FRIEND, "f1", ts = 50L),
            item(ResourceType.FRIEND, "f2", ts = 250L),
            item(ResourceType.FRIEND, "f3", ts = 400L),
        )
        coEvery { project.enumerate(any(), any(), any()) } returns listOf(
            item(ResourceType.PROJECT, "p1", ts = 100L),
            item(ResourceType.PROJECT, "p2", ts = 300L),
        )
        val items = composite.enumerate(PullCursor(0L, null), null, 3)
        assertEquals(3, items.size)
        // Earliest 3 by timestamp: 50, 100, 250
        assertEquals(listOf(50L, 100L, 250L), items.map { it.timestamp })
    }

    @Test
    fun `enumerate ties broken by resourceId asc`() = runTest {
        coEvery { social.enumerate(any(), any(), any()) } returns listOf(
            item(ResourceType.FRIEND, "z-id", ts = 100L),
        )
        coEvery { project.enumerate(any(), any(), any()) } returns listOf(
            item(ResourceType.PROJECT, "a-id", ts = 100L),
        )
        val items = composite.enumerate(PullCursor(0L, null), null, 50)
        assertEquals(2, items.size)
        assertEquals("a-id", items[0].resourceId)
        assertEquals("z-id", items[1].resourceId)
    }

    @Test
    fun `enumerate clamps limit to 1-500 range`() = runTest {
        coEvery { social.enumerate(any(), any(), any()) } returns emptyList()
        coEvery { project.enumerate(any(), any(), any()) } returns emptyList()

        // Out-of-range limits both clamp; we just verify no exception
        val high = composite.enumerate(PullCursor(0L, null), null, 9999)
        assertTrue(high.isEmpty())

        val low = composite.enumerate(PullCursor(0L, null), null, 0)
        assertTrue(low.isEmpty())
    }

    @Test
    fun `enumerate forwards cursor + resourceTypes filter to both walkers`() = runTest {
        coEvery { social.enumerate(any(), any(), any()) } returns emptyList()
        coEvery { project.enumerate(any(), any(), any()) } returns emptyList()

        val cursor = PullCursor(ts = 500L, id = "x")
        val filter = listOf(ResourceType.PROJECT)
        composite.enumerate(cursor, filter, 25)

        io.mockk.coVerify { social.enumerate(cursor, filter, 25) }
        io.mockk.coVerify { project.enumerate(cursor, filter, 25) }
    }

    @Test
    fun `enumerate works when only one sub-walker returns items`() = runTest {
        coEvery { social.enumerate(any(), any(), any()) } returns emptyList()
        coEvery { project.enumerate(any(), any(), any()) } returns listOf(
            item(ResourceType.PROJECT, "p1", ts = 100L),
            item(ResourceType.PROJECT, "p2", ts = 200L),
        )
        val items = composite.enumerate(PullCursor(0L, null), null, 50)
        assertEquals(2, items.size)
        assertTrue(items.all { it.resourceType == ResourceType.PROJECT })
    }
}
