package com.chainlesschain.android.feature.familyguard.domain.anomaly

/**
 * [AnomalyDetector] v0 阈值 + 名单配置 (FAMILY-27).
 *
 * DI 提供默认实例 (AnomalyModule.provideAnomalyConfig); 家长端按家庭规则覆盖留
 * FAMILY-17 RuleMerger / FAMILY-12 permissions 后续接通 (v0 用默认值)。单测直接构造
 * 变体覆盖各规则边界。
 *
 * @property singleAppMaxMinutes 单 app 连续使用上限 (主文档: 90min)。
 * @property singleAppSessionGapMs 合并同 app 连续运行段的最大间隔; 间隔超此视为两段会话
 *   (ForegroundAppAggregator 30min 强制切段, 故连续使用由多段拼回)。
 * @property dailyGameMaxMinutes 单日游戏类 app 累计上限 (主文档: 3h = 180min)。
 * @property lateNightStartHour / lateNightEndHour 凌晨亮屏判定窗口 [start, end) 本地小时。
 * @property rechargeIntentThreshold 单日充值类 intent 触发阈值 (≥ 此值告警)。
 * @property gamePackages 游戏类包名集 (DAILY_GAME_OVERUSE 判定)。
 * @property rechargeKinds 视为充值意图的 child_event.kind 集 (RECHARGE_INTENT_SPIKE 判定)。
 * @property knownApps 已知/系统 app 白名单 (UNKNOWN_APP_FIRST_SEEN 跳过这些)。
 */
data class AnomalyConfig(
    val singleAppMaxMinutes: Int = 90,
    val singleAppSessionGapMs: Long = 5 * 60_000L,
    val dailyGameMaxMinutes: Int = 180,
    val lateNightStartHour: Int = 0,
    val lateNightEndHour: Int = 6,
    val rechargeIntentThreshold: Int = 3,
    val gamePackages: Set<String> = DEFAULT_GAME_PACKAGES,
    val rechargeKinds: Set<String> = DEFAULT_RECHARGE_KINDS,
    val knownApps: Set<String> = emptySet(),
) {
    companion object {
        /**
         * v0 内置游戏包名 (可被家长配置覆盖)。仅热门样本; 完整库走云端下发留 v0.2。
         */
        val DEFAULT_GAME_PACKAGES: Set<String> = setOf(
            "com.tencent.tmgp.sgame", // 王者荣耀
            "com.tencent.tmgp.pubgmhd", // 和平精英
            "com.tencent.tmgp.cf", // 穿越火线
            "com.miHoYo.ys", // 原神 (国服)
            "com.miHoYo.GenshinImpact", // 原神 (国际服)
            "com.netease.dwrg", // 蛋仔派对
        )

        /** v0 视为充值意图的事件 kind (PDH collector / Accessibility 上报)。 */
        val DEFAULT_RECHARGE_KINDS: Set<String> = setOf("recharge", "payment", "topup")
    }
}
