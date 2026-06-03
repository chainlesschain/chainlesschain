package com.chainlesschain.android.feature.familyguard.boot

import com.chainlesschain.android.feature.familyguard.domain.emergency.UpstreamFreezer
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindStateMachine
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals

/**
 * FAMILY-19 验收: StartupReconciler 调用链 + 异常路径.
 *
 * pure mock 测试 (无 Robolectric / 无 Room), 验:
 *   - reconcileExpired 计数正确返回到 ReconcileReport
 *   - reconcileExpired 抛异常时不传染, 返 0 + 仍然完成 report
 *   - timestampMs 走 clock
 */
class StartupReconcilerTest {

    private val unbindStateMachine: UnbindStateMachine = mockk()
    private val relRepo: FamilyRelationshipRepository = mockk()
    private val freezer: UpstreamFreezer = mockk(relaxed = true)
    private val clock: Clock = Clock.fixed(
        Instant.ofEpochMilli(FamilyFixtures.FIXTURE_TIME_MS),
        ZoneOffset.UTC,
    )

    private val reconciler = StartupReconciler(
        unbindStateMachine = unbindStateMachine,
        familyRelationshipRepository = relRepo,
        upstreamFreezer = freezer,
        clock = clock,
    )

    @Test
    fun `reconcile delegates reconcileExpired count to report`() = runTest {
        coEvery { unbindStateMachine.reconcileExpired() } returns 3
        coEvery { relRepo.observeAllActive() } returns flowOf(emptyList())

        val report = reconciler.reconcile()

        assertEquals(3, report.unbindFinalized)
        assertEquals(FamilyFixtures.FIXTURE_TIME_MS, report.timestampMs)
        coVerify(exactly = 1) { unbindStateMachine.reconcileExpired() }
    }

    @Test
    fun `reconcile zero when no expired pending`() = runTest {
        coEvery { unbindStateMachine.reconcileExpired() } returns 0
        coEvery { relRepo.observeAllActive() } returns flowOf(emptyList())

        val report = reconciler.reconcile()
        assertEquals(0, report.unbindFinalized)
    }

    @Test
    fun `reconcile catches reconcileExpired exception and continues`() = runTest {
        coEvery { unbindStateMachine.reconcileExpired() } throws RuntimeException("DB error")
        coEvery { relRepo.observeAllActive() } returns flowOf(emptyList())

        val report = reconciler.reconcile()
        // unbindFinalized 走 default 0; 不传染整体异常
        assertEquals(0, report.unbindFinalized)
        assertEquals(FamilyFixtures.FIXTURE_TIME_MS, report.timestampMs)
    }

    @Test
    fun `reconcile catches observeAllActive exception and continues`() = runTest {
        coEvery { unbindStateMachine.reconcileExpired() } returns 2
        coEvery { relRepo.observeAllActive() } throws RuntimeException("Flow error")

        val report = reconciler.reconcile()
        // unbindFinalized 仍记 2; relationships 失败时 freezeRestored 走 0 default
        assertEquals(2, report.unbindFinalized)
        assertEquals(0, report.freezeRestored)
    }

    @Test
    fun `reconcile report contains all three counters`() = runTest {
        coEvery { unbindStateMachine.reconcileExpired() } returns 5
        coEvery { relRepo.observeAllActive() } returns flowOf(emptyList())

        val report = reconciler.reconcile()
        // v0.1 freezeRestored + emergencyExpired 都 0 (实装留 FAMILY-XX)
        assertEquals(5, report.unbindFinalized)
        assertEquals(0, report.freezeRestored)
        assertEquals(0, report.emergencyExpired)
    }
}
