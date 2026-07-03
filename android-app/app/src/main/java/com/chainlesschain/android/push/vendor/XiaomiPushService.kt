package com.chainlesschain.android.push.vendor

import android.content.Context
import com.chainlesschain.android.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Xiaomi 小米推送（MIUI），**反射式**接入 —— 让 app 无 MiPush SDK（`app/libs/`
 * 手动 AAR，`-` 无则源集排除）也能编译运行。AAR 在时反射解析
 * `com.xiaomi.mipush.sdk.MiPushClient` 真注册；不在时每次调用降级为受保护的
 * no-op（false / null），不崩、无编译期硬依赖。regId 本身经
 * [com.chainlesschain.android.remote.session.RemoteSessionXiaomiReceiver]（`xiaomi`
 * 源集编译）的 `onCommandResult` 异步递送，并可经 [currentToken] 反射读回。
 * appId/appKey 来自 BuildConfig（空则跳过）。详见
 * [docs/guides/Vendor_Push_Setup.md](../../../../../../../../../docs/guides/Vendor_Push_Setup.md) §3.1。
 */
@Singleton
class XiaomiPushService @Inject constructor(
    @ApplicationContext private val context: Context,
) : VendorPushService {

    override val vendor: PushVendor = PushVendor.Xiaomi

    @Volatile private var initialized = false

    override fun initialize(): Boolean {
        if (initialized) return isIntegrated()
        initialized = true
        val appId = BuildConfig.XIAOMI_PUSH_APP_ID
        val appKey = BuildConfig.XIAOMI_PUSH_APP_KEY
        if (appId.isBlank() || appKey.isBlank()) {
            Timber.w("XiaomiPushService.initialize: no XIAOMI_PUSH_APP_ID/KEY — skipping (-PxiaomiAppId/Key)")
            return false
        }
        return runCatching {
            val mgr = Class.forName("com.xiaomi.mipush.sdk.MiPushClient")
            mgr.getMethod(
                "registerPush",
                Context::class.java,
                String::class.java,
                String::class.java,
            ).invoke(null, context, appId, appKey)
            Timber.i("XiaomiPushService: registerPush requested")
            true
        }.getOrElse {
            Timber.w(it, "XiaomiPushService.initialize: MiPush SDK unavailable — stub fallback")
            false
        }
    }

    override fun currentToken(): String? = runCatching {
        val mgr = Class.forName("com.xiaomi.mipush.sdk.MiPushClient")
        (mgr.getMethod("getRegId", Context::class.java).invoke(null, context) as? String)
            ?.takeIf { it.isNotBlank() }
    }.getOrNull()

    override fun shutdown() {
        runCatching {
            val mgr = Class.forName("com.xiaomi.mipush.sdk.MiPushClient")
            mgr.getMethod("unregisterPush", Context::class.java).invoke(null, context)
        }
        initialized = false
    }

    override fun isIntegrated(): Boolean = runCatching {
        Class.forName("com.xiaomi.mipush.sdk.MiPushClient"); true
    }.getOrDefault(false)
}
