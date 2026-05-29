package com.chainlesschain.android.feature.familyguard.data.unbind

import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindResult
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindStateMachine
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindStateMachine.Companion.COOLDOWN_MS
import com.chainlesschain.android.feature.familyguard.domain.unbind.UnbindStateMachine.Companion.FORCE_GRACE_MS
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-15 实装. 所有状态转换走 DAO 的原子 SQL UPDATE (含 WHERE status 守卫),
 * 让并发 race 自然成 last-write-wins, 不会乱跳状态 (e.g. active → unbound 越过 pending).
 *
 * 主文档 §3.1 v0.2:
 *   - active → request → unbind_pending (24h)
 *   - unbind_pending → cancel (任一方) → active
 *   - unbind_pending → 冷却到期 finalize → unbound
 *   - 强制 finalize: cooldown_until + 6h grace 后申请方可调
 *
 * Worker 实际接入留 FAMILY-19 (BootReceiver + AlarmManager); FAMILY-15 仅提供
 * [reconcileExpired] 入口供 Worker 调用。
 */
@Singleton
class UnbindStateMachineImpl @Inject constructor(
    private val familyRelationshipDao: FamilyRelationshipDao,
    private val clock: Clock,
) : UnbindStateMachine {

    override suspend fun requestUnbind(
        relationshipId: Long,
        requesterDid: String,
    ): UnbindResult {
        val now = clock.millis()
        val cooldownUntil = now + COOLDOWN_MS
        val rows = familyRelationshipDao.markUnbindPending(
            id = relationshipId,
            requestAt = now,
            cooldownUntil = cooldownUntil,
            requesterDid = requesterDid,
            updatedAt = now,
        )
        if (rows > 0) return UnbindResult.Success

        // 未生效: 要么已 pending, 要么不存在, 要么状态 frozen / unbound 等
        val existing = familyRelationshipDao.findById(relationshipId)
            ?: return UnbindResult.NotFound
        return when (existing.status) {
            "unbind_pending" -> UnbindResult.AlreadyUnbinding(
                cooldownUntilMs = existing.unbindCooldownUntil ?: cooldownUntil,
            )
            else -> UnbindResult.NotPending
        }
    }

    override suspend fun cancelUnbind(relationshipId: Long): UnbindResult {
        val now = clock.millis()
        val rows = familyRelationshipDao.cancelUnbindPending(
            id = relationshipId,
            updatedAt = now,
        )
        if (rows > 0) return UnbindResult.Success

        val existing = familyRelationshipDao.findById(relationshipId)
            ?: return UnbindResult.NotFound
        return when (existing.status) {
            // 幂等: 已 active → success no-op (双方同时撤销 race 友好)
            "active" -> UnbindResult.Success
            else -> UnbindResult.NotPending
        }
    }

    override suspend fun finalizeUnbind(relationshipId: Long): UnbindResult {
        val now = clock.millis()
        val rows = familyRelationshipDao.finalizeUnbindIfExpired(
            id = relationshipId,
            now = now,
            updatedAt = now,
        )
        if (rows > 0) return UnbindResult.Success

        val existing = familyRelationshipDao.findById(relationshipId)
            ?: return UnbindResult.NotFound
        return when {
            existing.status != "unbind_pending" -> UnbindResult.NotPending
            // status==pending 但 SQL 未生效 → cooldown 未到期
            else -> UnbindResult.TooEarly(
                cooldownUntilMs = existing.unbindCooldownUntil ?: 0L,
            )
        }
    }

    override suspend fun forceFinalize(
        relationshipId: Long,
        requesterDid: String,
    ): UnbindResult {
        val existing = familyRelationshipDao.findById(relationshipId)
            ?: return UnbindResult.NotFound
        if (existing.status != "unbind_pending") return UnbindResult.NotPending

        // 主文档 §3.1 v0.2 — 申请方在 cooldown_until + 6h 之后才能强制 finalize
        val cooldownEnd = existing.unbindCooldownUntil ?: return UnbindResult.NotPending
        val now = clock.millis()
        val forceTimeOk = now >= (cooldownEnd + FORCE_GRACE_MS)
        if (!forceTimeOk) {
            return UnbindResult.TooEarly(cooldownUntilMs = cooldownEnd + FORCE_GRACE_MS)
        }

        // 这一步 SQL: finalizeUnbindIfExpired 的 cooldown_until ≤ now 已经一定成立
        // (force_time_ok 蕴含此); 直接调即可。
        val rows = familyRelationshipDao.finalizeUnbindIfExpired(
            id = relationshipId,
            now = now,
            updatedAt = now,
        )
        return if (rows > 0) UnbindResult.Success else UnbindResult.NotPending
    }

    override suspend fun reconcileExpired(): Int {
        val now = clock.millis()
        val expired = familyRelationshipDao.listExpiredPendingIds(now)
        var done = 0
        for (id in expired) {
            val rows = familyRelationshipDao.finalizeUnbindIfExpired(
                id = id,
                now = now,
                updatedAt = now,
            )
            if (rows > 0) done++
        }
        return done
    }
}
