package com.chainlesschain.android.auto

import androidx.car.app.model.MessageTemplate
import androidx.car.app.testing.TestCarContext
import androidx.test.core.app.ApplicationProvider
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * v1.2 #1 Android Auto Phase 0 — VoiceModeScreen 占位 template 单测。
 *
 * 用 TestCarContext.createCarContext(Application) 直接造 CarContext（绕开
 * SessionController 的 Session 实例化复杂度，Phase 0 仅验 template 内容）。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class VoiceModeScreenTest {

    private lateinit var carContext: TestCarContext

    @Before
    fun setup() {
        carContext = TestCarContext.createCarContext(
            ApplicationProvider.getApplicationContext(),
        )
    }

    @Test
    fun `onGetTemplate returns MessageTemplate with expected title`() {
        val screen = VoiceModeScreen(carContext)
        val template = screen.onGetTemplate()
        assertNotNull(template)
        assertTrue(
            template is MessageTemplate,
            "Expected MessageTemplate, got ${template::class.simpleName}",
        )
        val msg = template as MessageTemplate
        assertEquals("ChainlessChain Voice", msg.title?.toString())
    }

    @Test
    fun `onGetTemplate body mentions Voice Mode`() {
        val screen = VoiceModeScreen(carContext)
        val template = screen.onGetTemplate() as MessageTemplate
        val body = template.message.toString()
        assertTrue(
            body.contains("Voice Mode"),
            "expected body to mention 'Voice Mode', got: $body",
        )
    }

    @Test
    fun `onGetTemplate has at least one action button`() {
        val screen = VoiceModeScreen(carContext)
        val template = screen.onGetTemplate() as MessageTemplate
        // refresh 按钮 + Phase 1 起后会再加更多
        assertTrue(
            template.actions.size >= 1,
            "expected ≥1 action, got ${template.actions.size}",
        )
    }
}
