package com.chainlesschain.android.capture.share

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 内存中的 Shared Inbox 队列：保存 [ShareReceiverActivity] 解析出来的 [SharePayload]，
 * 等待 SyncCoordinator 在下一次 30s push 循环中把它们推送到桌面 KB。
 *
 * v1.0 设计简化（D-share 范围）：
 *  - 仅内存存储；进程被杀则队列丢失（用户在 ShareSheet 选 ChainlessChain 后通常立即查看，
 *    长存留风险低）
 *  - 上限 [MAX_ENTRIES]，超出时丢弃最旧条目（FIFO 滑动窗口）
 *  - 线程安全通过 [MutableStateFlow] 的 update lambda 保证原子
 *
 * v1.1 计划：升级为 Room 落盘，配合 SyncCoordinator 做 cursor 推进。
 */
@Singleton
class SharedInboxRepository @Inject constructor() {

    private val _entries = MutableStateFlow<List<SharePayload>>(emptyList())
    val entries: StateFlow<List<SharePayload>> = _entries.asStateFlow()

    /** 当前队列长度。 */
    fun size(): Int = _entries.value.size

    /**
     * 入队。若入队后超过 [MAX_ENTRIES]，则丢弃头部最旧条目以保持上限。
     *
     * @return 入队后队列的实际大小
     */
    fun enqueue(payload: SharePayload): Int {
        var newSize = -1
        _entries.update { current ->
            val appended = current + payload
            val trimmed = if (appended.size > MAX_ENTRIES) {
                appended.takeLast(MAX_ENTRIES)
            } else {
                appended
            }
            newSize = trimmed.size
            trimmed
        }
        return newSize
    }

    /** 取出并清空所有 entry（供 SyncCoordinator 调用）。 */
    fun drain(): List<SharePayload> {
        var snapshot: List<SharePayload> = emptyList()
        _entries.update { current ->
            snapshot = current
            emptyList()
        }
        return snapshot
    }

    /** 仅清空，不返回（测试 / 用户主动清理）。 */
    fun clear() {
        _entries.value = emptyList()
    }

    companion object {
        /** 队列上限。超出时丢弃最旧（FIFO 滑动窗口）。 */
        const val MAX_ENTRIES = 200
    }
}
