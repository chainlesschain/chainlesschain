package com.chainlesschain.android.call

import com.chainlesschain.android.core.database.dao.call.CallHistoryDao
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 [CallHistoryRecorder] 的 Room 实现（P3+）：把结束的通话写入 `call_history` 表。
 * 由 `MainActivity` 注入到 `CallManager.historyRecorder`；UI 经 [CallHistoryDao] 的 Flow 读取展示。
 */
@Singleton
class RoomCallHistoryRecorder @Inject constructor(
    private val dao: CallHistoryDao,
) : CallHistoryRecorder {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun record(session: CallSession) {
        val entity = runCatching { CallHistoryRecorder.toEntity(session) }.getOrNull() ?: return
        scope.launch {
            runCatching { dao.insert(entity) }
                .onFailure { Timber.w(it, "[CallHistory] insert failed call=${session.callId}") }
        }
    }
}
