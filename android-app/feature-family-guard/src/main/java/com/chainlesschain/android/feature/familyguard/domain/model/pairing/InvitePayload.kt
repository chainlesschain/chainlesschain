package com.chainlesschain.android.feature.familyguard.domain.model.pairing

import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Pairing invite payload (FAMILY-13). 主文档 §3.1 v0.2 Flow C 配对协议。
 *
 * 家长端生成 → 序列化 + Ed25519 sig → 编 base64-URL → QR. 孩子端反向: QR
 * 解 base64 → 反序列化 → verify sig → 校验 TTL + acceptance code → 写库。
 *
 * 字段顺序敏感: 任何字段重排会破坏 sig (encode 是字段顺序确定的 JSON 序列化)。
 * 后续加字段必须 append + 配 Migration (即使是 default 字段也会改 JSON 字节流)。
 *
 * Inviter 的 PrimaryDid 跟 inviterRole/inviterTier 一起标识 invitation 的来源,
 * acceptee 需信任该 DID 才接受 (UI 显示 "X 邀请你成为他的孩子"; X 是 inviterDid
 * 的可读名)。
 *
 * acceptanceCode 走 hash + salt 存这里, 不存明文; 孩子端在 UI 输入明文,
 * service 现 hash 比对。明文走线下/QQ 等带外渠道告知, 不在 QR 内。
 */
@Serializable
data class InvitePayload(
    @SerialName("family_group_id")
    val familyGroupId: String,

    @SerialName("inviter_did")
    val inviterDid: String,

    @SerialName("inviter_role")
    val inviterRole: MemberRole,

    @SerialName("inviter_tier")
    val inviterTier: GuardianTier,

    /** 应配对成 family-friend 的对端角色 (典型: parent 邀请 child)。 */
    @SerialName("invitee_role")
    val inviteeRole: MemberRole,

    @SerialName("invitee_tier")
    val inviteeTier: GuardianTier? = null,

    /**
     * 家长申明的 permissions 的 sha256 hash; 孩子端拿明文版本 (来自配对界面预览)
     * 与该 hash 比对, 防中间人篡改权限。
     */
    @SerialName("proposed_permissions_hash")
    val proposedPermissionsHash: String,

    /** 家长申明的孩子年龄 (UI 显示给孩子确认; 实际年龄由孩子在 acceptInvite 时自报)。 */
    @SerialName("expected_child_age")
    val expectedChildAge: Int? = null,

    @SerialName("created_at_ms")
    val createdAtMs: Long,

    /** TTL 上限; 默认 createdAt + 10 min。Service 在 acceptInvite 时校验 clock.millis() ≤ expires。 */
    @SerialName("expires_at_ms")
    val expiresAtMs: Long,

    /** sha256(salt || acceptanceCode), 防 QR 截屏被旁人直接用。 */
    @SerialName("acceptance_code_hash")
    val acceptanceCodeHash: String,

    @SerialName("acceptance_code_salt")
    val acceptanceCodeSalt: String,
) {
    companion object {
        const val DEFAULT_TTL_MS: Long = 10L * 60L * 1000L // 10 min

        /** Json 配置同 [com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions]. */
        val codec: Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        fun decode(json: String): InvitePayload =
            codec.decodeFromString(serializer(), json)

        fun encode(payload: InvitePayload): String =
            codec.encodeToString(payload)
    }
}
