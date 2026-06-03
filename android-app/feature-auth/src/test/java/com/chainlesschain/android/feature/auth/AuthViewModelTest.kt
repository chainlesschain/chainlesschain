package com.chainlesschain.android.feature.auth

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.auth.data.biometric.BiometricAuthenticator
import com.chainlesschain.android.feature.auth.data.repository.AuthRepository
import com.chainlesschain.android.feature.auth.domain.model.User
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * AuthViewModel单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {

    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var viewModel: AuthViewModel
    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val biometricAuthenticator = mockk<BiometricAuthenticator>(relaxed = true)

    private val testUser = User(
        id = "test-user-id",
        deviceId = "test-device-id",
        biometricEnabled = false
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        // 默认Mock行为
        coEvery { authRepository.isSetupComplete() } returns false
        coEvery { biometricAuthenticator.isBiometricAvailable() } returns
                BiometricAuthenticator.BiometricAvailability.Available

        viewModel = AuthViewModel(authRepository, biometricAuthenticator)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state should be unauthenticated`() = runTest {
        // Given - setup已完成

        // When - 获取初始状态
        val state = viewModel.uiState.first()

        // Then - 应该是未认证状态
        assertFalse(state.isAuthenticated)
        assertFalse(state.isLoading)
    }

    @Test
    fun `setupPIN with valid PIN should succeed`() = runTest {
        // Given
        val pin = "123456"
        coEvery { authRepository.register(pin) } returns Result.Success(testUser)

        // When
        viewModel.setupPIN(pin)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertTrue(state.isAuthenticated)
        assertTrue(state.isSetupComplete)
        assertEquals(testUser, state.currentUser)
        coVerify { authRepository.register(pin) }
    }

    @Test
    fun `setupPIN with invalid PIN length should show error`() = runTest {
        // Given
        val invalidPin = "123"

        // When
        viewModel.setupPIN(invalidPin)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertFalse(state.isAuthenticated)
        assertEquals("PIN码必须是6位数字", state.error)
    }

    @Test
    fun `verifyPIN with correct PIN should succeed`() = runTest {
        // Given
        val pin = "123456"
        coEvery { authRepository.verifyPIN(pin) } returns Result.Success(testUser)

        // When
        viewModel.verifyPIN(pin)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertTrue(state.isAuthenticated)
        assertEquals(testUser, state.currentUser)
        coVerify { authRepository.verifyPIN(pin) }
    }

    @Test
    fun `verifyPIN with incorrect PIN should show error`() = runTest {
        // Given
        val pin = "123456"
        coEvery { authRepository.verifyPIN(pin) } returns
                Result.Error(IllegalArgumentException(), "PIN码错误")

        // When
        viewModel.verifyPIN(pin)
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertFalse(state.isAuthenticated)
        assertEquals("PIN码错误", state.error)
        assertEquals(1, state.pinAttempts)
    }

    @Test
    fun `clearError should remove error message`() = runTest {
        // Given - 先设置一个错误
        viewModel.setupPIN("123") // 无效PIN
        testDispatcher.scheduler.advanceUntilIdle()

        // When
        viewModel.clearError()
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertEquals(null, state.error)
    }

    @Test
    fun `logout should clear authentication state`() = runTest {
        // Given - 先登录
        coEvery { authRepository.verifyPIN("123456") } returns Result.Success(testUser)
        viewModel.verifyPIN("123456")
        testDispatcher.scheduler.advanceUntilIdle()

        // When - 退出登录
        viewModel.logout()
        testDispatcher.scheduler.advanceUntilIdle()

        // Then
        val state = viewModel.uiState.first()
        assertFalse(state.isAuthenticated)
        assertFalse(state.isSetupComplete)
        coVerify { authRepository.logout() }
    }
}
