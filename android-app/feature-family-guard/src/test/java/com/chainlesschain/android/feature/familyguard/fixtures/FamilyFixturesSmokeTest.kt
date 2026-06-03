package com.chainlesschain.android.feature.familyguard.fixtures

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures.FIXTURE_CHILD_DID
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures.FIXTURE_GROUP_ID
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures.FIXTURE_PRIMARY_DID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * FAMILY-09 验收: fixture builder 跑通 (3+) + 1 e2e 冒烟测试串通 DAO chain.
 *
 * 用 Room in-memory DB 跑端到端: fakeFamilyGroup → fakeParent/fakeChild →
 * fakeRelationship → fakeSosEvent + fakeLocationPoint + fakeRevivalCode. 这
 * 一条链覆盖 8 张 placeholder 表中的 6 张 + Entity ID 关联 (groupId / childDid
 * / familyRelationshipId), 验证 fixture default 字段值在真 schema 上能 round-trip。
 *
 * 在意的不是 DAO 行为本身 (那是各 ticket 自己的事), 而是 fixture 的 default 字段
 * 跟 Room 表 schema 兼容 + key/index 不冲突。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyFixturesSmokeTest {

    private lateinit var db: FamilyGuardDatabase

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

    @Test
    fun `fakeFamilyGroup default round-trips through DAO`() = runBlocking {
        val group = FamilyFixtures.fakeFamilyGroup()
        db.familyGroupDao().upsert(group)
        val found = db.familyGroupDao().findById(FIXTURE_GROUP_ID)
        assertNotNull(found)
        assertEquals(group, found)
    }

    @Test
    fun `fakeParent and fakeChild round-trip with unique fk constraint not tripped`() =
        runBlocking {
            // 先 group, 再 membership; 不强制 FK 但保持引用一致
            db.familyGroupDao().upsert(FamilyFixtures.fakeFamilyGroup())
            val parentId = db.familyMembershipDao().upsert(FamilyFixtures.fakeParent())
            val childId = db.familyMembershipDao().upsert(FamilyFixtures.fakeChild())

            assertTrue(parentId > 0)
            assertTrue(childId > 0)
            // 与 parent 不冲突 (UNIQUE(group, member, device) 区分)
            assertTrue(parentId != childId)
        }

    @Test
    fun `fakeRelationship round-trips with default permissions JSON`() = runBlocking {
        db.familyGroupDao().upsert(FamilyFixtures.fakeFamilyGroup())
        val relId = db.familyRelationshipDao().upsert(FamilyFixtures.fakeRelationship())
        assertTrue(relId > 0)

        val rel = db.familyRelationshipDao().findByFriendDid(FIXTURE_CHILD_DID)
        assertNotNull(rel)
        assertEquals("parent", rel.roleSelf)
        assertEquals("child", rel.roleOther)
        assertEquals("active", rel.status)
        assertTrue(rel.permissions.contains("L1"))
    }

    @Test
    fun `end-to-end smoke chain group-membership-relationship-sos-location-revivalCode`() =
        runBlocking {
            // 1. Group
            db.familyGroupDao().upsert(FamilyFixtures.fakeFamilyGroup())

            // 2. Memberships (parent + child)
            db.familyMembershipDao().upsert(FamilyFixtures.fakeParent())
            db.familyMembershipDao().upsert(FamilyFixtures.fakeChild())

            // 3. Relationship (parent 看 child)
            val relId = db.familyRelationshipDao().upsert(FamilyFixtures.fakeRelationship())
            assertTrue(relId > 0)

            // 4. SOS event (child 触发)
            db.sosEventDao().upsert(FamilyFixtures.fakeSosEvent())

            // 5. Location (child 上报)
            db.locationPointDao().insertAll(
                listOf(FamilyFixtures.fakeLocationPoint()),
            )

            // 6. RevivalCode (孩子端生成, 关联 relationship)
            val revivalId = db.revivalCodeDao().insert(
                FamilyFixtures.fakeRevivalCode(familyRelationshipId = relId),
            )
            assertTrue(revivalId > 0)

            // 7. 反向查全链, 断言数据完整
            val foundGroup = db.familyGroupDao().findById(FIXTURE_GROUP_ID)
            assertNotNull(foundGroup)
            // 默认 group 的 primaryDid 走 FIXTURE_PRIMARY_DID (创建人 / primary
            // guardian, 与 FIXTURE_PARENT_DID 故意区分以便测多家长场景)
            assertEquals(FIXTURE_PRIMARY_DID, foundGroup.primaryDid)

            val rels = db.familyRelationshipDao().observeAllActive().first()
            assertEquals(1, rels.size)
            assertEquals(FIXTURE_CHILD_DID, rels[0].friendDid)

            val pendingSos = db.sosEventDao().observePending().first()
            assertEquals(1, pendingSos.size)
            assertEquals("in_app", pendingSos[0].triggerSource)

            val locs = db.locationPointDao().querySince(
                childDid = FIXTURE_CHILD_DID,
                sinceMs = 0L,
            )
            assertEquals(1, locs.size)
            assertEquals(31.23, locs[0].latitude)

            val codes = db.revivalCodeDao().listAvailable()
            assertEquals(1, codes.size)
            assertEquals(relId, codes[0].familyRelationshipId)
            assertEquals(0, codes[0].failedAttempts)
        }
}

