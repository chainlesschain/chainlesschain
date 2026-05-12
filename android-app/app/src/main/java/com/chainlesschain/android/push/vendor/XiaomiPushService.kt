package com.chainlesschain.android.push.vendor

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 小米推送 stub —— v1.1 issue #19 P1 国内 push SDK 参考实现框架。
 *
 * **状态**: 🟡 stub — initialize() / requestToken() / shutdown() 全 no-op。
 * v1.2 真集成步骤详见 [docs/guides/Vendor_Push_Setup.md](../../../../../../../../../docs/guides/Vendor_Push_Setup.md)
 * §3.1 Xiaomi 段。
 *
 * **真集成时只需** 在本类把 4 处 TODO 换成 MiPushClient SDK 调用：
 *   1. [initialize] → `MiPushClient.registerPush(context, APP_ID, APP_KEY)`
 *   2. [currentToken] → `MiPushClient.getRegId(context)`
 *   3. [shutdown] → `MiPushClient.unregisterPush(context)`
 *   4. 新建 `XiaomiPushReceiver extends PushMessageReceiver` 监听
 *      onReceivePassThroughMessage / onReceiveRegisterResult，转调
 *      [com.chainlesschain.android.push.CcPushNotificationService.onRemoteData]
 *
 * **不动**：[VendorPushService] interface / [PushVendorRegistry] / Settings UI / docs。
 */
@Singleton
class XiaomiPushService @Inject constructor(
    @ApplicationContext private val context: Context,
) : VendorPushService {

    override val vendor: PushVendor = PushVendor.Xiaomi

    @Volatile private var initialized = false
    @Volatile private var registeredToken: String? = null

    override fun initialize(): Boolean {
        if (initialized) {
            Timber.d("XiaomiPushService.initialize: already initialized (no-op)")
            return false
        }
        // TODO v1.2 真集成：
        //   val APP_ID = BuildConfig.XIAOMI_PUSH_APP_ID    // build.gradle.kts buildConfigField
        //   val APP_KEY = BuildConfig.XIAOMI_PUSH_APP_KEY
        //   if (shouldInit(context)) {                      // 仅小米手机才注册
        //       MiPushClient.registerPush(context, APP_ID, APP_KEY)
        //   }
        Timber.w(
            "XiaomiPushService.initialize: stub no-op. v1.2 真集成详见 docs/guides/Vendor_Push_Setup.md §3.1",
        )
        initialized = true
        return false  // 表示 stub 状态
    }

    override fun currentToken(): String? {
        // TODO v1.2: return MiPushClient.getRegId(context)
        return registeredToken
    }

    override fun shutdown() {
        if (!initialized) return
        // TODO v1.2: MiPushClient.unregisterPush(context)
        Timber.d("XiaomiPushService.shutdown: stub no-op")
        initialized = false
        registeredToken = null
    }

    override fun isIntegrated(): Boolean = false  // v1.1 stub；v1.2 改 true

    /**
     * 内部：v1.2 push receiver 回调 token 时设置（参考 commented 代码）。
     */
    @Suppress("unused") // v1.2 wired
    internal fun setToken(token: String) {
        registeredToken = token
        Timber.i("XiaomiPushService: token set (len=${token.length})")
    }
}
