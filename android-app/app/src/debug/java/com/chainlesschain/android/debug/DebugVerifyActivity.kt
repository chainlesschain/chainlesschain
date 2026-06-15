package com.chainlesschain.android.debug

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.chainlesschain.android.core.common.onError
import com.chainlesschain.android.core.common.onSuccess
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.feature.familyguard.data.codec.InviteTokenCodec
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.AcceptanceCode
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.PermissionTemplates
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.familyguard.domain.service.InvitePairingService
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.presentation.familypairing.LocalDidProvider
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 仅 **debug 构建** 存在 (放 src/debug, release APK 不含)。一个无界面、可被 `adb shell am start`
 * 触发的端到端验证入口。
 *
 * 存在理由: 部分真机 (尤其 MIUI) 拒绝 `adb shell input` 注入 (INJECT_EVENTS), 导致无法用脚本
 * 驱动 UI 做端到端验证; 但 `am start` 不受该限制。本 Activity 让我们在这类锁定设备上仍能跑
 * 真机数据路径验证 (走真实 Room/Repository, 非单测的内存库)。
 *
 * 用法 (debug applicationId 带 .debug 后缀):
 * ```
 * adb shell am start -n com.chainlesschain.android.debug/com.chainlesschain.android.debug.DebugVerifyActivity \
 *   --es op add_friend --es did did:key:zPeer123
 * ```
 * 随后回 App 社交 → 好友列表截图, 应见该 DID 为 **已添加 (ACCEPTED)** 好友 —— 即 #1「扫码加好友」
 * 离线互加逻辑在真机上的证据 (绕过相机/输入注入)。
 */
@AndroidEntryPoint
class DebugVerifyActivity : ComponentActivity() {

    @Inject
    lateinit var friendRepository: FriendRepository

    @Inject
    lateinit var familyGroupRepository: FamilyGroupRepository

    @Inject
    lateinit var familyMembershipRepository: FamilyMembershipRepository

    @Inject
    lateinit var invitePairingService: InvitePairingService

    @Inject
    lateinit var localDidProvider: LocalDidProvider

