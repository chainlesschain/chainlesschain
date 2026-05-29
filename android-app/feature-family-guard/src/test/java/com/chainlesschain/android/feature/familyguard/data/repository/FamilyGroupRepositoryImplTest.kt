package com.chainlesschain.android.feature.familyguard.data.repository

import app.cash.turbine.test
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyGroupDao
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.InvalidFamilyGroupException
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * FAMILY-10 验收: 10 case 覆盖 CRUD + did/name/JSON 校验 + 边界.
 * 全 mockk DAO, Clock.fixed + SecureRandom fixed seed 让 ULID 可重现。
 */
class FamilyGroupRepositoryImplTest {

    private val dao: FamilyGroupDao = mockk(relaxed = true)
    private val obsFlow = MutableStateFlow<List<FamilyGroupEntity>>(emptyList())

    private fun fixedClock(ms: Long = FamilyFixtures.FIXTURE_TIME_MS): Clock =
        Clock.fixed(Instant.ofEpochMilli(ms), ZoneOffset.UTC)

    private fun seededRandom(seed: Long = 1L): SecureRandom =
        SecureRandom.getInstance("SHA1PRNG").apply { setSeed(seed) }

    private fun repo(
        clockMs: Long = FamilyFixtures.FIXTURE_TIME_MS,
        seed: Long = 1L,
    ): FamilyGroupRepositoryImpl {
        coEvery { dao.observeAll() } returns obsFlow
        return FamilyGroupRepositoryImpl(dao, fixedClock(clockMs), seededRandom(seed))
    }

    // ─── CRUD happy path ───

    @Test
    fun `create returns entity with auto ULID and inserts via DAO`() = runTest {
        coEvery { dao.insert(any()) } returns 1L
        val r = repo()
        val entity = r.create(
            name = "陈家",
            primaryDid = "did:chain:dad",
        )
        assertEquals("陈家", entity.name)
        assertEquals("did:chain:dad", entity.primaryDid)
        assertEquals(FamilyFixtures.FIXTURE_TIME_MS, entity.createdAt)
        assertEquals(26, entity.id.length) // ULID-ish 26 char
        coVerify(exactly = 1) { dao.insert(entity) }
    }

    @Test
    fun `create trims name whitespace`() = runTest {
        coEvery { dao.insert(any()) } returns 1L
        val entity = repo().create(name = "  陈家  ", primaryDid = "did:chain:dad")
        assertEquals("陈家", entity.name)
    }

    @Test
    fun `findById delegates to DAO`() = runTest {
        val stored = FamilyFixtures.fakeFamilyGroup(id = "G1", name = "Test")
        coEvery { dao.findById("G1") } returns stored

        val found = repo().findById("G1")
        assertEquals(stored, found)
    }

    @Test
    fun `observeAll emits Flow from DAO`() = runTest {
        val a = FamilyFixtures.fakeFamilyGroup(id = "A", name = "A家")
        val b = FamilyFixtures.fakeFamilyGroup(id = "B", name = "B家")
        repo().observeAll().test {
            assertEquals(emptyList(), awaitItem())
            obsFlow.value = listOf(a, b)
            val updated = awaitItem()
            assertEquals(2, updated.size)
        }
    }

    @Test
    fun `rename updates name via DAO when entity exists`() = runTest {
        coEvery { dao.exists("G1") } returns true
        coEvery { dao.updateName("G1", "新名") } returns 1
        assertTrue(repo().rename("G1", "新名"))
        coVerify(exactly = 1) { dao.updateName("G1", "新名") }
    }

    @Test
    fun `rename returns false when entity missing`() = runTest {
        coEvery { dao.exists("missing") } returns false
        assertFalse(repo().rename("missing", "X"))
        coVerify(exactly = 0) { dao.updateName(any(), any()) }
    }

    @Test
    fun `updateMetadata accepts null to clear and writes via DAO`() = runTest {
        coEvery { dao.exists("G1") } returns true
        coEvery { dao.updateMetadata("G1", null) } returns 1
        assertTrue(repo().updateMetadata("G1", null))
        coVerify(exactly = 1) { dao.updateMetadata("G1", null) }
    }

