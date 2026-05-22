package com.chainlesschain.android.pdh.social.aichat

/**
 * §2.6 D10.2 — 9 AI vendor (推文 §"AI 助手": 豆包 / 文心 / Kimi / 通义 /
 * DeepSeek / 智谱 / 混元 / 千帆 / 扣子) 各自 cookie scrape WebView 配置。
 *
 * 每 vendor 4 字段：
 *  - key            : 唯一标识 (用于 EncryptedSharedPreferences key prefix +
 *                     UI map key + cc syncAdapter --vendor 参数)
 *  - displayName    : 用户可见 (推文文案直照搬，含括号厂商前缀让用户能认出)
 *  - loginUrl       : WebView 起步 URL (默认登录页 — 多数家是 chat 入口)
 *  - cookieDomain   : CookieManager.getCookie 读 cookie 的域 (带 https://)
 *  - isLoginSuccess : URL pattern (lambda) — WebView onPageFinished 判断
 *                     登录成功，触发 cookie 提取
 *
 * 实证 caveats (跟 Bilibili 同 trap)：
 *  - 各家 login URL → 登录后会重定向 (passport.X → www.X)。isLoginSuccess
 *    必须只在 "已到 www.X" 时判 true，避免 passport 阶段就误触发
 *  - cookie 域加 https:// 否则 CookieManager 返 null（API 行为）
 *  - 部分家（豆包 / 文心）走 baidu / bytedance 子域 — cookieDomain 要写实
 *    际 set-cookie 域，不是营销页面域
 *
 * 真接通 sync 路径：cookie → in-APK cc hub sync ai-chat-history --vendor
 * <key> --cookie '<c>' --json → packages/personal-data-hub Phase 10.2
 * 8 厂商 adapter (DeepSeek/Kimi/通义/智谱/混元/千帆/扣子/Dreamina)。豆包 /
 * 文心 桌面端 adapter v0.2 待补，UI v0.1 占位但 cookie 已能存 (用户不丢
 * onboarding context)。
 */
enum class AiChatVendor(
    val key: String,
    val displayName: String,
    val loginUrl: String,
    val cookieDomain: String,
    val isLoginSuccess: (String) -> Boolean,
) {
    DOUBAO(
        key = "doubao",
        displayName = "豆包 (字节)",
        loginUrl = "https://www.doubao.com/chat/",
        cookieDomain = "https://www.doubao.com",
        isLoginSuccess = { url -> url.contains("doubao.com/chat") && !url.contains("login") },
    ),
    WENXIN(
        key = "wenxin",
        displayName = "文心一言 (百度)",
        loginUrl = "https://yiyan.baidu.com/",
        cookieDomain = "https://yiyan.baidu.com",
        isLoginSuccess = { url -> url.startsWith("https://yiyan.baidu.com") && !url.contains("passport") },
    ),
    KIMI(
        key = "kimi",
        displayName = "Kimi (月之暗面)",
        loginUrl = "https://kimi.moonshot.cn/",
        cookieDomain = "https://kimi.moonshot.cn",
        isLoginSuccess = { url -> url.contains("kimi.moonshot.cn") && !url.contains("/auth/") },
    ),
    TONGYI(
        key = "tongyi",
        displayName = "通义千问 (阿里)",
        loginUrl = "https://tongyi.aliyun.com/qianwen/",
        cookieDomain = "https://tongyi.aliyun.com",
        isLoginSuccess = { url -> url.contains("tongyi.aliyun.com/qianwen") && !url.contains("login") },
    ),
    DEEPSEEK(
        key = "deepseek",
        displayName = "DeepSeek",
        loginUrl = "https://chat.deepseek.com/",
        cookieDomain = "https://chat.deepseek.com",
        isLoginSuccess = { url -> url.startsWith("https://chat.deepseek.com") && !url.contains("sign_in") },
    ),
    ZHIPU(
        key = "zhipu",
        displayName = "智谱 GLM",
        loginUrl = "https://chatglm.cn/main/alltoolsdetail",
        cookieDomain = "https://chatglm.cn",
        isLoginSuccess = { url -> url.contains("chatglm.cn") && !url.contains("login") },
    ),
    HUNYUAN(
        key = "hunyuan",
        displayName = "混元 (腾讯)",
        loginUrl = "https://yuanbao.tencent.com/",
        cookieDomain = "https://yuanbao.tencent.com",
        isLoginSuccess = { url -> url.contains("yuanbao.tencent.com") && !url.contains("login") },
    ),
    QIANFAN(
        key = "qianfan",
        displayName = "千帆 (百度)",
        loginUrl = "https://qianfan.cloud.baidu.com/",
        cookieDomain = "https://qianfan.cloud.baidu.com",
        isLoginSuccess = { url -> url.contains("qianfan.cloud.baidu.com") && !url.contains("passport") },
    ),
    COZE(
        key = "coze",
        displayName = "扣子 (Coze)",
        loginUrl = "https://www.coze.cn/space",
        cookieDomain = "https://www.coze.cn",
        isLoginSuccess = { url -> url.contains("coze.cn") && !url.contains("sign-in") },
    );

    companion object {
        fun fromKey(key: String): AiChatVendor? = entries.firstOrNull { it.key == key }

        /**
         * 推文 §"AI 助手 9 家" 的全集（顺序跟 推文 / PaymentShoppingCard
         * AiAssistantsGroup 一致：豆包/文心/Kimi/通义/DeepSeek/智谱/混元/
         * 千帆/扣子）。UI 直接 iterate.
         */
        val ORDERED: List<AiChatVendor> = listOf(
            DOUBAO, WENXIN, KIMI, TONGYI, DEEPSEEK,
            ZHIPU, HUNYUAN, QIANFAN, COZE,
        )
    }
}
