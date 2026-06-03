package com.chainlesschain.android.feature.familyguard.data.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.CompanionSummaryAccess
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.InvalidFamilyPermissionsException
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.PermissionTemplates
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.repository.InvalidFamilyRelationshipException
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import java.time.Clock
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-12 Repository 集成测试. Room in-memory 真跑 SQL + JSON encode/decode
 * 端到端串通, 避免 mock DAO 时漏掉 SQL 列名漂移这种隐蔽 bug。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyRelationshipRepositoryImplTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var repo: FamilyRelationshipRepositoryImpl
    private val clock: Clock = FamilyFixtures.fakeClock()

    private val GROUP = FamilyFixtures.FIXTURE_GROUP_ID
    private val CHILD_DID = FamilyFixtures.FIXTURE_CHILD_DID

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        repo = FamilyRelationshipRepositoryImpl(
            familyRelationshipDao = db.familyRelationshipDao(),
            clock = clock,
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    // ─── create / readPermissions round-trip ───

    @Test
    fun `create with parent-to-child template round-trips through DB`(): Unit = runBlocking {
        val perm = PermissionTemplates.forParentToChild()
        val entity = repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = perm,
        )
        assertTrue(entity.id > 0)
        assertEquals(GROUP, entity.familyGroupId)
        assertEquals("parent", entity.roleSelf)
        assertEquals("child", entity.roleOther)

        val readBack = repo.readPermissions(entity.id)
        assertNotNull(readBack)
        assertEquals(perm, readBack)
    }

    @Test
    fun `updatePermissions changes JSON in DB and is observable via readPermissions`(): Unit =
        runBlocking {
            val entity = repo.create(
                familyGroupId = GROUP,
                friendDid = CHILD_DID,
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = PermissionTemplates.forParentToChild(),
            )
            val updated = PermissionTemplates.forParentToChild().copy(
                telemetryLevel = TelemetryLevel.L2,
                allowForcePickup = true,
                allowAppDisable = true,
                allowCompanionSummary = CompanionSummaryAccess.NEVER,
            )
            assertTrue(repo.updatePermissions(entity.id, updated))
            val read = repo.readPermissions(entity.id)
            assertEquals(updated, read)
        }

    @Test
    fun `updatePermissions returns false when id not found`(): Unit = runBlocking {
        assertFalse(
            repo.updatePermissions(
                id = 999_999L,
                permissions = PermissionTemplates.forParentToChild(),
            ),
        )
    }

    @Test
    fun `readPermissions returns null when id missing`(): Unit = runBlocking {
        assertNull(repo.readPermissions(999L))
    }

    @Test
    fun `readPermissions throws on malformed stored JSON (data corruption guard)`(): Unit =
        runBlocking {
            // 旁路 Repository, 直接写一个 "permissions" 是非法 JSON 的 entity
            val bad = FamilyFixtures.fakeRelationship().copy(
                permissions = "this-is-not-json",
            )
            val id = db.familyRelationshipDao().insert(bad)
            assertFailsWith<InvalidFamilyRelationshipException> {
                repo.readPermissions(id)
            }
        }

    // ─── find / observe ───

    @Test
    fun `findById returns inserted entity`(): Unit = runBlocking {
        val e = repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = PermissionTemplates.forParentToChild(),
        )
        val found = repo.findById(e.id)
        assertEquals(e, found)
    }

    @Test
    fun `findByFriendDid returns relationship for that did`(): Unit = runBlocking {
        repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = PermissionTemplates.forParentToChild(),
        )
        val found = repo.findByFriendDid(CHILD_DID)
        assertEquals(CHILD_DID, found?.friendDid)
    }

    // ─── 校验 ───

    @Test
    fun `create with blank group throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyRelationshipException> {
            repo.create(
                familyGroupId = "",
                friendDid = CHILD_DID,
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = PermissionTemplates.forParentToChild(),
            )
        }
    }

    @Test
    fun `create with bad did throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyRelationshipException> {
            repo.create(
                familyGroupId = GROUP,
                friendDid = "user:dad",
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = PermissionTemplates.forParentToChild(),
            )
        }
    }

    @Test
    fun `create with too-short did throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyRelationshipException> {
            repo.create(
                familyGroupId = GROUP,
                friendDid = "did:abc",
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = PermissionTemplates.forParentToChild(),
            )
        }
    }

    @Test
    fun `permissions with quiet_hours exceeding cap throws`(): Unit = runBlocking {
        val bad = PermissionTemplates.forParentToChild().copy(
            _quietHoursMaxPerDayMin = 60,
            telemetryQuietHours = listOf(
                QuietHourWindow(start = "20:00", end = "23:00"), // 180 min > cap 60
            ),
        )
        val ex = assertFailsWith<InvalidFamilyPermissionsException> {
            repo.create(
                familyGroupId = GROUP,
                friendDid = CHILD_DID,
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = bad,
            )
        }
        assertTrue(ex.message!!.contains("exceeds cap"))
    }

    @Test
    fun `permissions with negative cap throws`(): Unit = runBlocking {
        val bad = FamilyPermissions(_quietHoursMaxPerDayMin = -1)
        assertFailsWith<InvalidFamilyPermissionsException> {
            repo.create(
                familyGroupId = GROUP,
                friendDid = CHILD_DID,
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = bad,
            )
        }
    }

    @Test
    fun `permissions with cap above 1440 throws`(): Unit = runBlocking {
        val bad = FamilyPermissions(_quietHoursMaxPerDayMin = 1441)
        assertFailsWith<InvalidFamilyPermissionsException> {
            repo.create(
                familyGroupId = GROUP,
                friendDid = CHILD_DID,
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = bad,
            )
        }
    }

    @Test
    fun `create with bad emergency contacts JSON throws`(): Unit = runBlocking {
        assertFailsWith<InvalidFamilyRelationshipException> {
            repo.create(
                familyGroupId = GROUP,
                friendDid = CHILD_DID,
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = PermissionTemplates.forParentToChild(),
                emergencyContactsJson = "{not-json",
            )
        }
    }

    @Test
    fun `create with valid emergency contacts array succeeds`(): Unit = runBlocking {
        val e = repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = PermissionTemplates.forParentToChild(),
            emergencyContactsJson = """[{"name":"12355","phone":"12355","type":"hotline"}]""",
        )
        assertEquals(
            """[{"name":"12355","phone":"12355","type":"hotline"}]""",
            e.emergencyContacts,
        )
    }

    @Test
    fun `updateEmergencyContacts can clear to null`(): Unit = runBlocking {
        val e = repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = PermissionTemplates.forParentToChild(),
            emergencyContactsJson = """[{"name":"110","phone":"110"}]""",
        )
        assertTrue(repo.updateEmergencyContacts(e.id, null))
        val refreshed = repo.findById(e.id)
        assertNull(refreshed?.emergencyContacts)
    }

    @Test
    fun `updateEmergencyContacts with bad JSON throws and does not modify DB`(): Unit =
        runBlocking {
            val e = repo.create(
                familyGroupId = GROUP,
                friendDid = CHILD_DID,
                roleSelf = MemberRole.PARENT,
                roleOther = MemberRole.CHILD,
                permissions = PermissionTemplates.forParentToChild(),
            )
            assertFailsWith<InvalidFamilyRelationshipException> {
                repo.updateEmergencyContacts(e.id, "{broken")
            }
            // DB 未修改
            val refreshed = repo.findById(e.id)
            assertNull(refreshed?.emergencyContacts)
        }

    // ─── Sanity: stored permissions JSON 含 snake_case ───

    @Test
    fun `stored permissions column contains snake_case field names`(): Unit = runBlocking {
        val e = repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = PermissionTemplates.forParentToChild(),
        )
        val raw = e.permissions
        assertTrue(raw.contains("\"telemetry_level\""))
        assertTrue(raw.contains("\"allow_silent_observe\""))
        assertFalse(raw.contains("\"telemetryLevel\""))
    }

    @Test
    fun `inserted relationship is exposed via observeActiveByGroup`(): Unit = runBlocking {
        val e = repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = PermissionTemplates.forParentToChild(),
        )
        val active = db.familyRelationshipDao().observeActive(GROUP)
        val list = active.first()
        assertEquals(1, list.size)
        assertEquals(e.id, list[0].id)
    }

    @Test
    fun `child-to-parent template stored permissions has allow_emergency_unbind true`(): Unit =
        runBlocking {
            val e = repo.create(
                familyGroupId = GROUP,
                friendDid = FamilyFixtures.FIXTURE_PARENT_DID,
                roleSelf = MemberRole.CHILD,
                roleOther = MemberRole.PARENT,
                permissions = PermissionTemplates.forChildToParent(),
            )
            val read = repo.readPermissions(e.id)
            assertNotNull(read)
            assertTrue(read.allowEmergencyUnbind, "child→parent template must allow emergency unbind")
            assertEquals(CompanionSummaryAccess.NEVER, read.allowCompanionSummary)
        }

    @Test
    fun `permission read survives decode after multiple writes`(): Unit = runBlocking {
        val e = repo.create(
            familyGroupId = GROUP,
            friendDid = CHILD_DID,
            roleSelf = MemberRole.PARENT,
            roleOther = MemberRole.CHILD,
            permissions = PermissionTemplates.forParentToChild(),
        )
        // 改 5 次, 每次 decode 还原应该完全相等
        var current = PermissionTemplates.forParentToChild()
        repeat(5) { i ->
            current = current.copy(
                telemetryLevel = if (i % 2 == 0) TelemetryLevel.L0 else TelemetryLevel.L2,
                allowForcePickup = i % 2 == 1,
            )
            assertTrue(repo.updatePermissions(e.id, current))
        }
        val final = repo.readPermissions(e.id)
        assertEquals(current, final)
    }
}

