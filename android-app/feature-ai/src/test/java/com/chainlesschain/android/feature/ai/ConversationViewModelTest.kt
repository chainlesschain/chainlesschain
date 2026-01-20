package com.chainlesschain.android.feature.ai

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.ai.data.rag.RAGRetriever
import com.chainlesschain.android.feature.ai.data.repository.ConversationRepository
import com.chainlesschain.android.feature.ai.domain.model.*
import com.chainlesschain.android.feature.ai.presentation.ConversationViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * ConversationViewModel单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationViewModelTest {

    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var viewModel: ConversationViewModel
    private val repository = mockk<ConversationRepository>(relaxed = true)
    private val ragRetriever = mockk<RAGRetriever>(relaxed = true)

    private val testConversation = Conversation(
        id = "test-conv-id",
        title = "测试对话",
        model = "gpt-4",
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis()
    )

    private val testMessage = Message(
        id = "test-msg-id",
        conversationId = "test-conv-id",
        role = MessageRole.USER,
        content = "你好",
        createdAt = System.currentTimeMillis()
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        // 默认Mock行为
        coEvery { repository.getAllConversations() } returns flowOf(emptyList())
        coEvery { ragRetriever.buildContext(any(), any()) } returns ""

        viewModel = ConversationViewModel(repository, ragRetriever)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state should be correct`() = runTest {
        // When - 获取初始状态
        val state = viewModel.uiState.first()

        // Then
        assertFalse(state.isLoading)
        assertFalse(state.isSending)
        assertEquals(null, state.error)
    }

    @Test
    fun `createConversation should succeed`() = runTest {
        // Given
        val title = "新对话"
        val model = "gpt-4"
        coEvery { repository.createConversation(title, model) } returns Result.success(testConversation)

        // When
        viewModel.createConversation(title, model)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertTrue(state.operationSuccess)
        assertEquals(testConversation, viewModel.currentConversation.first())
        coVerify { repository.createConversation(title, model) }
    }

    @Test
    fun `deleteConversation should call repository`() = runTest {
        // Given
        val id = "test-conv-id"
        coEvery { repository.deleteConversation(id) } returns Result.success(Unit)

        // When
        viewModel.deleteConversation(id)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertTrue(viewModel.uiState.first().operationSuccess)
        coVerify { repository.deleteConversation(id) }
    }

    @Test
    fun `loadConversation should load conversation and messages`() = runTest {
        // Given
        val id = "test-conv-id"
        coEvery { repository.getConversationById(id) } returns flowOf(testConversation)
        coEvery { repository.getMessages(id) } returns flowOf(listOf(testMessage))

        // When
        viewModel.loadConversation(id)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertEquals(testConversation, viewModel.currentConversation.first())
        assertEquals(1, viewModel.messages.first().size)
        coVerify { repository.getConversationById(id) }
        coVerify { repository.getMessages(id) }
    }

    @Test
    fun `togglePinned should call repository`() = runTest {
        // Given
        val id = "test-conv-id"
        coEvery { repository.togglePinned(id) } returns Result.success(Unit)

        // When
        viewModel.togglePinned(id)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        coVerify { repository.togglePinned(id) }
    }

    @Test
    fun `setCurrentModel should update state`() = runTest {
        // Given
        val model = LLMModel("gpt-4", "GPT-4", LLMProvider.OPENAI)

        // When
        viewModel.setCurrentModel(model)

        // Then
        assertEquals(model, viewModel.uiState.first().currentModel)
    }

    @Test
    fun `setApiKey should update state`() = runTest {
        // Given
        val model = LLMModel("gpt-4", LLMProvider.OPENAI, "GPT-4")
        val apiKey = "test-api-key"

        // First set a model (setApiKey requires currentModel to be set)
        viewModel.setCurrentModel(model)
        testDispatcher.scheduler.advanceUntilIdle()

        // When
        viewModel.setApiKey(apiKey)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertEquals(apiKey, viewModel.uiState.first().currentApiKey)
    }

    @Test
    fun `checkLLMAvailability should update state`() = runTest {
        // Given
        val provider = LLMProvider.OPENAI
        val apiKey = "test-key"
        coEvery { repository.checkLLMAvailability(provider, apiKey) } returns true

        // When
        viewModel.checkLLMAvailability(provider, apiKey)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertTrue(viewModel.uiState.first().llmAvailable)
    }

    @Test
    fun `clearError should remove error message`() = runTest {
        // Given - 先设置错误状态
        val title = "新对话"
        val model = "gpt-4"
        coEvery { repository.createConversation(title, model) } returns Result.error(Exception(), "创建失败")
        viewModel.createConversation(title, model)
        testDispatcher.scheduler.advanceUntilIdle()

        // When
        viewModel.clearError()

        // Then
        assertEquals(null, viewModel.uiState.first().error)
    }
}
