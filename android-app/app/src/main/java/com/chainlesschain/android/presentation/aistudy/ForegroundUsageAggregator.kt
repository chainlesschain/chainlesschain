package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity

/** 单个 app 的今日使用 (供学情报告"今日使用"块)。 */
data class AppUsage(val label: String, val minutes: Int)

/** 今日前台使用汇总 (主文档 §3.2 L0/L1 → §3.6 学情报告"今日使用"块)。 */
data class ForegroundUsageSummary(
    val totalMinutes: Int,
    /** 用时最长的前几个 app (友好名 + 分钟)。 */
    val topApps: List<AppUsage>,
)

/**
 * 把孩子端 telemetry 的前台 app run 事件聚合成"今日使用"汇总 (纯逻辑, 可单测)。
 *
 * 输入 = [com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
 * .querySince] 取到的当日 [ChildEventEntity]；只认 `source='foreground_app'` + `kind='run'`
 * (FAMILY-20 ForegroundAppTimer 写的聚合段)，按 package 累加 durationMs，给总时长 + top-N。
 * package 经 [KNOWN_APPS] 映射友好名 (未知取包名末段)，避免家长看见裸包名。
 */
object ForegroundUsageAggregator {

    private val PKG = Regex(""""package"\s*:\s*"([^"]+)"""")

    fun summarize(events: List<ChildEventEntity>, topN: Int = 3): ForegroundUsageSummary {
        val runs = events.filter { it.source == SOURCE_FOREGROUND_APP && it.kind == KIND_RUN }
        if (runs.isEmpty()) return ForegroundUsageSummary(0, emptyList())

        val byPackage = HashMap<String, Long>()
        for (e in runs) {
            val pkg = packageOf(e) ?: continue
            byPackage[pkg] = (byPackage[pkg] ?: 0L) + e.durationMs.coerceAtLeast(0L)
        }
        val totalMin = msToMinutes(byPackage.values.sum())
        val top = byPackage.entries
            .sortedWith(compareByDescending<Map.Entry<String, Long>> { it.value }.thenBy { it.key })
            .map { AppUsage(label(it.key), msToMinutes(it.value)) }
            .filter { it.minutes > 0 }
            .take(topN)
        return ForegroundUsageSummary(totalMinutes = totalMin, topApps = top)
    }

    private fun packageOf(e: ChildEventEntity): String? =
        PKG.find(e.payload)?.groupValues?.get(1)?.takeIf { it.isNotBlank() }

    private fun label(pkg: String): String = KNOWN_APPS[pkg] ?: pkg.substringAfterLast('.')

    private fun msToMinutes(ms: Long): Int = (ms / 60_000L).toInt()

    private const val SOURCE_FOREGROUND_APP = "foreground_app"
    private const val KIND_RUN = "run"

    // 常见 app 友好名 (社交/游戏/学习为主; 未知包名取末段)。
    private val KNOWN_APPS = mapOf(
        "com.tencent.mm" to "微信",
        "com.tencent.mobileqq" to "QQ",
        "com.ss.android.ugc.aweme" to "抖音",
        "com.smile.gifmaker" to "快手",
        "com.sina.weibo" to "微博",
        "com.xingin.xhs" to "小红书",
        "com.zhihu.android" to "知乎",
        "com.tencent.tmgp.sgame" to "王者荣耀",
        "com.tencent.tmgp.pubgmhd" to "和平精英",
        "com.miHoYo.Yuanshen" to "原神",
        "com.miHoYo.enterprise.NGHSoD" to "崩坏：星穹铁道",
        "com.netease.mc" to "我的世界",
        "com.baidu.homework" to "作业帮",
        "com.fenbi.android.solar" to "小猿搜题",
        "com.bilibili.app.in" to "哔哩哔哩",
        "tv.danmaku.bili" to "哔哩哔哩",
        "com.android.chrome" to "Chrome 浏览器",
        "com.UCMobile" to "UC 浏览器",
    )
}
