package com.chainlesschain.android.feature.familyguard.domain.anomaly

import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-55 验收: GeofenceDwellDetector 纯函数 — 停留会话聚合 + 安全区跳过 + 禁入区/非安全
 * 区分级 + 时长阈值 + 间隔断开 + dedupKey。固定时区 Asia/Shanghai。
 */
class GeofenceDwellDetectorTest {

    private val zone = ZoneId.of("Asia/Shanghai")
    private val detector = GeofenceDwellDetector(zone)
    private val child = "did:child:1"
    private val config = AnomalyConfig() // dwellMin=30min, radius=150m, maxGap=20min

    // 基准点: 上海某处。附近点 (±0.0003° ≈ 33m) 视为同处停留。
    private val baseLat = 31.2300
    private val baseLng = 121.4700

    private fun ms(date: String, time: String): Long =
        LocalDateTime.parse("${date}T$time").atZone(zone).toInstant().toEpochMilli()

    private fun point(time: String, lat: Double = baseLat, lng: Double = baseLng) = LocationPointEntity(
        childDid = child,
        deviceId = "dev1",
        latitude = lat,
        longitude = lng,
        source = "fused",
        timestamp = ms("2026-06-01", time),
    )

    private fun geofence(
        id: String,
        kind: String,
        lat: Double = baseLat,
        lng: Double = baseLng,
        radiusM: Int = 200,
        active: Boolean = true,
    ) = GeofenceEntity(
        id = id,
        familyGroupId = "grp",
        name = if (kind == "banned") "网吧" else "家",
        kind = kind,
        latitude = lat,
        longitude = lng,
        radiusM = radiusM,
        onEnterAction = "notify_parent",
        onExitAction = "silent",
        onLateAction = "notify_parent",
        active = active,
    )

    // 40min 同处停留序列 (每 10min 一点，轻微抖动但都在 150m 内)。
    private fun dwell40min() = listOf(
        point("14:00"),
        point("14:10", lat = baseLat + 0.0002),
        point("14:20", lng = baseLng + 0.0002),
        point("14:30"),
        point("14:40", lat = baseLat - 0.0001),
    )

    @Test
    fun `dwell in non-safe area flags WARNING`() {
        val out = detector.detect(child, dwell40min(), emptyList(), ms("2026-06-01", "15:00"), config)
        assertEquals(1, out.size)
        assertEquals(AnomalyType.GEOFENCE_DWELL, out[0].type)
        assertEquals(AnomalySeverity.WARNING, out[0].severity)
        assertTrue(out[0].summary.contains("非安全区域"))
    }

    @Test
    fun `dwell inside safe geofence is skipped`() {
        val home = geofence("home1", "home")
        val out = detector.detect(child, dwell40min(), listOf(home), ms("2026-06-01", "15:00"), config)
        assertTrue(out.isEmpty())
    }

    @Test
    fun `dwell inside banned geofence flags CRITICAL`() {
        val banned = geofence("ban1", "banned")
        val out = detector.detect(child, dwell40min(), listOf(banned), ms("2026-06-01", "15:00"), config)
        assertEquals(1, out.size)
        assertEquals(AnomalySeverity.CRITICAL, out[0].severity)
        assertTrue(out[0].summary.contains("禁入区"))
        assertTrue(out[0].dedupKey.contains("banned:ban1"))
    }

    @Test
    fun `short stay below threshold is not flagged`() {
        val short = listOf(point("14:00"), point("14:10"), point("14:20")) // 20min < 30min
        val out = detector.detect(child, short, emptyList(), ms("2026-06-01", "15:00"), config)
        assertTrue(out.isEmpty())
    }

    @Test
    fun `gap breaks session so neither half reaches threshold`() {
        // 两段各 20min，中间隔 40min (> maxGap 20min) → 断开，两段都 < 30min。
        val pts = listOf(
            point("14:00"), point("14:10"), point("14:20"),
            point("15:00"), point("15:10"), point("15:20"),
        )
        val out = detector.detect(child, pts, emptyList(), ms("2026-06-01", "16:00"), config)
        assertTrue(out.isEmpty())
    }

    @Test
    fun `moving away ends session`() {
        // 前 3 点同处 20min，之后跑去 ~2km 外 (超 150m) → 第一段断在 14:20，仅 20min<30min。
        val farLat = baseLat + 0.02 // ≈2.2km
        val pts = listOf(
            point("14:00"), point("14:10"), point("14:20"),
            point("14:30", lat = farLat), point("14:40", lat = farLat),
        )
        val out = detector.detect(child, pts, emptyList(), ms("2026-06-01", "15:00"), config)
        assertTrue(out.isEmpty())
    }

    @Test
    fun `inactive geofence does not shelter dwell`() {
        // 家围栏 inactive → 停留不被"安全区"豁免 → 仍 WARNING。
        val home = geofence("home1", "home", active = false)
        val out = detector.detect(child, dwell40min(), listOf(home), ms("2026-06-01", "15:00"), config)
        assertEquals(1, out.size)
        assertEquals(AnomalySeverity.WARNING, out[0].severity)
    }

    @Test
    fun `dedupKey is stable for same location and day`() {
        val now = ms("2026-06-01", "15:00")
        val k1 = detector.detect(child, dwell40min(), emptyList(), now, config)[0].dedupKey
        val k2 = detector.detect(child, dwell40min(), emptyList(), now, config)[0].dedupKey
        assertEquals(k1, k2)
        assertTrue(k1.startsWith("geofence_dwell:loc:"))
        assertTrue(k1.endsWith(":2026-06-01"))
    }

    @Test
    fun `fewer than two points yields nothing`() {
        assertTrue(detector.detect(child, listOf(point("14:00")), emptyList(), ms("2026-06-01", "15:00"), config).isEmpty())
        assertTrue(detector.detect(child, emptyList(), emptyList(), ms("2026-06-01", "15:00"), config).isEmpty())
    }
}
