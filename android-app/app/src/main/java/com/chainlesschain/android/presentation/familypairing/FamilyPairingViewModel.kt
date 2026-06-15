package com.chainlesschain.android.presentation.familypairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.data.codec.InviteTokenCodec
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.AcceptanceCode
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.PairingResult
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.service.InvitePairingService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 本机角色：先选「我是家长 / 我是孩子」。 */
enum class PairingMode { CHOOSE, PARENT, CHILD }

/** 选定角色后的动作：菜单 / 生成邀请给对方 / 接受对方邀请。两侧对称, 双向各做一次即互相可见。 */
enum class PairingAction { MENU, GENERATE, ACCEPT }

data class FamilyPairingUiState(
    val mode: PairingMode = PairingMode.CHOOSE,
    val action: PairingAction = PairingAction.MENU,
    val busy: Boolean = false,
    // ─── 家长端生成的邀请 (一次性给 UI 展示) ───
    /** [InviteTokenCodec] 编码后的 SignedInvite, 渲染成二维码 / 可复制文本。 */
    val inviteToken: String? = null,
    /** 明文 6 位接受码; 走线下/IM 告知孩子 (二维码里只含 hash)。 */
    val acceptanceCode: String? = null,
    // ─── 孩子端接受结果 ───
    val pairedRelationshipId: Long? = null,
    /** 绑定成功后一次性显示的复活码 (用户记下后即让出引用)。 */
    val revivalCode: String? = null,
    /** 自报年龄 < 14 → 需监护人确认实名 (UI 弹确认后再 forceKycAck 重试)。 */
    val kycPending: Boolean = false,
    /** snackbar 反馈; UI 弹完调 [consumeMessage] 清。 */
    val message: String? = null,
)

/**
 * 家长↔孩子配对绑定屏的 ViewModel (FAMILY-13 协议层接 UI)。
 *
 * 把已实装且单测透的 [InvitePairingService.createInvite] / [acceptInvite] 协议接到界面：
 *   - 家长端：[createInvite] → 生成 SignedInvite (二维码) + 明文接受码。
 *   - 孩子端：[acceptInvite] → 验签 / TTL / 接受码 / KYC 年龄门 → 写 membership +
 *     relationship + 复活码，成功一次性显示复活码。
 *
 * **本机 demo 口径**（同 [com.chainlesschain.android.presentation.familyrewards.FamilyRewardsViewModel]）：
 * 用 demo DID 常量，单设备同库时 createInvite 建的 family_group 在 acceptInvite 时能查到，
 * 故单机即可端到端跑通绑定。真实双机绑定还需：真 DID 接入、family_group 经 P2P 同步到孩子端
 * (否则孩子端 [PairingResult.UnknownFamilyGroup])、二维码摄像头扫描 —— 均为设备阻塞 follow-up。
 */
