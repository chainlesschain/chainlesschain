package com.chainlesschain.android.push.vendor

import android.content.Context
import com.chainlesschain.android.BuildConfig
import com.chainlesschain.android.remote.session.OppoTokenProvider
import com.chainlesschain.android.remote.session.RemoteSessionPushBridge
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import java.lang.reflect.Proxy
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 P1：非小米参考实现的另 3 厂商 stub。
 *
 * 集中放一个文件避免 4 个几乎同款 ~30 行 stub 散在 4 个文件。每个 stub 用 [XiaomiPushService]
 * 同模板：initialize/currentToken/shutdown 全 no-op，抛 [VendorSdkNotIntegratedException]
 * 引用 docs。
 *
 * **真集成时按 [docs/guides/Vendor_Push_Setup.md](../../../../../../../../../docs/guides/Vendor_Push_Setup.md)
 * 各厂商章节**：
 *  - §3.2 Huawei HMS Push（agconnect-services.json + push-kit）
 *  - §3.3 OPPO HeytapPush（OPush AAR + AndroidManifest）
 *  - §3.4 vivo Push（VivoPush AAR + manifest 配 receiver）
 */

@Singleton
class HuaweiPushService @Inject constructor(
    @ApplicationContext private val context: Context,
) : VendorPushService {
    override val vendor: PushVendor = PushVendor.Huawei

    @Volatile private var initialized = false

    override fun initialize(): Boolean {
        if (initialized) return false
        // TODO v1.2: HmsInstanceId.getInstance(context).getToken(APP_ID, "HCM")
        // 配 agconnect-services.json + apply plugin "com.huawei.agconnect"
        Timber.w("HuaweiPushService.initialize: stub. 详 docs/guides/Vendor_Push_Setup.md §3.2")
        initialized = true
        return false
    }

    override fun currentToken(): String? = null
    override fun shutdown() {
        // TODO v1.2: HmsInstanceId.getInstance(context).deleteToken(APP_ID, "HCM")
        initialized = false
    }
    override fun isIntegrated(): Boolean = false
}

/**
 * OPPO (HeyTap) Push, wired via **reflection** so the app compiles and runs
 * WITHOUT the OPPO Push SDK (`com.heytap.msp:push`, linked only with
 * -PoppoPush=true). Unlike vivo (a manifest receiver), OPPO delivers the regId
 * through the `ICallBackResultService` callback passed to
 * `HeytapPushManager.register(context, appKey, appSecret, callback)` — so this
 * service both turns push on AND routes the fresh regId to the live Remote
 * Session via [RemoteSessionPushBridge]. appKey/appSecret come from BuildConfig
 * (empty → skip). Every call is guarded: SDK absent / creds missing → no-op
 * (false / null), no crash. See docs/guides/Vendor_Push_Setup.md §3.3.
 */
@Singleton
class OppoPushService @Inject constructor(
    @ApplicationContext private val context: Context,
) : VendorPushService {
    override val vendor: PushVendor = PushVendor.Oppo

    @Volatile private var initialized = false

    override fun initialize(): Boolean {
        if (initialized) return isIntegrated()
        initialized = true
        val appKey = BuildConfig.OPPO_PUSH_APP_KEY
        val appSecret = BuildConfig.OPPO_PUSH_APP_SECRET
        if (appKey.isBlank() || appSecret.isBlank()) {
            Timber.w("OppoPushService.initialize: no OPPO_PUSH_APP_KEY/SECRET — skipping (-PoppoPushAppKey/Secret)")
            return false
        }
        return runCatching {
            val mgr = Class.forName("com.heytap.msp.push.HeytapPushManager")
            mgr.getMethod("init", Context::class.java, Boolean::class.javaPrimitiveType)
                .invoke(null, context, BuildConfig.DEBUG)
            val callbackClass =
                Class.forName("com.heytap.msp.push.callback.ICallBackResultService")
            val callback = Proxy.newProxyInstance(
                callbackClass.classLoader,
                arrayOf(callbackClass),
            ) { _, method, args ->
                // onRegister(code, regId[, pkg, miniPkg]) — arg count varies across
                // SDK versions; the regId is the first non-blank String argument.
                if (method.name == "onRegister") {
                    val regId = args?.firstOrNull { it is String && it.isNotBlank() } as? String
                    if (!regId.isNullOrBlank()) {
                        RemoteSessionPushBridge.onNewToken(regId, OppoTokenProvider.PROVIDER)
                    }
                }
                null // every ICallBackResultService method returns void
            }
            mgr.getMethod(
                "register",
                Context::class.java,
                String::class.java,
                String::class.java,
                callbackClass,
            ).invoke(null, context, appKey, appSecret, callback)
            Timber.i("OppoPushService: register requested")
            true
        }.getOrElse {
            Timber.w(it, "OppoPushService.initialize: OPPO SDK unavailable — stub fallback")
            false
        }
    }

    override fun currentToken(): String? = runCatching {
        val mgr = Class.forName("com.heytap.msp.push.HeytapPushManager")
        (mgr.getMethod("getRegisterID").invoke(null) as? String)?.takeIf { it.isNotBlank() }
    }.getOrNull()

    override fun shutdown() {
        runCatching {
            val mgr = Class.forName("com.heytap.msp.push.HeytapPushManager")
            mgr.getMethod("unRegister").invoke(null)
        }
        initialized = false
    }

    override fun isIntegrated(): Boolean = runCatching {
        Class.forName("com.heytap.msp.push.HeytapPushManager"); true
    }.getOrDefault(false)
}

