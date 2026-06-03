package com.chainlesschain.android.feature.familyguard.data.emergency

import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.domain.emergency.EmergencyUnbindResult
import com.chainlesschain.android.feature.familyguard.domain.emergency.EmergencyUnbindService
import com.chainlesschain.android.feature.familyguard.domain.emergency.ExternalContactNotifier
import com.chainlesschain.android.feature.familyguard.domain.emergency.UpstreamFreezer
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCodeVerification
import com.chainlesschain.android.feature.familyguard.domain.repository.RevivalCodeRepository
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * FAMILY-16 实装.
 *
 * 关键顺序 (主文档 §3.1 v0.2 + 安全考虑):
 *   1. RevivalCodeRepository.verify (3 错锁 24h 状态机, 走 FAMILY-08)
 *   2. **若 Success 立刻 UpstreamFreezer.freeze** — 在 DB 写之前!
 *      原因: 即使 DB 写失败, freeze 仍然生效, 保护性默认 (主文档 §3.1 v0.2
 *      "立刻 freeze 上行"); 这是 stalkerware 防御的核心。
 *   3. DB 写 markEmergencyUnbound
 *   4. ExternalContactNotifier.notify (异步; 失败 / 0 推送也不回滚)
 *
 * 错误恢复:
 *   - Verify 失败 → 直接返对应 result, 不 freeze, 不写 DB, 不通知
 *   - Verify Success + familyRelationshipId=null → 视为 OrphanCode (生产不该出, 防御编程)
 *   - DB 写 0 行 → OrphanCode(frozen=true)
 */
@Singleton
class EmergencyUnbindServiceImpl @Inject constructor(
    private val revivalCodeRepository: RevivalCodeRepository,
    private val familyRelationshipDao: FamilyRelationshipDao,
    private val upstreamFreezer: UpstreamFreezer,
    private val externalContactNotifier: ExternalContactNotifier,
    private val clock: Clock,
) : EmergencyUnbindService {

    override suspend fun trigger(
        revivalCode: RevivalCode,
        deviceFingerprint: String,
    ): EmergencyUnbindResult {
        // ─── 1. 验证复活码 ───
        val verification = revivalCodeRepository.verify(revivalCode)
        when (verification) {
            is RevivalCodeVerification.WrongCode ->
                return EmergencyUnbindResult.WrongCode(verification.remainingAttempts)
            is RevivalCodeVerification.LockedOut ->
                return EmergencyUnbindResult.LockedOut(verification.unlockAtMs)
            RevivalCodeVerification.NoCodeRegistered ->
                return EmergencyUnbindResult.NoCodeRegistered
            RevivalCodeVerification.AlreadyConsumed ->
                return EmergencyUnbindResult.AlreadyConsumed
            is RevivalCodeVerification.Success -> Unit // 继续
        }

        val familyRelationshipId = (verification as RevivalCodeVerification.Success)
            .familyRelationshipId

        // ─── 2. 立刻 freeze (保护性默认; DB 写错也保 freeze 状态) ───
        val freezeReason = EmergencyUnbindService.REASON_REVIVAL_CODE
        runCatching { upstreamFreezer.freeze(freezeReason) }
            .onFailure { Timber.e(it, "UpstreamFreezer.freeze failed during emergency unbind") }

        if (familyRelationshipId == null) {
            // 复活码生效但无关联 relationship → orphan; freeze 仍生效, 不写 DB
            return EmergencyUnbindResult.OrphanCode(frozen = true)
        }

        // ─── 3. DB 写 emergency_unbound ───
        val now = clock.millis()
        val rows = runCatching {
            familyRelationshipDao.markEmergencyUnbound(
                id = familyRelationshipId,
                triggeredAt = now,
                reason = freezeReason,
                updatedAt = now,
            )
        }.getOrElse { e ->
            Timber.e(e, "markEmergencyUnbound failed for id=$familyRelationshipId")
            0
        }
        if (rows == 0) {
            // family_relationship 不存在 / 已 unbound; 但 freeze + 复活码消费已生效
            return EmergencyUnbindResult.OrphanCode(frozen = true)
        }

        // ─── 4. 通知外部联系人 (best-effort) ───
        val notifiedCount = runCatching {
            externalContactNotifier.notify(
                ExternalContactNotifier.EmergencyNotification(
                    triggerKind = ExternalContactNotifier.TriggerKind.REVIVAL_CODE_TRIGGERED,
                    familyRelationshipId = familyRelationshipId,
                    timestampMs = now,
                    deviceFingerprint = deviceFingerprint,
                    reason = freezeReason,
                ),
            )
        }.getOrElse { e ->
            Timber.e(e, "External notifier failed for id=$familyRelationshipId")
            0
        }

        return EmergencyUnbindResult.Success(
            familyRelationshipId = familyRelationshipId,
            notifiedCount = notifiedCount,
        )
    }

    override suspend fun revoke(
        familyRelationshipId: Long,
    ): EmergencyUnbindService.RevokeResult {
        val rel = familyRelationshipDao.findById(familyRelationshipId)
            ?: return EmergencyUnbindService.RevokeResult.NotFound
        if (rel.status != "emergency_unbound") {
            return EmergencyUnbindService.RevokeResult.NotEmergencyUnbound
        }
        val triggeredAt = rel.emergencyUnbindAt
            ?: return EmergencyUnbindService.RevokeResult.NotEmergencyUnbound
        val now = clock.millis()
        if (now > triggeredAt + EmergencyUnbindService.GRACE_PERIOD_MS) {
            return EmergencyUnbindService.RevokeResult.GracePeriodExpired
        }
        // 走 upsert 重置 status='active' + 清 emergency 列
        familyRelationshipDao.upsert(
            rel.copy(
                status = "active",
                emergencyUnbindAt = null,
                emergencyUnbindReason = null,
                updatedAt = now,
            ),
        )
        upstreamFreezer.unfreeze()
        return EmergencyUnbindService.RevokeResult.Success
    }
}
