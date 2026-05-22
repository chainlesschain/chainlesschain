package com.chainlesschain.android.pdh.travel

/**
 * §2.5 D8.2 — 出行 vendor 配置 (推文 §"出行: 高德 / 携程")。
 *
 * 跟 AiChatVendor 同 pattern 的 cookie-scrape WebView 抓取入口。两家路径：
 *  - 高德 (amap)：v0.1 cookie scrape amap.com 网页版用户中心 (基础 profile +
 *    部分历史)；v0.2 升级 OAuth 走 lbs.amap.com 拿历史轨迹 API (需开发者
 *    应用 client_id/secret + redirect_uri)。当前 cookie scrape 可拿登录态
 *    + 收藏地点，但完整轨迹 API 走 OAuth 路径
 *  - 携程 (ctrip)：纯 cookie scrape，accounts.ctrip.com 登录后 cookie 域
 *    `.ctrip.com` 即可用 web API 拿订单 / 酒店 / 机票历史
 *
 * 跟桌面 packages/personal-data-hub adapter 命名对齐：
 *  - travel-amap (高德地图)
 *  - travel-ctrip (携程)
 *
 * 真接通 sync 路径：cookie → in-APK cc hub sync travel-{vendor} --cookie '<c>' →
 * 桌面 adapter 待补 (v0.2 双家)。本机 UI v0.1 全显，cookie 已能保存让用户
 * onboarding 不丢。
 */
enum class TravelVendor(
    val key: String,
    val displayName: String,
    val loginUrl: String,
    val cookieDomain: String,
    val isLoginSuccess: (String) -> Boolean,
    val authHint: String,
) {
    AMAP(
        key = "travel-amap",
        displayName = "高德地图",
        loginUrl = "https://www.amap.com/",
        cookieDomain = "https://www.amap.com",
        isLoginSuccess = { url -> url.contains("amap.com") && !url.contains("passport") && !url.contains("login") },
        authHint = "网页登录后 cookie scrape — 拿账户态 + 收藏地点。完整轨迹历史 v0.2 升级 OAuth (需 lbs.amap.com 开发者应用)",
    ),
    CTRIP(
        key = "travel-ctrip",
        displayName = "携程",
        loginUrl = "https://accounts.ctrip.com/",
        cookieDomain = "https://www.ctrip.com",
        isLoginSuccess = { url ->
            // 携程 登录成功后跳 www.ctrip.com 或 my.ctrip.com，避免 accounts.
            // 还没登录就误触发
            (url.contains("ctrip.com") && !url.contains("accounts.ctrip.com")) ||
                url.contains("my.ctrip.com")
        },
        authHint = "携程账号登录 → cookie scrape → 拿订单 / 酒店 / 机票历史",
    );

    companion object {
        fun fromKey(key: String): TravelVendor? = entries.firstOrNull { it.key == key }
        val ORDERED: List<TravelVendor> = listOf(AMAP, CTRIP)
    }
}
