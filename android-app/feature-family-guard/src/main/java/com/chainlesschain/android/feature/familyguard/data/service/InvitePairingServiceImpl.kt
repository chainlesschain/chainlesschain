package com.chainlesschain.android.feature.familyguard.data.service

import com.chainlesschain.android.feature.familyguard.data.codec.InviteTokenCodec
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.AcceptanceCode
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.InvitePayload
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.PairingResult
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.SignedInvite
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.RevivalCodeRepository
import com.chainlesschain.android.feature.familyguard.domain.service.InvitePairingService
import com.chainlesschain.android.feature.familyguard.domain.service.InvitePairingService.Companion.KYC_REQUIRED_AGE
import com.chainlesschain.android.feature.familyguard.domain.signer.InviteSigner
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-13 实装. 端到端 createInvite / acceptInvite 配对协议. 业务层注入:
 *   - Clock (TTL + bound_at 用)
 *   - SecureRandom (acceptance code + salt 生成)
 *   - InviteSigner (Ed25519 抽象)
 *   - FamilyGroupRepository (校验 group 存在)
 *   - FamilyMembershipRepository (写 invitee membership)
 *   - FamilyRelationshipRepository (写 invitee → inviter relationship + permissions)
 *   - RevivalCodeRepository (生成复活码)
 *
 * 写库错误恢复: acceptInvite 整体不走 transaction (Room @Transaction 跨
 * Repository 写麻烦), 因此如果 RevivalCode 生成失败, 已写的 Membership +
 * Relationship 留库 (status=active). FAMILY-15 解绑流程可清理。v0.1 接受此
 * 风险, 因端到端真机 E2E 落地后才能验证此种 race。
 */
