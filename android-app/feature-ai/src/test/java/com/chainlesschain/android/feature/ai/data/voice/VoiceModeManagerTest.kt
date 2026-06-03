package com.chainlesschain.android.feature.ai.data.voice

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * VoiceModeManager 单测。M3 D1。
 *
 * 用 fake impls of AudioRecorder/AsrEngine/VoiceChatBridge/AudioPlayer，避免 MockK 拳打 final class +
 * Android framework 假调用。每个测试在自己的 manager 实例里跑，互不污染。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoiceModeManagerTest {

    private fun newManager(
        recorder: AudioRecorder = FakeRecorder(),
        asr: AsrEngine = FakeAsr(),
        bridge: VoiceChatBridge = FakeBridge(),
        player: AudioPlayer = FakePlayer(),
    ): VoiceModeManager = VoiceModeManager(recorder, asr, bridge, player)

    private val dummyWav = File("dummy.wav")

    @Test
    fun `initial state is Idle`() {
        val mgr = newManager()
        assertEquals(VoiceModeState.Idle, mgr.state.value)
    }

    @Test
    fun `startRecording without permission fails with PERMISSION stage`() {
        val rec = FakeRecorder(hasPerm = false)
        val mgr = newManager(recorder = rec)
        val ok = mgr.startRecording()
        assertFalse(ok)
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.PERMISSION, s.stage)
    }

    @Test
    fun `startRecording when recorder_start returns false fails with RECORDING stage`() {
        val rec = FakeRecorder(startResult = false)
        val mgr = newManager(recorder = rec)
        val ok = mgr.startRecording()
        assertFalse(ok)
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.RECORDING, s.stage)
    }

    @Test
    fun `startRecording success transitions to Recording`() {
        val rec = FakeRecorder()
        val mgr = newManager(recorder = rec)
        val ok = mgr.startRecording()
        assertTrue(ok)
        assertEquals(VoiceModeState.Recording, mgr.state.value)
        assertEquals(1, rec.startCalls)
    }

    @Test
    fun `startRecording is ignored when already Recording`() = runTest {
        val mgr = newManager()
        mgr.startRecording()
        val prev = mgr.state.value
        val again = mgr.startRecording()
        assertFalse(again)
        assertEquals(prev, mgr.state.value)
    }

    @Test
    fun `stopAndProcess is no-op when not in Recording`() = runTest {
        val mgr = newManager()
        mgr.stopAndProcess()
        assertEquals(VoiceModeState.Idle, mgr.state.value)
    }

    @Test
    fun `stopAndProcess with null wav file fails with RECORDING stage`() = runTest {
        val rec = FakeRecorder(stopResult = null)
        val mgr = newManager(recorder = rec)
        mgr.startRecording()
        mgr.stopAndProcess()
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.RECORDING, s.stage)
    }

    @Test
    fun `full pipeline succeeds reaches Done with correct payload`() = runTest {
        val bridge = FakeBridge(reply = "你好，我是助手。", conversationId = "conv-1")
        val asr = FakeAsr(returnText = "你好")
        val mgr = newManager(asr = asr, bridge = bridge)
        mgr.startRecording()
        mgr.stopAndProcess()
        val done = mgr.state.value as VoiceModeState.Done
        assertEquals("你好", done.userText)
        assertEquals("你好，我是助手。", done.replyText)
    }

    @Test
    fun `ASR throws fails pipeline with TRANSCRIBE stage`() = runTest {
        val asr = FakeAsr(throwError = RuntimeException("识别接口不通"))
        val mgr = newManager(asr = asr)
        mgr.startRecording()
        mgr.stopAndProcess()
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.TRANSCRIBE, s.stage)
        assertTrue(s.message.contains("识别接口不通"))
    }

    @Test
    fun `ASR returns blank fails pipeline with TRANSCRIBE stage`() = runTest {
        val asr = FakeAsr(returnText = "   ")
        val mgr = newManager(asr = asr)
        mgr.startRecording()
        mgr.stopAndProcess()
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.TRANSCRIBE, s.stage)
    }

    @Test
    fun `chat returns failure leads to Failed CHAT`() = runTest {
        val bridge = FakeBridge(chatResult = Result.failure(RuntimeException("桌面离线")))
        val mgr = newManager(bridge = bridge)
        mgr.startRecording()
        mgr.stopAndProcess()
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.CHAT, s.stage)
        assertTrue(s.message.contains("桌面离线"))
    }

    @Test
    fun `chat returns blank reply fails with CHAT stage`() = runTest {
        val bridge = FakeBridge(reply = "")
        val mgr = newManager(bridge = bridge)
        mgr.startRecording()
        mgr.stopAndProcess()
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.CHAT, s.stage)
    }

    @Test
    fun `TTS failure leaves Failed TTS but keeps reply visible upstream`() = runTest {
        val bridge = FakeBridge(synthesizeResult = Result.failure(RuntimeException("TTS quota 用尽")))
        val mgr = newManager(bridge = bridge)
        mgr.startRecording()
        mgr.stopAndProcess()
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.TTS, s.stage)
    }

    @Test
    fun `player play returns false fails with PLAY stage`() = runTest {
        val player = FakePlayer(playResult = false)
        val mgr = newManager(player = player)
        mgr.startRecording()
        mgr.stopAndProcess()
        val s = mgr.state.value as VoiceModeState.Failed
        assertEquals(VoiceModeState.Failed.Stage.PLAY, s.stage)
    }

    @Test
    fun `cancel resets to Idle and stops recorder and player`() = runTest {
        val rec = FakeRecorder()
        val player = FakePlayer()
        val mgr = newManager(recorder = rec, player = player)
        mgr.startRecording()
        mgr.cancel()
        assertEquals(VoiceModeState.Idle, mgr.state.value)
        assertEquals(1, rec.cancelCalls)
        assertEquals(1, player.stopCalls)
    }

    @Test
    fun `continuousMode after Done re-starts recording`() = runTest {
        val rec = FakeRecorder()
        val mgr = newManager(recorder = rec)
        mgr.continuousMode = true
        mgr.startRecording()
        mgr.stopAndProcess()
        // 连续模式下 Done 后立刻 startRecording，最终状态应是 Recording
        assertEquals(VoiceModeState.Recording, mgr.state.value)
        assertEquals(2, rec.startCalls)
    }

    @Test
    fun `conversationId carries to subsequent chat call`() = runTest {
        val bridge = FakeBridge(conversationId = "conv-keep")
        val mgr = newManager(bridge = bridge)
        mgr.startRecording()
        mgr.stopAndProcess()
        mgr.resetIdle()
        mgr.startRecording()
        mgr.stopAndProcess()
        // 第二次 chat 调用应收到 conv-keep 作为输入 conversationId
        assertEquals(listOf<String?>(null, "conv-keep"), bridge.chatConvIds)
    }

    @Test
    fun `resetConversation clears stored conversationId`() = runTest {
        val bridge = FakeBridge(conversationId = "conv-A")
        val mgr = newManager(bridge = bridge)
        mgr.startRecording()
        mgr.stopAndProcess()
        mgr.resetIdle()
        mgr.resetConversation()
        mgr.startRecording()
        mgr.stopAndProcess()
        assertEquals(listOf<String?>(null, null), bridge.chatConvIds)
    }

    @Test
    fun `resetIdle from Done returns to Idle`() {
        val mgr = newManager()
        // 手动塞 Done 状态以模拟 pipeline 结束（runTest 不需要因为不调 suspend）
        // 通过完整 pipeline 跑一次取得 Done
        kotlinx.coroutines.runBlocking {
            mgr.startRecording()
            mgr.stopAndProcess()
        }
        assertTrue(mgr.state.value is VoiceModeState.Done)
        mgr.resetIdle()
        assertEquals(VoiceModeState.Idle, mgr.state.value)
    }

    @Test
    fun `resetIdle from Idle is no-op`() {
        val mgr = newManager()
        mgr.resetIdle()
        assertEquals(VoiceModeState.Idle, mgr.state.value)
    }

    @Test
    fun `resetIdle from Recording is ignored`() {
        val mgr = newManager()
        mgr.startRecording()
        mgr.resetIdle()
        assertEquals(VoiceModeState.Recording, mgr.state.value)
    }

    @Test
    fun `processAudio is callable directly for replay scenarios`() = runTest {
        val mgr = newManager()
        // 不经 startRecording 直接调（测试场景：从存档文件重放）
        mgr.processAudio(dummyWav)
        val done = mgr.state.value as VoiceModeState.Done
        assertNotNull(done)
    }

    // ===== Fakes =====

    private class FakeRecorder(
        var hasPerm: Boolean = true,
        var startResult: Boolean = true,
        var stopResult: File? = File("fake.wav"),
    ) : AudioRecorder {
        var startCalls = 0
        var cancelCalls = 0
        override fun hasPermission(): Boolean = hasPerm
        override fun start(): Boolean {
            startCalls++
            return startResult
        }
        override suspend fun stopAndWriteWav(): File? = stopResult
        override fun cancel() { cancelCalls++ }
    }

    private class FakeAsr(
        val returnText: String = "user 说的话",
        val throwError: Throwable? = null,
    ) : AsrEngine {
        override suspend fun transcribe(audioFile: File): String {
            throwError?.let { throw it }
            return returnText
        }
    }

    private class FakeBridge(
        val reply: String = "助手 reply",
        val conversationId: String = "conv-default",
        val chatResult: Result<VoiceChatReply>? = null,
        val synthesizeResult: Result<VoiceAudio>? = null,
    ) : VoiceChatBridge {
        val chatConvIds = mutableListOf<String?>()
        override suspend fun chat(userText: String, conversationId: String?): Result<VoiceChatReply> {
            chatConvIds.add(conversationId)
            return chatResult ?: Result.success(
                VoiceChatReply(reply = reply, conversationId = this.conversationId)
            )
        }
        override suspend fun synthesize(text: String): Result<VoiceAudio> {
            return synthesizeResult ?: Result.success(
                VoiceAudio(bytes = byteArrayOf(1, 2, 3), format = "mp3")
            )
        }
    }

    private class FakePlayer(var playResult: Boolean = true) : AudioPlayer {
        var stopCalls = 0
        override suspend fun play(audioBytes: ByteArray, format: String): Boolean = playResult
        override fun stop() { stopCalls++ }
    }
}
