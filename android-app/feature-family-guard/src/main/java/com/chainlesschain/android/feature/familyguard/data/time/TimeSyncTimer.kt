package com.chainlesschain.android.feature.familyguard.data.time

import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 权威时间周期同步定时器 (FAMILY-60). 主文档 §3.4 "每 30min 从家长端拉一次时间"。
 *
 * 每 [SYNC_INTERVAL_MS] 调一次 [TimeAuthority.sync] (经 ParentTimeSource 拉家长端 epoch
 * + Cristian 锚定到单调钟)。家长端不可达时 sync() 返 false, 锚点不变, 下个周期再试。
 *
 * 无独立 service —— 由常驻
 * [com.chainlesschain.android.feature.familyguard.service.FamilyGuardForegroundService]
 * onCreate [start] / onDestroy [stop] 托管 (同 [com.chainlesschain.android.feature.familyguard.data.anomaly.AnomalyScanTimer]
 * / ForegroundAppTimer 模式)。
 *
 * [syncOnce] 提 public suspend 便单测直驱单次同步 (不经 while-delay 生产协程, 避开
 * [[android_runtest_production_scope_hang]])。
 */
@Singleton
class TimeSyncTimer @Inject constructor(
    private val timeAuthority: TimeAuthority,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var job: Job? = null

    @Synchronized
    fun start() {
        if (job?.isActive == true) return // 幂等
        job = scope.launch {
            while (isActive) {
                runCatching { syncOnce() }
                    .onFailure { Timber.w(it, "time sync failed") }
                delay(SYNC_INTERVAL_MS)
            }
        }
    }

    @Synchronized
    fun stop() {
        job?.cancel()
        job = null
    }

    /** 单次同步 (public 供单测直驱)。@return true 同步成功并更新锚点; false 家长端不可达。 */
    suspend fun syncOnce(): Boolean = timeAuthority.sync()

    companion object {
        /** 同步周期 (主文档 §3.4: 30min)。 */
        const val SYNC_INTERVAL_MS = 30L * 60 * 1000
    }
}
