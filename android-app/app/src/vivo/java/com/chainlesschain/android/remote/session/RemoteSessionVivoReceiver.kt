package com.chainlesschain.android.remote.session

import android.content.Context
import com.vivo.push.model.UPSNotificationMessage
import com.vivo.push.sdk.OpenClientPushMessageReceiver
import org.json.JSONObject

/**
 * Bridges vivo push into the Remote Session feature (the vivo analog of
 * [RemoteSessionFirebaseService]).
 *
 * Lives in the `vivo` source set, which app/build.gradle.kts adds to `main` ONLY
 * when the vivo Push SDK AAR is present in app/libs/ — so the app builds and runs
 * fine without it ([VivoTokenProvider] still resolves the regId via reflection at
 * pair time). Declared in AndroidManifest with tools:ignore="MissingClass";
 * on AAR-less builds the class is absent and the receiver never fires. See
 * docs/guides/Vendor_Push_Setup.md §3.4.
 */
class RemoteSessionVivoReceiver : OpenClientPushMessageReceiver() {

    /**
     * A fresh regId (first registration or rotation) — forward it to any live
     * Remote Session so an in-flight, backgrounded session starts waking on the
     * new token immediately. When no session is active this is a no-op; the next
     * pairing reads the cached regId via [VivoTokenProvider].
     */
    override fun onReceiveRegId(context: Context, regId: String) {
        RemoteSessionPushBridge.onNewToken(regId, VivoTokenProvider.PROVIDER)
    }

    /**
     * A vivo notification tapped by the user. Its params carry only routing ids
     * (no session content); surface the approval prompt locally so tapping the
     * push lands on the approval UI even when the app was backgrounded.
     */
    override fun onNotificationMessageClicked(context: Context, message: UPSNotificationMessage) {
        val params = message.params ?: return
        if (params["type"] != "remote-session.approval-request") return
        val event = JSONObject().put("type", "approval_request")
        params["sessionId"]?.let { event.put("sessionId", it) }
        params["clientId"]?.let { event.put("clientId", it) }
        RemoteSessionNotifier(context.applicationContext).notifyApproval(event)
    }
}