@Singleton
class InvitePairingServiceImpl @Inject constructor(
    private val familyGroupRepository: FamilyGroupRepository,
    private val familyMembershipRepository: FamilyMembershipRepository,
    private val familyRelationshipRepository: FamilyRelationshipRepository,
    private val revivalCodeRepository: RevivalCodeRepository,
    private val inviteSigner: InviteSigner,
    private val clock: Clock,
    private val secureRandom: SecureRandom = SecureRandom(),
) : InvitePairingService {

    override suspend fun createInvite(
        familyGroupId: String,
        inviterDid: String,
        inviterRole: MemberRole,
        inviterTier: GuardianTier,
        inviteeRole: MemberRole,
        inviteeTier: GuardianTier?,
        proposedPermissions: FamilyPermissions,
        expectedChildAge: Int?,
    ): InvitePairingService.CreateInviteResult {
        val acceptanceCode = AcceptanceCode(nextSixDigitCode())
        val acceptanceSalt = randomHex(16)
        val acceptanceHash = sha256Hex(acceptanceSalt + acceptanceCode.value)
        val permissionsHash = sha256Hex(FamilyPermissions.encode(proposedPermissions))

        val now = clock.millis()
        val payload = InvitePayload(
            familyGroupId = familyGroupId,
            inviterDid = inviterDid,
            inviterRole = inviterRole,
            inviterTier = inviterTier,
            inviteeRole = inviteeRole,
            inviteeTier = inviteeTier,
            proposedPermissionsHash = permissionsHash,
            expectedChildAge = expectedChildAge,
            createdAtMs = now,
            expiresAtMs = now + InvitePayload.DEFAULT_TTL_MS,
            acceptanceCodeHash = acceptanceHash,
            acceptanceCodeSalt = acceptanceSalt,
        )
        val payloadJson = InvitePayload.encode(payload)
        val sigBytes = inviteSigner.sign(payloadJson.toByteArray(Charsets.UTF_8))
        val signatureB64 = Base64.getUrlEncoder().withoutPadding().encodeToString(sigBytes)

        return InvitePairingService.CreateInviteResult(
            signedInvite = SignedInvite(payloadJson = payloadJson, signatureB64 = signatureB64),
            acceptanceCode = acceptanceCode,
        )
    }

    override suspend fun acceptInvite(
        qrPayload: String,
        acceptanceCode: AcceptanceCode,
        accepteeDid: String,
        accepteeDeviceId: String,
        reportedChildAge: Int,
        childPermissions: FamilyPermissions,
        forceKycAck: Boolean,
    ): PairingResult {
        // ─── parse + verify sig ───
        val signedInvite = runCatching { InviteTokenCodec.decode(qrPayload) }
            .getOrElse { return PairingResult.MalformedQr }

        val payload = runCatching { signedInvite.decodePayload() }
            .getOrElse { return PairingResult.MalformedQr }

        val sigBytes = runCatching {
            Base64.getUrlDecoder().decode(signedInvite.signatureB64)
        }.getOrElse { return PairingResult.InvalidSignature }

        val payloadBytes = signedInvite.payloadJson.toByteArray(Charsets.UTF_8)
        val sigOk = runCatching {
            inviteSigner.verify(payload.inviterDid, payloadBytes, sigBytes)
        }.getOrElse { false }
        if (!sigOk) return PairingResult.InvalidSignature

        // ─── TTL ───
        if (clock.millis() > payload.expiresAtMs) return PairingResult.Expired

        // ─── Acceptance code ───
        val expectedHash = sha256Hex(payload.acceptanceCodeSalt + acceptanceCode.value)
        if (expectedHash != payload.acceptanceCodeHash) return PairingResult.WrongAcceptanceCode

        // ─── KYC gate ───
        if (reportedChildAge < KYC_REQUIRED_AGE && !forceKycAck) {
            return PairingResult.KycRequired(
                expectedChildAge = payload.expectedChildAge,
                reportedChildAge = reportedChildAge,
            )
        }

        // ─── family_group 存在 ───
        val groupExists = familyGroupRepository.findById(payload.familyGroupId) != null
        if (!groupExists) return PairingResult.UnknownFamilyGroup

        // ─── 已配对 ───
        val existing = familyRelationshipRepository.findByFriendDid(payload.inviterDid)
        if (existing != null && existing.status == "active") return PairingResult.AlreadyMember

        // ─── 端到端写库 ───
        return runCatching {
            // 1. invitee 成 family_membership 一员
            familyMembershipRepository.addMember(
                familyGroupId = payload.familyGroupId,
                memberDid = accepteeDid,
                role = payload.inviteeRole,
                guardianTier = payload.inviteeTier,
                deviceId = accepteeDeviceId,
            )

            // 2. 创建 invitee → inviter 关系
            val relationship = familyRelationshipRepository.create(
                familyGroupId = payload.familyGroupId,
                friendDid = payload.inviterDid,
                roleSelf = payload.inviteeRole,
                roleOther = payload.inviterRole,
                guardianTierOther = payload.inviterTier,
                permissions = childPermissions,
                boundEvidence = sha256Hex(payload.acceptanceCodeHash + accepteeDid),
            )

            // 3. 孩子端生成复活码 (一次性给 UI 显示)
            val revivalCode = revivalCodeRepository.generateNewCode(
                familyRelationshipId = relationship.id,
            )

            PairingResult.Success(
                relationship = relationship,
                revivalCode = revivalCode,
            )
        }.getOrElse { e ->
            PairingResult.Failed(reason = e::class.simpleName ?: "Unknown")
        }
    }

    // ─── helpers ───

    internal fun nextSixDigitCode(): String {
        val range = AcceptanceCode.MAX_VALUE_EXCLUSIVE - AcceptanceCode.MIN_VALUE
        return (secureRandom.nextInt(range) + AcceptanceCode.MIN_VALUE).toString()
    }

    internal fun randomHex(byteLen: Int): String {
        val bytes = ByteArray(byteLen)
        secureRandom.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    internal fun sha256Hex(input: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
