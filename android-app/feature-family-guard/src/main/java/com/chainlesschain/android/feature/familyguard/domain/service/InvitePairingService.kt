package com.chainlesschain.android.feature.familyguard.domain.service

import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.AcceptanceCode
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.PairingResult
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.SignedInvite
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions

/**
 * Flow C QR 配对协议 (FAMILY-13).
 *
 * 主文档 §3.1 v0.2 §配对流程; 两步 API:
 *   1. [createInvite] (家长端): 生成 SignedInvite + 明文 acceptance code.
 *      QR encoder 把 SignedInvite 序列化成 QR; acceptance code 走线下 / QQ
 *      告知孩子。
 *   2. [acceptInvite] (孩子端): 扫码 → 输入 acceptance code → 自报年龄 →
 *      service 验全套 → 写库 (FamilyGroup 必先存在; FamilyMembership +
 *      FamilyRelationship + RevivalCode 由本 service 端到端写)。
 *
 * 配对成功返 [PairingResult.Success] 含明文 [RevivalCode];
 * UI 立即弹 [RevivalCodeDisplayCard] 一次性显示。
 */
interface InvitePairingService {

    /**
     * 家长端生成邀请. service 自动:
     *   - 生成 acceptance code (CSPRNG 6 位)
     *   - 计算 sha256(salt + acceptance code)
     *   - 计算 sha256(permissions JSON) 作为完整性校验
     *   - 用 inviterDid 私钥 Ed25519 签 payload JSON
     *   - 返回 SignedInvite + 明文 acceptance code (一次性给 UI 显示)
     */
    suspend fun createInvite(
        familyGroupId: String,
        inviterDid: String,
        inviterRole: MemberRole,
        inviterTier: GuardianTier,
        inviteeRole: MemberRole,
        inviteeTier: GuardianTier? = null,
        proposedPermissions: FamilyPermissions,
        expectedChildAge: Int? = null,
    ): CreateInviteResult

    /**
     * 孩子端接受邀请. service:
     *   - 校验 sig (Ed25519 over payload JSON, by inviterDid)
     *   - 校验 expiresAtMs ≥ clock.millis()
     *   - 校验 sha256(salt + acceptanceCode) == payload.acceptanceCodeHash
     *   - 若 reportedChildAge < 14 → 返 KycRequired (UI 必弹 KYC 验证)
     *   - 校验 familyGroupId 存在
     *   - 若已有 active relationship (group + friend_did) → AlreadyMember
     *   - 写: FamilyMembership (inviter + invitee 各一行) +
     *     FamilyRelationship (双向不强求, FAMILY-13 仅写 invitee→inviter
     *     一条; inviter 端的镜像由 P2P 同步在 FAMILY-26 落地) +
     *     RevivalCode (孩子端生成, 跟新 relationship 关联)
     *   - 返 Success 含明文复活码 (UI 一次性显示)
     *
     * @param childDeviceId 设备指纹 / random ID, 走 family_membership 的 deviceId 列
     * @param childPermissions 孩子端为 inviter 方向准备的权限 (典型: forChildToParent template)
     * @param forceKycAck 若 UI 已弹 KYC 并完成验证 (FAMILY-65), 再调本 method 用 true
     *   绕过 KYC gate
     */
    suspend fun acceptInvite(
        qrPayload: String,
        acceptanceCode: AcceptanceCode,
        accepteeDid: String,
        accepteeDeviceId: String,
        reportedChildAge: Int,
        childPermissions: FamilyPermissions,
        forceKycAck: Boolean = false,
    ): PairingResult

    data class CreateInviteResult(
        val signedInvite: SignedInvite,
        val acceptanceCode: AcceptanceCode,
    )

    companion object {
        /** 主文档 §5.1: 14 岁以下需监护人 + 平台审核. */
        const val KYC_REQUIRED_AGE = 14
    }
}
