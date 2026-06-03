package com.chainlesschain.android.feature.familyguard.data.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.domain.repository.SosEventRepository
import com.chainlesschain.android.feature.familyguard.domain.sos.SosNotifier
import com.chainlesschain.android.feature.familyguard.domain.sos.SosStatus
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTransitionResult
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTriggerSource
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthorityStatus
import java.security.SecureRandom
import kotlinx.coroutines.flow.first
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
import kotlin.test.assertTrue

/**
 * FAMILY-40 验收: trigger + 状态机转换 (guard 守卫: 合法 / 非法状态 / NotFound).
 * Room in-memory 真跑 SQL atomic transitions; mutable fake TimeAuthority + 单实例
 * SecureRandom (suffix 每次调用递增 → id 唯一, 不因同毫秒触发碰撞; 不断言具体 id 值)。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class SosEventRepositoryImplTest {

    private lateinit var db: FamilyGuardDatabase
    private val baseNow = 1_700_000_000_000L

    private class FakeTimeAuthority(var nowMs: Long) : TimeAuthority {
        override fun authoritativeNow(): Long = nowMs
        override fun status(): TimeAuthorityStatus = TimeAuthorityStatus.TRUSTED
        override fun isTimeTrusted(): Boolean = true
        override fun shouldLockTimeFeatures(): Boolean = false
        override suspend fun sync(): Boolean = true
    }

    private class FakeSosNotifier : SosNotifier {
        val falseAlarms = mutableListOf<String>() // sosEventId
        override suspend fun notifyFalseAlarm(
            sosEventId: String,
            childDid: String,
            familyGroupId: String,
            reason: String,
        ) {
            falseAlarms += sosEventId
        }
        override suspend fun notifyBroadcast(
            sosEventId: String,
            childDid: String,
            familyGroupId: String,
            guardianDids: List<String>,
            locationSnapshot: String?,
        ) = Unit
        override suspend fun notifyAcknowledged(
            sosEventId: String,
            acknowledgedByDid: String,
            standDownGuardianDids: List<String>,
        ) = Unit
    }

    private val fakeTime = FakeTimeAuthority(baseNow)
    private val fakeNotifier = FakeSosNotifier()
    private lateinit var sut: SosEventRepositoryImpl

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        ).allowMainThreadQueries().build()
        sut = SosEventRepositoryImpl(db.sosEventDao(), fakeTime, fakeNotifier, SecureRandom())
    }

    @After
    fun tearDown() = db.close()

    private suspend fun seedPending(): String =
        sut.trigger("did:chain:kid", "grp", SosTriggerSource.IN_APP).id

    // ─── trigger ───

    @Test
    fun `trigger creates a pending event with source + triggeredAt`(): Unit = runBlocking {
        val ev = sut.trigger("did:chain:kid", "grp", SosTriggerSource.VOLUME_BUTTON)
        assertEquals(SosStatus.PENDING.storageValue, ev.status)
        assertEquals("volume_button", ev.triggerSource)
        assertEquals(baseNow, ev.triggeredAt)
        assertTrue(ev.id.isNotBlank())
        assertEquals(ev, db.sosEventDao().findById(ev.id))
    }

    @Test
    fun `trigger blank childDid throws`(): Unit = runBlocking {
        try {
            sut.trigger("", "grp", SosTriggerSource.IN_APP)
            error("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("childDid"))
        }
    }

    // ─── acknowledge ───

    @Test
    fun `acknowledge pending succeeds and sets guardian`(): Unit = runBlocking {
        val id = seedPending()
        assertIs<SosTransitionResult.Success>(sut.acknowledge(id, "did:chain:mom"))
        val rel = db.sosEventDao().findById(id)
        assertEquals(SosStatus.ACKNOWLEDGED.storageValue, rel?.status)
        assertEquals("did:chain:mom", rel?.acknowledgedBy)
    }

    @Test
    fun `acknowledge already-resolved returns InvalidState`(): Unit = runBlocking {
        val id = seedPending()
        sut.resolve(id)
        val invalid = assertIs<SosTransitionResult.InvalidState>(sut.acknowledge(id, "did:chain:mom"))
        assertEquals(SosStatus.RESOLVED, invalid.current)
    }

    @Test
    fun `acknowledge missing id returns NotFound`(): Unit = runBlocking {
        assertIs<SosTransitionResult.NotFound>(sut.acknowledge("nope", "did:chain:mom"))
    }

    // ─── resolve ───

    @Test
    fun `resolve from pending succeeds`(): Unit = runBlocking {
        val id = seedPending()
        assertIs<SosTransitionResult.Success>(sut.resolve(id, note = "handled"))
        val rel = db.sosEventDao().findById(id)
        assertEquals(SosStatus.RESOLVED.storageValue, rel?.status)
        assertEquals("handled", rel?.resolutionNote)
    }

    @Test
    fun `resolve from acknowledged succeeds`(): Unit = runBlocking {
        val id = seedPending()
        sut.acknowledge(id, "did:chain:mom")
        assertIs<SosTransitionResult.Success>(sut.resolve(id))
        assertEquals(SosStatus.RESOLVED.storageValue, db.sosEventDao().findById(id)?.status)
    }

    // ─── false alarm ───

    @Test
    fun `cancelAsFalseAlarm within 5min succeeds and notifies guardian`(): Unit = runBlocking {
        val id = seedPending()
        // 触发后 4min 撤销 (窗口内)
        fakeTime.nowMs = baseNow + 4 * 60 * 1000
        assertIs<SosTransitionResult.Success>(sut.cancelAsFalseAlarm(id, "误触"))
        val rel = db.sosEventDao().findById(id)
        assertEquals(SosStatus.FALSE_ALARM.storageValue, rel?.status)
        assertEquals("误触", rel?.cancelReason)
        assertEquals(listOf(id), fakeNotifier.falseAlarms) // 通知家长
    }

    @Test
    fun `cancelAsFalseAlarm after 5min window returns CancelWindowExpired and does not notify`(): Unit =
        runBlocking {
            val id = seedPending()
            // 触发后 6min 撤销 (超 5min 窗口)
            fakeTime.nowMs = baseNow + 6 * 60 * 1000
            assertIs<SosTransitionResult.CancelWindowExpired>(sut.cancelAsFalseAlarm(id, "误触"))
            // 仍 pending (未改状态), 不通知
            assertEquals(SosStatus.PENDING.storageValue, db.sosEventDao().findById(id)?.status)
            assertTrue(fakeNotifier.falseAlarms.isEmpty())
        }

    @Test
    fun `cancel window boundary uses CANCEL_WINDOW_MS constant`() {
        assertEquals(5L * 60 * 1000, SosEventRepository.CANCEL_WINDOW_MS)
    }

    @Test
    fun `cancelAsFalseAlarm after acknowledged returns InvalidState`(): Unit = runBlocking {
        val id = seedPending()
        sut.acknowledge(id, "did:chain:mom")
        val invalid = assertIs<SosTransitionResult.InvalidState>(sut.cancelAsFalseAlarm(id, "误触"))
        assertEquals(SosStatus.ACKNOWLEDGED, invalid.current)
        assertTrue(fakeNotifier.falseAlarms.isEmpty()) // 非 pending → 不撤销不通知
    }

    // ─── queries ───

    @Test
    fun `observePending reflects only pending events`(): Unit = runBlocking {
        val a = seedPending()
        val b = seedPending()
        sut.resolve(a)

        val pending = db.sosEventDao().observePending().first()
        assertEquals(listOf(b), pending.map { it.id })
        assertNotNull(db.sosEventDao().findById(a)) // resolved 仍在库, 只是不 pending
    }

    @Test
    fun `observeRecentForChild returns child events newest first`(): Unit = runBlocking {
        fakeTime.nowMs = baseNow
        sut.trigger("did:chain:kid", "grp", SosTriggerSource.IN_APP)
        fakeTime.nowMs = baseNow + 1000
        sut.trigger("did:chain:kid", "grp", SosTriggerSource.CODEWORD)
        fakeTime.nowMs = baseNow + 2000
        sut.trigger("did:chain:other", "grp", SosTriggerSource.IN_APP)

        val recent = db.sosEventDao().observeRecentForChild("did:chain:kid", limit = 10).first()
        assertEquals(2, recent.size)
        assertEquals(baseNow + 1000, recent.first().triggeredAt) // newest kid event first
        assertNull(recent.firstOrNull { it.childDid == "did:chain:other" })
    }
}
