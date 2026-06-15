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
 * "应到却未到"（child 截止时间前从未 ENTER 学校）由 [resolveOverdueArrival] 覆盖：**判定本身是
 * 纯函数**（截止已过 + 当天适用 + 当天未进入 → on_late），只有"周期性地拿当天最近 ENTER 喂进来"
 * 的定时器轮询属 FAMILY-52 真机范畴。它与 ENTER 路径的"已进入但迟到"互补，复用同一 ON_LATE
 * dedupKey，故同一天最多一条迟到/未到通知。
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

    /**
     * "应到却未到"纯判定 (主文档 §3.8)：当天截止时间已过、且 child 当天从未进入该围栏 → 产出
     * on_late 动作（摘要为"应到未到"，区别于 ENTER 路径的"迟到到达"）。
     *
     * 与 [resolve] 的 ENTER→on_late 互补：那条在 child **真的到了**（迟）时触发；本条在
     * **该到没到**（截止已过仍无 ENTER）时触发。两者共用同一 ON_LATE dedupKey
     * (`<id>:ON_LATE:<本地日>`)，故同一天最多一条通知 —— child 先未到（本条）、后迟到进校
     * （ENTER 条）下游去重后只下发一次。
     *
     * **纯函数**：由调用方（设备阻塞的 WorkManager 周期轮询，属 FAMILY-52 真机范畴）备好
     * [lastEnterMs]（该 child 在该围栏最近一次 ENTER 的 epoch ms，从未进入则 null）+ nowMs 驱动。
     * 非 active / 无 expected_arrival / 当天非适用 weekday / 截止未到 / 当天已进入 → null。
     */
    fun resolveOverdueArrival(
        geofence: GeofenceEntity,
        childDid: String,
        lastEnterMs: Long?,
        nowMs: Long,
    ): ResolvedGeofenceAction? {
        if (!geofence.active) return null
        if (!isLateArrival(geofence, nowMs)) return null
        if (enteredOn(lastEnterMs, nowMs)) return null
        return resolved(geofence, GeofenceTrigger.ON_LATE, geofence.onLateAction, childDid, nowMs)
            ?.copy(summary = overdueSummary(geofence))
    }

    /** [lastEnterMs] 落在 [nowMs] 的同一本地日 → 视为"当天已进入"。null（从未进入）→ false。 */
    private fun enteredOn(lastEnterMs: Long?, nowMs: Long): Boolean =
        lastEnterMs != null && localDate(lastEnterMs) == localDate(nowMs)

    private fun overdueSummary(geofence: GeofenceEntity): String {
        val kindLabel = GeofenceKind.fromStorage(geofence.kind)?.let { kindLabel(it) } ?: geofence.name
        return "应到未到「${geofence.name}」($kindLabel)"
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
