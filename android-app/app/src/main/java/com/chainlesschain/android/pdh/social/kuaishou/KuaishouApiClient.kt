package com.chainlesschain.android.pdh.social.kuaishou

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v0.1 placeholder — Kuaishou (快手) www.kuaishou.com client.
 *
 * **Tiny surface deliberately**：快手 web 几乎所有读接口 (GraphQL queries
 * visionFeedRecommend / visionProfilePhotoList / visionSearchPhoto) 都需
 * NS_sig3 签名（来自 kuaishou anti-bot SDK，签名复杂度比抖音 X-Bogus 高），
 * 没有可靠的纯 Kotlin 实现。
 *
 * v0.1 路径：**不调任何网络接口**，只从 WebView 抓回的 cookie 字符串抽 userId。
 * 快手 web cookie 关键字段：
 *   - `userId`               登录后才出现的数字用户 id（首选）
 *   - `kuaishou.web.cp.api_ph`  account fingerprint 包含 user_id payload (legacy fallback)
 *   - `passToken`            session token (确认 logged-in 但不含 uid)
 *   - `did`                  device fingerprint (匿名用户也有；不能当 uid)
 *   - `kpf` / `kpn`          platform marker (匿名用户也有)
 *
 * v0.2+ 待接通（NS_sig3 路径，需 WebView JS 注入或者自己实现签名算法）：
 *   - `/graphql` visionFeedRecommend  推荐流（BROWSE）
 *   - `/graphql` visionProfilePhotoList 用户主页列表 + 收藏（COLLECT）
 *   - `/graphql` visionSearchPhoto    搜索历史（SEARCH）
 *
 * 与 [com.chainlesschain.android.pdh.social.toutiao.ToutiaoApiClient] 同模板。
 */
@Singleton
class KuaishouApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests (v0.2+ when network lands). */
    var baseUrl: HttpUrl = "https://www.kuaishou.com/".toHttpUrl()

    @Volatile var lastErrorCode: Int = 0
        private set
    @Volatile var lastErrorMessage: String? = null
        private set

    /**
     * v0.1 entry: WebView 把 cookie 字符串递回来后调本方法抽 uid + 校验"已登录"。
     *
     * 返回 null = cookie 不含可识别 userId 字段（基本可断定未登录 / 仅游客态）。
     */
    fun extractUid(cookie: String?): String? {
        if (cookie.isNullOrBlank()) {
            setLastError(-1, "cookie 为空")
            return null
        }
        // 首选：userId=N (登录后稳定写入)
        val userId = Regex("(?:^|; ?)userId=(\\d+)").find(cookie)?.groupValues?.getOrNull(1)
        if (userId != null && userId.isNotBlank() && userId != "0") {
            clearLastError()
            return userId
        }
        // 次选：legacy kuaishou.web.cp.api_ph 偶尔携 user_id 字段，best-effort
        val cp = Regex("(?:^|; ?)kuaishou\\.web\\.cp\\.api_ph=([^;]+)")
            .find(cookie)?.groupValues?.getOrNull(1)
        if (!cp.isNullOrBlank()) {
            val embeddedUid = Regex("user_id\":\"?(\\d+)\"?").find(cp)?.groupValues?.getOrNull(1)
                ?: Regex("\"uid\":\"?(\\d+)\"?").find(cp)?.groupValues?.getOrNull(1)
            if (embeddedUid != null && embeddedUid.isNotBlank() && embeddedUid != "0") {
                clearLastError()
                return embeddedUid
            }
        }
        // 没找到任何 uid 字段 — cookie 是"匿名"或"登录未完成"
        setLastError(-7, "cookie 缺 userId / kuaishou.web.cp.api_ph 嵌套 user_id — 登录未完成或仅游客态")
        Timber.w(
            "KuaishouApiClient.extractUid: no uid candidate found in cookie (length=%d)",
            cookie.length,
        )
        return null
    }

    private fun setLastError(code: Int, message: String?) {
        lastErrorCode = code
        lastErrorMessage = message
    }

    private fun clearLastError() {
        lastErrorCode = 0
        lastErrorMessage = null
    }
}
