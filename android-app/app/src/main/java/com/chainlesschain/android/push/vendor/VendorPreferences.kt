package com.chainlesschain.android.push.vendor

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 P1：用户 push vendor 偏好持久化。
 *
 * 默认 null（使用 [PushVendorRegistry] auto-detect by manufacturer）；用户在 Settings
 * 可以 override 选指定 vendor（适用于小米手机想用 FCM 跨平台、或刷三方 ROM 后想强选某家
 * 等场景）。
 *
 * 同款 SharedPreferences 模式：[com.chainlesschain.android.config.TurnServerPreferences]
 * + [com.chainlesschain.android.feature.ai.data.voice.AsrEnginePreferences]。
 */
@Singleton
class VendorPreferences @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREF_NAME,
        Context.MODE_PRIVATE,
    )

    private val _userOverride = MutableStateFlow(loadOverride())
    val userOverride: StateFlow<PushVendor?> = _userOverride.asStateFlow()

    /** 用户 Settings 选择 vendor。null = 重置为 auto-detect。 */
    fun setOverride(vendor: PushVendor?) {
        _userOverride.value = vendor
        prefs.edit {
            if (vendor == null) remove(KEY_OVERRIDE)
            else putString(KEY_OVERRIDE, vendor.name)
        }
        Timber.i("VendorPreferences: override=$vendor")
    }

    private fun loadOverride(): PushVendor? {
        val name = prefs.getString(KEY_OVERRIDE, null) ?: return null
        return runCatching { PushVendor.valueOf(name) }.getOrNull()
    }

    companion object {
        private const val PREF_NAME = "vendor_push_prefs"
        private const val KEY_OVERRIDE = "user_vendor_override"
    }
}
