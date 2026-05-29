package com.chainlesschain.android.feature.familyguard.domain.merger

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.CompanionSummaryAccess
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel

/**
 * 多家长冲突解决核心 (FAMILY-17). 主文档 §3.1 v0.2 + §3.4 v0.2:
 *   - app_time_limit  → 取**最严** (min daily_max_sec, 最窄 window)
 *   - app_blocklist   → **并集** (任一家长拉黑即拉黑)
 *   - payment_cap     → 取**最严** (min per_day / per_month / approval_threshold)
 *   - permissions     → 字段级取严 (bool AND, level min, companion NEVER 赢)
 *   - approval votes  → **一票否决** (任一拒绝 = 拒绝)
 *
 * source_priority (Primary=1 / Secondary=2) v0.1 仅做记录, **不影响 merge**:
 * 默认行为是"取最严", 防"primary 不小心覆盖 secondary 严格规则"导致孩子失保护。
 * 真正的"primary 可显式覆盖 secondary"工作流留 FAMILY-XX (走"提议 + 协商频道")。
 *
 * 所有 method 纯函数, 单测可直接调; 不接 IO; 输入空列表时返回 null 或合理默认。
 */
object RuleMerger {

    // ─── 1. AppTimeLimit ───

    /**
     * 取最严: min(dailyMaxSec), 最窄 weekday/weekend window (取交集)。
     * 同 packageName 多 config 才能合并; 不同 package 调用方应先分组。
     *
     * 跨午夜 window 在 v0.1 简化处理: 任一为跨午夜则保留申请方原 window 不做窄化
     * (实际产品中跨午夜窗口少见; 复杂的窗口逻辑留 FAMILY-Enforce body 落地)。
     *
     * @return 合并 config; 空列表 → null
     */
    fun mergeAppTimeLimit(configs: List<AppTimeLimitConfig>): AppTimeLimitConfig? {
        if (configs.isEmpty()) return null
        if (configs.size == 1) return configs[0]
        val pkg = configs[0].packageName
        require(configs.all { it.packageName == pkg }) {
            "mergeAppTimeLimit requires same packageName; got ${configs.map { it.packageName }}"
        }
        return AppTimeLimitConfig(
            packageName = pkg,
            dailyMaxSec = configs.minOf { it.dailyMaxSec },
            weekdayWindow = narrowestWindow(configs.mapNotNull { it.weekdayWindow }),
            weekendWindow = narrowestWindow(configs.mapNotNull { it.weekendWindow }),
        )
    }

    /** 多窗口取交集 (start = max start, end = min end); 若结果无效则保留第一个原值。 */
    internal fun narrowestWindow(windows: List<TimeWindow>): TimeWindow? {
        if (windows.isEmpty()) return null
        // 任何跨午夜 → 简化, 直接返第一个 (跨午夜的窗口交集语义复杂, 留产品决策)
        if (windows.any { it.endMinutes() < it.startMinutes() }) return windows[0]
        val maxStart = windows.maxOf { it.startMinutes() }
        val minEnd = windows.minOf { it.endMinutes() }
        if (maxStart >= minEnd) return windows[0] // 无重叠 → fallback 第一个原值
        return TimeWindow(
            start = minutesToHhMm(maxStart),
            end = minutesToHhMm(minEnd),
        )
    }

    private fun minutesToHhMm(min: Int): String {
        val h = min / 60
        val m = min % 60
        return "%02d:%02d".format(h, m)
    }

    // ─── 2. AppBlocklist ───

    /** 并集. 重复 package 去重; 保持首次出现顺序 (LinkedHashSet)。 */
    fun mergeAppBlocklist(configs: List<AppBlocklistConfig>): AppBlocklistConfig {
        val merged = LinkedHashSet<String>()
        configs.forEach { merged.addAll(it.packages) }
        return AppBlocklistConfig(packages = merged.toList())
    }

    // ─── 3. PaymentCap ───

