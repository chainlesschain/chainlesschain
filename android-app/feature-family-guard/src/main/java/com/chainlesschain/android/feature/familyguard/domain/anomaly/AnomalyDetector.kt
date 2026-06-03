package com.chainlesschain.android.feature.familyguard.domain.anomaly

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

/**
 * 异常事件检测引擎 v0 (FAMILY-27). 主文档 §3.2 "异常事件触发" 5 条 v0 规则:
 *
 *   1. SINGLE_APP_OVERUSE     — 单 app 连续使用 > 90min
 *   2. LATE_NIGHT_SCREEN      — 凌晨 0:00-6:00 亮屏
 *   3. DAILY_GAME_OVERUSE     — 单日游戏 > 3h
 *   4. UNKNOWN_APP_FIRST_SEEN — 30 天内首次进入未知 app
 *   5. RECHARGE_INTENT_SPIKE  — 充值类 intent 单日 ≥ 阈值
 *
 * **纯函数** ([detect] 无 IO): 由 [com.chainlesschain.android.feature.familyguard.data.anomaly.AnomalyScanTimer]
 * 备好窗口数据后驱动, 单测可直接喂 [ChildEventEntity] 断言。日期/小时按本地墙钟
 * ([zoneId], DI 注入设备时区) 计算 — 凌晨亮屏 + 单日聚合都是用户感知的本地时间。
 *
 * 连续使用合并: ForegroundAppAggregator 把同 app 30min 强制切段, 故"连续 90min"由
 * 多段拼回 —— 同包名相邻段间隔 ≤ [AnomalyConfig.singleAppSessionGapMs] 视为一次会话,
 * 会话累计时长比对阈值。
 *
 * 去重: 每条异常生成稳定 [DetectedAnomaly.dedupKey] (按 app/日/夜 分桶), 故每 15min
 * 复扫同一天的同一异常 key 不变, 仓储 OnConflict IGNORE 去重 → 家长只收一次。
 */
