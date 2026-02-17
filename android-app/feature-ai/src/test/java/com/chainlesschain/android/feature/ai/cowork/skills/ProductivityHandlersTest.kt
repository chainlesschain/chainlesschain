package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.handler.*
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import io.mockk.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for the 5 productivity skill handlers:
 * QuickNote, EmailDraft, MeetingNotes, DailyPlanner, TextImprover.
 */
class ProductivityHandlersTest {

    private lateinit var mockLlmAdapter: LLMAdapter
    private val model = "qwen2:7b"

    @Before
    fun setUp() {
        mockLlmAdapter = mockk()
    }

    // ===== QuickNoteHandler =====

    @Test
    fun `QuickNoteHandler returns categorized note`() = runBlocking {
        val handler = QuickNoteHandler()
        assertEquals("quick-note", handler.skillName)

        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns
            "## Category\ntask\n\n## Tags\nmeeting, budget\n\n## Summary\nMeeting about budget\n\n## Note\nMeeting with Bob at 3pm about Q3 budget"

        val result = handler.execute(
            mapOf("text" to "Meeting with Bob at 3pm about Q3 budget"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertTrue(result.output.contains("Category"))
        assertTrue(result.output.contains("Tags"))
        coVerify { mockLlmAdapter.chat(any(), any(), any(), any()) }
    }

    @Test
    fun `QuickNoteHandler accepts input key`() = runBlocking {
        val handler = QuickNoteHandler()
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "Note organized"

        val result = handler.execute(
            mapOf("input" to "Build a habit tracker"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
    }

    @Test
    fun `QuickNoteHandler uses category hint`() = runBlocking {
        val handler = QuickNoteHandler()
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "Categorized as idea"

        val result = handler.execute(
            mapOf("text" to "New app concept", "category" to "idea"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        // Verify system prompt includes category hint
        coVerify {
            mockLlmAdapter.chat(match { messages ->
                messages.any { it.content.contains("idea") && it.role.value == "system" }
            }, any(), any(), any())
        }
    }

    @Test
    fun `QuickNoteHandler returns error when no text`() = runBlocking {
        val handler = QuickNoteHandler()
        val result = handler.execute(emptyMap(), mockLlmAdapter, model)

        assertFalse(result.success)
        assertTrue(result.error!!.contains("No note content"))
    }

    // ===== EmailDraftHandler =====

    @Test
    fun `EmailDraftHandler returns email with subject`() = runBlocking {
        val handler = EmailDraftHandler()
        assertEquals("email-draft", handler.skillName)

        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns
            "## Subject\nQuarterly Review Meeting\n\n## Email\nDear Bob,\n\nI'd like to invite you..."

        val result = handler.execute(
            mapOf("text" to "Invite Bob to quarterly review", "to" to "Bob", "tone" to "formal"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertTrue(result.output.contains("Subject"))
        assertEquals("formal", result.data["tone"])
    }

    @Test
    fun `EmailDraftHandler defaults tone to formal`() = runBlocking {
        val handler = EmailDraftHandler()
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "Email draft"

        val result = handler.execute(
            mapOf("text" to "Thanks for help"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertEquals("formal", result.data["tone"])
    }

    @Test
    fun `EmailDraftHandler supports casual tone`() = runBlocking {
        val handler = EmailDraftHandler()
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "Hey!"

        val result = handler.execute(
            mapOf("text" to "Thanks for last night", "tone" to "casual"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertEquals("casual", result.data["tone"])
    }

    @Test
    fun `EmailDraftHandler returns error when no text`() = runBlocking {
        val handler = EmailDraftHandler()
        val result = handler.execute(emptyMap(), mockLlmAdapter, model)

        assertFalse(result.success)
        assertTrue(result.error!!.contains("No email description"))
    }

    // ===== MeetingNotesHandler =====

    @Test
    fun `MeetingNotesHandler returns structured notes`() = runBlocking {
        val handler = MeetingNotesHandler()
        assertEquals("meeting-notes", handler.skillName)

        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns
            "## Attendees\n- Bob\n- Alice\n\n## Key Decisions\n- Prioritize mobile\n\n## Action Items\n- [ ] Bob: wireframes by Friday"

        val result = handler.execute(
            mapOf("text" to "Bob and Alice discussed the roadmap. Decided to prioritize mobile. Bob will create wireframes by Friday."),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertTrue(result.output.contains("Attendees"))
        assertTrue(result.output.contains("Action Items"))
    }

    @Test
    fun `MeetingNotesHandler returns error when no text`() = runBlocking {
        val handler = MeetingNotesHandler()
        val result = handler.execute(emptyMap(), mockLlmAdapter, model)

        assertFalse(result.success)
        assertTrue(result.error!!.contains("No meeting notes"))
    }

    // ===== DailyPlannerHandler =====

    @Test
    fun `DailyPlannerHandler returns prioritized plan`() = runBlocking {
        val handler = DailyPlannerHandler()
        assertEquals("daily-planner", handler.skillName)

        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns
            "## Priority Tasks\nP1: Finish API integration\nP2: Review PR\n\n## Daily Schedule\n09:00-10:30 API Integration"

        val result = handler.execute(
            mapOf("text" to "Finish API integration, review PR from Alice, gym at 6pm"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertTrue(result.output.contains("Priority"))
        assertTrue(result.output.contains("Schedule"))
    }

    @Test
    fun `DailyPlannerHandler returns error when no text`() = runBlocking {
        val handler = DailyPlannerHandler()
        val result = handler.execute(emptyMap(), mockLlmAdapter, model)

        assertFalse(result.success)
        assertTrue(result.error!!.contains("No goals or tasks"))
    }

    // ===== TextImproverHandler =====

    @Test
    fun `TextImproverHandler returns improved text with changes`() = runBlocking {
        val handler = TextImproverHandler()
        assertEquals("text-improver", handler.skillName)

        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns
            "## Improved Text\nWe need to resolve the server stability issue.\n\n## Changes Made\n- Removed filler words"

        val result = handler.execute(
            mapOf("text" to "The thing is that we need to basically figure out what to do about the server"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertTrue(result.output.contains("Improved Text"))
        assertTrue(result.output.contains("Changes Made"))
    }

    @Test
    fun `TextImproverHandler defaults style to formal`() = runBlocking {
        val handler = TextImproverHandler()
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "Improved"

        val result = handler.execute(
            mapOf("text" to "hey bob"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertEquals("formal", result.data["style"])
    }

    @Test
    fun `TextImproverHandler supports concise style`() = runBlocking {
        val handler = TextImproverHandler()
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "Concise version"

        val result = handler.execute(
            mapOf("text" to "verbose text here", "style" to "concise"),
            mockLlmAdapter,
            model
        )

        assertTrue(result.success)
        assertEquals("concise", result.data["style"])
    }

    @Test
    fun `TextImproverHandler returns error when no text`() = runBlocking {
        val handler = TextImproverHandler()
        val result = handler.execute(emptyMap(), mockLlmAdapter, model)

        assertFalse(result.success)
        assertTrue(result.error!!.contains("No text provided"))
    }
}
