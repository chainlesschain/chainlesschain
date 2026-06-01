package com.chainlesschain.android.feature.familyguard.domain.anomaly

import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceKind
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 围栏异常停留检测 (FAMILY-55，M8 联动；主文档 §3.2 第 6 条规则)。
 *
 * **纯函数** ([detect] 无 IO): 与 [AnomalyDetector] 并列的第 6 条异常规则，但消费的是
 * [LocationPointEntity] 序列（FAMILY-51 调频采集落库）+ active [GeofenceEntity] 定义，
 * 故单开一个 detector（不塞进消费前台事件的 AnomalyDetector.detect 签名）。产出同样的
 * [DetectedAnomaly]，复用 anomaly 表 + dedup + 推送通道（rowId≤0 去重）。
 *
 * 规则: 把连续位置点聚成"停留会话"——新点偏离会话锚点 ≤ [AnomalyConfig.dwellRadiusM] 且与
 * 上一点间隔 ≤ [AnomalyConfig.dwellMaxPointGapMs] 则并入；否则断开。会话时长 ≥
 * [AnomalyConfig.dwellMinMinutes] 且锚点**不在**任何 active 安全围栏（家/学校/培训班）内时:
 *   - 落在 active 禁入区围栏 → CRITICAL ("在禁入区停留…")
 *   - 不在任何围栏 → WARNING ("在非安全区域停留…")
 * 在安全围栏内的长停留属正常（在家/在校），跳过。
 *
 * 进入禁入区**瞬间**的告警走 FAMILY-54 on_enter；本规则补的是"停留时长"维度。
 * dedupKey 按 停留地点桶（禁入区 id / 经纬度三位小数 ≈111m）+ 本地日分桶，复扫不重复落库。
 *
 * 距离用 Haversine（球面近似，城市尺度误差可忽略），避免引地图 SDK 依赖、保持纯 JVM 可单测。
 */
class GeofenceDwellDetector @Inject constructor(
    private val zoneId: ZoneId,
) {

    fun detect(
        childDid: String,
        points: List<LocationPointEntity>,
        activeGeofences: List<GeofenceEntity>,
        nowMs: Long,
        config: AnomalyConfig,
    ): List<DetectedAnomaly> {
        val sorted = points.sortedBy { it.timestamp }
        if (sorted.size < 2) return emptyList()
        val active = activeGeofences.filter { it.active }
        val dwellMinMs = config.dwellMinMinutes * MS_PER_MIN
        val out = mutableListOf<DetectedAnomaly>()

        var anchor: LocationPointEntity? = null
        var last: LocationPointEntity? = null

        fun flush() {
            val a = anchor ?: return
            val l = last ?: return
            val durMs = l.timestamp - a.timestamp
            if (durMs >= dwellMinMs) {
                classify(childDid, a, durMs, active, nowMs)?.let { out += it }
            }
        }

        for (p in sorted) {
            val a = anchor
            if (a == null) {
                anchor = p
                last = p
                continue
            }
            val withinRadius = haversineM(a.latitude, a.longitude, p.latitude, p.longitude) <= config.dwellRadiusM
            val gapOk = p.timestamp - last!!.timestamp <= config.dwellMaxPointGapMs
            if (withinRadius && gapOk) {
                last = p
            } else {
                flush()
                anchor = p
                last = p
            }
        }
        flush()
        return out
    }

    private fun classify(
        childDid: String,
        anchor: LocationPointEntity,
        durMs: Long,
        active: List<GeofenceEntity>,
        nowMs: Long,
    ): DetectedAnomaly? {
        val insideSafe = active.any { isSafe(it.kind) && contains(it, anchor) }
        if (insideSafe) return null // 在家/学校/培训班长停留属正常
        val minutes = durMs / MS_PER_MIN
        val banned = active.firstOrNull { it.kind == GeofenceKind.BANNED.storageValue && contains(it, anchor) }
        return if (banned != null) {
            DetectedAnomaly(
                type = AnomalyType.GEOFENCE_DWELL,
                severity = AnomalySeverity.CRITICAL,
                childDid = childDid,
                dedupKey = "${AnomalyType.GEOFENCE_DWELL.storageValue}:banned:${banned.id}:${localDate(anchor.timestamp)}",
                summary = "在禁入区「${banned.name}」停留约 $minutes 分钟",
                detail = "dwell_ms=$durMs geofence=${banned.id}",
                detectedAtMs = nowMs,
            )
        } else {
            DetectedAnomaly(
                type = AnomalyType.GEOFENCE_DWELL,
                severity = AnomalySeverity.WARNING,
                childDid = childDid,
                dedupKey = "${AnomalyType.GEOFENCE_DWELL.storageValue}:loc:${bucket(anchor.latitude)},${bucket(anchor.longitude)}:${localDate(anchor.timestamp)}",
                summary = "在非安全区域停留约 $minutes 分钟",
                detail = "dwell_ms=$durMs lat=${anchor.latitude} lng=${anchor.longitude}",
                detectedAtMs = nowMs,
            )
        }
    }

    private fun isSafe(kind: String): Boolean = when (GeofenceKind.fromStorage(kind)) {
        GeofenceKind.HOME, GeofenceKind.SCHOOL, GeofenceKind.CLASS -> true
        GeofenceKind.BANNED, null -> false
    }

    private fun contains(geofence: GeofenceEntity, point: LocationPointEntity): Boolean =
        haversineM(geofence.latitude, geofence.longitude, point.latitude, point.longitude) <= geofence.radiusM

    /** 经纬度三位小数桶 (≈111m)，dedup 稳定。 */
    private fun bucket(coord: Double): Long = (coord * 1000).roundToLong()

    private fun localDate(epochMs: Long): LocalDate =
        Instant.ofEpochMilli(epochMs).atZone(zoneId).toLocalDate()

    private fun haversineM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return EARTH_RADIUS_M * (2 * atan2(sqrt(a), sqrt(1 - a)))
    }

    private companion object {
        const val MS_PER_MIN = 60_000L
        const val EARTH_RADIUS_M = 6_371_000.0
    }
}