    /** 取最严: min per_day / per_month / approval_threshold. 空列表 → null。 */
    fun mergePaymentCap(configs: List<PaymentCapConfig>): PaymentCapConfig? {
        if (configs.isEmpty()) return null
        return PaymentCapConfig(
            perDay = configs.minOf { it.perDay },
            perMonth = configs.minOf { it.perMonth },
            perTxApprovalThreshold = configs.minOf { it.perTxApprovalThreshold },
        )
    }

    // ─── 4. Permissions (字段级取严) ───

    /**
     * 合并多 [FamilyPermissions]:
     *   - bool allow_*: AND (任一 false → false)
     *   - telemetryLevel: 取**最低** (家长能看到的级别取交集 → 最低)
     *   - companionSummary: NEVER 赢 over STATS_ONLY
     *   - quietHoursMaxPerDayMin: max (孩子端隐私上限取最严 = 最宽松上限, 给孩子留余地)
     *   - telemetryAppsBlocklist: 并集
     *   - telemetryQuietHours: 并集 (家长间不冲突 — 都是孩子端时段叠加)
     *
     * 空列表 → null (调用方应自行决策默认权限).
     */
    fun mergePermissions(perms: List<FamilyPermissions>): FamilyPermissions? {
        if (perms.isEmpty()) return null
        if (perms.size == 1) return perms[0]

        // telemetry level 取 min — 字段 ordinalLevel 越大权限越大, min 即取严
        val mergedLevel = perms.minBy { it.telemetryLevel.ordinalLevel }.telemetryLevel

        // companion: NEVER 优先
        val mergedCompanion =
            if (perms.any { it.allowCompanionSummary == CompanionSummaryAccess.NEVER }) {
                CompanionSummaryAccess.NEVER
            } else {
                CompanionSummaryAccess.STATS_ONLY
            }

        // blocklist 并集
        val mergedAppsBlocklist = LinkedHashSet<String>().apply {
            perms.forEach { addAll(it.telemetryAppsBlocklist) }
        }.toList()

        // quiet_hours 并集 (按 (start, end, weekday_only) 去重)
        val mergedQuietHours = LinkedHashSet<QuietHourWindow>().apply {
            perms.forEach { addAll(it.telemetryQuietHours) }
        }.toList()

        return FamilyPermissions(
            telemetryLevel = mergedLevel,
            telemetryAppsBlocklist = mergedAppsBlocklist,
            telemetryQuietHours = mergedQuietHours,
            _quietHoursMaxPerDayMin = perms.maxOf { it._quietHoursMaxPerDayMin },
            allowMessage = perms.all { it.allowMessage },
            allowAudioCall = perms.all { it.allowAudioCall },
            allowVideoCall = perms.all { it.allowVideoCall },
            allowSilentObserve = perms.all { it.allowSilentObserve },
            allowForcePickup = perms.all { it.allowForcePickup },
            allowRemoteView = perms.all { it.allowRemoteView },
            allowRuleEdit = perms.all { it.allowRuleEdit },
            allowTaskAssign = perms.all { it.allowTaskAssign },
            allowAppDisable = perms.all { it.allowAppDisable },
            allowAppHide = perms.all { it.allowAppHide },
            allowPaymentVeto = perms.all { it.allowPaymentVeto },
            allowLocationView = perms.all { it.allowLocationView },
            allowGeofenceEdit = perms.all { it.allowGeofenceEdit },
            allowSosReceive = perms.all { it.allowSosReceive },
            allowRewardGrant = perms.all { it.allowRewardGrant },
            allowCompanionSummary = mergedCompanion,
            allowEmergencyUnbind = perms.all { it.allowEmergencyUnbind },
        )
    }

    // ─── 5. Approval voting (一票否决) ───

    /**
     * 主文档 §3.1 v0.2 多家长冲突: "任意 guardian 拒绝支付审批 = 拒绝"。
     *
     * 任一 vote=false → false (REJECT). 空列表 → null (无投票, 调用方决策).
     * 全 vote=true → true (APPROVE).
     */
    fun aggregateApprovals(votes: List<Boolean>): Boolean? {
        if (votes.isEmpty()) return null
        return votes.all { it }
    }
}
