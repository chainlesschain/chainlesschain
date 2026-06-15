package com.chainlesschain.android.debug

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.chainlesschain.android.core.common.onError
import com.chainlesschain.android.core.common.onSuccess
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import dagger.hilt.android.AndroidEntryPoint
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        when (val op = intent.getStringExtra("op")) {
            "add_friend" -> addFriend(intent.getStringExtra("did"))
            "check_friend" -> checkFriend(intent.getStringExtra("did"))
            "family_selftest" -> familySelfTest()
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

    private fun log(msg: String) = android.util.Log.i("CC_DEBUG_VERIFY", msg)

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
