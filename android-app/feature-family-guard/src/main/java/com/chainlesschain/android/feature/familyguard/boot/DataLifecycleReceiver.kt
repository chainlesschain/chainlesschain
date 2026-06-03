package com.chainlesschain.android.feature.familyguard.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.chainlesschain.android.feature.familyguard.data.lifecycle.DataLifecycleCleaner
import com.chainlesschain.android.feature.familyguard.data.lifecycle.DataLifecycleScheduler
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 数据生命周期清理日 alarm 的 receiver (FAMILY-28).
 *
 * [DataLifecycleScheduler] 每日 ~03:00 内部 alarm 触发 → 跑 [DataLifecycleCleaner.cleanOnce]
 * (主文档 §4.6 表删 + audit log 写入)。仅 self 发送, exported=false。cleaner 走 IO 协程,
 * goAsync 让广播保持 alive 直到完成 (清理 DELETE 通常 < 1s)。
 */
@AndroidEntryPoint
class DataLifecycleReceiver : BroadcastReceiver() {

    @Inject lateinit var cleaner: DataLifecycleCleaner

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DataLifecycleScheduler.ACTION_CLEANUP) return
        Timber.i("DataLifecycleReceiver fired")

        val pendingResult = goAsync()
        scope.launch {
            try {
                val report = cleaner.cleanOnce(System.currentTimeMillis())
                Timber.i("DataLifecycleReceiver cleanup: $report")
            } catch (e: Exception) {
                Timber.e(e, "DataLifecycleReceiver cleanup failed")
            } finally {
                pendingResult.finish()
            }
        }
    }
}
