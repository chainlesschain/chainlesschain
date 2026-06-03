package com.chainlesschain.android.feature.familyguard.domain.sos

import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.SosEventRepository
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * SOS broadcast call 协调器 (FAMILY-43, M7; 主文档 §3.7 "broadcast call — 家长端任一接通")。
 *
 * 把 FAMILY-40 的 SOS 状态机 + FAMILY-34 的通话控制面 串成广播语义:
 *   1. [broadcast]: SOS 触发后，向本组所有 guardian 高优广播 (经 [SosNotifier.notifyBroadcast]);
 *      :app 侧据返回的目标列表逐个走 family.call.invite + WebRTC (设备媒体, FAMILY-34/35)。
 *   2. [onGuardianAck]: 某 guardian 接通 (WebRTC ACCEPT 事件由 :app 折射进来) → 经
 *      [SosEventRepository.acknowledge] 原子抢占 PENDING；**首个**成功者胜出 (DB `WHERE
 *      status='pending'` 守卫保证竞态安全)，其余 guardian 经 [SosNotifier.notifyAcknowledged]
 *      收 "已接通" 提示并收起告警。
 *
 * **本协调器是纯逻辑 seam**: 不直接依赖 WebRTC (FamilyCallRpcClient 在 :app)。:app 负责
 * (a) broadcast() 返回的目标 → 真 family.call.invite；(b) 把通话 ACCEPT 事件喂给
 * onGuardianAck()。故协调器仅依赖 [SosEventRepository] + [SosNotifier] 两个已绑定的 seam，
 * 可在 :feature-family-guard 内单测 (同 FAMILY-44/54/55 纯逻辑 + NoOp seam 模式)。
 */
@Singleton
class SosBroadcastCoordinator @Inject constructor(
    private val sosRepository: SosEventRepository,
    private val notifier: SosNotifier,
) {

    /**
     * 广播一条已触发的 SOS 给本组 guardians。[guardianDids] 会去重并剔除孩子自身 did /
     * 空白；返回**实际广播的目标列表** (供 :app 逐个发起通话)。无有效目标 → 不通知、返回空。
     */
    suspend fun broadcast(sosEvent: SosEventEntity, guardianDids: List<String>): List<String> {
        val targets = cleanTargets(guardianDids, exclude = sosEvent.childDid)
        if (targets.isEmpty()) {
            Timber.w("SOS broadcast: no guardian targets for id=%s", sosEvent.id)
            return emptyList()
        }
        notifier.notifyBroadcast(
            sosEventId = sosEvent.id,
            childDid = sosEvent.childDid,
            familyGroupId = sosEvent.familyGroupId,
            guardianDids = targets,
            locationSnapshot = sosEvent.locationSnapshot,
        )
        return targets
    }

    /**
     * 某 guardian 接通 broadcast SOS。[allGuardianDids] = 本次广播的全部目标 (用于算 stand-down)。
     */
    suspend fun onGuardianAck(
        sosEventId: String,
        acknowledgingGuardianDid: String,
        allGuardianDids: List<String>,
    ): SosAckOutcome =
        when (val r = sosRepository.acknowledge(sosEventId, acknowledgingGuardianDid)) {
            is SosTransitionResult.Success -> {
                val standDown = cleanTargets(allGuardianDids, exclude = acknowledgingGuardianDid)
                notifier.notifyAcknowledged(sosEventId, acknowledgingGuardianDid, standDown)
                SosAckOutcome.FirstAck(acknowledgingGuardianDid, standDown)
            }
            is SosTransitionResult.InvalidState ->
                if (r.current == SosStatus.ACKNOWLEDGED) {
                    SosAckOutcome.AlreadyAcknowledged
                } else {
                    SosAckOutcome.Invalid(r.current)
                }
            SosTransitionResult.NotFound -> SosAckOutcome.NotFound
            // acknowledge() 契约不会返回 CancelWindowExpired (那是 cancel 专属); 防御性兜底。
            SosTransitionResult.CancelWindowExpired -> {
                Timber.w("SOS onGuardianAck got CancelWindowExpired (unexpected) id=%s", sosEventId)
                SosAckOutcome.Invalid(SosStatus.PENDING)
            }
        }

    /** 去空白 + 去重 + 剔除 [exclude]，保持首次出现顺序。 */
    private fun cleanTargets(dids: List<String>, exclude: String): List<String> =
        dids.asSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != exclude }
            .distinct()
            .toList()
}
