package com.chainlesschain.android.pdh

import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute

/**
 * §3.5.10 隐私分级路由(纯逻辑核)—— module 101 Phase 2。
 *
 * PDH 复用现成的 4 档 LLM 路由([LlmRoute]),但把方向从 HubAsk 的"能力优先"
 * (默认 CLOUD_ANDROID、回退链 cloud→pc→lan→local)**翻转为隐私优先**:默认选
 * 当前可用的【最私密】档,并按数据敏感度封顶"最低隐私档"。高敏感默认不出端,
 * 上云须显式同意(§7.1)。
 *
 * 这是设计 §3.5.10 的"接线 1/2"纯函数核:隐私 rank + 敏感度→默认档 +
 * effectiveTier。徽章文案 / 手动切档 / 云同意卡 / per-turn 作用到 cc agent 的
 * LLM(接线 3/4/5/6)是上层 UI + cc 侧集成,基于本核搭建。**纯函数、可单测、
 * 无 Android 依赖**(LlmRoute 是纯 enum)。
 */
enum class DataCategory {
    /** 高敏感:健康 / 财务 / 即时通讯 / 位置 —— 默认仅端侧。 */
    HEALTH, FINANCE, IM, LOCATION,

    /** 中敏感:通讯录 / 社交 —— 可到自有 LAN/PC,云须同意。 */
    CONTACTS, SOCIAL,

    /** 低敏感:系统数据 / 文件元数据 / 公开 —— 可云(仍只送摘要)。 */
    SYSTEM, FILE_META, PUBLIC,
}

object PdhPrivacyTier {

    /**
     * 隐私 rank = 数据离端程度。0=不出端(最私密)… 2=第三方云(最不私密)。
     * 真正的隐私悬崖是【云 vs 其余】:端侧不出端;LAN/PC 出端但仍是你自有设备;
     * 只有云把(摘要)交给第三方。
     */
    fun privacyRank(route: LlmRoute): Int = when (route) {
        LlmRoute.LOCAL_DEVICE -> 0
        LlmRoute.LAN_OLLAMA, LlmRoute.PC_LOCAL -> 1
        LlmRoute.CLOUD_ANDROID -> 2
    }

    /** 某类数据默认允许的【最高 rank】:高敏感=0(仅端侧),中=1,低=2。 */
    fun maxAllowedRank(category: DataCategory): Int = when (category) {
        DataCategory.HEALTH, DataCategory.FINANCE,
        DataCategory.IM, DataCategory.LOCATION,
        -> 0
        DataCategory.CONTACTS, DataCategory.SOCIAL -> 1
        DataCategory.SYSTEM, DataCategory.FILE_META, DataCategory.PUBLIC -> 2
    }

    /**
     * 本轮的 effective 档:
     *  1. 用户显式选的档 [selected] 若【可用】且 rank 不超敏感度上限 → 用它(尊重选择);
     *  2. 否则在【可用】档里取满足 rank ≤ 敏感度上限的【最私密】(rank 最小)档;
     *  3. 都不满足(如高敏感但只有云可用)→ null,调用方弹云同意卡或诚实提示。
     *
     * **隐私优先**:与 HubAsk 的 effectiveRoute(能力优先,默认上云)相反。
     */
    fun effectiveTier(
        selected: LlmRoute,
        category: DataCategory,
        available: Set<LlmRoute>,
    ): LlmRoute? {
        if (available.isEmpty()) return null
        val cap = maxAllowedRank(category)
        if (selected in available && privacyRank(selected) <= cap) return selected
        return available
            .filter { privacyRank(it) <= cap }
            .minByOrNull { privacyRank(it) }
    }

    /**
     * 是否需要弹"上云同意卡":想用云档,但该类数据的默认上限不允许直接上云
     * (maxAllowedRank < 云 rank)。同意后才放行云档(可记"本类不再问")。
     */
    fun needsCloudConsent(requested: LlmRoute, category: DataCategory): Boolean =
        requested == LlmRoute.CLOUD_ANDROID &&
            maxAllowedRank(category) < privacyRank(LlmRoute.CLOUD_ANDROID)

    /** 顶栏档位徽章:emoji 标签 + 一句"数据是否离开手机"。 */
    fun badge(route: LlmRoute): TierBadge = when (route) {
        LlmRoute.LOCAL_DEVICE -> TierBadge("🟢 端侧", "数据不出手机")
        LlmRoute.LAN_OLLAMA -> TierBadge("🟡 局域网", "出端到你的局域网设备")
        LlmRoute.PC_LOCAL -> TierBadge("🔵 桌面", "出端到你配对的桌面")
        LlmRoute.CLOUD_ANDROID -> TierBadge("☁️ 云", "仅摘要上云,不送原始数据")
    }

    /** 档位徽章文案。 */
    data class TierBadge(val label: String, val dataFlow: String)
}
