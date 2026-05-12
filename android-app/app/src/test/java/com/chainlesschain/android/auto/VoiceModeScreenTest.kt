package com.chainlesschain.android.auto

import androidx.car.app.model.MessageTemplate
import androidx.car.app.testing.TestCarContext
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.feature.ai.data.voice.AsrEngine
import com.chainlesschain.android.feature.ai.data.voice.AudioPlayer
import com.chainlesschain.android.feature.ai.data.voice.AudioRecorder
import com.chainlesschain.android.feature.ai.data.voice.VoiceChatBridge
import com.chainlesschain.android.feature.ai.data.voice.VoiceChatReply
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeState
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.assertFalse

/**
 * v1.2 #1 Android Auto Phase 1 — VoiceModeScreen template 单测。
 *
 * 用真 [VoiceModeManager] (fake deps) — 单测覆盖每个 state 的 body 文案 + actions
 * 集合形状。底层 recorder / asr / bridge / player 都是 mockk。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class VoiceModeScreenTest {

    private lateinit var carContext: TestCarContext
    private lateinit var recorder: AudioRecorder
    private lateinit var asr: AsrEngine
    private lateinit var bridge: VoiceChatBridge
    private lateinit var player: AudioPlayer
    private lateinit var manager: VoiceModeManager
    private lateinit var screen: VoiceModeScreen

    @Before
    fun setup() {
        carContext = TestCarContext.createCarContext(
            ApplicationProvider.getApplicationContext(),
        )
        recorder = mockk(relaxed = true)
        asr = mockk(relaxed = true)
        bridge = mockk(relaxed = true)
        player = mockk(relaxed = true)
        every { recorder.hasPermission() } returns true
        every { recorder.start() } returns true
        coEvery { bridge.chat(any(), any()) } returns Result.success(
            VoiceChatReply(reply = "hi", conversationId = "c1"),
        )
        manager = VoiceModeManager(recorder, asr, bridge, player)
        screen = VoiceModeScreen(carContext, manager)
    }

    @Test
    fun `Idle template has Mic start action`() {
        // 默认 manager 创建后 state=Idle
        val template = screen.onGetTemplate() as MessageTemplate
        assertEquals("ChainlessChain Voice", template.title?.toString())
        assertTrue(template.message.toString().contains("开始录音"))
        assertTrue(
            template.actions.any { it.title?.toString()?.contains("开始录音") == true },
            "Idle should have 开始录音 action, got: ${template.actions.map { it.title?.toString() }}",
        )
    }

    @Test
    fun `Recording template has Stop + Cancel actions`() {
        manager.startRecording() // → Recording
        val template = screen.onGetTemplate() as MessageTemplate
        val titles = template.actions.map { it.title?.toString() ?: "" }
        assertTrue(titles.any { it.contains("停止") }, "expected 停止, got $titles")
        assertTrue(titles.any { it.contains("取消") }, "expected 取消, got $titles")
        assertTrue(template.message.toString().contains("正在听"))
    }

    @Test
    fun `Failed template still shows Mic start action (retry)`() {
        every { recorder.hasPermission() } returns false
        manager.startRecording() // → Failed(PERMISSION)
        val template = screen.onGetTemplate() as MessageTemplate
        val titles = template.actions.map { it.title?.toString() ?: "" }
        assertTrue(titles.any { it.contains("开始录音") }, "Failed should show retry mic")
        assertTrue(template.message.toString().contains("出错"))
    }

    @Test
    fun `body for Thinking includes user text`() {
        val body = screen.bodyFor(VoiceModeState.Thinking(userText = "查一下今天天气"))
        assertTrue(body.contains("查一下今天天气"), "body should echo user text")
        assertTrue(body.contains("思考"), "body should indicate thinking")
    }

    @Test
    fun `body for Speaking shows user text + reply text`() {
        val body = screen.bodyFor(
            VoiceModeState.Speaking(
                userText = "今天天气",
                replyText = "今日晴天 28 度",
            ),
        )
        assertTrue(body.contains("今天天气"))
        assertTrue(body.contains("今日晴天"))
    }

    @Test
    fun `body for Done shows reply text only`() {
        val body = screen.bodyFor(
            VoiceModeState.Done(
                userText = "天气",
                replyText = "晴天 28 度",
            ),
        )
        assertTrue(body.contains("晴天 28 度"))
    }

    @Test
    fun `body for Failed includes stage and message`() {
        val body = screen.bodyFor(
            VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.TRANSCRIBE,
                "网络超时",
            ),
        )
        assertTrue(body.contains("TRANSCRIBE"))
        assertTrue(body.contains("网络超时"))
    }

    @Test
    fun `body for Idle prompts the user`() {
        assertTrue(
            screen.bodyFor(VoiceModeState.Idle).contains("开始录音"),
            "Idle body should prompt 开始录音",
        )
    }

    @Test
    fun `transitions Idle to Recording invalidates - state machine smoke`() {
        // 直接验状态机；invalidate() 在 Robolectric carContext 下是 no-op
        assertEquals(VoiceModeState.Idle, manager.state.value)
        val ok = manager.startRecording()
        assertTrue(ok)
        assertEquals(VoiceModeState.Recording, manager.state.value)
    }

    @Test
    fun `startRecording fails when permission missing - state goes to Failed`() {
        every { recorder.hasPermission() } returns false
        val ok = manager.startRecording()
        assertFalse(ok)
        val state = manager.state.value
        assertTrue(state is VoiceModeState.Failed)
        assertEquals(VoiceModeState.Failed.Stage.PERMISSION, (state as VoiceModeState.Failed).stage)
    }

    @Test
    fun `template title remains ChainlessChain Voice across states`() {
        val titles = mutableListOf<String?>()
        titles.add((screen.onGetTemplate() as MessageTemplate).title?.toString())
        manager.startRecording()
        titles.add((screen.onGetTemplate() as MessageTemplate).title?.toString())
        manager.cancel()
        titles.add((screen.onGetTemplate() as MessageTemplate).title?.toString())
        assertTrue(titles.all { it == "ChainlessChain Voice" })
    }

    @Test
    fun `onGetTemplate always returns non-null Template`() {
        val t = screen.onGetTemplate()
        assertNotNull(t)
        assertTrue(t is MessageTemplate)
    }
}
