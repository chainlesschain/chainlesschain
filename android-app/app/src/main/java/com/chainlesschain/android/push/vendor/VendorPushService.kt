package com.chainlesschain.android.push.vendor

/**
 * v1.1 issue #19 P1：国内 push 厂商 SDK 抽象。
 *
 * **背景**：FCM 国内不可达（设计文档 §9.1 + Q2）。各厂商 (小米/OPPO/华为/vivo)
 * 在自家 ROM 上有原生 push 通道，需各自集成 SDK。
 *
 * **架构**（FCM 同模式）：
 *  1. [VendorPushService] sealed interface 定义统一接口（initialize / requestToken / shutdown）
 *  2. 4 个 stub implementation 各厂商一个，v1.1 抛 [VendorSdkNotIntegratedException]
 *  3. [PushVendorRegistry] 按 [android.os.Build.MANUFACTURER] 自动选 vendor + 用户可在
 *     Settings override
 *  4. [VendorPushRouter] 桥接 vendor → 已有 [com.chainlesschain.android.push.CcPushNotificationService]
 *
 * **v1.2 真集成步骤** (per vendor)：
 *  1. 用户在 vendor 开发者控制台建 app + 取 credentials (AppId / AppKey / AppSecret)
 *  2. 配置 build.gradle.kts conditional 加 vendor SDK 依赖 + Maven repo
 *  3. AndroidManifest 加 vendor service / receiver / permission
 *  4. 把 Stub 的 initialize / requestToken / onMessageReceived 换成真 SDK 调用
 *  5. [CcPushNotificationService.onTokenChanged] 上传 token 到桌面（v1.2 后端 endpoint）
 *
 * 详见 [`docs/guides/Vendor_Push_Setup.md`](../../../../../../../../../docs/guides/Vendor_Push_Setup.md)。
 */
sealed interface VendorPushService {
    /** 唯一标识，用于 routing + Settings UI 显示。 */
    val vendor: PushVendor

    /**
     * 初始化 vendor SDK。需在 Application.onCreate 调用，传 credentials（v1.1 stub 不读）。
     * 应幂等（重复调用 no-op）。
     *
     * @return true 表示成功；false 表示 stub / SDK 未集成 / 凭证缺失
     */
    fun initialize(): Boolean

    /**
     * 同步获取当前 token（如果已注册）。null 表示未初始化或注册中。
     * v1.2 真集成应触发异步注册并通过 [CcPushNotificationService.onTokenChanged] 回调。
     */
    fun currentToken(): String?

    /** 关闭 SDK + 反注册。Application.onTerminate 或用户切换 vendor 时调用。 */
    fun shutdown()

    /** 是否已集成（v1.1 4 个 stub 全 false；真集成后该 vendor 的 impl 返 true）。 */
    fun isIntegrated(): Boolean
}

/**
 * 4 大国内 push 厂商 + FCM (海外兜底)。
 *
 * matcher 字符串匹配 [android.os.Build.MANUFACTURER]（lowercase 后 contains）：
 *  - Xiaomi: "xiaomi" / "redmi"
 *  - HMS (华为): "huawei" / "honor"
 *  - OPPO: "oppo" / "realme" / "oneplus" (OnePlus 用 ColorOS Push)
 *  - vivo: "vivo" / "iqoo"
 *  - FCM: 其他（Pixel / Samsung 国际版 etc.；Samsung 国内版有 SamsungPush 但 v1.2 才补）
 */
enum class PushVendor(
    val displayName: String,
    val matchers: List<String>,
    val sdkArtifact: String,
) {
    Xiaomi(
        displayName = "小米推送",
        matchers = listOf("xiaomi", "redmi"),
        sdkArtifact = "com.xiaomi.push:MiPushClient (manual AAR; not on Maven Central)",
    ),
    Huawei(
        displayName = "华为 HMS Push",
        matchers = listOf("huawei", "honor"),
        sdkArtifact = "com.huawei.hms:push (Huawei Maven repo)",
    ),
    Oppo(
        displayName = "OPPO 推送",
        matchers = listOf("oppo", "realme", "oneplus"),
        sdkArtifact = "com.heytap.msp:push (OPPO Maven repo)",
    ),
    Vivo(
        displayName = "vivo 推送",
        matchers = listOf("vivo", "iqoo"),
        sdkArtifact = "com.vivo.push:vivopush (manual AAR)",
    ),
    Fcm(
        displayName = "Firebase FCM (海外兜底)",
        matchers = emptyList(), // fallback
        sdkArtifact = "com.google.firebase:firebase-messaging (M3 D3)",
    ),
}

/**
 * v1.1 stub 抛此异常告知用户该 vendor SDK 未集成。
 * UI 应捕获 + 引导查 docs/guides/Vendor_Push_Setup.md
 */
class VendorSdkNotIntegratedException(
    val vendor: PushVendor,
    val nextStep: String =
        "v1.2 计划：在开发者控制台申请 credentials → 加 SDK 依赖 → 改 stub 为真实现。" +
            "详见 docs/guides/Vendor_Push_Setup.md。",
) : Exception("${vendor.displayName} SDK 未集成（v1.1 stub）。$nextStep")
