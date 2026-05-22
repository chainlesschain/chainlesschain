package com.chainlesschain.android.pdh.travel

/**
 * §2.5 D8.2 — 出行 vendor 配置 (推文 §"出行: 高德 / 携程" + 地图三联扩展)。
 *
 * 跟 AiChatVendor 同 pattern 的 cookie-scrape WebView 抓取入口。四家路径分两类：
 *
 * **地图类 (3 家)** — cookie scrape 拿账户态 + 收藏地点，完整轨迹历史 v0.2 升级
 * OAuth / SAF 导入 (各家 API 不同)：
 *  - 高德 (amap)：cookie scrape amap.com 网页版用户中心 (基础 profile + 部分
 *    历史)；完整轨迹 v0.2 走 lbs.amap.com OAuth (需开发者应用 client_id/secret +
 *    redirect_uri)
 *  - 百度 (baidu-map)：cookie scrape map.baidu.com 网页版用户中心 (登录态 +
 *    收藏地点)；完整轨迹历史 v0.2 走 lbs.baidu.com 开放平台或 .db SAF 导入
 *  - 腾讯 (tencent-map)：cookie scrape map.qq.com 网页版 (登录态 + 收藏)；
 *    完整历史 v0.2 走 lbs.qq.com 或 .db SAF 导入
 *
 * **出行类 (1 家)** — cookie scrape 完整链路 (有 web API)：
 *  - 携程 (ctrip)：accounts.ctrip.com 登录后 cookie 域 `.ctrip.com` 即可用
 *    web API 拿订单 / 酒店 / 机票历史
 *
 * 跟桌面 packages/personal-data-hub adapter 命名对齐：
 *  - travel-amap (高德地图)
 *  - travel-baidu-map (百度地图)
 *  - travel-tencent-map (腾讯地图，本 v0.2 新增)
 *  - travel-ctrip (携程)
 *
 * 真接通 sync 路径：cookie → in-APK cc hub sync travel-{vendor} --cookie '<c>' →
 * 桌面 adapter 走 snapshot mode (Android 写 staging JSON) 或 sqlite mode (传统
 * device-pull .db)。本机 UI v0.2 4 卡全显。
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
    BAIDU_MAP(
        key = "travel-baidu-map",
        displayName = "百度地图",
        loginUrl = "https://map.baidu.com/",
        cookieDomain = "https://map.baidu.com",
        // 百度 passport 登录跳转域名 passport.baidu.com → 回到 map.baidu.com
        // 即视为成功；同 amap 排除 login / passport / sso 字样的中间页
        isLoginSuccess = { url ->
            url.contains("baidu.com") &&
                !url.contains("passport") &&
                !url.contains("login") &&
                !url.contains("sso")
        },
        authHint = "网页登录后 cookie scrape — 拿账户态 + 收藏地点。完整轨迹历史 v0.2 走 lbs.baidu.com 开放平台 (需开发者应用) 或 .db SAF 导入",
    ),
    TENCENT_MAP(
        key = "travel-tencent-map",
        displayName = "腾讯地图",
        loginUrl = "https://map.qq.com/",
        cookieDomain = "https://map.qq.com",
        // 腾讯地图 QQ/微信登录走 ssl.captcha.qq.com / xui.ptlogin2.qq.com 等中间
        // 域；回到 map.qq.com 即视为成功
        isLoginSuccess = { url ->
            url.contains("map.qq.com") &&
                !url.contains("login") &&
                !url.contains("ptlogin")
        },
        authHint = "网页登录后 cookie scrape — 拿账户态 + 收藏地点。完整轨迹历史 v0.2 走 lbs.qq.com 或 .db SAF 导入",
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
        // 地图三联在前 (高德 / 百度 / 腾讯)，携程出行收尾。UI 显示顺序与本列表一致
        val ORDERED: List<TravelVendor> = listOf(AMAP, BAIDU_MAP, TENCENT_MAP, CTRIP)
    }
}
