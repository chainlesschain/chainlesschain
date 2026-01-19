package com.chainlesschain.android.feature.auth

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.security.KeyManager
import com.chainlesschain.android.feature.auth.data.repository.AuthRepository
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * AuthRepository集成测试
 *
 * 需要Android环境运行（使用AndroidJUnit4）
 */
@RunWith(AndroidJUnit4::class)
class AuthRepositoryTest {

    private lateinit var context: Context
    private lateinit var repository: AuthRepository
    private val keyManager = mockk<KeyManager>(relaxed = true)

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()

        // Mock KeyManager
        every { keyManager.getDatabaseKey() } returns "test-database-key"

        repository = AuthRepository(context, keyManager)
    }

    @Test
    fun testInitialSetupIncomplete() = runTest {
        // Given - 新安装的应用

        // When
        val isComplete = repository.isSetupComplete()

        // Then
        assertFalse(isComplete)
    }

    @Test
    fun testRegisterUser() = runTest {
        // Given
        val pin = "123456"

        // When
        val result = repository.register(pin)

        // Then
        assertTrue(result.isSuccess)
        val user = result.getOrNull()
        assertNotNull(user)
        assertTrue(user.id.isNotEmpty())
        assertTrue(user.deviceId.isNotEmpty())
        assertFalse(user.biometricEnabled)

        // 验证设置完成
        assertTrue(repository.isSetupComplete())
    }

    @Test
    fun testVerifyCorrectPIN() = runTest {
        // Given - 先注册
        val pin = "123456"
        repository.register(pin)

        // When - 验证正确PIN
        val result = repository.verifyPIN(pin)

        // Then
        assertTrue(result.isSuccess)
        assertNotNull(result.getOrNull())
    }

    @Test
    fun testVerifyIncorrectPIN() = runTest {
        // Given - 先注册
        repository.register("123456")

        // When - 验证错误PIN
        val result = repository.verifyPIN("654321")

        // Then
        assertTrue(result.isError)
        assertEquals("PIN码错误", result.exceptionOrNull()?.message)
    }

    @Test
    fun testChangePIN() = runTest {
        // Given - 先注册
        val oldPin = "123456"
        val newPin = "654321"
        repository.register(oldPin)

        // When - 修改PIN
        val changeResult = repository.changePIN(oldPin, newPin)

        // Then - 修改成功
        assertTrue(changeResult.isSuccess)

        // 验证新PIN可用
        val verifyResult = repository.verifyPIN(newPin)
        assertTrue(verifyResult.isSuccess)

        // 旧PIN不可用
        val oldPinResult = repository.verifyPIN(oldPin)
        assertTrue(oldPinResult.isError)
    }

    @Test
    fun testSetBiometricEnabled() = runTest {
        // Given - 先注册
        repository.register("123456")

        // When - 启用生物识别
        val result = repository.setBiometricEnabled(true)

        // Then
        assertTrue(result.isSuccess)

        val user = repository.getCurrentUser()
        assertNotNull(user)
        assertTrue(user.biometricEnabled)
    }

    @Test
    fun testLogout() = runTest {
        // Given - 先注册
        repository.register("123456")
        assertTrue(repository.isSetupComplete())

        // When - 退出登录
        val result = repository.logout()

        // Then
        assertTrue(result.isSuccess)
        assertFalse(repository.isSetupComplete())
    }
}
