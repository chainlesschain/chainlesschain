package com.chainlesschain.android.feature.familyguard.domain.quiethours

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import java.time.Instant
import java.time.ZoneId
import javax.inject.Inject

/**
 * 私有时段 (Quiet Hours) 命中引擎 (FAMILY-24).
 *
 * 主文档 §3.2 v0.2 语义: "孩子端可声明私有时段, 期间 **L0 仍上报**;
 * **L1/L2/L3 全停采**; M3 通话默认拒接; M4 规则继续生效。"
 *
 * 本引擎只回答 "给定时刻是否落在某个私有窗口内" ([isActive]) + "据此把请求的上报
 * 级别降级到 L0" ([effectiveLevel])。窗口配置存于每条 family_relationship 的
 * [com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions.telemetryQuietHours]。
 *
 * 命中判断按 **本地墙钟** ([zoneId]) 比较, 因 '20:00'-'06:00' 是用户感知的本地时间;
 * 而事件时间戳 ([Instant]) 是 epoch (zone-agnostic), 故由调用方传入事件发生时刻,
 * 引擎在此做 epoch → 本地 LocalTime/DayOfWeek 转换。[zoneId] 默认设备本地时区
 * (DI provideZoneId); 与 [FamilyGuardModule.provideClock] 的 UTC epoch clock 正交 —
 * clock 管 "何时", zoneId 管 "墙钟几点"。
 *
 * **跨午夜**: end < start 视为跨天 ('22:00'-'06:00')。此时拆成两段判断:
 *   - 当天 [start, 24:00) — anchor = 今天
 *   - 次日 [00:00, end)  — anchor = 昨天 (窗口在昨天开始)
 * [QuietHourWindow.weekdayOnly] 按 **anchor 日** 判工作日, 故周六凌晨 02:00 命中的是
 * 周五开始的窗口 → 用周五判 weekday (命中), 而非周六。
 *
 * 单日累计上限 ([dailyTotalMinutes] / [exceedsDailyCap]) 的**权威拒绝点**是
 * [com.chainlesschain.android.feature.familyguard.data.repository.FamilyRelationshipRepositoryImpl]
 * 的 validatePermissions (写库前校验); 本引擎同名 helper 供 UI 预校验复用 (FAMILY-18
 * 权限编辑页), 两处共用 [QuietHourWindow.durationMinutes] 不漂移。
 */
class QuietHoursEngine @Inject constructor(
    private val zoneId: ZoneId,
) {

    /** [at] (本地墙钟) 是否落在任一 [windows] 内。空列表恒 false。 */
    fun isActive(windows: List<QuietHourWindow>, at: Instant): Boolean {
        if (windows.isEmpty()) return false
        val local = at.atZone(zoneId)
        val nowMin = local.hour * MINUTES_PER_HOUR + local.minute
        val today = local.dayOfWeek.value // ISO: Mon=1 .. Sun=7
        val yesterday = if (today == 1) 7 else today - 1
        return windows.any { matches(it, nowMin, today, yesterday) }
    }

    /**
     * 把 [requested] 级别按私有时段降级: 命中且 requested > L0 → 降到 L0;
     * 否则原样返回。L0 永不被降 (聚合永远允许上报)。
     */
    fun effectiveLevel(
        requested: TelemetryLevel,
        windows: List<QuietHourWindow>,
        at: Instant,
    ): TelemetryLevel = when {
        requested == TelemetryLevel.L0 -> TelemetryLevel.L0
        isActive(windows, at) -> TelemetryLevel.L0
        else -> requested
    }

    /** 全部窗口累计分钟数 (跨午夜窗口已按 [QuietHourWindow.durationMinutes] 加 24h)。 */
    fun dailyTotalMinutes(windows: List<QuietHourWindow>): Int =
        windows.sumOf { it.durationMinutes() }

    /** 累计是否超 [capMinutes] (默认上限见 FamilyPermissions.DEFAULT_QUIET_HOURS_MAX_MIN)。 */
    fun exceedsDailyCap(windows: List<QuietHourWindow>, capMinutes: Int): Boolean =
        dailyTotalMinutes(windows) > capMinutes

    private fun matches(window: QuietHourWindow, nowMin: Int, today: Int, yesterday: Int): Boolean {
        val start = window.start.toMinutes()
        val end = window.end.toMinutes()
        if (start == end) return false // 零长窗口: 永不激活
        return if (end > start) {
            // 同日窗口
            nowMin in start until end && appliesOn(window, today)
        } else {
            // 跨午夜: 今日尾段 [start,24:00) 或 昨日延伸 [00:00,end)
            (nowMin >= start && appliesOn(window, today)) ||
                (nowMin < end && appliesOn(window, yesterday))
        }
    }

    /** weekdayOnly=true 时仅 Mon-Fri (ISO 1..5) 生效; 否则全周。 */
    private fun appliesOn(window: QuietHourWindow, isoDay: Int): Boolean =
        !window.weekdayOnly || isoDay in 1..5

    private fun String.toMinutes(): Int {
        val parts = split(":")
        return parts[0].toInt() * MINUTES_PER_HOUR + parts[1].toInt()
    }

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}
