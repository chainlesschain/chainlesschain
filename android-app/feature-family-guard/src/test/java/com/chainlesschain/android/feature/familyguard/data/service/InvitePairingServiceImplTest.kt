package com.chainlesschain.android.feature.familyguard.data.service

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.codec.InviteTokenCodec
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyGroupRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyMembershipRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyRelationshipRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.RevivalCodeRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.AcceptanceCode
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.InvitePayload
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.PairingResult
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.PermissionTemplates
import com.chainlesschain.android.feature.familyguard.domain.service.InvitePairingService
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupSyncRecord
import com.chainlesschain.android.feature.familyguard.fixtures.FakeInviteSigner
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
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
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-13 端到端集成测试. 走真 Room in-memory, 真 SQLCipher? 否 —
 * inMemoryDatabaseBuilder 旁路 SQLCipher (FAMILY-02 设计决策).
 * 真 SQLCipher 端到端走 androidTest (留 FAMILY-66 e2e 套件)。
 *
 * 测试场景全覆盖 PairingResult sealed:
 *   - Success (happy path, 14+ child)
 *   - MalformedQr / InvalidSignature / Expired / WrongAcceptanceCode
 *   - KycRequired (<14) + forceKycAck bypass
 *   - UnknownFamilyGroup / AlreadyMember
 *   - 端到端 DB 状态校验 (FamilyMembership + FamilyRelationship + RevivalCode)
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class InvitePairingServiceImplTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var service: InvitePairingServiceImpl
    private lateinit var groupRepo: FamilyGroupRepositoryImpl

    private val signer = FakeInviteSigner()
    private val baseClockMs = FamilyFixtures.FIXTURE_TIME_MS

    /** 记录 enqueue 调用的 fake outbox (验 createInvite 排同步)。 */
    private class RecordingFamilyGroupOutbox : FamilyGroupOutbox {
        val enqueued = mutableListOf<Pair<FamilyGroupSyncRecord, List<String>>>()
        override suspend fun enqueue(record: FamilyGroupSyncRecord, targetDids: List<String>) {
            enqueued += record to targetDids
        }
    }

    private lateinit var groupOutbox: RecordingFamilyGroupOutbox

    private fun clockAt(ms: Long): Clock =
        Clock.fixed(Instant.ofEpochMilli(ms), ZoneOffset.UTC)

    private fun seededRandom(seed: Long = 42L): SecureRandom =
        SecureRandom.getInstance("SHA1PRNG").apply { setSeed(seed) }

    private fun rebuildService(clockMs: Long = baseClockMs) {
        val clock = clockAt(clockMs)
        groupRepo = FamilyGroupRepositoryImpl(db.familyGroupDao(), clock, seededRandom(1L))
        groupOutbox = RecordingFamilyGroupOutbox()
        service = InvitePairingServiceImpl(
            familyGroupRepository = groupRepo,
            familyMembershipRepository = FamilyMembershipRepositoryImpl(
                familyMembershipDao = db.familyMembershipDao(),
                clock = clock,
            ),
            familyRelationshipRepository = FamilyRelationshipRepositoryImpl(
                familyRelationshipDao = db.familyRelationshipDao(),
                clock = clock,
            ),
            revivalCodeRepository = RevivalCodeRepositoryImpl(
                revivalCodeDao = db.revivalCodeDao(),
                clock = clock,
                secureRandom = seededRandom(99L),
            ),
            inviteSigner = signer,
            familyGroupOutbox = groupOutbox,
            clock = clock,
            secureRandom = seededRandom(),
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
        rebuildService()
    }

    @After
    fun tearDown() {
        db.close()
    }

    private suspend fun seedGroup(): String {
        val g = groupRepo.create(
            name = "陈家",
            primaryDid = "did:chain:dad-primary",
        )
        return g.id
    }

    private suspend fun mintInvite(
        groupId: String,
        expectedChildAge: Int? = 10,
    ): InvitePairingService.CreateInviteResult = service.createInvite(
        familyGroupId = groupId,
        inviterDid = "did:chain:dad",
        inviterRole = MemberRole.PARENT,
        inviterTier = GuardianTier.PRIMARY,
        inviteeRole = MemberRole.CHILD,
        inviteeTier = null,
        proposedPermissions = PermissionTemplates.forParentToChild(),
        expectedChildAge = expectedChildAge,
    )

    // ─── createInvite ───

    @Test
    fun `createInvite returns 6-digit acceptance code and signed payload`(): Unit = runBlocking {
        val groupId = seedGroup()
        val result = mintInvite(groupId)

        assertEquals(6, result.acceptanceCode.value.length)
        assertTrue(result.acceptanceCode.value.all { it.isDigit() })

        // payloadJson + sig 应该可解
        val invite = result.signedInvite
        val payload = invite.decodePayload()
        assertEquals(groupId, payload.familyGroupId)
        assertEquals("did:chain:dad", payload.inviterDid)
        assertEquals(MemberRole.PARENT, payload.inviterRole)
        assertEquals(MemberRole.CHILD, payload.inviteeRole)
        assertEquals(baseClockMs + InvitePayload.DEFAULT_TTL_MS, payload.expiresAtMs)
    }

    @Test
    fun `createInvite signature verifies via signer`(): Unit = runBlocking {
        val groupId = seedGroup()
        val result = mintInvite(groupId)
        val invite = result.signedInvite

        val sigBytes = java.util.Base64.getUrlDecoder().decode(invite.signatureB64)
        val payloadBytes = invite.payloadJson.toByteArray(Charsets.UTF_8)
        assertTrue(signer.verify("did:chain:dad", payloadBytes, sigBytes))
    }

    @Test
    fun `createInvite enqueues family group to sync outbox`(): Unit = runBlocking {
        val groupId = seedGroup()
        mintInvite(groupId)

        assertEquals(1, groupOutbox.enqueued.size)
        val (record, targets) = groupOutbox.enqueued.first()
        assertEquals(groupId, record.id)
        assertEquals("陈家", record.name)
        assertEquals("did:chain:dad-primary", record.primaryDid)
        assertEquals(listOf("did:chain:dad-primary"), targets)
    }

    @Test
    fun `createInvite does not enqueue when family group missing`(): Unit = runBlocking {
        // 组不存在时不排同步 (findById 为 null)。
        mintInvite("group-does-not-exist")
        assertTrue(groupOutbox.enqueued.isEmpty())
    }

    // ─── acceptInvite happy path ───

    @Test
    fun `acceptInvite end-to-end writes membership + relationship + revival code`(): Unit =
        runBlocking {
            val groupId = seedGroup()
            val invite = mintInvite(groupId, expectedChildAge = 15)
            val qr = InviteTokenCodec.encode(invite.signedInvite)

            val result = service.acceptInvite(
                qrPayload = qr,
                acceptanceCode = invite.acceptanceCode,
                accepteeDid = "did:chain:kid",
                accepteeDeviceId = "dev-kid",
                reportedChildAge = 15,
                childPermissions = PermissionTemplates.forChildToParent(),
            )

            val success = assertIs<PairingResult.Success>(result)
            assertEquals("did:chain:dad", success.relationship.friendDid)
            assertEquals("child", success.relationship.roleSelf)
            assertEquals("parent", success.relationship.roleOther)
            assertEquals("primary", success.relationship.guardianTierOther)
            assertEquals(6, success.revivalCode.value.length)

            // DB 端: membership 1 + relationship 1 + revival code 1
            assertEquals(1, db.familyMembershipDao().listByGroup(groupId).size)
            assertEquals(
                "did:chain:kid",
                db.familyMembershipDao().listByGroup(groupId)[0].memberDid,
            )
            assertNotNull(db.familyRelationshipDao().findById(success.relationship.id))
            assertEquals(1, db.revivalCodeDao().listAvailable().size)
            assertEquals(
                success.relationship.id,
                db.revivalCodeDao().listAvailable()[0].familyRelationshipId,
            )
        }

    // ─── FAMILY-26: 内嵌 family_group 快照 (双机扫码即绑定) ───

    @Test
    fun `createInvite embeds family group snapshot in payload`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId)
        val snap = invite.signedInvite.decodePayload().groupSnapshot
        assertNotNull(snap)
        assertEquals(groupId, snap.id)
        assertEquals("陈家", snap.name)
        assertEquals("did:chain:dad-primary", snap.primaryDid)
    }

    @Test
    fun `acceptInvite materializes embedded group snapshot when local group absent`(): Unit =
        runBlocking {
            val groupId = seedGroup()
            val invite = mintInvite(groupId, expectedChildAge = 15)
            val qr = InviteTokenCodec.encode(invite.signedInvite)

            // 模拟孩子端: 本地无此 family_group, 但邀请内嵌了快照。
            db.familyGroupDao().deleteById(groupId)
            assertNull(db.familyGroupDao().findById(groupId))

            val result = service.acceptInvite(
                qrPayload = qr,
                acceptanceCode = invite.acceptanceCode,
                accepteeDid = "did:chain:kid",
                accepteeDeviceId = "dev-kid",
                reportedChildAge = 15,
                childPermissions = PermissionTemplates.forChildToParent(),
            )

            assertIs<PairingResult.Success>(result)
            // 组据内嵌快照物化, 原 id 保留 → 两端 family_group 收敛。
            val materialized = db.familyGroupDao().findById(groupId)
            assertNotNull(materialized)
            assertEquals("陈家", materialized.name)
        }

    @Test
    fun `parent accepting a child-generated invite writes parent-to-child relationship (bidirectional)`(): Unit =
        runBlocking {
            val groupId = seedGroup()
            // 对称配对反向: 孩子端生成"邀请家长"的邀请。
            val invite = service.createInvite(
                familyGroupId = groupId,
                inviterDid = "did:chain:kid",
                inviterRole = MemberRole.CHILD,
                inviterTier = GuardianTier.SECONDARY,
                inviteeRole = MemberRole.PARENT,
                inviteeTier = GuardianTier.PRIMARY,
                proposedPermissions = PermissionTemplates.forChildToParent(),
                expectedChildAge = null,
            )
            val qr = InviteTokenCodec.encode(invite.signedInvite)
            // 家长接受 (成年年龄, 不触发 KYC)。
            val result = service.acceptInvite(
                qrPayload = qr,
                acceptanceCode = invite.acceptanceCode,
                accepteeDid = "did:chain:dad",
                accepteeDeviceId = "dev-dad",
                reportedChildAge = 40,
                childPermissions = PermissionTemplates.forParentToChild(),
            )
            val success = assertIs<PairingResult.Success>(result)
            assertEquals("did:chain:kid", success.relationship.friendDid)
            assertEquals("parent", success.relationship.roleSelf)
            assertEquals("child", success.relationship.roleOther)
            // 家长端写入了自己的 membership(parent) → 家长「家人」页据此 + relationship 看到孩子。
            val members = db.familyMembershipDao().listByGroup(groupId)
            assertEquals("did:chain:dad", members.single().memberDid)
            assertEquals("parent", members.single().role)
        }

    // ─── Failure paths ───

    @Test
    fun `acceptInvite returns MalformedQr for garbage input`(): Unit = runBlocking {
        seedGroup()
        val result = service.acceptInvite(
            qrPayload = "this-is-not-base64-json",
            acceptanceCode = AcceptanceCode("123456"),
            accepteeDid = "did:chain:kid",
            accepteeDeviceId = "dev-kid",
            reportedChildAge = 15,
            childPermissions = PermissionTemplates.forChildToParent(),
        )
        assertIs<PairingResult.MalformedQr>(result)
    }

    @Test
    fun `acceptInvite returns InvalidSignature when sig tampered`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId)
        val tampered = invite.signedInvite.copy(
            signatureB64 = "AAAA" + invite.signedInvite.signatureB64.drop(4),
        )
        val qr = InviteTokenCodec.encode(tampered)

        val result = service.acceptInvite(
            qrPayload = qr,
            acceptanceCode = invite.acceptanceCode,
            accepteeDid = "did:chain:kid",
            accepteeDeviceId = "dev-kid",
            reportedChildAge = 15,
            childPermissions = PermissionTemplates.forChildToParent(),
        )
        assertIs<PairingResult.InvalidSignature>(result)
    }

    @Test
    fun `acceptInvite returns Expired when TTL passed`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId)
        val qr = InviteTokenCodec.encode(invite.signedInvite)

        // 把 clock 推后 11 min (> 10 min TTL)
        rebuildService(clockMs = baseClockMs + InvitePayload.DEFAULT_TTL_MS + 1)

        // 但 group + 重建的 service 没有看到旧 group; 重新 seed
        val gId = seedGroup()
        // 注意: 用旧 invite 但新 service, group_id 仍可解 (invite payload 内嵌的)。
        // 由于新 group id 与旧 invite 的 group id 不同, 这测试得用 stable group id 才能精准测 Expired。
        // 改写: 重建 service 但跳过 seedGroup, 因 invite payload 含的 groupId 已不存在;
        // 测试目标只是 "TTL 检查在 group 检查前" — 我们用 invite 原 groupId 测试。
        val expiredResult = service.acceptInvite(
            qrPayload = qr,
            acceptanceCode = invite.acceptanceCode,
            accepteeDid = "did:chain:kid",
            accepteeDeviceId = "dev-kid",
            reportedChildAge = 15,
            childPermissions = PermissionTemplates.forChildToParent(),
        )
        assertIs<PairingResult.Expired>(expiredResult)
    }

    @Test
    fun `acceptInvite returns WrongAcceptanceCode when wrong code`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId)
        val qr = InviteTokenCodec.encode(invite.signedInvite)

        // 用一个保证不同的 6 位码
        val wrong = if (invite.acceptanceCode.value == "111111") AcceptanceCode("222222")
        else AcceptanceCode("111111")

        val result = service.acceptInvite(
            qrPayload = qr,
            acceptanceCode = wrong,
            accepteeDid = "did:chain:kid",
            accepteeDeviceId = "dev-kid",
            reportedChildAge = 15,
            childPermissions = PermissionTemplates.forChildToParent(),
        )
        assertIs<PairingResult.WrongAcceptanceCode>(result)
    }

    @Test
    fun `acceptInvite returns KycRequired for child under 14`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId, expectedChildAge = 8)
        val qr = InviteTokenCodec.encode(invite.signedInvite)

        val result = service.acceptInvite(
            qrPayload = qr,
            acceptanceCode = invite.acceptanceCode,
            accepteeDid = "did:chain:kid",
            accepteeDeviceId = "dev-kid",
            reportedChildAge = 8,
            childPermissions = PermissionTemplates.forChildToParent(),
        )

        val kyc = assertIs<PairingResult.KycRequired>(result)
        assertEquals(8, kyc.expectedChildAge)
        assertEquals(8, kyc.reportedChildAge)

        // DB 未写
        assertEquals(0, db.familyMembershipDao().listByGroup(groupId).size)
    }

    @Test
    fun `acceptInvite proceeds when forceKycAck true for under-14 child`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId, expectedChildAge = 8)
        val qr = InviteTokenCodec.encode(invite.signedInvite)

        val result = service.acceptInvite(
            qrPayload = qr,
            acceptanceCode = invite.acceptanceCode,
            accepteeDid = "did:chain:kid",
            accepteeDeviceId = "dev-kid",
            reportedChildAge = 8,
            childPermissions = PermissionTemplates.forChildToParent(),
            forceKycAck = true,
        )
        assertIs<PairingResult.Success>(result)
    }

    @Test
    fun `acceptInvite returns UnknownFamilyGroup when group does not exist`(): Unit =
        runBlocking {
            // 不 seed group; invite 仍可 mint (createInvite 不验 group 存在), 但 accept 时 group 缺
            val invite = mintInvite("non-existent-group", expectedChildAge = 15)
            val qr = InviteTokenCodec.encode(invite.signedInvite)

            val result = service.acceptInvite(
                qrPayload = qr,
                acceptanceCode = invite.acceptanceCode,
                accepteeDid = "did:chain:kid",
                accepteeDeviceId = "dev-kid",
                reportedChildAge = 15,
                childPermissions = PermissionTemplates.forChildToParent(),
            )
            assertIs<PairingResult.UnknownFamilyGroup>(result)
        }

    @Test
    fun `acceptInvite returns AlreadyMember when second accept on active relationship`(): Unit =
        runBlocking {
            val groupId = seedGroup()
            val invite = mintInvite(groupId, expectedChildAge = 15)
            val qr = InviteTokenCodec.encode(invite.signedInvite)

            // 第一次 accept
            val first = service.acceptInvite(
                qrPayload = qr,
                acceptanceCode = invite.acceptanceCode,
                accepteeDid = "did:chain:kid",
                accepteeDeviceId = "dev-kid",
                reportedChildAge = 15,
                childPermissions = PermissionTemplates.forChildToParent(),
            )
            assertIs<PairingResult.Success>(first)

            // 第二次 accept 同 invite — 已 active
            val second = service.acceptInvite(
                qrPayload = qr,
                acceptanceCode = invite.acceptanceCode,
                accepteeDid = "did:chain:kid",
                accepteeDeviceId = "dev-kid-2",
                reportedChildAge = 15,
                childPermissions = PermissionTemplates.forChildToParent(),
            )
            assertIs<PairingResult.AlreadyMember>(second)
        }

    // ─── Sanity: codec round-trip ───

    @Test
    fun `InviteTokenCodec round-trip preserves SignedInvite`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId)

        val qr = InviteTokenCodec.encode(invite.signedInvite)
        val decoded = InviteTokenCodec.decode(qr)
        assertEquals(invite.signedInvite, decoded)
    }

    @Test
    fun `InviteTokenCodec decode trims whitespace`(): Unit = runBlocking {
        val groupId = seedGroup()
        val invite = mintInvite(groupId)
        val qr = InviteTokenCodec.encode(invite.signedInvite)
        val padded = "  $qr\n"

        val decoded = InviteTokenCodec.decode(padded)
        assertEquals(invite.signedInvite, decoded)
    }
}
