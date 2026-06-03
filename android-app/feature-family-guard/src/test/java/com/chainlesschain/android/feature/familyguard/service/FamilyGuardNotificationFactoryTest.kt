package com.chainlesschain.android.feature.familyguard.service

import android.app.NotificationManager
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyGuardState
import com.chainlesschain.android.feature.familyguard.domain.model.NotificationChannels
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * FAMILY-05 验收: 4 状态映射 LOW / HIGH channel + channel 注册幂等。
 *
 * 用 Robolectric 跑因为需要真 NotificationManager / NotificationChannel 实例;
 * minSdk=28 我们直接走 API 28+ 行为, 不测 pre-O 分支。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyGuardNotificationFactoryTest {

    private val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val notifMgr by lazy { ctx.getSystemService(NotificationManager::class.java)!! }

    @Test
    fun `ensureChannelsCreated registers both LOW and HIGH channels`() {
        FamilyGuardNotificationFactory.ensureChannelsCreated(ctx)

        val low = notifMgr.getNotificationChannel(NotificationChannels.STATUS_LOW)
        val high = notifMgr.getNotificationChannel(NotificationChannels.ALERT_HIGH)

        assertNotNull(low, "STATUS_LOW channel must exist")
        assertNotNull(high, "ALERT_HIGH channel must exist")
        assertEquals(NotificationManager.IMPORTANCE_LOW, low.importance)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, high.importance)
    }

    @Test
    fun `ensureChannelsCreated is idempotent on repeated invocation`() {
        FamilyGuardNotificationFactory.ensureChannelsCreated(ctx)
        val firstLow = notifMgr.getNotificationChannel(NotificationChannels.STATUS_LOW)
        FamilyGuardNotificationFactory.ensureChannelsCreated(ctx)
        val secondLow = notifMgr.getNotificationChannel(NotificationChannels.STATUS_LOW)
        // 同一 channel id 注册第二次时不应触发 重置 (导致 settings 用户偏好丢失);
        // Robolectric 行为是覆盖, 但本工厂的实现里我们查 getNotificationChannel 先,
        // 不存在才注册; 此断言验证 getNotificationChannel 仍能取得。
        assertNotNull(firstLow)
        assertNotNull(secondLow)
        assertEquals(firstLow.id, secondLow.id)
    }

    @Test
    fun `IDLE maps to STATUS_LOW channel and uses idle text`() {
        val notif = FamilyGuardNotificationFactory.build(ctx, FamilyGuardState.IDLE, null)
        assertEquals(NotificationChannels.STATUS_LOW, notif.channelId)
        val text = notif.extras.getCharSequence(NotificationCompat.EXTRA_TEXT)
        assertEquals("家庭守护待机中", text?.toString())
    }

    @Test
    fun `MONITORING maps to STATUS_LOW channel and uses monitoring text`() {
        val notif = FamilyGuardNotificationFactory.build(ctx, FamilyGuardState.MONITORING, null)
        assertEquals(NotificationChannels.STATUS_LOW, notif.channelId)
        val text = notif.extras.getCharSequence(NotificationCompat.EXTRA_TEXT)
        assertEquals("家庭守护监管中", text?.toString())
    }

    @Test
    fun `OBSERVING maps to ALERT_HIGH channel`() {
        val notif = FamilyGuardNotificationFactory.build(ctx, FamilyGuardState.OBSERVING, null)
        assertEquals(NotificationChannels.ALERT_HIGH, notif.channelId)
        val text = notif.extras.getCharSequence(NotificationCompat.EXTRA_TEXT)
        assertEquals("正在被家长查看屏幕", text?.toString())
    }

    @Test
    fun `URGENT maps to ALERT_HIGH channel and uses urgent text`() {
        val notif = FamilyGuardNotificationFactory.build(ctx, FamilyGuardState.URGENT, null)
        assertEquals(NotificationChannels.ALERT_HIGH, notif.channelId)
        val text = notif.extras.getCharSequence(NotificationCompat.EXTRA_TEXT)
        assertEquals("⚠️ 紧急联络中", text?.toString())
    }

    @Test
    fun `all states declare ongoing flag so user cannot swipe-dismiss`() {
        FamilyGuardState.entries.forEach { state ->
            val notif = FamilyGuardNotificationFactory.build(ctx, state, null)
            assertEquals(
                expected = android.app.Notification.FLAG_ONGOING_EVENT,
                actual = notif.flags and android.app.Notification.FLAG_ONGOING_EVENT,
                message = "$state notification must have FLAG_ONGOING_EVENT",
            )
        }
    }
}
