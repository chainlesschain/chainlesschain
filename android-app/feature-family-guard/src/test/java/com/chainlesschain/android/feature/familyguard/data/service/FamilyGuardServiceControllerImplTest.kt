package com.chainlesschain.android.feature.familyguard.data.service

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyGuardState
import com.chainlesschain.android.feature.familyguard.service.FamilyGuardForegroundService
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * FAMILY-05 验收: Controller setState 调 startForegroundService + intent action
 * + EXTRA_STATE; stop() 走 stopService action.
 *
 * 用 Robolectric Shadow 拦截 startForegroundService 调用, 断言 intent 的属性。
 * 不真起 Service 实例 — 那是 AndroidTest 的 instrumented 范围。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyGuardServiceControllerImplTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val controller = FamilyGuardServiceControllerImpl(ctx)

    @Test
    fun `setState sends startForegroundService intent with state extra`() {
        controller.setState(FamilyGuardState.MONITORING)

        val shadowApp = shadowOf(ctx as android.app.Application)
        val started = shadowApp.nextStartedService
        assertNotNull(started)
        assertEquals(
            FamilyGuardForegroundService.ACTION_SET_STATE,
            started.action,
        )
        assertEquals(
            FamilyGuardState.MONITORING.name,
            started.getStringExtra(FamilyGuardForegroundService.EXTRA_STATE),
        )
    }

    @Test
    fun `stop sends stop action intent`() {
        controller.stop()
        val shadowApp = shadowOf(ctx as android.app.Application)
        val started = shadowApp.nextStartedService
        assertNotNull(started)
        assertEquals(
            FamilyGuardForegroundService.ACTION_STOP,
            started.action,
        )
    }

    @Test
    fun `repeated setState produces distinct intents per state`() {
        controller.setState(FamilyGuardState.IDLE)
        controller.setState(FamilyGuardState.URGENT)
        val shadowApp = shadowOf(ctx as android.app.Application)
        val first = shadowApp.nextStartedService
        val second = shadowApp.nextStartedService
        assertEquals(FamilyGuardState.IDLE.name, first.getStringExtra(FamilyGuardForegroundService.EXTRA_STATE))
        assertEquals(FamilyGuardState.URGENT.name, second.getStringExtra(FamilyGuardForegroundService.EXTRA_STATE))
    }

    @Test
    fun `intentToSetState carries the requested state name`() {
        val intent = FamilyGuardForegroundService.intentToSetState(ctx, FamilyGuardState.OBSERVING)
        assertEquals(FamilyGuardForegroundService.ACTION_SET_STATE, intent.action)
        assertEquals(
            FamilyGuardState.OBSERVING.name,
            intent.getStringExtra(FamilyGuardForegroundService.EXTRA_STATE),
        )
    }

    @Test
    fun `intentToStop has stop action and no state extra`() {
        val intent = FamilyGuardForegroundService.intentToStop(ctx)
        assertEquals(FamilyGuardForegroundService.ACTION_STOP, intent.action)
        assertEquals(null, intent.getStringExtra(FamilyGuardForegroundService.EXTRA_STATE))
    }
}
