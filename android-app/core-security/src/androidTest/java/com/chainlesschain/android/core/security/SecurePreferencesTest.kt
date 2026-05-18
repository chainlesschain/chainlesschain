package com.chainlesschain.android.core.security

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * SecurePreferences单元测试
 *
 * 测试API Key的加密存储功能
 */
@RunWith(AndroidJUnit4::class)
class SecurePreferencesTest {

    private lateinit var securePreferences: SecurePreferences
    private lateinit var context: Context

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        securePreferences = SecurePreferences(context)

        // 清除所有数据
        securePreferences.clearAllApiKeys()
    }

    @After
    fun tearDown() {
        securePreferences.clearAllApiKeys()
    }

    @Test
    fun `saveOpenAIApiKey should store API key`() {
        // Given
        val apiKey = "sk-test-12345"

        // When
        securePreferences.saveOpenAIApiKey(apiKey)

        // Then
        val retrieved = securePreferences.getOpenAIApiKey()
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `getOpenAIApiKey should return null when not set`() {
        // When
        val apiKey = securePreferences.getOpenAIApiKey()

        // Then
        assertNull(apiKey)
    }

    @Test
    fun `saveDeepSeekApiKey should store API key`() {
        // Given
        val apiKey = "ds-test-67890"

        // When
        securePreferences.saveDeepSeekApiKey(apiKey)

        // Then
        val retrieved = securePreferences.getDeepSeekApiKey()
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `saveCustomApiKey should store API key`() {
        // Given
        val apiKey = "custom-api-key"

        // When
        securePreferences.saveCustomApiKey(apiKey)

        // Then
        val retrieved = securePreferences.getCustomApiKey()
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `saveCustomApiEndpoint should store endpoint`() {
        // Given
        val endpoint = "https://custom-api.example.com"

        // When
        securePreferences.saveCustomApiEndpoint(endpoint)

        // Then
        val retrieved = securePreferences.getCustomApiEndpoint()
        assertEquals(endpoint, retrieved)
    }

    @Test
    fun `getApiKeyForProvider should return correct key for OPENAI`() {
        // Given
        val apiKey = "sk-openai-test"
        securePreferences.saveOpenAIApiKey(apiKey)

        // When
        val retrieved = securePreferences.getApiKeyForProvider("OPENAI")

        // Then
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `getApiKeyForProvider should return correct key for DEEPSEEK`() {
        // Given
        val apiKey = "ds-deepseek-test"
        securePreferences.saveDeepSeekApiKey(apiKey)

        // When
        val retrieved = securePreferences.getApiKeyForProvider("DEEPSEEK")

        // Then
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `getApiKeyForProvider should return null for unknown provider`() {
        // When
        val retrieved = securePreferences.getApiKeyForProvider("UNKNOWN")

        // Then
        assertNull(retrieved)
    }

    @Test
    fun `saveApiKeyForProvider should save key for OPENAI`() {
        // Given
        val apiKey = "sk-test"

        // When
        securePreferences.saveApiKeyForProvider("OPENAI", apiKey)

        // Then
        val retrieved = securePreferences.getOpenAIApiKey()
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `saveApiKeyForProvider should save key for DEEPSEEK`() {
        // Given
        val apiKey = "ds-test"

        // When
        securePreferences.saveApiKeyForProvider("DEEPSEEK", apiKey)

        // Then
        val retrieved = securePreferences.getDeepSeekApiKey()
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `hasApiKeyForProvider should return true when key exists`() {
        // Given
        securePreferences.saveOpenAIApiKey("test-key")

        // When
        val hasKey = securePreferences.hasApiKeyForProvider("OPENAI")

        // Then
        assertTrue(hasKey)
    }

    @Test
    fun `hasApiKeyForProvider should return false when key does not exist`() {
        // When
        val hasKey = securePreferences.hasApiKeyForProvider("OPENAI")

        // Then
        assertFalse(hasKey)
    }

    @Test
    fun `hasApiKeyForProvider should return false for empty key`() {
        // Given
        securePreferences.saveOpenAIApiKey("")

        // When
        val hasKey = securePreferences.hasApiKeyForProvider("OPENAI")

        // Then
        assertFalse(hasKey)
    }

    @Test
    fun `clearAllApiKeys should remove all stored keys`() {
        // Given
        securePreferences.saveOpenAIApiKey("sk-test")
        securePreferences.saveDeepSeekApiKey("ds-test")
        securePreferences.saveCustomApiKey("custom-test")

        // When
        securePreferences.clearAllApiKeys()

        // Then
        assertNull(securePreferences.getOpenAIApiKey())
        assertNull(securePreferences.getDeepSeekApiKey())
        assertNull(securePreferences.getCustomApiKey())
        assertNull(securePreferences.getCustomApiEndpoint())
    }

    @Test
    fun `should persist keys across instance recreation`() {
        // Given
        val apiKey = "sk-persistent-test"
        securePreferences.saveOpenAIApiKey(apiKey)

        // When - create new instance
        val newInstance = SecurePreferences(context)
        val retrieved = newInstance.getOpenAIApiKey()

        // Then
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `should handle special characters in API keys`() {
        // Given
        val apiKey = "sk-test_!@#$%^&*()_+{}|:<>?-=[]\\;',./~`"

        // When
        securePreferences.saveOpenAIApiKey(apiKey)
        val retrieved = securePreferences.getOpenAIApiKey()

        // Then
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `should handle long API keys`() {
        // Given
        val apiKey = "a".repeat(500)

        // When
        securePreferences.saveOpenAIApiKey(apiKey)
        val retrieved = securePreferences.getOpenAIApiKey()

        // Then
        assertEquals(apiKey, retrieved)
    }

    @Test
    fun `provider names should be case insensitive`() {
        // Given
        val apiKey = "test-key"
        securePreferences.saveApiKeyForProvider("openai", apiKey)

        // When
        val retrieved1 = securePreferences.getApiKeyForProvider("OPENAI")
        val retrieved2 = securePreferences.getApiKeyForProvider("openai")
        val retrieved3 = securePreferences.getApiKeyForProvider("OpenAI")

        // Then
        assertEquals(apiKey, retrieved1)
        assertEquals(apiKey, retrieved2)
        assertEquals(apiKey, retrieved3)
    }
}
