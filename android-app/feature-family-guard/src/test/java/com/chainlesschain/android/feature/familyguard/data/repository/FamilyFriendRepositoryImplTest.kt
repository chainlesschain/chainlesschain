package com.chainlesschain.android.feature.familyguard.data.repository

import app.cash.turbine.test
import com.chainlesschain.android.core.database.dao.social.FriendDao
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * FAMILY-03 acceptance:
 *   ✅ observeAllFamilyFriends() 可读现有 friend list (joined w/ relationships)
 *   ✅ markAsFamily() / unmarkAsFamily() 标记 / 取消 family-friend
 *   ✅ DIDManager injection works (currentSelfDid())
 *
 * Friend ↔ Relationship cross-database join 走 client-side, 因为两库分离
 * (ChainlessChainDatabase / family_guard.db; FAMILY-02 设计决策)。
 */
class FamilyFriendRepositoryImplTest {

    private val friendDao: FriendDao = mockk()
    private val familyRelationshipDao: FamilyRelationshipDao = mockk()
    private val didManager: DIDManager = mockk()

    private lateinit var repo: FamilyFriendRepositoryImpl

    @Before
    fun setUp() {
        repo = FamilyFriendRepositoryImpl(
            friendDao = friendDao,
            familyRelationshipDao = familyRelationshipDao,
            didManager = didManager,
        )
    }

    @Test
    fun `observeAllFamilyFriends joins friend with active relationships`() = runTest {
        val mom = friendFor(did = "did:chain:mom", nickname = "妈妈")
        val kid = friendFor(did = "did:chain:kid", nickname = "小明")
        val orphanDid = "did:chain:ghost" // 有 relationship 无 FriendEntity, 应被过滤

        val momRel = relationshipFor(friendDid = "did:chain:mom", roleOther = "parent")
        val kidRel = relationshipFor(friendDid = "did:chain:kid", roleOther = "child")
        val orphanRel = relationshipFor(friendDid = orphanDid, roleOther = "child")

        every { familyRelationshipDao.observeAllActive() } returns flowOf(
            listOf(momRel, kidRel, orphanRel),
        )
        coEvery { friendDao.getFriendByDid("did:chain:mom") } returns mom
        coEvery { friendDao.getFriendByDid("did:chain:kid") } returns kid
        coEvery { friendDao.getFriendByDid(orphanDid) } returns null

        repo.observeAllFamilyFriends().test {
            val result = awaitItem()
            assertEquals(2, result.size, "orphan relationship must be filtered out")
            assertEquals("妈妈", result[0].friend.nickname)
            assertEquals("parent", result[0].otherRole)
            assertEquals("小明", result[1].friend.nickname)
            assertEquals("child", result[1].otherRole)
            awaitComplete()
        }
    }

    @Test
    fun `isFamily delegates to dao predicate query`() = runTest {
        coEvery { familyRelationshipDao.isActiveFamily("did:chain:dad") } returns true
        coEvery { familyRelationshipDao.isActiveFamily("did:chain:stranger") } returns false

        assertTrue(repo.isFamily("did:chain:dad"))
        assertFalse(repo.isFamily("did:chain:stranger"))
    }

    @Test
    fun `markAsFamily upserts active relationship row and returns row id`() = runTest {
        val newRel = relationshipFor(friendDid = "did:chain:newkid", roleOther = "child")
        coEvery { familyRelationshipDao.upsert(newRel) } returns 42L

        val id = repo.markAsFamily(newRel)

        assertEquals(42L, id)
        coVerify(exactly = 1) { familyRelationshipDao.upsert(newRel) }
    }

    @Test
    fun `unmarkAsFamily flips status to unbound when row exists`() = runTest {
        val existing = relationshipFor(friendDid = "did:chain:exkid", roleOther = "child")
            .copy(id = 7L)
        coEvery { familyRelationshipDao.findByFriendDid("did:chain:exkid") } returns existing
        coEvery {
            familyRelationshipDao.updateStatus(
                id = 7L,
                newStatus = "unbound",
                updatedAt = any(),
            )
        } returns 1

        val result = repo.unmarkAsFamily("did:chain:exkid")

        assertTrue(result)
        coVerify {
            familyRelationshipDao.updateStatus(
                id = 7L,
                newStatus = "unbound",
                updatedAt = any(),
            )
        }
    }

    @Test
    fun `unmarkAsFamily returns false when no relationship exists`() = runTest {
        coEvery {
            familyRelationshipDao.findByFriendDid("did:chain:nobody")
        } returns null

        val result = repo.unmarkAsFamily("did:chain:nobody")

        assertFalse(result)
        coVerify(exactly = 0) {
            familyRelationshipDao.updateStatus(any(), any(), any())
        }
    }

    @Test
    fun `currentSelfDid delegates to DIDManager`() = runTest {
        every { didManager.getCurrentDID() } returns "did:chain:self"

        val self = repo.currentSelfDid()

        assertNotNull(self)
        assertEquals("did:chain:self", self)
    }

    // ─── Fixtures (FAMILY-09 共享 fixture 落地前的本地版本) ───

    private fun friendFor(did: String, nickname: String): FriendEntity = FriendEntity(
        did = did,
        nickname = nickname,
        addedAt = 0L,
        status = FriendStatus.ACCEPTED,
    )

    private fun relationshipFor(
        friendDid: String,
        roleOther: String,
    ): FamilyRelationshipEntity = FamilyRelationshipEntity(
        familyGroupId = "grp-test",
        friendDid = friendDid,
        roleSelf = if (roleOther == "child") "parent" else "child",
        roleOther = roleOther,
        guardianTierOther = if (roleOther == "parent") "primary" else null,
        boundAt = 1_700_000_000_000L,
        permissions = "{}",
        status = "active",
        createdAt = 1_700_000_000_000L,
        updatedAt = 1_700_000_000_000L,
    )
}
