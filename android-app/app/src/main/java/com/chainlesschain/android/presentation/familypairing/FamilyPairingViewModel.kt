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

/** 配对屏的三种界面态：先选角色 → 家长生成邀请 / 孩子接受邀请。 */
enum class PairingMode { CHOOSE, PARENT, CHILD }

data class FamilyPairingUiState(
    val mode: PairingMode = PairingMode.CHOOSE,
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
) : ViewModel() {

    private val _uiState = MutableStateFlow(FamilyPairingUiState())
    val uiState: StateFlow<FamilyPairingUiState> = _uiState.asStateFlow()

    fun chooseParent() = _uiState.update { it.copy(mode = PairingMode.PARENT) }
    fun chooseChild() = _uiState.update { it.copy(mode = PairingMode.CHILD) }

    /** 返回角色选择，清掉上一轮生成/接受的敏感态 (token/接受码/复活码)。 */
    fun reset() {
        _uiState.value = FamilyPairingUiState()
    }

    fun consumeMessage() = _uiState.update { it.copy(message = null) }

    fun dismissKyc() = _uiState.update { it.copy(kycPending = false) }

    /** 家长端：生成邀请二维码 + 明文接受码。 */
    fun createInvite(expectedChildAge: Int? = null) = viewModelScope.launch {
        _uiState.update { it.copy(busy = true) }
        runCatching {
            val groupId = ensureLocalGroup()
            pairingService.createInvite(
                familyGroupId = groupId,
                inviterDid = DEMO_PARENT_DID,
                inviterRole = MemberRole.PARENT,
                inviterTier = GuardianTier.PRIMARY,
                inviteeRole = MemberRole.CHILD,
                inviteeTier = null,
                proposedPermissions = parentGuardianPermissions(),
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

    /** 已存在 family_group 则复用第一个，否则建一个本机家庭组 (demo)。 */
    private suspend fun ensureLocalGroup(): String {
        val existing = familyGroupRepository.observeAll().first()
        return existing.firstOrNull()?.id
            ?: familyGroupRepository.create(name = "我的家庭", primaryDid = DEMO_PARENT_DID).id
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

        _uiState.update { it.copy(busy = true) }
        val result = runCatching {
            pairingService.acceptInvite(
                qrPayload = trimmedToken,
                acceptanceCode = acceptance,
                accepteeDid = DEMO_CHILD_DID,
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
        const val DEMO_PARENT_DID = "did:chain:local-parent"
        const val DEMO_CHILD_DID = "did:chain:local-child"
        const val DEMO_CHILD_DEVICE = "local-child-device"
    }
}
