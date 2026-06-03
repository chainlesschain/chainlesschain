package com.chainlesschain.android.remote.offline

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
 * v1.2 prep — OfflineQueue TTL 用户可配（v1.1 follow-up，issue #19 W1 留尾）。
 *
 * v1.0 OfflineCommandQueue.OLD_COMMAND_THRESHOLD 写死 7 天。本类提供 SharedPreferences
 * 持久化的 ttlDays，[OfflineCommandQueue.cleanupOldCommands] 改读 [ttlMillis]。
 *
 * 默认 7 天（v1.0 行为兼容）；用户可在 Settings → 离线队列页 选 1d/7d/30d/custom。
 *
 * 同款模式：[com.chainlesschain.android.config.TurnServerPreferences] /
 * [com.chainlesschain.android.feature.ai.data.voice.AsrEnginePreferences]。
 */
@Singleton
class OfflineQueuePreferences @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREF_NAME,
        Context.MODE_PRIVATE,
    )

    private val _ttlDays = MutableStateFlow(loadTtlDays())
    val ttlDays: StateFlow<Int> = _ttlDays.asStateFlow()

    /** TTL 毫秒值（OfflineCommandQueue.cleanupOldCommands 用）。 */
    val ttlMillis: Long get() = _ttlDays.value.toLong() * MS_PER_DAY

    /**
     * 用户在 Settings 选择 TTL。clamp 到 [MIN_TTL_DAYS, MAX_TTL_DAYS] 防极端值。
     */
    fun setTtlDays(days: Int) {
        val clamped = days.coerceIn(MIN_TTL_DAYS, MAX_TTL_DAYS)
        _ttlDays.value = clamped
        prefs.edit { putInt(KEY_TTL_DAYS, clamped) }
        Timber.i("OfflineQueuePreferences: ttlDays=$clamped")
    }

    private fun loadTtlDays(): Int =
        prefs.getInt(KEY_TTL_DAYS, DEFAULT_TTL_DAYS).coerceIn(MIN_TTL_DAYS, MAX_TTL_DAYS)

    companion object {
        private const val PREF_NAME = "offline_queue_prefs"
        private const val KEY_TTL_DAYS = "ttl_days"
        const val DEFAULT_TTL_DAYS = 7  // v1.0 行为兼容
        const val MIN_TTL_DAYS = 1      // 防误设 0 立刻清空
        const val MAX_TTL_DAYS = 90     // 防极端长 TTL 占空间
        const val MS_PER_DAY = 24L * 60 * 60 * 1000

        /** UI Quick-pick 选项；自定义走 InputText (UI 端) */
        val QUICK_PICK_DAYS = listOf(1, 7, 14, 30)
    }
}
