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
import com.chainlesschain.android.feature.familyguard.data.sync.NoOpFamilyGroupOutbox
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.PairingResult
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.PermissionTemplates
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.fixtures.FakeInviteSigner
import com.chainlesschain.android.feature.familyguard.presentation.family.FamilyMembersViewModel
import io.mockk.mockk
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 真·两设备绑定端到端测试 (FAMILY-13/26)。两个**独立的** FamilyGuardDatabase 模拟两台手机,
 * 各自的 service/repos, 跑完整对称双向流程, 断言两端「家人」页都能看到对方。
 *
 * 覆盖三件事的端到端正确性 (无需真机):
 *   1. 邀请内嵌 group 快照 → 孩子端本地无组也能 acceptInvite (不再 UnknownFamilyGroup)。
 *   2. 对称配对: 家长邀孩子 + 孩子邀家长, 两端各写 relationship。
 *   3. FamilyMembersViewModel.buildState 把"仅 relationship 的对端"也显示 → 双向可见。
 *
 * 签名用 FakeInviteSigner 共享 secret 模拟"验签通过"(真 did:key 跨设备验签由
 * DidManagerInviteSigner + InvitePairingServiceImplTest 反向用例覆盖)。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyTwoDeviceBindingTest {

    private val clock: Clock = Clock.fixed(Instant.ofEpochMilli(1_700_000_000_000L), ZoneOffset.UTC)
    private val signer = FakeInviteSigner() // 同 secret = 跨"设备"验签通过

    /** DID → 设备, 让"出站 outbox"能把记录投递到目标设备 (模拟 P2P 送达)。 */
    private val devicesByDid = mutableMapOf<String, Device>()

    /** 跨设备 membership outbox: enqueue 即把记录写到 targetDid 对应设备的本地库 (模拟 P2P)。 */
    private inner class CrossDeviceMembershipOutbox :
        com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipOutbox {
        override suspend fun enqueue(
            record: com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipSyncRecord,
            targetDids: List<String>,
        ) {
            targetDids.forEach { did -> devicesByDid[did]?.membershipRepo?.upsertReplica(record) }
        }
    }

    /** 一台"设备": 独立 DB + 全套 repo + service。 */
    private inner class Device(seed: Long) {
        val db: FamilyGuardDatabase = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        ).allowMainThreadQueries().build()

        val groupRepo: FamilyGroupRepository = FamilyGroupRepositoryImpl(db.familyGroupDao(), clock, rnd(seed))
        val membershipRepo: FamilyMembershipRepository =
            FamilyMembershipRepositoryImpl(db.familyMembershipDao(), clock)
        val relationshipRepo: FamilyRelationshipRepository =
            FamilyRelationshipRepositoryImpl(db.familyRelationshipDao(), clock)
        val service = InvitePairingServiceImpl(
            familyGroupRepository = groupRepo,
            familyMembershipRepository = membershipRepo,
            familyRelationshipRepository = relationshipRepo,
            revivalCodeRepository = RevivalCodeRepositoryImpl(db.revivalCodeDao(), clock, rnd(seed + 1)),
            inviteSigner = signer,
            familyGroupOutbox = NoOpFamilyGroupOutbox(),
            familyMembershipOutbox = CrossDeviceMembershipOutbox(),
            clock = clock,
            secureRandom = rnd(seed + 2),
        )

        /** 该设备「家人」页会显示的成员 did 集合 (走真实 buildState 合并逻辑)。 */
        fun visibleMemberDids(groupId: String): Set<String> = runBlocking {
            val memberships = db.familyMembershipDao().listByGroup(groupId)
            val relationships = relationshipRepo.observeActiveByGroup(groupId).first()
            vm.buildState(memberships, relationships, emptyList(), "家").members.map { it.memberDid }.toSet()
        }
    }

    private fun rnd(seed: Long) = SecureRandom.getInstance("SHA1PRNG").apply { setSeed(seed) }

    // buildState 是 pure 函数, 用 mockk repos 构造仅为调它。
    private val vm = FamilyMembersViewModel(
        familyGroupRepository = mockk(relaxed = true),
        familyMembershipRepository = mockk(relaxed = true),
        familyRelationshipRepository = mockk(relaxed = true),
        sosEventDao = mockk(relaxed = true),
    )

    private lateinit var parent: Device
    private lateinit var child: Device

    private val parentDid = "did:key:zParentAAAAAAAA"
    private val childDid = "did:key:zChildBBBBBBBBB"

    @After
    fun tearDown() {
        if (::parent.isInitialized) parent.db.close()
        if (::child.isInitialized) child.db.close()
    }

    @Test
    fun `child membership auto-syncs to parent so parent sees child without reverse invite`() = runBlocking {
        parent = Device(seed = 1L)
        child = Device(seed = 100L)
        devicesByDid[parentDid] = parent
        devicesByDid[childDid] = child

        val groupId = parent.groupRepo.create(name = "陈家", primaryDid = parentDid).id
        val invite = parent.service.createInvite(
            familyGroupId = groupId,
            inviterDid = parentDid,
            inviterRole = MemberRole.PARENT,
            inviterTier = GuardianTier.PRIMARY,
            inviteeRole = MemberRole.CHILD,
            inviteeTier = null,
            proposedPermissions = PermissionTemplates.forParentToChild(),
            expectedChildAge = 15,
        )
        // 孩子单向接受 (无反向邀请)。acceptInvite 内 enqueue 孩子 membership → 经 CrossDevice
        // outbox 投递到家长设备 → 家长库写入孩子 membership。
        val accept = child.service.acceptInvite(
            qrPayload = InviteTokenCodec.encode(invite.signedInvite),
            acceptanceCode = invite.acceptanceCode,
            accepteeDid = childDid,
            accepteeDeviceId = "child-device",
            reportedChildAge = 15,
            childPermissions = PermissionTemplates.forChildToParent(),
        )
        assertIs<PairingResult.Success>(accept)
        // 仅靠 membership 同步 (无反向邀请), 家长端家人页已显示孩子。
        assertTrue(
            parent.visibleMemberDids(groupId).contains(childDid),
            "parent should see child via membership sync (no reverse invite)",
        )
    }

    @Test
    fun `two devices bind bidirectionally and each sees the other in family list`() = runBlocking {
        parent = Device(seed = 1L)
        child = Device(seed = 100L)
        devicesByDid[parentDid] = parent
        devicesByDid[childDid] = child

        // 家长建组 (只在家长 DB)。
        val groupId = parent.groupRepo.create(name = "陈家", primaryDid = parentDid).id

        // ── 方向 1: 家长邀孩子 → 孩子接受 ──
        val invite1 = parent.service.createInvite(
            familyGroupId = groupId,
            inviterDid = parentDid,
            inviterRole = MemberRole.PARENT,
            inviterTier = GuardianTier.PRIMARY,
            inviteeRole = MemberRole.CHILD,
            inviteeTier = null,
            proposedPermissions = PermissionTemplates.forParentToChild(),
            expectedChildAge = 15,
        )
        // 孩子设备本地没有这个 group (关键: 靠邀请内嵌快照物化)。
        assertNull(child.db.familyGroupDao().findById(groupId))
        val accept1 = child.service.acceptInvite(
            qrPayload = InviteTokenCodec.encode(invite1.signedInvite),
            acceptanceCode = invite1.acceptanceCode,
            accepteeDid = childDid,
            accepteeDeviceId = "child-device",
            reportedChildAge = 15,
            childPermissions = PermissionTemplates.forChildToParent(),
        )
        assertIs<PairingResult.Success>(accept1)
        // 组已据内嵌快照在孩子 DB 物化。
        assertNotNull(child.db.familyGroupDao().findById(groupId))
        // 孩子端家人页能看到家长 (+ 自己)。
        val childView = child.visibleMemberDids(groupId)
        assertTrue(childView.contains(parentDid), "child should see parent")
        assertTrue(childView.contains(childDid), "child should see self")

        // ── 方向 2: 孩子邀家长 → 家长接受 (对称, 让家长端也可见) ──
        val invite2 = child.service.createInvite(
            familyGroupId = groupId,
            inviterDid = childDid,
            inviterRole = MemberRole.CHILD,
            inviterTier = GuardianTier.SECONDARY,
            inviteeRole = MemberRole.PARENT,
            inviteeTier = GuardianTier.PRIMARY,
            proposedPermissions = PermissionTemplates.forChildToParent(),
            expectedChildAge = null,
        )
        val accept2 = parent.service.acceptInvite(
            qrPayload = InviteTokenCodec.encode(invite2.signedInvite),
            acceptanceCode = invite2.acceptanceCode,
            accepteeDid = parentDid,
            accepteeDeviceId = "parent-device",
            reportedChildAge = 40, // 成年, 不触发 KYC
            childPermissions = PermissionTemplates.forParentToChild(),
        )
        assertIs<PairingResult.Success>(accept2)
        // 家长端家人页现在能看到孩子 (+ 自己) —— 这正是之前"家长端看不到"的修复点。
        val parentView = parent.visibleMemberDids(groupId)
        assertTrue(parentView.contains(childDid), "parent should see child")
        assertTrue(parentView.contains(parentDid), "parent should see self")
    }
}
