package com.chainlesschain.android.feature.familyguard.data.unbind

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindResult
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindStateMachine
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * FAMILY-15 验收: 5 happy + 3 边界 + reconcileExpired.
 * Room in-memory 真跑 SQL atomic state transitions; Clock fixed 让 cooldown
 * 边界硬测可重现。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class UnbindStateMachineImplTest {

    private lateinit var db: FamilyGuardDatabase
    private val baseClockMs = FamilyFixtures.FIXTURE_TIME_MS

    private fun clockAt(ms: Long): Clock =
        Clock.fixed(Instant.ofEpochMilli(ms), ZoneOffset.UTC)

    private fun service(clockMs: Long): UnbindStateMachineImpl =
        UnbindStateMachineImpl(db.familyRelationshipDao(), clockAt(clockMs))

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun tearDown() {
        db.close()
    }

    /** 插一个 active relationship, 返 id. */
    private suspend fun seedActive(): Long =
        db.familyRelationshipDao().insert(
            FamilyFixtures.fakeRelationship().copy(status = "active"),
        )

    // ─── Happy paths (5) ───

    @Test
    fun `happy 1 active to unbind_pending sets cooldown_until = now + 24h`(): Unit = runBlocking {
        val id = seedActive()
        val svc = service(baseClockMs)

        val result = svc.requestUnbind(id, requesterDid = "did:chain:dad")
        assertIs<UnbindResult.Success>(result)

        val rel = db.familyRelationshipDao().findById(id)
        assertNotNull(rel)
        assertEquals("unbind_pending", rel.status)
        assertEquals(baseClockMs, rel.unbindRequestAt)
        assertEquals(baseClockMs + UnbindStateMachine.COOLDOWN_MS, rel.unbindCooldownUntil)
        assertEquals("did:chain:dad", rel.unbindRequester)
    }

    @Test
    fun `happy 2 unbind_pending to active via cancelUnbind clears all unbind fields`(): Unit =
        runBlocking {
            val id = seedActive()
            val svc = service(baseClockMs)
            svc.requestUnbind(id, "did:chain:dad")

            // 任一方调 cancelUnbind
            assertIs<UnbindResult.Success>(svc.cancelUnbind(id))

            val rel = db.familyRelationshipDao().findById(id)
            assertEquals("active", rel?.status)
            assertNull(rel?.unbindRequestAt)
            assertNull(rel?.unbindCooldownUntil)
            assertNull(rel?.unbindRequester)
        }

    @Test
    fun `happy 3 finalizeUnbind after cooldown expired sets status=unbound`(): Unit = runBlocking {
        val id = seedActive()
        // 在 base 时刻 request
        service(baseClockMs).requestUnbind(id, "did:chain:dad")

        // 推 clock 到 25h (>24h cooldown)
        val laterMs = baseClockMs + UnbindStateMachine.COOLDOWN_MS + 60_000L
        val result = service(laterMs).finalizeUnbind(id)
        assertIs<UnbindResult.Success>(result)

        val rel = db.familyRelationshipDao().findById(id)
        assertEquals("unbound", rel?.status)
    }

    @Test
    fun `happy 4 forceFinalize after cooldown + 6h grace`(): Unit = runBlocking {
        val id = seedActive()
        service(baseClockMs).requestUnbind(id, "did:chain:dad")

        // cooldown_until + 6h + 1min
        val forceMs = baseClockMs + UnbindStateMachine.COOLDOWN_MS +
            UnbindStateMachine.FORCE_GRACE_MS + 60_000L
        val result = service(forceMs).forceFinalize(id, requesterDid = "did:chain:dad")
        assertIs<UnbindResult.Success>(result)

        assertEquals("unbound", db.familyRelationshipDao().findById(id)?.status)
    }

    @Test
    fun `happy 5 reconcileExpired finalizes all expired pending in one pass`(): Unit = runBlocking {
        // 3 个 pending: 1 在 base+1min request, 2 在 base+2min, 3 在 base+25h request
        val a = db.familyRelationshipDao().insert(
            FamilyFixtures.fakeRelationship().copy(status = "active", friendDid = "did:a"),
        )
        val b = db.familyRelationshipDao().insert(
            FamilyFixtures.fakeRelationship().copy(status = "active", friendDid = "did:b"),
        )
        val c = db.familyRelationshipDao().insert(
            FamilyFixtures.fakeRelationship().copy(status = "active", friendDid = "did:c"),
        )

        service(baseClockMs).requestUnbind(a, "did:dad")
        service(baseClockMs).requestUnbind(b, "did:dad")
        service(baseClockMs + UnbindStateMachine.COOLDOWN_MS + 60_000L).requestUnbind(c, "did:dad")

        // 时钟推到 base+25h: a/b 应过期, c 未过期 (因 c 是在 base+24.1h request, 加 24h = 48.1h)
        val laterMs = baseClockMs + UnbindStateMachine.COOLDOWN_MS + 60_000L
        val done = service(laterMs).reconcileExpired()
        assertEquals(2, done)

        assertEquals("unbound", db.familyRelationshipDao().findById(a)?.status)
        assertEquals("unbound", db.familyRelationshipDao().findById(b)?.status)
        assertEquals("unbind_pending", db.familyRelationshipDao().findById(c)?.status)
    }

    // ─── Edge cases (3) ───

    @Test
    fun `edge 1 double request returns AlreadyUnbinding with cooldown info`(): Unit = runBlocking {
        val id = seedActive()
        val svc = service(baseClockMs)
        assertIs<UnbindResult.Success>(svc.requestUnbind(id, "did:dad"))

        val second = svc.requestUnbind(id, "did:mom") // 第二人尝试也 request
        val already = assertIs<UnbindResult.AlreadyUnbinding>(second)
        assertEquals(baseClockMs + UnbindStateMachine.COOLDOWN_MS, already.cooldownUntilMs)
    }

    @Test
    fun `edge 2 double cancel is idempotent (race-safe)`(): Unit = runBlocking {
        val id = seedActive()
        val svc = service(baseClockMs)
        svc.requestUnbind(id, "did:dad")
        assertIs<UnbindResult.Success>(svc.cancelUnbind(id))

        // 第二次 cancel - 双方同时撤销 race; 应该 idempotent success (因 status 已 active)
        assertIs<UnbindResult.Success>(svc.cancelUnbind(id))
    }

    @Test
    fun `edge 3 finalize before cooldown returns TooEarly with cooldown info`(): Unit = runBlocking {
        val id = seedActive()
        service(baseClockMs).requestUnbind(id, "did:dad")

        // 在 cooldown 期间试图 finalize → TooEarly
        val midMs = baseClockMs + UnbindStateMachine.COOLDOWN_MS / 2
        val result = service(midMs).finalizeUnbind(id)
        val tooEarly = assertIs<UnbindResult.TooEarly>(result)
        assertEquals(baseClockMs + UnbindStateMachine.COOLDOWN_MS, tooEarly.cooldownUntilMs)
    }

    // ─── Additional negative paths ───

    @Test
    fun `requestUnbind on unbound relationship returns NotPending`(): Unit = runBlocking {
        val id = seedActive()
        service(baseClockMs).requestUnbind(id, "did:dad")
        service(baseClockMs + UnbindStateMachine.COOLDOWN_MS + 1L).finalizeUnbind(id)

        // unbound 后再 request
        val result = service(baseClockMs + UnbindStateMachine.COOLDOWN_MS + 2L)
            .requestUnbind(id, "did:dad")
        assertIs<UnbindResult.NotPending>(result)
    }

    @Test
    fun `cancelUnbind on missing id returns NotFound`(): Unit = runBlocking {
        val result = service(baseClockMs).cancelUnbind(999_999L)
        assertIs<UnbindResult.NotFound>(result)
    }

    @Test
    fun `finalizeUnbind on missing id returns NotFound`(): Unit = runBlocking {
        val result = service(baseClockMs).finalizeUnbind(999_999L)
        assertIs<UnbindResult.NotFound>(result)
    }

    @Test
    fun `forceFinalize too early returns TooEarly with cooldown+grace`(): Unit = runBlocking {
        val id = seedActive()
        service(baseClockMs).requestUnbind(id, "did:dad")

        // 在 cooldown_until + 3h (< +6h grace) 调 forceFinalize
        val tooEarlyMs = baseClockMs + UnbindStateMachine.COOLDOWN_MS +
            3L * 60L * 60L * 1000L
        val result = service(tooEarlyMs).forceFinalize(id, "did:dad")
        val tooEarly = assertIs<UnbindResult.TooEarly>(result)
        assertEquals(
            baseClockMs + UnbindStateMachine.COOLDOWN_MS + UnbindStateMachine.FORCE_GRACE_MS,
            tooEarly.cooldownUntilMs,
        )
    }

    @Test
    fun `forceFinalize on active returns NotPending`(): Unit = runBlocking {
        val id = seedActive()
        val result = service(baseClockMs).forceFinalize(id, "did:dad")
        assertIs<UnbindResult.NotPending>(result)
    }

    @Test
    fun `cancelUnbind on unbound returns NotPending`(): Unit = runBlocking {
        val id = seedActive()
        service(baseClockMs).requestUnbind(id, "did:dad")
        service(baseClockMs + UnbindStateMachine.COOLDOWN_MS + 1L).finalizeUnbind(id)

        val result = service(baseClockMs + UnbindStateMachine.COOLDOWN_MS + 2L).cancelUnbind(id)
        assertIs<UnbindResult.NotPending>(result)
    }

    // ─── Reconcile no-op when nothing expired ───

    @Test
    fun `reconcileExpired returns 0 when no pending entries`(): Unit = runBlocking {
        val id = seedActive() // active, not pending
        assertEquals(0, service(baseClockMs).reconcileExpired())
        assertEquals("active", db.familyRelationshipDao().findById(id)?.status)
    }
}
