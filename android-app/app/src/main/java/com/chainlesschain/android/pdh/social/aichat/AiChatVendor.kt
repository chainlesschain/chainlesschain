package com.chainlesschain.android.pdh.social.aichat

/**
 * §2.6 D10.2 — AI vendor (推文 §"AI 助手": 豆包 / 文心 / Kimi / 通义 /
 * DeepSeek / 智谱 / 混元 / 扣子) 各自 cookie scrape WebView 配置。
 * 原推文列 9 家含独立"千帆"，2026-05-22 与"文心一言"合并到 WENXIN entry
 * (key=qianfan)，桌面 vendor adapter 只一份。
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
 * 真接通 sync 路径：cookie → 加密凭据快照 → in-APK cc hub sync
 * ai-chat-history --input <path> --json。Node 端已注册 9 厂商
 * (DeepSeek/Kimi/通义/智谱/混元/千帆/扣子/Dreamina/豆包)；豆包内部接口
 * 仍需按真实账号版本回归字段漂移。
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
    /**
     * 文心一言。enum entry 名 `WENXIN`，但 `key="qianfan"` 对齐桌面
     * `packages/.../vendors/qianfan.js` (BASE=yiyan.baidu.com)。原先 Android
     * WENXIN 与 QIANFAN 双 vendor → 桌面 single qianfan adapter 名错配，
     * 2026-05-22 合并：删 QIANFAN entry，WENXIN.key 改 "qianfan" 让 cc sync
     * ai-chat-history --vendor qianfan 真接通。
     */
    WENXIN(
        key = "qianfan",
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
    // 注：原 QIANFAN entry (key="qianfan", qianfan.cloud.baidu.com) 与
    // 桌面 vendor 命名冲突 — 桌面 qianfan adapter 实际 BASE=yiyan.baidu.com
    // (=文心一言)。2026-05-22 删除独立 QIANFAN entry，文心一言走 WENXIN
    // entry 直接复用 key="qianfan"。千帆企业版 (qianfan.cloud.baidu.com)
    // 需 API key 流程，未来 v0.3+ 单独立 entry。
    COZE(
        key = "coze",
        displayName = "扣子 (Coze)",
        loginUrl = "https://www.coze.cn/space",
        cookieDomain = "https://www.coze.cn",
        isLoginSuccess = { url -> url.contains("coze.cn") && !url.contains("sign-in") },
    ),
    /**
     * 即梦 (Dreamina) — ByteDance AI image / video gen. Phase 10.2 desktop
     * vendor adapter已 ship (packages/.../vendors/dreamina.js, BASE=
     * jimeng.jianying.com)。Phase 5.8 (2026-05-25) Android UI 接通同套
     * cookie-scrape WebView 流，与 8 个聊天 vendor 同架构 — 不同 schema：
     * message.subtype=ai-image-generation + content.generatedImages 由
     * schema-map.js 设置。
     */
    DREAMINA(
        key = "dreamina",
        displayName = "即梦 (字节)",
        loginUrl = "https://jimeng.jianying.com/",
        cookieDomain = "https://jimeng.jianying.com",
        isLoginSuccess = { url -> url.contains("jimeng.jianying.com") && !url.contains("login") },
    );

    companion object {
        fun fromKey(key: String): AiChatVendor? = entries.firstOrNull { it.key == key }

        /**
         * 推文 §"AI 助手 9 家" 原列豆包/文心/Kimi/通义/DeepSeek/智谱/混元/
         * 千帆/扣子。2026-05-22 WENXIN+QIANFAN 合并后 8 家：文心 entry
         * (key=qianfan) 复用桌面 qianfan adapter (BASE=yiyan.baidu.com)。
         * 2026-05-25 加 DREAMINA (字节即梦图像/视频生成, 桌面 vendor 已 ship)
         * 凑 9 家与原推文承诺对齐。UI 直接 iterate；顺序与
         * PaymentShoppingCard.AiAssistantsGroup providers 列表对齐。
         */
        val ORDERED: List<AiChatVendor> = listOf(
            DOUBAO, WENXIN, KIMI, TONGYI, DEEPSEEK,
            ZHIPU, HUNYUAN, COZE, DREAMINA,
        )
    }
}
