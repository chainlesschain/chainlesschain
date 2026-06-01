package com.chainlesschain.android.feature.familyguard.domain.geofence

import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.domain.model.ExpectedArrival
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceAction
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceBoundary
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceKind
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceTrigger
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

/**
 * 围栏动作引擎 (FAMILY-54，主文档 §3.8)。
 *
 * **纯函数** ([resolve] 无 IO): FAMILY-52 的 Geofencing API 透出 [GeofenceBoundary] 边界事件后，
 * 由调用方备好命中的 [GeofenceEntity] 驱动本引擎，产出待下发的 [ResolvedGeofenceAction] 列表；
 * 真正下发（推送 / 锁应用）在后续 dispatcher（接 FAMILY-04 enforce + 推送通道）。单测可直接
 * 喂 entity + boundary + nowMs 断言（同 [com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyDetector] 模式）。
 *
 * 触发映射:
 *   - [GeofenceBoundary.ENTER] → on_enter_action（始终）。若围栏配了 expected_arrival 且本次进入
 *     **迟于** 应到时间+宽限（按本地墙钟 [zoneId] + 当天 ISO weekday 比对）→ **附加** on_late_action
 *     （两槽独立: 常见 on_enter=silent + on_late=notify_parent，故迟到进校既"安静记录到达"又"通知迟到"）。
 *   - [GeofenceBoundary.EXIT]  → on_exit_action。
 *   - [GeofenceBoundary.DWELL] → 空（停留检测属 FAMILY-55 异常引擎，本引擎不映射动作）。
 *
 * 动作字面量非法 / 为 "silent" 的处理见 [GeofenceAction.parse]；解析为 null 的触发被跳过
 * （不产生输出），"silent" 仍输出供审计区分。dedupKey 按 围栏/触发/本地日 分桶，边界抖动
 * （反复 ENTER/EXIT）当天只下发一次。
 *
 * "应到却未到"（child 截止时间前从未 ENTER 学校）需定时器轮询，属 FAMILY-52 真机范畴，
 * 本纯逻辑引擎只覆盖"已进入但迟到"。
 */
class GeofenceActionEngine @Inject constructor(
    private val zoneId: ZoneId,
) {

    fun resolve(
        geofence: GeofenceEntity,
        boundary: GeofenceBoundary,
        childDid: String,
        nowMs: Long,
    ): List<ResolvedGeofenceAction> {
        if (!geofence.active) return emptyList()
        return when (boundary) {
            GeofenceBoundary.ENTER -> resolveEnter(geofence, childDid, nowMs)
            GeofenceBoundary.EXIT ->
                listOfNotNull(
                    resolved(geofence, GeofenceTrigger.ON_EXIT, geofence.onExitAction, childDid, nowMs),
                )
            GeofenceBoundary.DWELL -> emptyList()
        }
    }

    private fun resolveEnter(
        geofence: GeofenceEntity,
        childDid: String,
        nowMs: Long,
    ): List<ResolvedGeofenceAction> {
        val out = mutableListOf<ResolvedGeofenceAction>()
        resolved(geofence, GeofenceTrigger.ON_ENTER, geofence.onEnterAction, childDid, nowMs)
            ?.let { out += it }
        if (isLateArrival(geofence, nowMs)) {
            resolved(geofence, GeofenceTrigger.ON_LATE, geofence.onLateAction, childDid, nowMs)
                ?.let { out += it }
        }
        return out
    }

    /** 本次进入是否迟于 expected_arrival（含 grace）；无 / 非法 schedule、当天非适用 weekday → false。 */
    private fun isLateArrival(geofence: GeofenceEntity, nowMs: Long): Boolean {
        val sched = ExpectedArrival.parseOrNull(geofence.expectedArrival) ?: return false
        val expected = sched.localTimeOrNull() ?: return false
        val zdt = Instant.ofEpochMilli(nowMs).atZone(zoneId)
        if (sched.days.isNotEmpty() && zdt.dayOfWeek.value !in sched.days) return false
        val deadline = expected.plusMinutes(sched.graceMinutes.toLong())
        return zdt.toLocalTime().isAfter(deadline)
    }

    private fun resolved(
        geofence: GeofenceEntity,
        trigger: GeofenceTrigger,
        rawAction: String,
        childDid: String,
        nowMs: Long,
    ): ResolvedGeofenceAction? {
        val action = GeofenceAction.parse(rawAction) ?: return null
        return ResolvedGeofenceAction(
            action = action,
            trigger = trigger,
            geofenceId = geofence.id,
            geofenceName = geofence.name,
            childDid = childDid,
            dedupKey = "${geofence.id}:${trigger.name}:${localDate(nowMs)}",
            summary = summaryFor(geofence, trigger),
            triggeredAtMs = nowMs,
        )
    }

    private fun summaryFor(geofence: GeofenceEntity, trigger: GeofenceTrigger): String {
        val kindLabel = GeofenceKind.fromStorage(geofence.kind)?.let { kindLabel(it) } ?: geofence.name
        return when (trigger) {
            GeofenceTrigger.ON_ENTER -> "已到达「${geofence.name}」($kindLabel)"
            GeofenceTrigger.ON_EXIT -> "已离开「${geofence.name}」($kindLabel)"
            GeofenceTrigger.ON_LATE -> "迟到到达「${geofence.name}」($kindLabel)"
        }
    }

    private fun kindLabel(kind: GeofenceKind): String = when (kind) {
        GeofenceKind.HOME -> "家"
        GeofenceKind.SCHOOL -> "学校"
        GeofenceKind.CLASS -> "培训班"
        GeofenceKind.BANNED -> "禁入区"
    }

    private fun localDate(epochMs: Long): LocalDate =
        Instant.ofEpochMilli(epochMs).atZone(zoneId).toLocalDate()
}
