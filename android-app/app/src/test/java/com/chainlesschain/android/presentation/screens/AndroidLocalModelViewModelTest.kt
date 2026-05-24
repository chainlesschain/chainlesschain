package com.chainlesschain.android.presentation.screens

import android.content.Context
import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.ModelManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * AndroidLocalModelViewModel 单测 —— 5 用例覆盖：状态映射、init refresh、download/delete
 * 透传、并发 download 短路。
 *
 * 模式镜像 [HubLocalViewModelTest]：StandardTestDispatcher + setMain/resetMain + mockk relaxed。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AndroidLocalModelViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var modelManager: ModelManager
    private lateinit var llmEngine: LlmInferenceEngine
    private lateinit var appContext: Context

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        modelManager = mockk(relaxed = true)
        every { modelManager.defaultSpec } returns ModelManager.ModelSpec(
            filename = "test-model.task",
            url = "https://hf-mirror.com/test/path",
            expectedSha256 = null,
            sizeBytesApprox = 555_000_000L,
            displayName = "Test Model",
        )
        every { modelManager.state } returns
            MutableStateFlow<ModelManager.State>(ModelManager.State.NotDownloaded)
        coEvery { modelManager.refresh(any()) } returns ModelManager.State.NotDownloaded

        llmEngine = mockk(relaxed = true)
        every { llmEngine.nativeReady } returns true

        appContext = mockk(relaxed = true)
        every { appContext.getString(any()) } returns "stub"
        every { appContext.getString(any(), *anyVararg()) } returns "stub"
    }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    private fun newVm() = AndroidLocalModelViewModel(appContext, modelManager, llmEngine)

    @Test
    fun `init triggers refresh and reflects NotDownloaded`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        coVerify { modelManager.refresh(any()) }
        assertEquals(LocalModelStatus.NotDownloaded, vm.uiState.value.modelState)
        assertFalse(vm.uiState.value.isReady)
        assertTrue(vm.uiState.value.nativeReady)
    }

    @Test
    fun `Ready state maps to LocalModelStatus Ready with isReady true`() =
        runTest(testDispatcher) {
            val readyState = ModelManager.State.Ready(
                file = File("/tmp/test-model.task"),
                sha256 = "deadbeefcafebabe1234567890",
            )
            every { modelManager.state } returns MutableStateFlow<ModelManager.State>(readyState)
            coEvery { modelManager.refresh(any()) } returns readyState

            val vm = newVm()
            advanceUntilIdle()

            val status = vm.uiState.value.modelState
            assertTrue(status is LocalModelStatus.Ready)
            assertEquals("test-model.task", status.filename)
            assertEquals("deadbeefcafe", status.sha256Short)
            assertTrue(vm.uiState.value.isReady)
        }

    @Test
    fun `downloadModel calls modelManager download`() = runTest(testDispatcher) {
        coEvery { modelManager.download(any()) } returns ModelManager.State.NotDownloaded
        val vm = newVm()
        advanceUntilIdle()

        vm.downloadModel()
        advanceUntilIdle()

        coVerify { modelManager.download(any()) }
    }

    @Test
    fun `concurrent downloadModel short-circuits second call`() = runTest(testDispatcher) {
        // 让 download 挂起 → 第一次 in-flight 期间第二次必须被 guard 挡掉
        val gate = kotlinx.coroutines.CompletableDeferred<ModelManager.State>()
        coEvery { modelManager.download(any()) } coAnswers { gate.await() }
        val vm = newVm()
        advanceUntilIdle()

        vm.downloadModel()
        vm.downloadModel() // 应被 guard 短路
        advanceUntilIdle()

        // 释放第一个 download
        gate.complete(ModelManager.State.NotDownloaded)
        advanceUntilIdle()

        coVerify(exactly = 1) { modelManager.download(any()) }
    }

    @Test
    fun `deleteModel calls modelManager delete`() = runTest(testDispatcher) {
        coEvery { modelManager.delete(any()) } returns Unit
        val vm = newVm()
        advanceUntilIdle()

        vm.deleteModel()
        advanceUntilIdle()

        coVerify { modelManager.delete(any()) }
    }
}
