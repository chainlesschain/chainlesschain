package com.chainlesschain.android.feature.ai.data.voice

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * v1.1 issue #19 W4 AsrEngineRouter 路由 + Whisper stub 单测。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AsrEngineRouterTest {

    private lateinit var preferences: AsrEnginePreferences
    private lateinit var volcengine: VolcengineAsrClient
    private lateinit var whisper: WhisperAsrEngine
    private lateinit var router: AsrEngineRouter

    private val engineFlow = MutableStateFlow(AsrEngineChoice.Volcengine)
    private val modelFlow = MutableStateFlow(WhisperModel.Base)
    private val dummyAudio = File("test.wav")

    @Before
    fun setup() {
        unmockkAll()
        preferences = mockk(relaxed = true)
        volcengine = mockk(relaxed = true)
        whisper = mockk(relaxed = true)

        every { preferences.engine } returns engineFlow
        every { preferences.whisperModel } returns modelFlow

        router = AsrEngineRouter(preferences, volcengine, whisper)
    }

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `router routes to volcengine when engine is Volcengine`() = runTest {
        engineFlow.value = AsrEngineChoice.Volcengine
        coEvery { volcengine.transcribe(dummyAudio) } returns "火山结果"

        val result = router.transcribe(dummyAudio)

        assertEquals("火山结果", result)
        coVerify(exactly = 1) { volcengine.transcribe(dummyAudio) }
        coVerify(exactly = 0) { whisper.transcribe(any()) }
    }

    @Test
    fun `router routes to whisper when engine is Whisper`() = runTest {
        engineFlow.value = AsrEngineChoice.Whisper
        coEvery { whisper.transcribe(dummyAudio) } returns "whisper 结果"

        val result = router.transcribe(dummyAudio)

        assertEquals("whisper 结果", result)
        coVerify(exactly = 1) { whisper.transcribe(dummyAudio) }
        coVerify(exactly = 0) { volcengine.transcribe(any()) }
    }

    @Test
    fun `router responds to engine preference change at next call`() = runTest {
        coEvery { volcengine.transcribe(any()) } returns "火山"
        coEvery { whisper.transcribe(any()) } returns "whisper"

        engineFlow.value = AsrEngineChoice.Volcengine
        assertEquals("火山", router.transcribe(dummyAudio))

        engineFlow.value = AsrEngineChoice.Whisper
        assertEquals("whisper", router.transcribe(dummyAudio))

        engineFlow.value = AsrEngineChoice.Volcengine
        assertEquals("火山", router.transcribe(dummyAudio))
    }

    // 注：WhisperAsrEngine.transcribe stub 抛 WhisperNotInstalledException 单测
    // 用真实 instance 而非 mock，验证 v1.1 stub 行为。
    @Test
    fun `whisper stub throws WhisperNotInstalledException with model info`() = runTest {
        val realPrefs = mockk<AsrEnginePreferences>()
        every { realPrefs.whisperModel } returns MutableStateFlow(WhisperModel.Base)

        val realWhisper = WhisperAsrEngine(realPrefs)

        try {
            realWhisper.transcribe(dummyAudio)
            fail("expected WhisperNotInstalledException")
        } catch (e: WhisperNotInstalledException) {
            assertEquals(WhisperModel.Base, e.model)
            assertTrue(e.message!!.contains("v1.1 stub"))
            assertTrue(e.message!!.contains("docs/guides/Whisper_Local_ASR_Setup.md"))
        }
    }

    @Test
    fun `whisper stub respects current model preference`() = runTest {
        val realPrefs = mockk<AsrEnginePreferences>()
        val modelFlow2 = MutableStateFlow(WhisperModel.Tiny)
        every { realPrefs.whisperModel } returns modelFlow2

        val realWhisper = WhisperAsrEngine(realPrefs)

        try {
            realWhisper.transcribe(dummyAudio)
            fail("expected throw")
        } catch (e: WhisperNotInstalledException) {
            assertEquals(WhisperModel.Tiny, e.model)
        }

        modelFlow2.value = WhisperModel.Small
        try {
            realWhisper.transcribe(dummyAudio)
            fail("expected throw")
        } catch (e: WhisperNotInstalledException) {
            assertEquals(WhisperModel.Small, e.model)
        }
    }

    @Test
    fun `whisper stub isModelInstalled always returns false in v1_1`() {
        val realPrefs = mockk<AsrEnginePreferences>()
        every { realPrefs.whisperModel } returns MutableStateFlow(WhisperModel.Base)
        val realWhisper = WhisperAsrEngine(realPrefs)

        for (model in WhisperModel.values()) {
            assertEquals(false, realWhisper.isModelInstalled(model))
        }
    }

    @Test
    fun `WhisperModel enum metadata is filled for all 3 sizes`() {
        for (model in WhisperModel.values()) {
            assertTrue(model.displayName.isNotBlank())
            assertTrue(model.sizeMB > 0)
            assertTrue(model.accuracyHint.isNotBlank())
            assertTrue(model.firstTokenLatencyMs.isNotBlank())
            assertTrue(model.ggmlFilename.startsWith("ggml-"))
            assertTrue(model.ggmlFilename.endsWith(".bin"))
        }
    }

    @Test
    fun `AsrEngineChoice enum values intact`() {
        assertEquals(2, AsrEngineChoice.values().size)
        assertTrue(AsrEngineChoice.values().contains(AsrEngineChoice.Volcengine))
        assertTrue(AsrEngineChoice.values().contains(AsrEngineChoice.Whisper))
    }
}
