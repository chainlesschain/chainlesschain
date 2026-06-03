package com.chainlesschain.android.feature.familyguard.data.time

import android.os.SystemClock
import com.chainlesschain.android.feature.familyguard.domain.time.MonotonicClock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [MonotonicClock] 默认实装 (FAMILY-60): 包 [SystemClock.elapsedRealtime] —— 自开机起
 * 单调递增 (含深睡), 用户改墙钟/时区不影响。
 */
@Singleton
class SystemMonotonicClock @Inject constructor() : MonotonicClock {
    override fun elapsedRealtimeMs(): Long = SystemClock.elapsedRealtime()
}
