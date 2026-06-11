package com.chainlesschain.android.presentation.mistakebook

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.presentation.aistudy.Completion
import com.chainlesschain.android.presentation.aistudy.EarnContext
import com.chainlesschain.android.presentation.aistudy.MistakeBook
import com.chainlesschain.android.presentation.aistudy.MistakeEntry
import com.chainlesschain.android.presentation.aistudy.PointsEngine
import com.chainlesschain.android.presentation.aistudy.PointsLedger
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/** 错题本复习的每日目标 (满 N 题给分, 与 EarnRules.mistakeReview5 对齐)。 */
const val REVIEW_DAILY_TARGET = 5

data class MistakeBookUiState(
    val entries: List<MistakeEntry> = emptyList(),
    /** 今日已复习条数 (同一条当日多次只计一次)。 */
    val reviewedToday: Int = 0,
    val message: String? = null,
)

/**
 * M6 错题本屏的 ViewModel (主文档 §3.6 间隔重复 + §3.9 复习赚分)。
 *
 * 激活两个此前 dormant 的引擎能力: [MistakeBook.markReviewed] (间隔重复打点,
 * 此前无 UI 入口) 与 [Completion.MistakeReview] (复习满 5 题 +8 分, 此前无人构造)。
 * 赚分走 [PointsEngine.decideEarn] 全管线; **按日去重**: taskId = "mistake-review-<日起点>",
 * 账本 hasEarnedForTask 保证一天只发一次 (重启/反复复习不重复发)。
 */
@HiltViewModel
class MistakeBookViewModel @Inject constructor(
    private val mistakeBook: MistakeBook,
    private val ledger: PointsLedger,
) : ViewModel() {

    private val _message = MutableStateFlow<String?>(null)

    val uiState: StateFlow<MistakeBookUiState> =
        combine(mistakeBook.entries, _message) { entries, message ->
            MistakeBookUiState(
                // 间隔重复排序: 复习少的在前, 同次数老错题在前。
                entries = entries.sortedWith(compareBy({ it.reviewCount }, { it.createdAt })),
                reviewedToday = countReviewedToday(entries, System.currentTimeMillis()),
                message = message,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), MistakeBookUiState())

    /** 复习一条: 打点 + 满 5 题触发赚分 (按日去重)。返回 Job 便于测试 join。 */
    fun review(id: String) = viewModelScope.launch {
        val now = System.currentTimeMillis()
        mistakeBook.markReviewed(id, now)
        val reviewed = countReviewedToday(mistakeBook.snapshot(), now)
        if (reviewed >= REVIEW_DAILY_TARGET) {
            awardReviewPoints(reviewed, now)
        } else {
            _message.update { "已复习（今日 $reviewed/$REVIEW_DAILY_TARGET）" }
        }
    }

    /** §4.6: 错题本永久保留、仅用户主动删 — 这是那个"主动删"入口。 */
    fun remove(id: String) {
        mistakeBook.remove(id)
        _message.update { "已删除" }
    }

    fun consumeMessage() = _message.update { null }

    private suspend fun awardReviewPoints(count: Int, now: Long) {
        val dayStart = now - (now % DAY_MS)
        val taskId = "mistake-review-$dayStart" // 按日去重: 同日重复触发被 hasEarnedForTask 拒
        val decision = PointsEngine.decideEarn(
            childDid = DEMO_CHILD_DID,
            completion = Completion.MistakeReview(taskId = taskId, count = count),
            reason = "错题本复习满 $REVIEW_DAILY_TARGET 题",
            context = EarnContext(
                taskAlreadyEarned = ledger.hasEarnedForTask(DEMO_CHILD_DID, taskId),
                earnedToday = ledger.earnedBetween(DEMO_CHILD_DID, dayStart, dayStart + DAY_MS),
            ),
            eventId = UUID.randomUUID().toString(),
            now = now,
        )
        decision.event?.let { ledger.append(it) }
        _message.update {
            if (decision.rejected) "已复习（今日 $count 题）" else "复习达标 +${decision.approvedAmount} 积分！"
        }
    }

    private fun countReviewedToday(entries: List<MistakeEntry>, now: Long): Int {
        val dayStart = now - (now % DAY_MS)
        return entries.count { (it.lastReviewedAt ?: 0L) >= dayStart }
    }

    private companion object {
        const val DAY_MS = 86_400_000L
        const val DEMO_CHILD_DID = "did:chain:local-child"
    }
}