@HiltViewModel
class FamilyPairingViewModel @Inject constructor(
    private val pairingService: InvitePairingService,
    private val familyGroupRepository: FamilyGroupRepository,
    private val localDidProvider: LocalDidProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FamilyPairingUiState())
    val uiState: StateFlow<FamilyPairingUiState> = _uiState.asStateFlow()

    fun chooseParent() = _uiState.update { it.copy(mode = PairingMode.PARENT, action = PairingAction.MENU) }
    fun chooseChild() = _uiState.update { it.copy(mode = PairingMode.CHILD, action = PairingAction.MENU) }

    /** 进入「生成邀请给对方」(清上一轮 token)。 */
    fun startGenerate() =
        _uiState.update { it.copy(action = PairingAction.GENERATE, inviteToken = null, acceptanceCode = null) }

    /** 进入「接受对方的邀请」(清上一轮结果)。 */
    fun startAccept() =
        _uiState.update { it.copy(action = PairingAction.ACCEPT, revivalCode = null, pairedRelationshipId = null) }

    /** 返回该角色的动作菜单。 */
    fun backToMenu() = _uiState.update { it.copy(action = PairingAction.MENU) }

    /** 返回角色选择，清掉上一轮生成/接受的敏感态 (token/接受码/复活码)。 */
    fun reset() {
        _uiState.value = FamilyPairingUiState()
    }

    fun consumeMessage() = _uiState.update { it.copy(message = null) }

    fun dismissKyc() = _uiState.update { it.copy(kycPending = false) }

    /**
     * 生成邀请二维码 + 明文接受码。角色对称：本机是家长则邀请孩子, 是孩子则邀请家长。
     * 双向各生成+接受一次, 两端 family_relationship 互建, 家人页即互相可见。
     */
    fun createInvite(expectedChildAge: Int? = null) = viewModelScope.launch {
        // 缺身份即自动补建 (RoleSelector 不建 DID, 见 LocalDidProvider.ensureDid 注释)。
        val inviterDid = localDidProvider.ensureDid()
        if (inviterDid.isNullOrBlank()) {
            _uiState.update { it.copy(message = "创建本机身份失败，请到「密钥管理」手动创建 DID 后重试") }
            return@launch
        }
        val asChild = _uiState.value.mode == PairingMode.CHILD
        _uiState.update { it.copy(busy = true) }
        runCatching {
            val groupId = ensureLocalGroup(inviterDid)
            pairingService.createInvite(
                familyGroupId = groupId,
                inviterDid = inviterDid,
                inviterRole = if (asChild) MemberRole.CHILD else MemberRole.PARENT,
                inviterTier = if (asChild) GuardianTier.SECONDARY else GuardianTier.PRIMARY,
                inviteeRole = if (asChild) MemberRole.PARENT else MemberRole.CHILD,
                inviteeTier = if (asChild) GuardianTier.PRIMARY else null,
                proposedPermissions = if (asChild) childToParentPermissions() else parentGuardianPermissions(),
                expectedChildAge = expectedChildAge,
            )
        }.onSuccess { result ->
            _uiState.update {
                it.copy(
                    busy = false,
                    inviteToken = InviteTokenCodec.encode(result.signedInvite),
                    acceptanceCode = result.acceptanceCode.value,
                    message = "邀请已生成，让孩子扫码并输入下面的接受码",
                )
            }
        }.onFailure { e ->
            _uiState.update {
                it.copy(busy = false, message = "生成邀请失败：${e.message ?: e::class.simpleName}")
            }
        }
    }

    /**
     * 复用 primaryDid == 本机真实 DID 的家庭组；否则用本机真实 DID 新建一个。
     *
     * **关键 (#3 家长端看不到家人)**：不能无脑复用"第一个"组。旧版本 / AI 陪学奖励·任务的
     * demo 流可能先建过 primaryDid=`did:chain:local-parent` 的占位组；若复用它，家长在组里的
     * 身份就是 demo DID，对端无法 extractPublicKey 验签 → 孩子绑定的 membership 永远同步不过来，
     * 家人页恒空。只认 primaryDid 与本机真实 did:key 一致的组，stale demo 组一律跳过另建。
     */
    private suspend fun ensureLocalGroup(primaryDid: String): String {
        val existing = familyGroupRepository.observeAll().first()
        return existing.firstOrNull { it.primaryDid == primaryDid }?.id
            ?: familyGroupRepository.create(name = "我的家庭", primaryDid = primaryDid).id
    }

    /**
     * 孩子端：接受邀请。先做客户端表单校验 (token 非空 / 接受码 6 位数字 / 年龄合法)，
     * 再调协议层。年龄 < 14 → [PairingResult.KycRequired]，UI 弹监护人确认后用
     * [forceKycAck] = true 重试本方法。
     */
    fun acceptInvite(
        token: String,
        code: String,
        ageText: String,
        forceKycAck: Boolean = false,
    ) = viewModelScope.launch {
        val trimmedToken = token.trim()
        if (trimmedToken.isEmpty()) {
            _uiState.update { it.copy(message = "请先粘贴或扫描家长的邀请二维码内容") }
            return@launch
        }
        val acceptance = runCatching { AcceptanceCode(code.trim()) }.getOrNull()
        if (acceptance == null) {
            _uiState.update { it.copy(message = "接受码为 6 位数字，请向家长确认") }
            return@launch
        }
        val age = ageText.trim().toIntOrNull()
        if (age == null || age !in 1..120) {
            _uiState.update { it.copy(message = "请输入有效年龄") }
            return@launch
        }
        val accepteeDid = localDidProvider.ensureDid()
        if (accepteeDid.isNullOrBlank()) {
            _uiState.update { it.copy(message = "创建本机身份失败，请到「密钥管理」手动创建 DID 后重试") }
            return@launch
        }

        _uiState.update { it.copy(busy = true) }
        val result = runCatching {
            pairingService.acceptInvite(
                qrPayload = trimmedToken,
                acceptanceCode = acceptance,
                accepteeDid = accepteeDid,
                accepteeDeviceId = DEMO_CHILD_DEVICE,
                reportedChildAge = age,
                childPermissions = childToParentPermissions(),
                forceKycAck = forceKycAck,
            )
        }.getOrElse { PairingResult.Failed(it::class.simpleName ?: "Unknown") }
        applyResult(result)
    }

    private fun applyResult(result: PairingResult) {
        when (result) {
            is PairingResult.Success -> _uiState.update {
                it.copy(
                    busy = false,
                    kycPending = false,
                    pairedRelationshipId = result.relationship.id,
                    revivalCode = result.revivalCode.value,
                    message = "绑定成功！请记下复活码（紧急解绑用，仅显示一次）",
                )
            }
            is PairingResult.KycRequired -> _uiState.update {
                it.copy(busy = false, kycPending = true, message = null)
            }
            PairingResult.MalformedQr -> fail("二维码内容无法解析，请确认完整复制")
            PairingResult.InvalidSignature -> fail("邀请签名校验失败（可能被篡改），请家长重新生成")
            PairingResult.Expired -> fail("邀请已过期，请家长重新生成")
            PairingResult.WrongAcceptanceCode -> fail("接受码不对，跟家长确认")
            PairingResult.AlreadyMember -> fail("已经和该家长绑定过了")
            PairingResult.UnknownFamilyGroup ->
                fail("找不到家庭组（跨设备需家长端先同步家庭组，P2P 同步为 follow-up）")
            is PairingResult.Failed -> fail("绑定失败：${result.reason}")
        }
    }

    private fun fail(msg: String) = _uiState.update { it.copy(busy = false, message = msg) }

    /** 家长 (inviter) 方向权限：监督 + 通话 + 规则/任务 + 位置 + SOS + 奖励 (陪伴仍仅统计)。 */
    private fun parentGuardianPermissions() = FamilyPermissions(
        telemetryLevel = TelemetryLevel.L1,
        allowRuleEdit = true,
        allowTaskAssign = true,
        allowAppHide = true,
        allowAppDisable = true,
        allowLocationView = true,
        allowGeofenceEdit = true,
        allowSosReceive = true,
        allowRewardGrant = true,
    )

    /** 孩子 (accepter) 为家长方向准备的权限：开放紧急解绑通道，其余取默认。 */
    private fun childToParentPermissions() = FamilyPermissions(
        allowEmergencyUnbind = true,
    )

    private companion object {
        const val DEMO_CHILD_DEVICE = "local-child-device"
    }
}
