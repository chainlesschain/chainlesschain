package com.chainlesschain.android.feature.familyguard.domain.model.pairing

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode

/**
 * Flow C 配对结果 sealed (FAMILY-13).
 *
 * 成功结果 [Success] 含双方写入的 entity + 孩子端用的复活码明文 (一次性显示)。
 */
sealed interface PairingResult {

    /**
     * 配对成功. UI 应立即:
     *   1. 弹 RevivalCodeDisplayCard 展示 [revivalCode] (一次, 然后让出引用)
     *   2. 切到家人页 (FAMILY-18) 显新建立的关系
     */
    data class Success(
        val relationship: FamilyRelationshipEntity,
        val revivalCode: RevivalCode,
    ) : PairingResult

    /** QR 数据无法解析 / 反序列化失败 / 字段缺失. */
    data object MalformedQr : PairingResult

    /** Ed25519 sig 验证失败 (篡改 / 伪造 inviterDid). */
    data object InvalidSignature : PairingResult

    /** payload.expiresAtMs < clock.millis(); UI 提示 "邀请已过期, 请家长重新生成". */
    data object Expired : PairingResult

    /** acceptance code 输错; UI 提示 "码不对, 跟家长确认". */
    data object WrongAcceptanceCode : PairingResult

    /**
     * KYC required: 孩子声明年龄 < 14. 主文档 §5.1 法律: 14 岁以下需监护人 +
     * 平台审核. v0.1 UI 弹"请在监护人陪同下完成实名验证"; 验证后由 UI 再调
     * acceptInvite(forceKycAck = true) 走最终写库 (FAMILY-65 真实名接入)。
     *
     * @property expectedChildAge 家长申报值
     * @property reportedChildAge 孩子自报值
     */
    data class KycRequired(
        val expectedChildAge: Int?,
        val reportedChildAge: Int,
    ) : PairingResult

    /** 同 family_group 内 inviter+invitee 已绑过 (status=active). */
    data object AlreadyMember : PairingResult

    /** family_group 不存在 (邀请伪造或孤儿). */
    data object UnknownFamilyGroup : PairingResult

    /** 任何意外异常 (DB 写失败 / 加密层抛 等); 错误信息脱敏后回传 UI。 */
    data class Failed(val reason: String) : PairingResult
}
