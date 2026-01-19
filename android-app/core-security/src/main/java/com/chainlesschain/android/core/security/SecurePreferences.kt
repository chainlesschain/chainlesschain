package com.chainlesschain.android.core.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 安全偏好设置（加密存储）
 *
 * 使用EncryptedSharedPreferences存储敏感数据
 * - API Keys
 * - Tokens
 * - 其他敏感配置
 */
@Singleton
class SecurePreferences @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val masterKey: MasterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val encryptedPrefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        PREFS_FILENAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    companion object {
        private const val PREFS_FILENAME = "chainlesschain_secure_prefs"

        // Keys
        private const val KEY_OPENAI_API_KEY = "openai_api_key"
        private const val KEY_DEEPSEEK_API_KEY = "deepseek_api_key"
        private const val KEY_CUSTOM_API_KEY = "custom_api_key"
        private const val KEY_CUSTOM_API_ENDPOINT = "custom_api_endpoint"
    }

    /**
     * 保存OpenAI API Key
     */
    fun saveOpenAIApiKey(apiKey: String) {
        encryptedPrefs.edit()
            .putString(KEY_OPENAI_API_KEY, apiKey)
            .apply()
    }

    /**
     * 获取OpenAI API Key
     */
    fun getOpenAIApiKey(): String? {
        return encryptedPrefs.getString(KEY_OPENAI_API_KEY, null)
    }

    /**
     * 保存DeepSeek API Key
     */
    fun saveDeepSeekApiKey(apiKey: String) {
        encryptedPrefs.edit()
            .putString(KEY_DEEPSEEK_API_KEY, apiKey)
            .apply()
    }

    /**
     * 获取DeepSeek API Key
     */
    fun getDeepSeekApiKey(): String? {
        return encryptedPrefs.getString(KEY_DEEPSEEK_API_KEY, null)
    }

    /**
     * 保存自定义API Key
     */
    fun saveCustomApiKey(apiKey: String) {
        encryptedPrefs.edit()
            .putString(KEY_CUSTOM_API_KEY, apiKey)
            .apply()
    }

    /**
     * 获取自定义API Key
     */
    fun getCustomApiKey(): String? {
        return encryptedPrefs.getString(KEY_CUSTOM_API_KEY, null)
    }

    /**
     * 保存自定义API端点
     */
    fun saveCustomApiEndpoint(endpoint: String) {
        encryptedPrefs.edit()
            .putString(KEY_CUSTOM_API_ENDPOINT, endpoint)
            .apply()
    }

    /**
     * 获取自定义API端点
     */
    fun getCustomApiEndpoint(): String? {
        return encryptedPrefs.getString(KEY_CUSTOM_API_ENDPOINT, null)
    }

    /**
     * 根据提供商获取API Key
     */
    fun getApiKeyForProvider(provider: String): String? {
        return when (provider.uppercase()) {
            "OPENAI" -> getOpenAIApiKey()
            "DEEPSEEK" -> getDeepSeekApiKey()
            "CUSTOM" -> getCustomApiKey()
            else -> null
        }
    }

    /**
     * 根据提供商保存API Key
     */
    fun saveApiKeyForProvider(provider: String, apiKey: String) {
        when (provider.uppercase()) {
            "OPENAI" -> saveOpenAIApiKey(apiKey)
            "DEEPSEEK" -> saveDeepSeekApiKey(apiKey)
            "CUSTOM" -> saveCustomApiKey(apiKey)
        }
    }

    /**
     * 删除所有API Keys
     */
    fun clearAllApiKeys() {
        encryptedPrefs.edit()
            .remove(KEY_OPENAI_API_KEY)
            .remove(KEY_DEEPSEEK_API_KEY)
            .remove(KEY_CUSTOM_API_KEY)
            .remove(KEY_CUSTOM_API_ENDPOINT)
            .apply()
    }

    /**
     * 检查是否有已保存的API Key
     */
    fun hasApiKeyForProvider(provider: String): Boolean {
        return getApiKeyForProvider(provider)?.isNotEmpty() == true
    }
}
