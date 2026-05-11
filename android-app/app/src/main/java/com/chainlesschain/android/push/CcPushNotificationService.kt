package com.chainlesschain.android.push

import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 跨厂商 push 通知接收适配器（M3 D3 PushNotifier）。
 *
 * **设计取舍**：v1.0 不直接引入 firebase-messaging 依赖（设计文档 §9.1 + Q2：FCM 国内可达性
 * 待定，OPPO/小米/华为统一推送预计 v1.1），所以本类不 extends FirebaseMessagingService，
 * 而是定义一个**协议中立**的入口：调用方（FirebaseMessagingService 子类 / HmsPushService /
 * MiPushReceiver / 桌面 P2P fallback）拿到 Map<String,String> data 后调 [onRemoteData] 即可。
 *
 * **添 FCM 真实装配步骤**（待 google-services.json 到位）：
 *   1. 在 app/google-services.json 放 Firebase 配置（build.gradle.kts 已有 conditional plugin）
 *   2. 加 dep `implementation("com.google.firebase:firebase-messaging-ktx")` 到 build.gradle.kts
 *      conditional block (line 396-400)
 *   3. 新建 `app/src/main/java/.../push/CcFirebaseMessagingService.kt`:
 *      ```kotlin
 *      @AndroidEntryPoint
 *      class CcFirebaseMessagingService : FirebaseMessagingService() {
 *          @Inject lateinit var service: CcPushNotificationService
 *          override fun onMessageReceived(msg: RemoteMessage) {
 *              service.onRemoteData(msg.data)
 *          }
 *          override fun onNewToken(token: String) {
 *              service.onTokenChanged(token)
 *          }
 *      }
 *      ```
 *   4. Manifest <service> 加：
 *      ```xml
 *      <service android:name=".push.CcFirebaseMessagingService"
 *               android:exported="false"
 *               android:directBootAware="false">
 *          <intent-filter>
 *              <action android:name="com.google.firebase.MESSAGING_EVENT"/>
 *          </intent-filter>
 *      </service>
 *      ```
 *   5. 详见 docs/M3_FCM_SETUP.md
 *
 * **本地 fallback 路径**：桌面 P2P 通道收到通知数据直接调 [onRemoteData]，跳过 FCM —
 * 国内无 Play Services 设备的兜底。Map 协议与 FCM data 一致。
 */
@Singleton
class CcPushNotificationService @Inject constructor(
    private val notificationCenter: NotificationCenter,
) {

    /**
     * 入口：FCM 或本地 fallback 投递的 Remote data。
     *
     * @return 是否成功 dispatch（false = 解析失败 / 未知 type）
     */
    fun onRemoteData(data: Map<String, String>): Boolean {
        val payload = FcmRemoteMessageParser.parse(data)
        if (payload == null) {
            Timber.w("CcPushNotificationService: 未识别的 push data type=%s", data["type"])
            return false
        }
        notificationCenter.dispatch(payload)
        return true
    }

    /**
     * FCM 注册 token 变更回调（FirebaseMessagingService.onNewToken）。v1.0 仅 log；v1.1 上传
     * token 到桌面 mobile-bridge 让桌面可以主动给手机推送。
     */
    fun onTokenChanged(token: String) {
        Timber.i("CcPushNotificationService: token changed (len=${token.length}) — 上传逻辑待 v1.1")
    }
}
