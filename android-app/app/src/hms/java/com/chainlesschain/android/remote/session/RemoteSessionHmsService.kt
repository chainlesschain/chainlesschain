package com.chainlesschain.android.remote.session

import com.huawei.hms.push.HmsMessageService
import com.huawei.hms.push.RemoteMessage
import org.json.JSONObject

/**
 * Bridges Huawei HMS push into the Remote Session feature — the HMS analog of
 * [RemoteSessionFirebaseService] (both subclass a vendor MessageService with
 * onNewToken / onMessageReceived).
 *
 * Lives in the `hms` source set, which app/build.gradle.kts adds to `main` ONLY
 * when agconnect-services.json is present — so the app builds and runs fine
 * without the HMS SDK ([HuaweiTokenProvider] still resolves a token via
 * reflection at pair time). Declared in AndroidManifest with
 * tools:ignore="MissingClass"; on HMS-less builds the class is absent and the
 * service is never instantiated. See docs/guides/Vendor_Push_Setup.md §3.2.
 */
class RemoteSessionHmsService : HmsMessageService() {

    /** Token rotation — forward the fresh token to any live Remote Session. */
    override fun onNewToken(token: String) {
        RemoteSessionPushBridge.onNewToken(token, HuaweiTokenProvider.PROVIDER)
    }

    /**
     * A push delivered while the app is foregrounded (or data-only) — the system
     * tray does not auto-display it, so post the approval notification ourselves.
     * Data carries only routing fields (no session content).
     */
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.dataOfMap ?: return
        if (data["type"] != "remote-session.approval-request") return
        val event = JSONObject().put("type", "approval_request")
        data["sessionId"]?.let { event.put("sessionId", it) }
        data["clientId"]?.let { event.put("clientId", it) }
        RemoteSessionNotifier(applicationContext).notifyApproval(event)
    }
}
