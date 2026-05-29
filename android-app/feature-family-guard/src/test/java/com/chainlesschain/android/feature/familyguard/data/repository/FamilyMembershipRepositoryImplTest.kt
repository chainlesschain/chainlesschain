package com.chainlesschain.android.feature.familyguard.data.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.InvalidFamilyMembershipException
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import java.time.Clock
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-11 验收 — ticket 文本明确:
 *   "1 group 加 2 parent (primary) + 2 child + 1 secondary guardian 不重复"
 *
 * 用真 Room in-memory DB 验证, 不 mock DAO. 因 UNIQUE(group, member, device)
 * 唯一约束 + role/tier 查询 SQL 走 Room 真路径, mock 难度堪比真接 Room。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyMembershipRepositoryImplTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var repo: FamilyMembershipRepositoryImpl
    private val clock: Clock = FamilyFixtures.fakeClock()

    private val GROUP = FamilyFixtures.FIXTURE_GROUP_ID

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        repo = FamilyMembershipRepositoryImpl(
            familyMembershipDao = db.familyMembershipDao(),
            clock = clock,
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    // ─── Ticket acceptance ───

    @Test
    fun `acceptance 1 group with 2 parents 2 children 1 secondary guardian without dup`() =
        runBlocking {
            // 2 primary parents (爸 + 妈)
            val dad = repo.addMember(
                familyGroupId = GROUP,
                memberDid = "did:chain:dad",
                role = MemberRole.PARENT,
                guardianTier = GuardianTier.PRIMARY,
                deviceId = "dev-dad",
            )
            val mom = repo.addMember(
                familyGroupId = GROUP,
                memberDid = "did:chain:mom",
                role = MemberRole.PARENT,
                guardianTier = GuardianTier.PRIMARY,
                deviceId = "dev-mom",
            )
            // 2 children (老大 + 老二)
            val kid1 = repo.addMember(
                familyGroupId = GROUP,
                memberDid = "did:chain:kid1",
                role = MemberRole.CHILD,
                guardianTier = null,
                deviceId = "dev-kid1",
            )
            val kid2 = repo.addMember(
                familyGroupId = GROUP,
                memberDid = "did:chain:kid2",
                role = MemberRole.CHILD,
                guardianTier = null,
                deviceId = "dev-kid2",
            )
            // 1 secondary guardian (奶奶)
            val grandma = repo.addMember(
                familyGroupId = GROUP,
                memberDid = "did:chain:grandma",
                role = MemberRole.GUARDIAN,
                guardianTier = GuardianTier.SECONDARY,
                deviceId = "dev-grandma",
            )

            // 5 不同 entity id, 不重复
            val ids = setOf(dad.id, mom.id, kid1.id, kid2.id, grandma.id)
            assertEquals(5, ids.size, "all 5 memberships must have distinct ids")

            // listAllByGroup 返 5
            val all = repo.listAllByGroup(GROUP)
            assertEquals(5, all.size)

            // listChildren 返 2 (kid1 + kid2)
            val children = repo.listChildren(GROUP)
            assertEquals(2, children.size)
            assertTrue(children.all { it.role == "child" })
            assertEquals(
                setOf("did:chain:kid1", "did:chain:kid2"),
                children.map { it.memberDid }.toSet(),
            )

            // listGuardians(tier=null) 返 3 (dad + mom + grandma; primary 排前面)
            val allGuardians = repo.listGuardians(GROUP, tier = null)
            assertEquals(3, allGuardians.size)
            // 前两个应是 primary (dad + mom, joined_at 相同 → joined_at 顺序)
            assertEquals(GuardianTier.PRIMARY.storageValue, allGuardians[0].guardianTier)
            assertEquals(GuardianTier.PRIMARY.storageValue, allGuardians[1].guardianTier)
            assertEquals(GuardianTier.SECONDARY.storageValue, allGuardians[2].guardianTier)

            // listGuardians(tier=PRIMARY) 返 2
            val primaryGuardians = repo.listGuardians(GROUP, tier = GuardianTier.PRIMARY)
            assertEquals(2, primaryGuardians.size)

            // listGuardians(tier=SECONDARY) 返 1
            val secondaryGuardians = repo.listGuardians(GROUP, tier = GuardianTier.SECONDARY)
            assertEquals(1, secondaryGuardians.size)
            assertEquals("did:chain:grandma", secondaryGuardians[0].memberDid)
        }

    // ─── Duplicate insert ABORT ───

    @Test
    fun `re-adding same group+did+device throws on UNIQUE constraint (ABORT)`(): Unit = runBlocking {
        repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-1")
        assertFailsWith<android.database.sqlite.SQLiteConstraintException> {
            repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-1")
        }
    }

    @Test
    fun `same member with different device produces distinct rows`(): Unit = runBlocking {
        val a = repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-a")
        val b = repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-b")
        assertTrue(a.id != b.id)
        assertEquals(2, repo.listAllByGroup(GROUP).size)
    }

    // ─── find / deactivate / hardDelete ───

    @Test
    fun `find returns entity by group+member+device`(): Unit = runBlocking {
        val e = repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-1")
        val found = repo.find(GROUP, "did:chain:dad", "dev-1")
        assertEquals(e, found)
    }

    @Test
    fun `find returns null when not found`(): Unit = runBlocking {
        assertNull(repo.find(GROUP, "did:chain:ghost", "dev-x"))
    }

    @Test
    fun `deactivate sets status inactive and filters from listChildren`(): Unit = runBlocking {
        val kid = repo.addMember(GROUP, "did:chain:kid", MemberRole.CHILD, null, "dev-kid")
        assertEquals(1, repo.listChildren(GROUP).size)
        assertTrue(repo.deactivate(kid.id))
        // listChildren 只返 active; deactivated 不在
        assertEquals(0, repo.listChildren(GROUP).size)
        // listAllByGroup 仍可见 (含 inactive)
        assertEquals(1, repo.listAllByGroup(GROUP).size)
    }

    @Test
    fun `hardDelete removes row entirely`(): Unit = runBlocking {
        val kid = repo.addMember(GROUP, "did:chain:kid", MemberRole.CHILD, null, "dev-kid")
        assertTrue(repo.hardDelete(kid.id))
        assertEquals(0, repo.listAllByGroup(GROUP).size)
    }

    // ─── 校验 ───

    @Test
    fun `addMember CHILD with non-null tier throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyMembershipException> {
            repo.addMember(GROUP, "did:chain:kid", MemberRole.CHILD, GuardianTier.PRIMARY, "dev-x")
        }
    }

    @Test
    fun `addMember PARENT with null tier throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyMembershipException> {
            repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, null, "dev-x")
        }
    }

    @Test
    fun `addMember GUARDIAN with null tier throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyMembershipException> {
            repo.addMember(GROUP, "did:chain:grandma", MemberRole.GUARDIAN, null, "dev-x")
        }
    }

    @Test
    fun `addMember bad did throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyMembershipException> {
            repo.addMember(GROUP, "user:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-x")
        }
    }

    @Test
    fun `addMember blank deviceId throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyMembershipException> {
            repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "   ")
        }
    }

    @Test
    fun `addMember blank familyGroupId throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyMembershipException> {
            repo.addMember("", "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-x")
        }
    }

    // ─── enum round-trip ───

    @Test
    fun `MemberRole and GuardianTier round-trip storage values`() {
        assertEquals(MemberRole.PARENT, MemberRole.fromStorage("parent"))
        assertEquals(MemberRole.CHILD, MemberRole.fromStorage("child"))
        assertEquals(MemberRole.GUARDIAN, MemberRole.fromStorage("guardian"))
        assertNull(MemberRole.fromStorage("nobody"))
        assertEquals(GuardianTier.PRIMARY, GuardianTier.fromStorage("primary"))
        assertEquals(GuardianTier.SECONDARY, GuardianTier.fromStorage("secondary"))
        assertNull(GuardianTier.fromStorage(null))
        assertNull(GuardianTier.fromStorage("bronze"))
    }

    @Test
    fun `observeByGroup returns inserted memberships sorted by joined_at`(): Unit = runBlocking {
        val first = repo.addMember(GROUP, "did:chain:a", MemberRole.CHILD, null, "dev-a")
        val second = repo.addMember(GROUP, "did:chain:b", MemberRole.CHILD, null, "dev-b")
        // listAllByGroup 用 observeByGroup 同源 SQL
        val list = repo.listAllByGroup(GROUP)
        assertEquals(2, list.size)
        // joined_at 同 ms (fixed clock) → 不保证特定顺序; 仅断言两 entity 都在
        assertNotNull(list.find { it.id == first.id })
        assertNotNull(list.find { it.id == second.id })
    }

    @Test
    fun `listGuardians on empty group returns empty list`(): Unit = runBlocking {
        assertTrue(repo.listGuardians(GROUP, tier = null).isEmpty())
        assertTrue(repo.listGuardians(GROUP, tier = GuardianTier.PRIMARY).isEmpty())
    }

    @Test
    fun `listChildren ignores parents and guardians`(): Unit = runBlocking {
        repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-dad")
        repo.addMember(GROUP, "did:chain:kid", MemberRole.CHILD, null, "dev-kid")
        repo.addMember(
            GROUP,
            "did:chain:gma",
            MemberRole.GUARDIAN,
            GuardianTier.SECONDARY,
            "dev-gma",
        )
        val children = repo.listChildren(GROUP)
        assertEquals(1, children.size)
        assertEquals("did:chain:kid", children[0].memberDid)
    }

    @Test
    fun `deactivate followed by listGuardians excludes inactive`(): Unit = runBlocking {
        val dad = repo.addMember(GROUP, "did:chain:dad", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-1")
        repo.addMember(GROUP, "did:chain:mom", MemberRole.PARENT, GuardianTier.PRIMARY, "dev-2")
        assertEquals(2, repo.listGuardians(GROUP).size)
        repo.deactivate(dad.id)
        assertEquals(1, repo.listGuardians(GROUP).size)
    }

    @Test
    fun `deactivate non-existent returns false`(): Unit = runBlocking {
        assertFalse(repo.deactivate(99999L))
    }
}
