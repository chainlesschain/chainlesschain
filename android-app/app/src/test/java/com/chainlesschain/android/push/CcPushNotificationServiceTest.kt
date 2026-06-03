package com.chainlesschain.android.push

import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.verify
import org.junit.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * CcPushNotificationService 单测 — 协议中立入口的 happy/unhappy 路径 + token 回调。
 */
class CcPushNotificationServiceTest {

    @Test
    fun `onRemoteData parses and dispatches valid payload`() {
        val center = mockk<NotificationCenter>(relaxed = true)
        val svc = CcPushNotificationService(center)
        val ok = svc.onRemoteData(
            mapOf(
                "type" to "cowork.request",
                "taskId" to "t-1",
                "summary" to "审批",
            )
        )
        assertTrue(ok)
        verify { center.dispatch(any()) }
    }

    @Test
    fun `onRemoteData returns false on unknown type and does not dispatch`() {
        val center = mockk<NotificationCenter>(relaxed = true)
        val svc = CcPushNotificationService(center)
        val ok = svc.onRemoteData(mapOf("type" to "bogus"))
        assertFalse(ok)
        verify(exactly = 0) { center.dispatch(any()) }
    }

    @Test
    fun `onRemoteData returns false on empty map`() {
        val center = mockk<NotificationCenter>(relaxed = true)
        val svc = CcPushNotificationService(center)
        assertFalse(svc.onRemoteData(emptyMap()))
        verify(exactly = 0) { center.dispatch(any()) }
    }

    @Test
    fun `onTokenChanged logs and does not throw on any token length`() {
        val center = mockk<NotificationCenter>(relaxed = true)
        val svc = CcPushNotificationService(center)
        svc.onTokenChanged("")  // empty
        svc.onTokenChanged("a".repeat(500))  // long
        // 无副作用 / 无异常 = pass
    }
}
