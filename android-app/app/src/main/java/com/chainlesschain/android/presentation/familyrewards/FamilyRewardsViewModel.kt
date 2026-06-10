package com.chainlesschain.android.presentation.familyrewards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.presentation.aistudy.Completion
import com.chainlesschain.android.presentation.aistudy.Deliverable
import com.chainlesschain.android.presentation.aistudy.DeliverableKind
import com.chainlesschain.android.presentation.aistudy.EarnContext
import com.chainlesschain.android.presentation.aistudy.PointsEngine
import com.chainlesschain.android.presentation.aistudy.PointsEvent
import com.chainlesschain.android.presentation.aistudy.PointsEventType
import com.chainlesschain.android.presentation.aistudy.PointsLedger
import com.chainlesschain.android.presentation.aistudy.RewardCatalogItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/** 一条积分历史行的 UI 投影。 */
data class RewardHistoryRow(
    val id: String,
    val label: String,
    val signedAmount: Int,
    val timestamp: Long,
)

data class FamilyRewardsUiState(
    val balance: Int = 0,
    val lifetimeEarned: Int = 0,
    val lifetimeSpent: Int = 0,
    val catalog: List<RewardCatalogItem> = emptyList(),
    val history: List<RewardHistoryRow> = emptyList(),
    /** 上一次操作的反馈 (earn/兑换成功或被拒原因)；UI 弹 snackbar 后清。 */
    val message: String? = null,
)

/**
 * M9 奖励 / 积分屏的 ViewModel。把 [PointsEngine] 纯逻辑 + [PointsLedger] (内存账本 seam)
 * 接到界面 (主文档 §3.9)。
 *
 * v0.1 演示: child DID 固定、catalog 用默认模板、earn 由"模拟完成作业"按钮触发。
 * 真实接线 (设备/后端阻塞 follow-up): earn 由 M5 任务完成自动触发、spend → M4 临时白名单
 * 实际下发、catalog 家长 CRUD、SQLCipher 持久化 + P2P 同步。
 */
@HiltViewModel
class FamilyRewardsViewModel @Inject constructor(
    private val ledger: PointsLedger,
) : ViewModel() {

    private val catalog: List<RewardCatalogItem> = defaultCatalog()
    private val _message = MutableStateFlow<String?>(null)

    val uiState: StateFlow<FamilyRewardsUiState> =
        combine(ledger.events, _message) { events, message ->
            val now = System.currentTimeMillis()
            val balance = PointsEngine.computeBalance(DEMO_CHILD_DID, events, now)
            FamilyRewardsUiState(
                balance = balance.balance,
                lifetimeEarned = balance.lifetimeEarned,
                lifetimeSpent = balance.lifetimeSpent,
                catalog = catalog,
                history = events
                    .filter { it.childDid == DEMO_CHILD_DID }
                    .sortedByDescending { it.timestamp }
                    .map { it.toRow() },
                message = message,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FamilyRewardsUiState())

    /** 演示: 模拟一次满分作业完成 → earn (经防作弊/单日上限引擎)。 */
    fun simulateHomeworkEarn(scorePct: Int = 100) = viewModelScope.launch {
        val now = System.currentTimeMillis()
        val (dayStart, dayEnd) = dayWindow(now)
        val decision = PointsEngine.decideEarn(
            childDid = DEMO_CHILD_DID,
            completion = Completion.Homework(taskId = UUID.randomUUID().toString(), scorePct = scorePct),
            reason = "完成作业（$scorePct 分）",
            context = EarnContext(
                taskAlreadyEarned = false, // 每次模拟用新 taskId
                earnedToday = ledger.earnedBetween(DEMO_CHILD_DID, dayStart, dayEnd),
            ),
            eventId = UUID.randomUUID().toString(),
            now = now,
        )
        decision.event?.let { ledger.append(it) }
        _message.update {
            when {
                decision.rejected -> decision.notes.firstOrNull() ?: "本次未获积分"
                decision.notes.isEmpty() -> "+${decision.approvedAmount} 积分"
                else -> "+${decision.approvedAmount} 积分（${decision.notes.joinToString("；")}）"
            }
        }
    }

    /** 兑换目录项 (经余额/上限引擎校验)。 */
    fun redeem(item: RewardCatalogItem) = viewModelScope.launch {
        val now = System.currentTimeMillis()
        val (dayStart, dayEnd) = dayWindow(now)
        val balance = ledger.balanceOf(DEMO_CHILD_DID, now).balance
        val decision = PointsEngine.decideSpend(
            childDid = DEMO_CHILD_DID,
            item = item,
            balance = balance,
            redeemedTodayForItem = ledger.redeemCountBetween(DEMO_CHILD_DID, item.id, dayStart, dayEnd),
            eventId = UUID.randomUUID().toString(),
            now = now,
        )
        decision.event?.let { ledger.append(it) }
        _message.update { decision.reason }
    }

    fun consumeMessage() = _message.update { null }

    private fun PointsEvent.toRow(): RewardHistoryRow {
        val sign = if (amount >= 0) "+" else ""
        val tag = when (type) {
            PointsEventType.EARN -> "赚取"
            PointsEventType.SPEND -> "兑换"
            PointsEventType.GRANT -> "家长发放"
            PointsEventType.REVOKE -> "扣回"
            PointsEventType.EXPIRE -> "过期"
        }
        return RewardHistoryRow(
            id = id,
            label = "[$tag] $reason",
            signedAmount = amount,
            timestamp = timestamp,
        )
    }

    private fun dayWindow(now: Long): Pair<Long, Long> {
        val dayStart = now - (now % DAY_MS)
        return dayStart to (dayStart + DAY_MS)
    }

    private fun defaultCatalog(): List<RewardCatalogItem> {
        val now = System.currentTimeMillis()
        fun item(id: String, name: String, cost: Int, deliverable: Deliverable, maxPerDay: Int) =
            RewardCatalogItem(
                id = id,
                familyGroupId = DEMO_GROUP_ID,
                name = name,
                cost = cost,
                deliverable = deliverable,
                maxPerDay = maxPerDay,
                createdBy = DEMO_PARENT_DID,
                createdAt = now,
            )
        return listOf(
            item("r-game-30", "额外 30 分钟游戏", 50, Deliverable(DeliverableKind.SCREEN_TIME_MIN, 30), 1),
            item("r-bili-60", "解锁 B 站 1 小时", 30, Deliverable(DeliverableKind.APP_UNLOCK, 60, listOf("tv.danmaku.bili")), 1),
            item("r-bedtime-30", "推迟睡觉 30 分钟", 60, Deliverable(DeliverableKind.DELAYED_BEDTIME_MIN, 30), 1),
            item("r-movie", "全家电影夜", 200, Deliverable(DeliverableKind.FAMILY_ACTIVITY), 0),
            item("r-cash-10", "10 元零花钱", 100, Deliverable(DeliverableKind.CASH, 10), 0),
        )
    }

    private companion object {
        const val DEMO_CHILD_DID = "did:chain:local-child"
        const val DEMO_GROUP_ID = "local-family"
        const val DEMO_PARENT_DID = "did:chain:local-parent"
        const val DAY_MS = 86_400_000L
    }
}
