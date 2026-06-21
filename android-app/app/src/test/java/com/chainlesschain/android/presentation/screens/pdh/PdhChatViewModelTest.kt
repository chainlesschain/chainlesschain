package com.chainlesschain.android.presentation.screens.pdh

import com.chainlesschain.android.pdh.PdhAgentSession
import com.chainlesschain.android.pdh.PdhAgentSession.FeedbackKind
import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import com.chainlesschain.android.pdh.PdhOnboarding
import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Module 101 §3.5.13/§3.5.15 — the ViewModel's cc-ack consumption: a resume_ack
 * authoritatively dismisses the matching 引导卡, a feedback_ack confirms the
 * mark, and a failed send honestly degrades (restore card / revert mark).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PdhChatViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var session: PdhAgentSession
    private lateinit var events: MutableSharedFlow<PdhAgentEvent>
    private lateinit var context: android.content.Context
    private lateinit var tmpDir: java.io.File

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        events = MutableSharedFlow(extraBufferCapacity = 64)
        session = mockk(relaxed = true)
        every { session.events } returns events
        coEvery { session.start(any()) } returns Result.success(Unit)
        // Real temp filesDir so chat-history persist/restore has somewhere to write.
        tmpDir = java.io.File.createTempFile("pdhchat", "").apply { delete(); mkdirs() }
        context = mockk(relaxed = true)
        every { context.filesDir } returns tmpDir
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        tmpDir.deleteRecursively()
    }

    /** Build the VM and let its init (start + event collector) settle. */
    private fun newVm(): PdhChatViewModel {
        // Inject the test dispatcher as @IoDispatcher so init's file IO runs on the
        // test scheduler → advanceUntilIdle deterministically drains it.
        val vm = PdhChatViewModel(session, context, dispatcher)
        dispatcher.scheduler.advanceUntilIdle() // start() + IO + subscribe to events
        return vm
    }

    private suspend fun emit(ev: PdhAgentEvent) {
        events.emit(ev)
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun guide(token: String?) = PdhAgentEvent.AssistRequired(
        instruction = "先登录微博", deepLink = null, resumeToken = token, reason = null,
    )

    @Test
    fun resume_ack_dismisses_the_matching_guide_card() = runTest(dispatcher) {
        val vm = newVm()
        emit(guide("rt-1"))
        emit(guide("rt-2"))
        assertEquals(2, vm.uiState.value.pendingCards.size)

        emit(PdhAgentEvent.ResumeAck(token = "rt-1", action = "completed"))

        val cards = vm.uiState.value.pendingCards
        assertEquals(1, cards.size)
        assertTrue(cards.single() is PdhChatViewModel.TrustCard.Guide)
        assertEquals("rt-2", (cards.single() as PdhChatViewModel.TrustCard.Guide).resumeToken)
    }

    @Test
    fun resume_ack_without_token_clears_all_guide_cards() = runTest(dispatcher) {
        val vm = newVm()
        emit(guide("rt-1"))
        emit(guide(null)) // a Guide whose id is a random UUID (no token)
        assertEquals(2, vm.uiState.value.pendingCards.size)

        emit(PdhAgentEvent.ResumeAck(token = null, action = "skip"))

        assertTrue(vm.uiState.value.pendingCards.none { it is PdhChatViewModel.TrustCard.Guide })
    }

    @Test
    fun skipGuide_failed_send_restores_the_card_and_sets_error() = runTest(dispatcher) {
        coEvery { session.sendResume(any(), any()) } returns false
        val vm = newVm()
        emit(guide("rt-1"))

        vm.skipGuide("rt-1")
        advanceUntilIdle()

        val cards = vm.uiState.value.pendingCards
        assertEquals(1, cards.size) // optimistically removed, then restored
        assertEquals("rt-1", (cards.single() as PdhChatViewModel.TrustCard.Guide).resumeToken)
        assertTrue(vm.uiState.value.error?.contains("失败") == true)
    }

    @Test
    fun completeGuide_successful_send_keeps_card_dismissed() = runTest(dispatcher) {
        coEvery { session.sendResume(any(), any()) } returns true
        val vm = newVm()
        emit(guide("rt-1"))

        vm.completeGuide("rt-1")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.pendingCards.isEmpty())
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun feedback_ack_marks_the_target_message() = runTest(dispatcher) {
        val vm = newVm()
        emit(PdhAgentEvent.Result(text = "已采集 100 条", isError = false))
        val msgId = vm.uiState.value.messages.last { it.role == PdhChatViewModel.Role.ASSISTANT }.id

        emit(PdhAgentEvent.FeedbackAck(turnId = msgId, kind = "positive"))

        val marked = vm.uiState.value.messages.first { it.id == msgId }
        assertEquals(FeedbackKind.POSITIVE, marked.feedback)
    }

    @Test
    fun thumbDown_failed_send_reverts_the_optimistic_mark() = runTest(dispatcher) {
        coEvery { session.sendFeedback(any(), any(), any()) } returns false
        val vm = newVm()
        emit(PdhAgentEvent.Result(text = "回答", isError = false))
        val msgId = vm.uiState.value.messages.last { it.role == PdhChatViewModel.Role.ASSISTANT }.id

        vm.thumbDown(msgId)
        advanceUntilIdle()

        val msg = vm.uiState.value.messages.first { it.id == msgId }
        assertNull(msg.feedback) // reverted
        assertTrue(vm.uiState.value.error?.contains("失败") == true)
    }

    // ── §3.5.19 首跑 onboarding ─────────────────────────────────────────────

    @Test
    fun fresh_run_shows_three_step_onboarding_with_no_root_default_sources() = runTest(dispatcher) {
        val vm = newVm() // tmpDir is empty → no history, no completion flag
        val ob = vm.uiState.value.onboarding
        assertNotNull(ob)
        assertEquals(PdhOnboarding.Step.IDENTITY, ob!!.step)
        assertEquals(setOf("system_data", "local_files"), ob.selectedSources)
    }

    @Test
    fun returning_user_with_completion_flag_skips_onboarding() = runTest(dispatcher) {
        java.io.File(tmpDir, "pdh-onboarding-done").writeText("1")
        val vm = newVm()
        assertNull(vm.uiState.value.onboarding)
        // returning user lands directly in chat (gets the 已就绪 line, not onboarding).
        assertTrue(vm.uiState.value.messages.any { it.role == PdhChatViewModel.Role.SYSTEM })
    }

    @Test
    fun next_advances_identity_to_sources_to_collect() = runTest(dispatcher) {
        val vm = newVm()
        vm.onboardingNext()
        assertEquals(PdhOnboarding.Step.SOURCES, vm.uiState.value.onboarding?.step)
        vm.onboardingNext()
        assertEquals(PdhOnboarding.Step.COLLECT, vm.uiState.value.onboarding?.step)
    }

    @Test
    fun toggle_source_removes_then_readds() = runTest(dispatcher) {
        val vm = newVm()
        vm.onboardingToggleSource("system_data")
        assertFalse(vm.uiState.value.onboarding!!.selectedSources.contains("system_data"))
        vm.onboardingToggleSource("system_data")
        assertTrue(vm.uiState.value.onboarding!!.selectedSources.contains("system_data"))
    }

    @Test
    fun skip_clears_onboarding() = runTest(dispatcher) {
        val vm = newVm()
        assertNotNull(vm.uiState.value.onboarding)
        vm.onboardingSkip()
        assertNull(vm.uiState.value.onboarding)
    }

    @Test
    fun start_collect_sends_a_prompt_naming_sources_and_finishes() = runTest(dispatcher) {
        coEvery { session.send(any()) } returns true
        val vm = newVm()
        vm.onboardingNext() // SOURCES
        vm.onboardingNext() // COLLECT
        assertEquals(PdhOnboarding.Step.COLLECT, vm.uiState.value.onboarding?.step)

        vm.onboardingStartCollect()
        advanceUntilIdle()

        assertNull(vm.uiState.value.onboarding)
        coVerify { session.send(match { it.contains("系统数据") && it.contains("全貌") }) }
    }

    // §3.5.10 接线3: the top-bar data-flow badge reflects the session's route.
    @Test
    fun init_sets_privacy_badge_from_session_route() = runTest(dispatcher) {
        every { session.currentRoute() } returns LlmRoute.CLOUD_ANDROID
        val vm = newVm()

        val badge = vm.uiState.value.privacyBadge
        assertEquals("☁️ 云", badge?.label)
        assertTrue(badge?.dataFlow?.contains("摘要") == true)
    }
}
