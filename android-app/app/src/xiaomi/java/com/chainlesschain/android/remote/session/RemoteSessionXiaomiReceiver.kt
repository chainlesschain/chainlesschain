package com.chainlesschain.android.remote.session

import android.content.Context
import com.xiaomi.mipush.sdk.MiPushClient
import com.xiaomi.mipush.sdk.MiPushCommandMessage
import com.xiaomi.mipush.sdk.MiPushMessage
import com.xiaomi.mipush.sdk.PushMessageReceiver
import org.json.JSONObject

/**
 * Bridges Xiaomi MiPush into the Remote Session feature (the MIUI analog of
 * [RemoteSessionVivoReceiver]).
 *
 * Lives in the `xiaomi` source set, which app/build.gradle.kts adds to `main`
 * ONLY when the MiPush AAR is present in app/libs/ — so the app builds and runs
 * fine without it ([XiaomiTokenProvider] still resolves the regId via reflection
 * at pair time). Declared in AndroidManifest with tools:ignore="MissingClass";
 * on AAR-less builds the class is absent and the receiver never fires. See
 * docs/guides/Vendor_Push_Setup.md §3.1.
 */
class RemoteSessionXiaomiReceiver : PushMessageReceiver() {

    /**
     * MiPush command results. On a successful register the fresh regId is
     * `commandArguments[0]` — forward it to any live Remote Session so a
     * backgrounded session starts waking on the new token immediately.
     */
    override fun onCommandResult(context: Context?, message: MiPushCommandMessage?) {
        if (message?.command != MiPushClient.COMMAND_REGISTER || message.resultCode != 0L) return
        val regId = message.commandArguments?.firstOrNull()
        if (!regId.isNullOrBlank()) {
            RemoteSessionPushBridge.onNewToken(regId, XiaomiTokenProvider.PROVIDER)
        }
    }

    /**
     * A MiPush notification tapped by the user. Its extra map carries only
     * routing ids (no session content); surface the approval prompt locally.
     */
    override fun onNotificationMessageClicked(context: Context?, message: MiPushMessage?) {
        val extra = message?.extra ?: return
        if (extra["type"] != "remote-session.approval-request") return
        val ctx = context ?: return
        val event = JSONObject().put("type", "approval_request")
        extra["sessionId"]?.let { event.put("sessionId", it) }
        extra["clientId"]?.let { event.put("clientId", it) }
        RemoteSessionNotifier(ctx.applicationContext).notifyApproval(event)
    }
}
