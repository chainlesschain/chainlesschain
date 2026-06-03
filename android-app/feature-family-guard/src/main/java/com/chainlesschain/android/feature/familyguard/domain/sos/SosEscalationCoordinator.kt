package com.chainlesschain.android.feature.familyguard.domain.sos

import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/** SOS 兜底升级阈值配置 (FAMILY-45)。 */
data class SosEscalationConfig(
    /** 无 guardian acknowledge 多久后兜底推外部联系人 (主文档 §3.7: 60s)。 */
    val fallbackWindowMs: Long = 60_000L,
)

/**
 * SOS 60s 兜底外部联系人升级协调器 (FAMILY-45, M7; 主文档 §3.7)。
 *
 * FAMILY-43 把 SOS 广播给所有 guardian；若 [SosEscalationConfig.fallbackWindowMs] (60s) 内
 * **仍无任何 guardian acknowledge** (事件仍 PENDING) → 把"孩子 SOS 求助 + 位置"经
 * [EmergencyContactNotifier] (v0.1 SMS) 推给 emergency_contacts。
 *
 * **判定 [evaluate] 是纯函数**（无 IO，权威时间 nowMs 由调用方注入——同 TimeAuthority 防改钟
 * 模式）：60s 定时器轮询 / 触发由 :app worker 驱动（设备侧），每次到点调 [escalateIfNeeded]，
 * 协调器据当前 SOS 状态 + 已解析的 [EmergencyContact] 列表 + nowMs 决定升级或 Hold。
 * 故仅依赖 [EmergencyContactNotifier] 一个已绑定 seam，可在 :feature-family-guard 内单测
 * （同 FAMILY-43/44/54/55 纯逻辑 + NoOp seam 模式）。
 */
@Singleton
class SosEscalationCoordinator @Inject constructor(
    private val notifier: EmergencyContactNotifier,
) {

    /**
     * 纯判定: 给定 SOS 事件 + 已解析外部联系人 + 权威 now → 是否兜底升级。
     * 仅当事件仍 PENDING、已过 60s 窗口、且有有效联系人时 [SosEscalationDecision.Escalate]。
     */
    fun evaluate(
        sosEvent: SosEventEntity,
        contacts: List<EmergencyContact>,
        nowMs: Long,
        config: SosEscalationConfig = SosEscalationConfig(),
    ): SosEscalationDecision {
        if (SosStatus.fromStorage(sosEvent.status) != SosStatus.PENDING) {
            return SosEscalationDecision.Hold(HoldReason.ALREADY_HANDLED)
        }
        if (nowMs - sosEvent.triggeredAt < config.fallbackWindowMs) {
            return SosEscalationDecision.Hold(HoldReason.WITHIN_WINDOW)
        }
        if (contacts.isEmpty()) {
            return SosEscalationDecision.Hold(HoldReason.NO_CONTACTS)
        }
        return SosEscalationDecision.Escalate(contacts)
    }

    /**
     * [evaluate] + 副作用: 决定 Escalate 时经 seam 推外部联系人。返回判定结果（供 :app 记审计 /
     * 决定是否还要重排定时器）。
     */
    suspend fun escalateIfNeeded(
        sosEvent: SosEventEntity,
        contacts: List<EmergencyContact>,
        nowMs: Long,
        config: SosEscalationConfig = SosEscalationConfig(),
    ): SosEscalationDecision {
        val decision = evaluate(sosEvent, contacts, nowMs, config)
        if (decision is SosEscalationDecision.Escalate) {
            Timber.w(
                "SOS escalating to %d external contacts (no guardian ack in %dms): id=%s",
                decision.contacts.size,
                config.fallbackWindowMs,
                sosEvent.id,
            )
            notifier.notifyEmergencyContacts(
                sosEventId = sosEvent.id,
                childDid = sosEvent.childDid,
                contacts = decision.contacts,
                locationSnapshot = sosEvent.locationSnapshot,
            )
        }
        return decision
    }
}
