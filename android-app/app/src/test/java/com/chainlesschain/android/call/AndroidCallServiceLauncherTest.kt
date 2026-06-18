package com.chainlesschain.android.call

import android.app.Application
import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * FAMILY-67 [AndroidCallServiceLauncher] 集成测试（P3，Robolectric）。
 *
 * 验「通话状态 → 通知/前台服务」映射：来电发全屏通知、接通起前台服务、去电只发通知、结束撤通知。
 * 用 Robolectric 影子 NotificationManager + ShadowApplication 的 started-service 队列断言。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AndroidCallServiceLauncherTest {

    private val app: Application = RuntimeEnvironment.getApplication()
    private val launcher = AndroidCallServiceLauncher(app, CallRinger(app))
    private val nm = app.getSystemService(NotificationManager::class.java)!!

    private fun session(
        state: CallState,
        direction: CallDirection = CallDirection.INCOMING,
        media: CallMediaType = CallMediaType.AUDIO,
    ) = CallSession("c1", "did:key:zPeer", direction, media, state, startedAtMs = 0L)

    @Test
    fun `incoming posts a full-screen call notification`() {
        launcher.onCall(session(CallState.INCOMING))
        assertNotNull(
            "incoming should post a notification",
            shadowOf(nm).getNotification(CallNotifications.NOTIFICATION_ID),
        )
    }

    @Test
    fun `connecting starts the call foreground service`() {
        launcher.onCall(session(CallState.CONNECTING, direction = CallDirection.OUTGOING))
        val started = shadowOf(app).nextStartedService
        assertNotNull("connecting should start a service", started)
        assertEquals(CallForegroundService::class.java.name, started.component?.className)
    }

    @Test
    fun `active starts the call foreground service`() {
        launcher.onCall(session(CallState.ACTIVE, direction = CallDirection.OUTGOING))
        val started = shadowOf(app).nextStartedService
        assertNotNull("active should start a service", started)
        assertEquals(CallForegroundService::class.java.name, started.component?.className)
    }

    @Test
    fun `outgoing ringing posts notification but does not start a service`() {
        launcher.onCall(session(CallState.OUTGOING, direction = CallDirection.OUTGOING))
        assertNotNull(
            "outgoing should post a notification",
            shadowOf(nm).getNotification(CallNotifications.NOTIFICATION_ID),
        )
        assertNull("no foreground service while only ringing", shadowOf(app).peekNextStartedService())
    }

    @Test
    fun `missed incoming call posts a missed-call notification (separate id)`() {
        val missed = CallSession(
            "c1", "did:key:zPeer", CallDirection.INCOMING, CallMediaType.AUDIO,
            CallState.ENDED, startedAtMs = 0L, connectedAtMs = 0L, endReason = CallEndReason.REMOTE_HANGUP,
        )
        launcher.onCall(missed)
        assertNotNull(
            "missed incoming should post a missed-call notification",
            shadowOf(nm).getNotification(CallNotifications.MISSED_NOTIFICATION_ID),
        )
    }

    @Test
    fun `rejected incoming does not post a missed-call notification`() {
        val rejected = CallSession(
            "c2", "did:key:zPeer", CallDirection.INCOMING, CallMediaType.AUDIO,
            CallState.ENDED, startedAtMs = 0L, connectedAtMs = 0L, endReason = CallEndReason.REJECTED,
        )
        launcher.onCall(rejected)
        assertNull(
            "explicitly rejected call is not a missed call",
            shadowOf(nm).getNotification(CallNotifications.MISSED_NOTIFICATION_ID),
        )
    }

    @Test
    fun `answered then ended posts no missed-call notification`() {
        val answered = CallSession(
            "c3", "did:key:zPeer", CallDirection.INCOMING, CallMediaType.AUDIO,
            CallState.ENDED, startedAtMs = 0L, connectedAtMs = 2_000L, endedAtMs = 8_000L,
            endReason = CallEndReason.REMOTE_HANGUP,
        )
        launcher.onCall(answered)
        assertNull(
            "an answered call is not missed",
            shadowOf(nm).getNotification(CallNotifications.MISSED_NOTIFICATION_ID),
        )
    }

    @Test
    fun `clear cancels the call notification`() {
        launcher.onCall(session(CallState.INCOMING))
        assertNotNull(shadowOf(nm).getNotification(CallNotifications.NOTIFICATION_ID))
        launcher.clear()
        assertNull(
            "clear should cancel the notification",
            shadowOf(nm).getNotification(CallNotifications.NOTIFICATION_ID),
        )
    }
}
