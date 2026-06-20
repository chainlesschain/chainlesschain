package com.chainlesschain.android.pdh

import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §3.5.10 隐私分级路由纯逻辑核测试。钉死:隐私序(云 vs 其余的悬崖)、敏感度→上限、
 * effectiveTier 的"尊重选择 / 隐私优先回退 / 无满足项→null",以及云同意判定。
 */
class PdhPrivacyTierTest {

    @Test
    fun privacy_rank_orders_local_below_lan_pc_below_cloud() {
        assertEquals(0, PdhPrivacyTier.privacyRank(LlmRoute.LOCAL_DEVICE))
        assertEquals(1, PdhPrivacyTier.privacyRank(LlmRoute.LAN_OLLAMA))
        assertEquals(1, PdhPrivacyTier.privacyRank(LlmRoute.PC_LOCAL))
        assertEquals(2, PdhPrivacyTier.privacyRank(LlmRoute.CLOUD_ANDROID))
    }

    @Test
    fun max_allowed_rank_by_sensitivity() {
        // 高敏感 → 仅端侧(0)
        for (c in listOf(DataCategory.HEALTH, DataCategory.FINANCE, DataCategory.IM, DataCategory.LOCATION)) {
            assertEquals(0, PdhPrivacyTier.maxAllowedRank(c), "high: $c")
        }
        // 中 → 自有设备(1)
        assertEquals(1, PdhPrivacyTier.maxAllowedRank(DataCategory.CONTACTS))
        assertEquals(1, PdhPrivacyTier.maxAllowedRank(DataCategory.SOCIAL))
        // 低 → 可云(2)
        for (c in listOf(DataCategory.SYSTEM, DataCategory.FILE_META, DataCategory.PUBLIC)) {
            assertEquals(2, PdhPrivacyTier.maxAllowedRank(c), "low: $c")
        }
    }

    private val all = setOf(
        LlmRoute.LOCAL_DEVICE, LlmRoute.LAN_OLLAMA, LlmRoute.PC_LOCAL, LlmRoute.CLOUD_ANDROID,
    )

    @Test
    fun effective_tier_honors_explicit_selection_when_allowed_and_available() {
        // 低敏感 + 选 PC_LOCAL(可用、rank1 ≤ 上限2) → 尊重选择
        assertEquals(
            LlmRoute.PC_LOCAL,
            PdhPrivacyTier.effectiveTier(LlmRoute.PC_LOCAL, DataCategory.SYSTEM, all),
        )
    }

    @Test
    fun effective_tier_high_sensitivity_caps_to_local_even_if_user_picked_cloud() {
        // 高敏感(上限0)+ 选云 → 选择超上限,不尊重 → 回退到可用最私密(端侧)
        assertEquals(
            LlmRoute.LOCAL_DEVICE,
            PdhPrivacyTier.effectiveTier(LlmRoute.CLOUD_ANDROID, DataCategory.IM, all),
        )
    }

    @Test
    fun effective_tier_falls_back_to_most_private_available_within_cap() {
        // 中敏感(上限1),端侧不可用 → 取可用且 rank≤1 的最私密 = LAN(1)优先于 PC(1,集合序)
        val avail = setOf(LlmRoute.LAN_OLLAMA, LlmRoute.PC_LOCAL, LlmRoute.CLOUD_ANDROID)
        val tier = PdhPrivacyTier.effectiveTier(LlmRoute.CLOUD_ANDROID, DataCategory.CONTACTS, avail)
        assertTrue(tier == LlmRoute.LAN_OLLAMA || tier == LlmRoute.PC_LOCAL)
        assertEquals(1, PdhPrivacyTier.privacyRank(tier!!))
    }

    @Test
    fun effective_tier_null_when_high_sensitivity_but_only_cloud_available() {
        // 高敏感(上限0)+ 仅云可用 → 无满足项 → null(调用方弹同意卡/诚实提示,不偷偷上云)
        assertNull(
            PdhPrivacyTier.effectiveTier(LlmRoute.CLOUD_ANDROID, DataCategory.HEALTH, setOf(LlmRoute.CLOUD_ANDROID)),
        )
    }

    @Test
    fun effective_tier_null_when_nothing_available() {
        assertNull(PdhPrivacyTier.effectiveTier(LlmRoute.LOCAL_DEVICE, DataCategory.PUBLIC, emptySet()))
    }

    @Test
    fun effective_tier_low_sensitivity_allows_cloud_when_chosen() {
        assertEquals(
            LlmRoute.CLOUD_ANDROID,
            PdhPrivacyTier.effectiveTier(LlmRoute.CLOUD_ANDROID, DataCategory.PUBLIC, all),
        )
    }

    @Test
    fun needs_cloud_consent_only_for_cloud_request_above_sensitivity_cap() {
        // 高敏感想上云 → 需同意
        assertTrue(PdhPrivacyTier.needsCloudConsent(LlmRoute.CLOUD_ANDROID, DataCategory.FINANCE))
        // 中敏感想上云 → 需同意(上限1 < 云 rank2)
        assertTrue(PdhPrivacyTier.needsCloudConsent(LlmRoute.CLOUD_ANDROID, DataCategory.SOCIAL))
        // 低敏感想上云 → 不需(上限2 == 云 rank2)
        assertFalse(PdhPrivacyTier.needsCloudConsent(LlmRoute.CLOUD_ANDROID, DataCategory.SYSTEM))
        // 非云请求 → 不需
        assertFalse(PdhPrivacyTier.needsCloudConsent(LlmRoute.LOCAL_DEVICE, DataCategory.HEALTH))
    }

    @Test
    fun badge_text_per_route() {
        assertEquals("🟢 端侧", PdhPrivacyTier.badge(LlmRoute.LOCAL_DEVICE).label)
        assertEquals("数据不出手机", PdhPrivacyTier.badge(LlmRoute.LOCAL_DEVICE).dataFlow)
        assertTrue(PdhPrivacyTier.badge(LlmRoute.CLOUD_ANDROID).label.contains("云"))
        assertTrue(PdhPrivacyTier.badge(LlmRoute.CLOUD_ANDROID).dataFlow.contains("摘要"))
    }
}
