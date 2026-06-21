package com.chainlesschain.android.presentation.screens.pdh

import com.chainlesschain.android.pdh.PdhAgentSession
import com.chainlesschain.android.pdh.PdhAgentSession.FeedbackKind
import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import io.mockk.coEvery
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

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        events = MutableSharedFlow(extraBufferCapacity = 64)
        session = mockk(relaxed = true)
        every { session.events } returns events
        coEvery { session.start(any()) } returns Result.success(Unit)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    /** Build the VM and let its init (start + event collector) settle. */
    private fun newVm(): PdhChatViewModel {
        val vm = PdhChatViewModel(session)
        dispatcher.scheduler.advanceUntilIdle() // start() + subscribe to events
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
}
