package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.RevivalCodeDao
import com.chainlesschain.android.feature.familyguard.data.entity.RevivalCodeEntity
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCodeVerification
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * FAMILY-08 验收: CSPRNG 唯一性 + verify state machine + 3 错锁 24h.
 *
 * SecureRandom 用 fixed seed → 可重现; Clock 用 Clock.fixed → 时间可控。
 * DAO mock 走 mockk; insert/update/markConsumed 全验调用模式。
 */
class RevivalCodeRepositoryImplTest {

    private val dao: RevivalCodeDao = mockk(relaxed = true)

    private fun fixedClock(ms: Long): Clock =
        Clock.fixed(Instant.ofEpochMilli(ms), ZoneOffset.UTC)

    private fun seededRandom(seed: Long): SecureRandom =
        SecureRandom.getInstance("SHA1PRNG").apply { setSeed(seed) }

    private fun repo(
        clockMs: Long = 0L,
        seed: Long = 1L,
    ): RevivalCodeRepositoryImpl =
        RevivalCodeRepositoryImpl(
            revivalCodeDao = dao,
            clock = fixedClock(clockMs),
            secureRandom = seededRandom(seed),
        )

    // ─── Generation ───

    @Test
    fun `generateNewCode produces 6-digit string and inserts hash+salt`() = runTest {
        val captured = slot<RevivalCodeEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        val r = repo(clockMs = 100L).generateNewCode()

        assertEquals(6, r.value.length)
        assertTrue(r.value.all { it.isDigit() })
        // hash hex 64 char, salt hex 32 char
        assertEquals(64, captured.captured.codeHash.length)
        assertEquals(32, captured.captured.salt.length)
        assertEquals(100L, captured.captured.createdAt)
        assertEquals(0, captured.captured.failedAttempts)
    }

    @Test
    fun `generateNewCode 100 runs yields high uniqueness (CSPRNG sanity)`() = runTest {
        coEvery { dao.insert(any()) } returns 1L
        val seen = mutableSetOf<String>()
        val r = repo(seed = 42L)
        repeat(100) {
            val code = r.nextSixDigitCode()
            seen.add(code)
        }
        // 期望 ≥ 99 distinct (10^6 中抽 100, 碰撞概率 ≈ 0.5%); 真出 100 也 ok
        assertTrue(
            seen.size >= 99,
            "100 codes should yield ≥99 distinct; got ${seen.size}",
        )
    }

    @Test
    fun `nextSixDigitCode stays in 100000-999999 range`() = runTest {
        val r = repo()
        repeat(1000) {
            val code = r.nextSixDigitCode().toInt()
            assertTrue(code in 100_000..999_999, "out-of-range: $code")
        }
    }

    // ─── Verify happy path ───

    @Test
    fun `verify with correct code returns Success and marks consumed`() = runTest {
        val r = repo(clockMs = 500L)
        // 预生成一个 known code/salt 然后塞给 dao listAvailable
        val plain = "246810"
        val salt = "00112233445566778899aabbccddeeff"
        val hash = r.hashCode(plain, salt)
        val entity = RevivalCodeEntity(
            id = 7L,
            codeHash = hash,
            salt = salt,
            createdAt = 0L,
        )
        coEvery { dao.listAvailable() } returns listOf(entity)
        coEvery { dao.markConsumed(7L, 500L) } returns 1

        val result = r.verify(RevivalCode(plain))

        assertIs<RevivalCodeVerification.Success>(result)
        coVerify(exactly = 1) { dao.markConsumed(7L, 500L) }
    }

    @Test
    fun `verify when no codes registered returns NoCodeRegistered`() = runTest {
        coEvery { dao.listAvailable() } returns emptyList()

        val result = repo().verify(RevivalCode("123456"))

        assertIs<RevivalCodeVerification.NoCodeRegistered>(result)
    }

    // ─── Wrong code + lockout ───

    @Test
    fun `verify with wrong code records failed attempt and reports remaining`() = runTest {
        val r = repo(clockMs = 1000L)
        val salt = "ff".repeat(16)
        val hash = r.hashCode("246810", salt)
        val entity = RevivalCodeEntity(id = 3L, codeHash = hash, salt = salt, createdAt = 0L)
        coEvery { dao.listAvailable() } returns listOf(entity)

        val result = r.verify(RevivalCode("000000"))

        assertIs<RevivalCodeVerification.WrongCode>(result)
        assertEquals(2, result.remainingAttempts) // 1 used, 2 left
        coVerify(exactly = 1) {
            dao.updateFailedAttempts(id = 3L, failedAttempts = 1, lockedUntil = null)
        }
    }