/**
 * vivo Push, wired via **reflection** so the app compiles and runs WITHOUT the
 * vivo Push SDK (a manual AAR, not on Maven). When the AAR is in app/libs/ the
 * reflection resolves `com.vivo.push.PushClient` and really turns push on; when
 * absent every call degrades to a guarded no-op (false / null) — no crash, no
 * hard dependency. The regId itself arrives asynchronously via
 * [com.chainlesschain.android.remote.session.RemoteSessionVivoReceiver]
 * (compiled from the `vivo` source set) and is readable here via [currentToken].
 * See docs/guides/Vendor_Push_Setup.md §3.4.
 */
@Singleton
class VivoPushService @Inject constructor(
    @ApplicationContext private val context: Context,
) : VendorPushService {
    override val vendor: PushVendor = PushVendor.Vivo

    @Volatile private var initialized = false

    override fun initialize(): Boolean {
        if (initialized) return isIntegrated()
        initialized = true
        return runCatching {
            val pushClient = pushClientInstance()
            pushClient.javaClass.getMethod("initialize").invoke(pushClient)
            val listenerClass = Class.forName("com.vivo.push.IPushActionListener")
            val listener = Proxy.newProxyInstance(
                listenerClass.classLoader,
                arrayOf(listenerClass),
            ) { _, method, args ->
                if (method.name == "onStateChanged") {
                    Timber.d("VivoPushService.turnOnPush state=${args?.getOrNull(0)}")
                }
                null
            }
            pushClient.javaClass.getMethod("turnOnPush", listenerClass)
                .invoke(pushClient, listener)
            Timber.i("VivoPushService: vivo push turned on")
            true
        }.getOrElse {
            Timber.w(it, "VivoPushService.initialize: vivo SDK unavailable — stub fallback")
            false
        }
    }

    override fun currentToken(): String? = runCatching {
        val pushClient = pushClientInstance()
        (pushClient.javaClass.getMethod("getRegId").invoke(pushClient) as? String)
            ?.takeIf { it.isNotBlank() }
    }.getOrNull()

    override fun shutdown() {
        runCatching {
            val pushClient = pushClientInstance()
            val listenerClass = Class.forName("com.vivo.push.IPushActionListener")
            val listener = Proxy.newProxyInstance(
                listenerClass.classLoader,
                arrayOf(listenerClass),
            ) { _, _, _ -> null }
            pushClient.javaClass.getMethod("turnOffPush", listenerClass)
                .invoke(pushClient, listener)
        }
        initialized = false
    }

    override fun isIntegrated(): Boolean =
        runCatching { Class.forName("com.vivo.push.PushClient"); true }.getOrDefault(false)

    /** Reflect `PushClient.getInstance(context)`; throws when the SDK is absent. */
    private fun pushClientInstance(): Any {
        val clazz = Class.forName("com.vivo.push.PushClient")
        return clazz.getMethod("getInstance", Context::class.java).invoke(null, context)
            ?: error("PushClient.getInstance returned null")
    }
}

/**
 * FCM 适配 [VendorPushService]，让 [PushVendorRegistry] 把海外 device routing 到 FCM。
 * FCM 集成由 M3 D3 [docs/M3_FCM_SETUP.md](../../../../../../../../../android-app/docs/M3_FCM_SETUP.md)
 * 完成（v1.0 骨架，v1.2 用户配 google-services.json 后激活）。
 */
@Singleton
class FcmPushService @Inject constructor(
    @ApplicationContext private val context: Context,
) : VendorPushService {
    override val vendor: PushVendor = PushVendor.Fcm

    override fun initialize(): Boolean {
        // FCM 走 com.chainlesschain.android.push.CcPushNotificationService 现有路径
        // (M3 D3 已实现协议中立入口)；本 vendor service 只是 routing 标识，不重复
        // 初始化 FCM SDK（FirebaseMessagingService 由 Manifest 注册自动 wire）。
        Timber.d("FcmPushService.initialize: routing only — FCM SDK 由 Manifest service auto-wire")
        return true
    }

    override fun currentToken(): String? {
        // TODO v1.2: 同步从 FirebaseMessaging.getInstance().getToken() 读
        return null
    }

    override fun shutdown() {
        // FCM SDK 不显式 shutdown
    }

    override fun isIntegrated(): Boolean {
        // TODO v1.2: 检测 google-services.json 存在 + FirebaseApp 已 init
        // v1.1 此 vendor 是 routing 占位，真实 FCM 状态以 docs/M3_FCM_SETUP.md 为准
        return false
    }
}