    @Inject
    lateinit var didManager: DIDManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        when (val op = intent.getStringExtra("op")) {
            "ensure_did" -> ensureDid()
            "add_friend" -> addFriend(intent.getStringExtra("did"))
            "check_friend" -> checkFriend(intent.getStringExtra("did"))
            "family_selftest" -> familySelfTest()
            "family_dump" -> familyDump()
            "family_inject_child" -> familyInjectChild(intent.getStringExtra("did"))
            "create_invite" -> createInvite(intent.getStringExtra("role") == "child")
            "accept_invite" -> acceptInvite(
                intent.getStringExtra("token"),
                intent.getStringExtra("code"),
                intent.getStringExtra("age")?.toIntOrNull() ?: 40,
            )
            else -> {
                log("unknown op: $op")
                toast("[debug] unknown op: $op")
                finish()
            }
        }
    }

    /**
     * #3「家长端看不到家人」数据层的真机验证: 在真实 Room 里建组 + 落一个孩子 membership
     * (这正是 P2P 同步到家长端后该发生的), 再 listAllByGroup 重读, 证孩子 membership 在真机
     * 数据库持久且可被家人页查询取到。家人页的可见性合并 (buildState) 是 module 内 internal,
     * 已由 FamilyMembersViewModelTest / FamilyTwoDeviceBindingTest 单测覆盖; 跨设备 P2P 投递
     * 那一半需两台机。验完删测试组, 不污染真实家庭数据。
     */
    private fun familySelfTest() {
        lifecycleScope.launch {
            val parentDid = "did:key:zDbgParentSelf"
            val childDid = "did:key:zDbgChildSelf"
            val groupId = familyGroupRepository.create(name = "[debug]测试家庭", primaryDid = parentDid).id
            try {
                familyMembershipRepository.addMember(
                    familyGroupId = groupId,
                    memberDid = childDid,
                    role = MemberRole.CHILD,
                    guardianTier = null,
                    deviceId = "dbg-child",
                )
                val memberships = familyMembershipRepository.listAllByGroup(groupId)
                val dids = memberships.map { it.memberDid }
                val childPersisted = dids.contains(childDid)
                log("family_selftest group=$groupId memberships=${memberships.size} dids=$dids childPersisted=$childPersisted")
                toast("[debug] 家庭成员落库 childPersisted=$childPersisted (n=${memberships.size})")
            } catch (e: Exception) {
                log("family_selftest failed: ${e.message}")
                toast("[debug] family_selftest failed: ${e.message}")
            } finally {
                runCatching { familyGroupRepository.delete(groupId) }
                finish()
            }
        }
    }

    private fun addFriend(did: String?) {
        if (did.isNullOrBlank()) {
            log("add_friend missing --es did")
            toast("[debug] missing --es did")
            finish()
            return
        }
        lifecycleScope.launch {
            val friend = FriendEntity(
                did = did,
                nickname = "用户 ${did.take(8)}",
                avatar = null,
                bio = null,
                status = FriendStatus.ACCEPTED,
                addedAt = System.currentTimeMillis(),
            )
            friendRepository.addFriend(friend)
                .onSuccess {
                    // 加完立刻从真实 Room 重新读一次, 把持久化后的状态打到 logcat 作真机证据。
                    friendRepository.getFriendByDid(did)
                        .onSuccess { persisted ->
                            log("add_friend did=$did -> persisted status=${persisted?.status} nickname=${persisted?.nickname}")
                            toast("[debug] added $did status=${persisted?.status}")
                        }
                        .onError { log("add_friend readback failed: ${it.message}") }
                }
                .onError {
                    log("add_friend add failed: ${it.message}")
                    toast("[debug] add failed: ${it.message}")
                }
            finish()
        }
    }

    private fun checkFriend(did: String?) {
        if (did.isNullOrBlank()) {
            log("check_friend missing --es did")
            finish()
            return
        }
        lifecycleScope.launch {
            friendRepository.getFriendByDid(did)
                .onSuccess { f ->
                    log("check_friend did=$did -> ${if (f == null) "NOT FOUND" else "status=${f.status} nickname=${f.nickname}"}")
                    toast("[debug] $did = ${f?.status ?: "NOT FOUND"}")
                }
                .onError { log("check_friend failed: ${it.message}") }
            finish()
        }
    }

    /** 诊断: 打印本机所有 family group + 每组成员数, 看家人页为空到底是没数据还是没显示。 */
    private fun familyDump() {
        lifecycleScope.launch {
            try {
                val groups = familyGroupRepository.observeAll().first()
                log("family_dump groups=${groups.size}")
                groups.forEach { g ->
                    val members = familyMembershipRepository.listAllByGroup(g.id)
                    log("family_dump group id=${g.id} name=${g.name} primaryDid=${g.primaryDid} members=${members.size} dids=${members.map { it.memberDid }}")
                }
                toast("[debug] groups=${groups.size}")
            } catch (e: Exception) {
                log("family_dump failed: ${e.message}")
            } finally {
                finish()
            }
        }
    }

    /**
     * 把一个孩子 membership 注入本机第一个 (或新建的) family group —— **模拟 P2P 把孩子绑定
     * 投递到家长端后该有的状态**。注入后家长「家人」页应能显示该孩子 (验证显示侧修复在真机生效;
     * 真实的跨设备投递是另一半, 需 live P2P)。不清理, 以便随后截图。
     */
    private fun familyInjectChild(childDid: String?) {
        val did = childDid?.takeIf { it.isNotBlank() } ?: "did:key:zChildDemo0001"
        lifecycleScope.launch {
            try {
                val groups = familyGroupRepository.observeAll().first()
                val groupId = groups.firstOrNull()?.id
                    ?: familyGroupRepository.create(name = "我的家庭", primaryDid = "did:key:zParentDemo0001").id
                runCatching {
                    familyMembershipRepository.addMember(
                        familyGroupId = groupId,
                        memberDid = did,
                        role = MemberRole.CHILD,
                        guardianTier = null,
                        deviceId = "child-demo-device",
                    )
                }
                val members = familyMembershipRepository.listAllByGroup(groupId)
                log("family_inject_child group=$groupId child=$did members=${members.size} dids=${members.map { it.memberDid }}")
                toast("[debug] 已注入孩子, 组内成员=${members.size}")
            } catch (e: Exception) {
                log("family_inject_child failed: ${e.message}")
                toast("[debug] inject failed: ${e.message}")
            } finally {
                finish()
            }
        }
    }

    /**
     * #3 端到端 (对称配对): 本机生成邀请 (角色由 [asChild] 定)。用本机真实 did:key + 只复用
     * primaryDid 匹配的组 (同 ensureLocalGroup 修复)。把 token + 接受码打到 logcat, 供对端 accept。
     */
    private fun createInvite(asChild: Boolean) {
        lifecycleScope.launch {
            try {
                val did = localDidProvider.currentDid()
                if (did.isNullOrBlank()) {
                    log("create_invite no local DID (先在「本机角色」建身份)")
                    toast("[debug] 本机无 DID, 先设角色")
                    finish()
                    return@launch
                }
                val groups = familyGroupRepository.observeAll().first()
                val groupId = groups.firstOrNull { it.primaryDid == did }?.id
                    ?: familyGroupRepository.create(name = "我的家庭", primaryDid = did).id
                val result = invitePairingService.createInvite(
                    familyGroupId = groupId,
                    inviterDid = did,
                    inviterRole = if (asChild) MemberRole.CHILD else MemberRole.PARENT,
                    inviterTier = if (asChild) GuardianTier.SECONDARY else GuardianTier.PRIMARY,
                    inviteeRole = if (asChild) MemberRole.PARENT else MemberRole.CHILD,
                    inviteeTier = if (asChild) GuardianTier.PRIMARY else null,
                    proposedPermissions = if (asChild) PermissionTemplates.forChildToParent() else PermissionTemplates.forParentToChild(),
                    expectedChildAge = if (asChild) null else 15,
                )
                val token = InviteTokenCodec.encode(result.signedInvite)
                log("create_invite asChild=$asChild inviterDid=$did group=$groupId code=${result.acceptanceCode.value}")
                log("create_invite TOKEN=$token")
                toast("[debug] 邀请已生成 code=${result.acceptanceCode.value}")
            } catch (e: Exception) {
                log("create_invite failed: ${e.message}")
                toast("[debug] create_invite failed: ${e.message}")
            } finally {
                finish()
            }
        }
    }

    /**
     * #3 端到端: 本机接受对端邀请。本机用真实 did:key。accept 成功后对端 (inviter) 会被写为
     * 本机的家人 (membership + relationship) → 家人页即可见对方 (无需 P2P, 走对称配对)。
     */
    private fun acceptInvite(token: String?, code: String?, age: Int) {
        lifecycleScope.launch {
            try {
                val did = localDidProvider.currentDid()
                if (did.isNullOrBlank()) { log("accept_invite no local DID"); finish(); return@launch }
                if (token.isNullOrBlank() || code.isNullOrBlank()) {
                    log("accept_invite missing token/code")
                    finish()
                    return@launch
                }
                val result = invitePairingService.acceptInvite(
                    qrPayload = token,
                    acceptanceCode = AcceptanceCode(code),
                    accepteeDid = did,
                    accepteeDeviceId = "debug-accept-device",
                    reportedChildAge = age,
                    childPermissions = PermissionTemplates.forParentToChild(),
                    forceKycAck = true,
                )
                log("accept_invite accepteeDid=$did result=${result::class.simpleName}")
                // 接受后 dump 各组成员, 看对端是否已成为本机家人。
                val groups = familyGroupRepository.observeAll().first()
                groups.forEach { g ->
                    val members = familyMembershipRepository.listAllByGroup(g.id)
                    log("accept_invite after: group=${g.id} primaryDid=${g.primaryDid} members=${members.map { it.memberDid }}")
                }
                toast("[debug] accept_invite -> ${result::class.simpleName}")
            } catch (e: Exception) {
                log("accept_invite failed: ${e.message}")
                toast("[debug] accept_invite failed: ${e.message}")
            } finally {
                finish()
            }
        }
    }

    /**
     * 若本机还没有 DID 身份, 创建一个真实 did:key (off-main 避免 keystore ANR)。家长设备此前
     * 只设了「本机角色」却没建 DID (RoleSelector 不创建身份) → 配对/同步都失败。供真机 E2E 补身份。
     */
    private fun ensureDid() {
        lifecycleScope.launch {
            try {
                val existing = didManager.getCurrentDID()
                if (existing != null) {
                    log("ensure_did already=$existing")
                    toast("[debug] DID=$existing")
                    finish()
                    return@launch
                }
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    didManager.createIdentity("debug-parent-device")
                }
                log("ensure_did created=${didManager.getCurrentDID()}")
                toast("[debug] DID created=${didManager.getCurrentDID()}")
            } catch (e: Exception) {
                log("ensure_did failed: ${e.message}")
                toast("[debug] ensure_did failed: ${e.message}")
            } finally {
                finish()
            }
        }
    }

    private fun log(msg: String) = android.util.Log.i("CC_DEBUG_VERIFY", msg)

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