    @Test
    fun `verify with 3rd wrong attempt triggers LockedOut for 24h`() = runTest {
        val r = repo(clockMs = 1000L)
        val salt = "aa".repeat(16)
        val hash = r.hashCode("246810", salt)
        val entity = RevivalCodeEntity(
            id = 5L,
            codeHash = hash,
            salt = salt,
            createdAt = 0L,
            failedAttempts = 2, // 已错 2 次, 这次第 3 次
        )
        coEvery { dao.listAvailable() } returns listOf(entity)

        val result = r.verify(RevivalCode("000000"))

        val expectedUnlock = 1000L + RevivalCodeRepositoryImpl.LOCKOUT_DURATION_MS
        assertIs<RevivalCodeVerification.LockedOut>(result)
        assertEquals(expectedUnlock, result.unlockAtMs)
        coVerify(exactly = 1) {
            dao.updateFailedAttempts(
                id = 5L,
                failedAttempts = 3,
                lockedUntil = expectedUnlock,
            )
        }
    }

    @Test
    fun `verify during active lockout returns LockedOut without incrementing attempts`() = runTest {
        val lockUntil = 5_000L
        val r = repo(clockMs = 3_000L)
        val salt = "bb".repeat(16)
        val hash = r.hashCode("246810", salt)
        val entity = RevivalCodeEntity(
            id = 9L,
            codeHash = hash,
            salt = salt,
            createdAt = 0L,
            failedAttempts = 3,
            lockedUntil = lockUntil,
        )
        coEvery { dao.listAvailable() } returns listOf(entity)

        val result = r.verify(RevivalCode("999999"))

        assertIs<RevivalCodeVerification.LockedOut>(result)
        assertEquals(lockUntil, result.unlockAtMs)
        // 关键: 锁中不再递增 attempts (防加锁延长攻击)
        coVerify(exactly = 0) {
            dao.updateFailedAttempts(any(), any(), any())
        }
    }

    @Test
    fun `verify after lockout expired falls back to wrong-code path`() = runTest {
        val r = repo(clockMs = 10_000L)
        val salt = "cc".repeat(16)
        val hash = r.hashCode("246810", salt)
        val entity = RevivalCodeEntity(
            id = 11L,
            codeHash = hash,
            salt = salt,
            createdAt = 0L,
            failedAttempts = 3,
            lockedUntil = 5_000L, // 已过期
        )
        coEvery { dao.listAvailable() } returns listOf(entity)

        val result = r.verify(RevivalCode("000000"))

        // 锁过期 + 输错码 → WrongCode 走原路径 (即 attempts +1, 这次第 4 次)
        assertIs<RevivalCodeVerification.LockedOut>(result) // 4 ≥ 3 → 再次锁
    }

    // ─── Already consumed ───

    @Test
    fun `verify on consumed code returns AlreadyConsumed`() = runTest {
        // listAvailable 返已过滤; 这测试需要"未过滤"的场景, 即 SQL 行已
        // consumed_at 但 listAvailable 仍返回它 — 这是不可能的 (SQL WHERE
        // consumed_at IS NULL). 因此这是个理论上不会发生的路径;
        // 我们用 mock 制造一个边界 case 确认 repo 仍能正确处理。
        val r = repo(clockMs = 100L)
        val salt = "dd".repeat(16)
        val hash = r.hashCode("246810", salt)
        val entity = RevivalCodeEntity(
            id = 13L,
            codeHash = hash,
            salt = salt,
            createdAt = 0L,
            consumedAt = 50L, // 异常: listAvailable 不应该返回 consumed entity
        )
        coEvery { dao.listAvailable() } returns listOf(entity)

        val result = r.verify(RevivalCode("246810"))

        assertIs<RevivalCodeVerification.AlreadyConsumed>(result)
        // 不应该再 markConsumed
        coVerify(exactly = 0) { dao.markConsumed(any(), any()) }
    }

    // ─── hasActiveCode / clearAll ───

    @Test
    fun `hasActiveCode true when DAO returns non-empty list`() = runTest {
        coEvery { dao.listAvailable() } returns listOf(
            RevivalCodeEntity(id = 1L, codeHash = "x", salt = "y", createdAt = 0L),
        )
        assertTrue(repo().hasActiveCode())
    }

    @Test
    fun `hasActiveCode false when DAO returns empty`() = runTest {
        coEvery { dao.listAvailable() } returns emptyList()
        assertFalse(repo().hasActiveCode())
    }

    @Test
    fun `clearAll deletes each available entity`() = runTest {
        val list = listOf(
            RevivalCodeEntity(id = 1L, codeHash = "x", salt = "y", createdAt = 0L),
            RevivalCodeEntity(id = 2L, codeHash = "x", salt = "y", createdAt = 0L),
        )
        coEvery { dao.listAvailable() } returns list
        repo().clearAll()
        coVerify(exactly = 1) { dao.deleteById(1L) }
        coVerify(exactly = 1) { dao.deleteById(2L) }
    }
}