    @Test
    fun `delete delegates to DAO and returns true on hit`() = runTest {
        coEvery { dao.deleteById("G1") } returns 1
        assertTrue(repo().delete("G1"))
    }

    // ─── 校验 ───

    @Test
    fun `create with blank name throws InvalidFamilyGroupException`() = runTest {
        assertFailsWith<InvalidFamilyGroupException> {
            repo().create(name = "   ", primaryDid = "did:chain:dad")
        }
    }

    @Test
    fun `create with too-long name throws InvalidFamilyGroupException`() = runTest {
        val tooLong = "X".repeat(65)
        assertFailsWith<InvalidFamilyGroupException> {
            repo().create(name = tooLong, primaryDid = "did:chain:dad")
        }
    }

    @Test
    fun `create with did missing did prefix throws`() = runTest {
        assertFailsWith<InvalidFamilyGroupException> {
            repo().create(name = "陈家", primaryDid = "user:dad")
        }
    }

    @Test
    fun `create with too short did throws`() = runTest {
        // "did:" 是 4 char, 加 3 char body → 7 total, < DID_MIN_LEN 8
        assertFailsWith<InvalidFamilyGroupException> {
            repo().create(name = "陈家", primaryDid = "did:abc")
        }
    }

    @Test
    fun `create with invalid JSON metadata throws`() = runTest {
        assertFailsWith<InvalidFamilyGroupException> {
            repo().create(
                name = "陈家",
                primaryDid = "did:chain:dad",
                metadataJson = "{not-valid-json",
            )
        }
    }

    @Test
    fun `create with valid JSON metadata succeeds`() = runTest {
        coEvery { dao.insert(any()) } returns 1L
        val entity = repo().create(
            name = "陈家",
            primaryDid = "did:chain:dad",
            metadataJson = """{"photo":"abc","motto":"love"}""",
        )
        assertNotNull(entity.metadataJson)
        coVerify(exactly = 1) { dao.insert(entity) }
    }

    @Test
    fun `rename with blank name throws`() = runTest {
        coEvery { dao.exists("G1") } returns true
        assertFailsWith<InvalidFamilyGroupException> {
            repo().rename("G1", "  ")
        }
        coVerify(exactly = 0) { dao.updateName(any(), any()) }
    }

    @Test
    fun `updateMetadata with bad JSON throws`() = runTest {
        coEvery { dao.exists("G1") } returns true
        assertFailsWith<InvalidFamilyGroupException> {
            repo().updateMetadata("G1", "[broken")
        }
        coVerify(exactly = 0) { dao.updateMetadata(any(), any()) }
    }

    @Test
    fun `generateUlid produces 26-char Crockford-base32 with time-sortable prefix`() = runTest {
        // 注意: 不能用 fixed seed 强求 byte-exact 重现 ——
        // SecureRandom.setSeed() 行为是 mix-in 而非 replace, 真重现需 DeterministicRandom
        // (超出 FAMILY-10 范围). 这里仅验形态:
        //   1. 长度 26
        //   2. 字符集 ⊆ Crockford
        //   3. timestamp prefix (前 10 char) 在同 clock 下相同 → 跨进程时序可比
        val crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        val id1 = repo(clockMs = 1_234_567_890L, seed = 42L).generateUlid()
        val id2 = repo(clockMs = 1_234_567_890L, seed = 7L).generateUlid()
        assertEquals(26, id1.length)
        assertEquals(26, id2.length)
        assertTrue(id1.all { it in crockford }, "non-Crockford char in $id1")
        assertTrue(id2.all { it in crockford }, "non-Crockford char in $id2")
        assertEquals(
            id1.substring(0, 10),
            id2.substring(0, 10),
            "timestamp prefix must match under same clock",
        )

        // 不同 clock → prefix 应该不同 (毫秒粒度)
        val idLater = repo(clockMs = 2_000_000_000L, seed = 42L).generateUlid()
        assertTrue(
            idLater.substring(0, 10) != id1.substring(0, 10),
            "later clock should yield different prefix",
        )
    }
}