class AnomalyDetector @Inject constructor(
    private val zoneId: ZoneId,
) {

    /**
     * @param childDid 本机 child DID (写入异常)
     * @param windowEvents 扫描窗口内事件 (建议 24h, 覆盖单日聚合规则)
     * @param priorForegroundPackages 窗口之前 [lookback] 天内出现过的前台包名集
     *   (UNKNOWN_APP_FIRST_SEEN 用: 窗口内出现但此集合 + 白名单都无 → 首见)
     * @param nowMs 扫描时刻 (= 检出时间)
     */
    fun detect(
        childDid: String,
        windowEvents: List<ChildEventEntity>,
        priorForegroundPackages: Set<String>,
        nowMs: Long,
        config: AnomalyConfig,
    ): List<DetectedAnomaly> {
        val runs = windowEvents
            .filter { it.source == SOURCE_FOREGROUND_APP && it.kind == KIND_RUN }
            .mapNotNull { e ->
                ForegroundAppPayload.decodePackageOrNull(e.payload)?.let { pkg ->
                    ForegroundRun(pkg, e.timestamp, e.durationMs)
                }
            }
            .sortedBy { it.startMs }

        val out = mutableListOf<DetectedAnomaly>()
        out += detectSingleAppOveruse(childDid, runs, nowMs, config)
        out += detectLateNightScreen(childDid, runs, nowMs, config)
        out += detectDailyGameOveruse(childDid, runs, nowMs, config)
        out += detectUnknownAppFirstSeen(childDid, runs, priorForegroundPackages, nowMs, config)
        out += detectRechargeSpike(childDid, windowEvents, nowMs, config)
        return out
    }

    // ─── Rule 1: 单 app 连续 > 90min ───

    private fun detectSingleAppOveruse(
        childDid: String,
        runs: List<ForegroundRun>,
        nowMs: Long,
        config: AnomalyConfig,
    ): List<DetectedAnomaly> {
        val thresholdMs = config.singleAppMaxMinutes * MS_PER_MIN
        val out = mutableListOf<DetectedAnomaly>()
        // 按包名分组, 各自按时间合并相邻会话。
        runs.groupBy { it.packageName }.forEach { (pkg, pkgRuns) ->
            var sessionStart = -1L
            var sessionEnd = -1L
            var sessionTotalMs = 0L
            fun flush() {
                if (sessionStart >= 0 && sessionTotalMs > thresholdMs) {
                    out += singleAppAnomaly(childDid, pkg, sessionStart, sessionTotalMs, nowMs)
                }
            }
            for (run in pkgRuns) {
                val runEnd = run.startMs + run.durationMs
                if (sessionStart < 0) {
                    sessionStart = run.startMs
                    sessionEnd = runEnd
                    sessionTotalMs = run.durationMs
                } else if (run.startMs - sessionEnd <= config.singleAppSessionGapMs) {
                    sessionEnd = runEnd
                    sessionTotalMs += run.durationMs
                } else {
                    flush()
                    sessionStart = run.startMs
                    sessionEnd = runEnd
                    sessionTotalMs = run.durationMs
                }
            }
            flush()
        }
        return out
    }

    private fun singleAppAnomaly(
        childDid: String,
        pkg: String,
        sessionStartMs: Long,
        totalMs: Long,
        nowMs: Long,
    ): DetectedAnomaly {
        val minutes = totalMs / MS_PER_MIN
        return DetectedAnomaly(
            type = AnomalyType.SINGLE_APP_OVERUSE,
            severity = AnomalySeverity.WARNING,
            childDid = childDid,
            dedupKey = "${AnomalyType.SINGLE_APP_OVERUSE.storageValue}:$pkg:${localDate(sessionStartMs)}",
            summary = "应用 $pkg 连续使用约 $minutes 分钟",
            detail = "session_start=$sessionStartMs total_ms=$totalMs",
            detectedAtMs = nowMs,
        )
    }

    // ─── Rule 2: 凌晨 0:00-6:00 亮屏 ───

    private fun detectLateNightScreen(
        childDid: String,
        runs: List<ForegroundRun>,
        nowMs: Long,
        config: AnomalyConfig,
    ): List<DetectedAnomaly> {
        // 每个凌晨亮屏的本地日期最多一条 (一夜一报)。
        val nightDates = runs
            .filter { localHour(it.startMs) in config.lateNightStartHour until config.lateNightEndHour }
            .map { localDate(it.startMs) }
            .toSortedSet()
        return nightDates.map { date ->
            DetectedAnomaly(
                type = AnomalyType.LATE_NIGHT_SCREEN,
                severity = AnomalySeverity.CRITICAL,
                childDid = childDid,
                dedupKey = "${AnomalyType.LATE_NIGHT_SCREEN.storageValue}:$date",
                summary = "$date 凌晨检测到亮屏使用",
                detail = "window=${config.lateNightStartHour}:00-${config.lateNightEndHour}:00",
                detectedAtMs = nowMs,
            )
        }
    }

    // ─── Rule 3: 单日游戏 > 3h ───

    private fun detectDailyGameOveruse(
        childDid: String,
        runs: List<ForegroundRun>,
        nowMs: Long,
        config: AnomalyConfig,
    ): List<DetectedAnomaly> {
        val thresholdMs = config.dailyGameMaxMinutes * MS_PER_MIN
        return runs
            .filter { it.packageName in config.gamePackages }
            .groupBy { localDate(it.startMs) }
            .filterValues { dayRuns -> dayRuns.sumOf { it.durationMs } > thresholdMs }
            .map { (date, dayRuns) ->
                val totalMin = dayRuns.sumOf { it.durationMs } / MS_PER_MIN
                DetectedAnomaly(
                    type = AnomalyType.DAILY_GAME_OVERUSE,
                    severity = AnomalySeverity.WARNING,
                    childDid = childDid,
                    dedupKey = "${AnomalyType.DAILY_GAME_OVERUSE.storageValue}:$date",
                    summary = "$date 游戏累计约 $totalMin 分钟",
                    detail = "games=${dayRuns.map { it.packageName }.distinct()}",
                    detectedAtMs = nowMs,
                )
            }
    }

    // ─── Rule 4: 30 天内首次进入未知 app ───

    private fun detectUnknownAppFirstSeen(
        childDid: String,
        runs: List<ForegroundRun>,
        priorForegroundPackages: Set<String>,
        nowMs: Long,
        config: AnomalyConfig,
    ): List<DetectedAnomaly> {
        return runs.map { it.packageName }.distinct()
            .filter { it !in config.knownApps && it !in priorForegroundPackages }
            .map { pkg ->
                DetectedAnomaly(
                    type = AnomalyType.UNKNOWN_APP_FIRST_SEEN,
                    severity = AnomalySeverity.INFO,
                    childDid = childDid,
                    dedupKey = "${AnomalyType.UNKNOWN_APP_FIRST_SEEN.storageValue}:$pkg",
                    summary = "首次使用新应用 $pkg",
                    detail = "first_seen_at=$nowMs",
                    detectedAtMs = nowMs,
                )
            }
    }

    // ─── Rule 5: 充值 intent 单日 ≥ 阈值 ───

    private fun detectRechargeSpike(
        childDid: String,
        windowEvents: List<ChildEventEntity>,
        nowMs: Long,
        config: AnomalyConfig,
    ): List<DetectedAnomaly> {
        return windowEvents
            .filter { it.kind in config.rechargeKinds }
            .groupBy { localDate(it.timestamp) }
            .filterValues { it.size >= config.rechargeIntentThreshold }
            .map { (date, dayEvents) ->
                DetectedAnomaly(
                    type = AnomalyType.RECHARGE_INTENT_SPIKE,
                    severity = AnomalySeverity.CRITICAL,
                    childDid = childDid,
                    dedupKey = "${AnomalyType.RECHARGE_INTENT_SPIKE.storageValue}:$date",
                    summary = "$date 检测到 ${dayEvents.size} 次充值意图",
                    detail = "count=${dayEvents.size} threshold=${config.rechargeIntentThreshold}",
                    detectedAtMs = nowMs,
                )
            }
    }

    // ─── helpers ───

    private fun localDate(epochMs: Long): LocalDate =
        Instant.ofEpochMilli(epochMs).atZone(zoneId).toLocalDate()

    private fun localHour(epochMs: Long): Int =
        Instant.ofEpochMilli(epochMs).atZone(zoneId).hour

    private data class ForegroundRun(
        val packageName: String,
        val startMs: Long,
        val durationMs: Long,
    )

    private companion object {
        const val SOURCE_FOREGROUND_APP = "foreground_app"
        const val KIND_RUN = "run"
        const val MS_PER_MIN = 60_000L
    }
}
