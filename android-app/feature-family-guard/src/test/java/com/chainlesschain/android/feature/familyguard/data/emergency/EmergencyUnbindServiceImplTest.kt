package com.chainlesschain.android.feature.familyguard.data.emergency

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.repository.RevivalCodeRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.emergency.EmergencyUnbindResult
import com.chainlesschain.android.feature.familyguard.domain.emergency.EmergencyUnbindService
import com.chainlesschain.android.feature.familyguard.domain.emergency.ExternalContactNotifier
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import java.security.SecureRandom
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
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * FAMILY-16 验收: 正确码 → freeze; 错 3 次 → 24h 锁; 锁中拒绝服务.
 *
 * Room in-memory 真跑 RevivalCodeRepository 3 错锁逻辑 (FAMILY-08 状态机端到端).
 * UpstreamFreezer 用 InMemoryUpstreamFreezer 真实例 (含 StateFlow);
 * ExternalContactNotifier mockk 让单测 verify 通知次数。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class EmergencyUnbindServiceImplTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var revivalRepo: RevivalCodeRepositoryImpl
    private lateinit var freezer: InMemoryUpstreamFreezer
    private lateinit var notifier: ExternalContactNotifier
    private lateinit var service: EmergencyUnbindServiceImpl

    private val baseClockMs = FamilyFixtures.FIXTURE_TIME_MS

    private fun clockAt(ms: Long): Clock =
        Clock.fixed(Instant.ofEpochMilli(ms), ZoneOffset.UTC)

    private fun seededRandom(seed: Long = 42L): SecureRandom =
        SecureRandom.getInstance("SHA1PRNG").apply { setSeed(seed) }

    private fun rebuildAt(clockMs: Long) {
        val c = clockAt(clockMs)
        revivalRepo = RevivalCodeRepositoryImpl(
            revivalCodeDao = db.revivalCodeDao(),
            clock = c,
            secureRandom = seededRandom(99L),
        )
        service = EmergencyUnbindServiceImpl(
            revivalCodeRepository = revivalRepo,
            familyRelationshipDao = db.familyRelationshipDao(),
            upstreamFreezer = freezer,
            externalContactNotifier = notifier,
            clock = c,
        )
    }

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        freezer = InMemoryUpstreamFreezer()
        notifier = mockk(relaxed = true)
        coEvery { notifier.notify(any()) } returns 2 // 默认通知 2 个外部联系人
        rebuildAt(baseClockMs)
    }

    @After
    fun tearDown() {
        db.close()
    }

    /** 端到端 setup: 写一个 active relationship + 生成一个真复活码绑这关系. */
    private suspend fun seedRelationshipWithCode(): Pair<Long, RevivalCode> {
        val rel = FamilyFixtures.fakeRelationship().copy(status = "active")
        val relId = db.familyRelationshipDao().insert(rel)
        val code = revivalRepo.generateNewCode(familyRelationshipId = relId)
        return relId to code
    }

    // ─── Acceptance 1: 正确码 → freeze + DB 写 + 外部通知 ───

    @Test
    fun `acceptance correct code triggers freeze + emergency_unbound + notify`(): Unit =
        runBlocking {
            val (relId, code) = seedRelationshipWithCode()
            assertFalse(freezer.isFrozen.value)

            val result = service.trigger(code, deviceFingerprint = "dev-kid")

            val success = assertIs<EmergencyUnbindResult.Success>(result)
            assertEquals(relId, success.familyRelationshipId)
            assertEquals(2, success.notifiedCount)
            assertTrue(freezer.isFrozen.value)
            assertEquals(
                EmergencyUnbindService.REASON_REVIVAL_CODE,
                freezer.currentReason(),
            )

            val updated = db.familyRelationshipDao().findById(relId)
            assertEquals("emergency_unbound", updated?.status)
            assertEquals(baseClockMs, updated?.emergencyUnbindAt)
            assertEquals(EmergencyUnbindService.REASON_REVIVAL_CODE, updated?.emergencyUnbindReason)

            coVerify(exactly = 1) {
                notifier.notify(
                    match {
                        it.triggerKind == ExternalContactNotifier.TriggerKind.REVIVAL_CODE_TRIGGERED &&
                            it.familyRelationshipId == relId &&
                            it.deviceFingerprint == "dev-kid"
                    },
                )
            }
        }

    // ─── Acceptance 2: 错 3 次 → 24h 锁 ───

    @Test
    fun `acceptance three wrong codes triggers 24h lockout`(): Unit = runBlocking {
        val (_, code) = seedRelationshipWithCode()
        // 用一个保证不同的码 (跟生成的不同)
        val wrong = AcceptanceCodeAlt.differentFrom(code)

        // 1 错 → remaining=2
        val r1 = service.trigger(wrong, "dev-kid")
        val wrong1 = assertIs<EmergencyUnbindResult.WrongCode>(r1)
        assertEquals(2, wrong1.remainingAttempts)
        assertFalse(freezer.isFrozen.value, "freeze 不应在错码时触发")

        // 2 错 → remaining=1
        val r2 = service.trigger(wrong, "dev-kid")
        assertEquals(1, assertIs<EmergencyUnbindResult.WrongCode>(r2).remainingAttempts)

        // 3 错 → LockedOut
        val r3 = service.trigger(wrong, "dev-kid")
        val locked = assertIs<EmergencyUnbindResult.LockedOut>(r3)
        assertEquals(
            baseClockMs + 24L * 60L * 60L * 1000L,
            locked.unlockAtMs,
        )
        assertFalse(freezer.isFrozen.value)
    }

    // ─── Acceptance 3: 锁中拒绝服务 ───

    @Test
    fun `acceptance lockout blocks even correct code without freeze`(): Unit = runBlocking {
        val (relId, code) = seedRelationshipWithCode()
        val wrong = AcceptanceCodeAlt.differentFrom(code)
        repeat(3) { service.trigger(wrong, "dev-kid") }

        // 即使输正确码, 锁中也拒
        val result = service.trigger(code, "dev-kid")
        assertIs<EmergencyUnbindResult.LockedOut>(result)
        assertFalse(freezer.isFrozen.value, "锁中正确码也不应 freeze")
        assertEquals(
            "active",
            db.familyRelationshipDao().findById(relId)?.status,
        )
    }

    // ─── 边界 / 防御 ───

    @Test
    fun `no code registered returns NoCodeRegistered`(): Unit = runBlocking {
        // 不 seed code; 直接 trigger
        val result = service.trigger(RevivalCode("123456"), "dev-kid")
        assertIs<EmergencyUnbindResult.NoCodeRegistered>(result)
        assertFalse(freezer.isFrozen.value)
    }

    @Test
    fun `already consumed code returns AlreadyConsumed`(): Unit = runBlocking {
        val (_, code) = seedRelationshipWithCode()
        service.trigger(code, "dev-kid") // 第一次成功

        // 重置 freezer (模拟撤销 / 进程重启)
        freezer.unfreeze()

        // 第二次 trigger 同一 code
        // RevivalCodeRepository.listAvailable 不返已 consumed → NoCodeRegistered
        // (复活码一次性, 不是 AlreadyConsumed; AlreadyConsumed 是 listAvailable 仍返
        // consumed entity 的边界情况; 实际生产不可达)
        val result = service.trigger(code, "dev-kid")
        assertIs<EmergencyUnbindResult.NoCodeRegistered>(result)
    }

    @Test
    fun `orphan code (familyRelationshipId null) still freezes`(): Unit = runBlocking {
        // 直接旁路 repo 写一个 family_relationship_id=null 的 code
        val code = revivalRepo.generateNewCode(familyRelationshipId = null)

        val result = service.trigger(code, "dev-kid")
        val orphan = assertIs<EmergencyUnbindResult.OrphanCode>(result)
        assertTrue(orphan.frozen)
        assertTrue(freezer.isFrozen.value, "orphan 也得 freeze (保护性默认)")
    }

    @Test
    fun `orphan code (id exists in code but rel deleted) returns OrphanCode frozen`(): Unit =
        runBlocking {
            // 模拟: 生成 code 关联到一个 id, 然后删 relationship
            val rel = FamilyFixtures.fakeRelationship().copy(status = "active")
            val relId = db.familyRelationshipDao().insert(rel)
            val code = revivalRepo.generateNewCode(familyRelationshipId = relId)
            db.familyRelationshipDao().updateStatus(
                id = relId,
                newStatus = "unbound",
                updatedAt = baseClockMs,
            )
            // markEmergencyUnbound SQL 守卫 WHERE status != 'unbound' → 0 rows

            val result = service.trigger(code, "dev-kid")
            val orphan = assertIs<EmergencyUnbindResult.OrphanCode>(result)
            assertTrue(orphan.frozen)
            assertTrue(freezer.isFrozen.value)
        }

    // ─── revoke ───

    @Test
    fun `revoke within grace period restores active + unfreezes`(): Unit = runBlocking {
        val (relId, code) = seedRelationshipWithCode()
        service.trigger(code, "dev-kid")
        assertTrue(freezer.isFrozen.value)

        // 6 天后撤销 (在 7 天宽限内)
        val laterMs = baseClockMs + 6L * 24L * 60L * 60L * 1000L
        rebuildAt(laterMs)

        val result = service.revoke(relId)
        assertEquals(EmergencyUnbindService.RevokeResult.Success, result)
        assertEquals("active", db.familyRelationshipDao().findById(relId)?.status)
        assertFalse(freezer.isFrozen.value)
    }

    @Test
    fun `revoke after 7 day grace returns GracePeriodExpired`(): Unit = runBlocking {
        val (relId, code) = seedRelationshipWithCode()
        service.trigger(code, "dev-kid")

        // 8 天后撤销 (超 7 天宽限)
        val laterMs = baseClockMs + 8L * 24L * 60L * 60L * 1000L
        rebuildAt(laterMs)

        val result = service.revoke(relId)
        assertEquals(EmergencyUnbindService.RevokeResult.GracePeriodExpired, result)
        // status 仍 emergency_unbound (撤销失败不动 DB)
        assertEquals(
            "emergency_unbound",
            db.familyRelationshipDao().findById(relId)?.status,
        )
    }

    @Test
    fun `revoke on active relationship returns NotEmergencyUnbound`(): Unit = runBlocking {
        val rel = FamilyFixtures.fakeRelationship().copy(status = "active")
        val relId = db.familyRelationshipDao().insert(rel)
        assertEquals(
            EmergencyUnbindService.RevokeResult.NotEmergencyUnbound,
            service.revoke(relId),
        )
    }

    @Test
    fun `revoke on missing relationship returns NotFound`(): Unit = runBlocking {
        assertEquals(
            EmergencyUnbindService.RevokeResult.NotFound,
            service.revoke(999_999L),
        )
    }

    /** Helper to find a 6-digit code different from the given one. */
    private object AcceptanceCodeAlt {
        fun differentFrom(code: RevivalCode): RevivalCode {
            // 把首位 '1' ↔ '2' 翻转, 保持 6 位数字
            val v = code.value
            val newFirst = if (v[0] == '1') '2' else '1'
            return RevivalCode(newFirst + v.drop(1))
        }
    }
}
