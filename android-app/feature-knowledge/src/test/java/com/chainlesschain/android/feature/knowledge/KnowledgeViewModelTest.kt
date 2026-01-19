package com.chainlesschain.android.feature.knowledge

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import androidx.paging.PagingData
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeItem
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType
import com.chainlesschain.android.feature.knowledge.domain.model.SyncStatus
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeViewModel
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
 * KnowledgeViewModel单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class KnowledgeViewModelTest {

    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var viewModel: KnowledgeViewModel
    private val repository = mockk<KnowledgeRepository>(relaxed = true)

    private val testItem = KnowledgeItem(
        id = "test-id",
        title = "测试标题",
        content = "# 测试内容\n\n这是一个测试。",
        type = KnowledgeType.NOTE,
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis(),
        deviceId = "test-device",
        tags = listOf("测试", "笔记"),
        syncStatus = SyncStatus.PENDING
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        // 默认Mock行为
        coEvery { repository.getItems() } returns flowOf(PagingData.empty())

        viewModel = KnowledgeViewModel(repository)
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
        assertEquals("", state.searchQuery)
        assertEquals(null, state.error)
    }

    @Test
    fun `createItem with valid data should succeed`() = runTest {
        // Given
        val title = "新笔记"
        val content = "内容"
        coEvery {
            repository.createItem(
                any(), any(), any(), any(), any(), any()
            )
        } returns Result.success(testItem)

        // When
        viewModel.createItem(title, content)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertTrue(state.operationSuccess)
        assertEquals("创建成功", state.successMessage)
        coVerify {
            repository.createItem(
                title = title,
                content = content,
                type = KnowledgeType.NOTE,
                folderId = null,
                tags = emptyList(),
                deviceId = any()
            )
        }
    }

    @Test
    fun `createItem with empty title should show error`() = runTest {
        // When
        viewModel.createItem("", "内容")
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertEquals("标题不能为空", state.error)
        assertFalse(state.operationSuccess)
    }

    @Test
    fun `updateItem should call repository`() = runTest {
        // Given
        val id = "test-id"
        val title = "更新标题"
        val content = "更新内容"
        coEvery { repository.updateItem(id, title, content, any()) } returns Result.success(Unit)

        // When
        viewModel.updateItem(id, title, content)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertTrue(viewModel.uiState.first().operationSuccess)
        coVerify { repository.updateItem(id, title, content, emptyList()) }
    }

    @Test
    fun `deleteItem should call repository`() = runTest {
        // Given
        val id = "test-id"
        coEvery { repository.deleteItem(id) } returns Result.success(Unit)

        // When
        viewModel.deleteItem(id)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertTrue(viewModel.uiState.first().operationSuccess)
        coVerify { repository.deleteItem(id) }
    }

    @Test
    fun `searchKnowledge should update search query`() = runTest {
        // Given
        val query = "测试搜索"
        coEvery { repository.searchItems(query) } returns flowOf(PagingData.empty())

        // When
        viewModel.searchKnowledge(query)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertEquals(query, viewModel.uiState.first().searchQuery)
    }

    @Test
    fun `clearSearch should reset query`() = runTest {
        // Given
        viewModel.searchKnowledge("test")
        testDispatcher.scheduler.advanceUntilIdle()

        // When
        viewModel.clearSearch()
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertEquals("", viewModel.uiState.first().searchQuery)
    }

    @Test
    fun `toggleFavorite should call repository`() = runTest {
        // Given
        val id = "test-id"
        coEvery { repository.toggleFavorite(id) } returns Result.success(Unit)

        // When
        viewModel.toggleFavorite(id)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        coVerify { repository.toggleFavorite(id) }
    }

    @Test
    fun `clearError should remove error message`() = runTest {
        // Given - 触发错误
        viewModel.createItem("", "content")
        testDispatcher.scheduler.advanceUntilIdle()

        // When
        viewModel.clearError()
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        assertEquals(null, viewModel.uiState.first().error)
    }
}
