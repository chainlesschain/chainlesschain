package com.chainlesschain.android.remote.session

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * Bridges Firebase Cloud Messaging into the Remote Session push feature.
 *
 * Lives in the `firebase` source set, which app/build.gradle.kts adds to `main`
 * ONLY when google-services.json is present — so the app builds and runs fine
 * without Firebase (FcmTokenProvider still resolves a token via reflection at
 * pair time). Registered in AndroidManifest with tools:ignore="MissingClass"
 * because the class is absent from Firebase-less builds and never instantiated
 * there.
 */
class RemoteSessionFirebaseService : FirebaseMessagingService() {

    /** Token rotation — forward the fresh token to any live Remote Session. */
    override fun onNewToken(token: String) {
        RemoteSessionPushBridge.onNewToken(token)
    }

    /**
     * A push delivered while the app is in the foreground (or data-only) — the
     * system tray does not auto-display it, so post the approval notification
     * ourselves. Data carries only routing fields (no session content).
     */
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["type"] != "remote-session.approval-request") return
        val event = JSONObject().put("type", "approval_request")
        data["sessionId"]?.let { event.put("sessionId", it) }
        data["clientId"]?.let { event.put("clientId", it) }
        RemoteSessionNotifier(applicationContext).notifyApproval(event)
    }
}
