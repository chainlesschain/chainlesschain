package com.chainlesschain.android.presentation.familyrewards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.data.dao.EnforceRuleDao
import com.chainlesschain.android.feature.familyguard.data.dao.RewardCatalogDao
import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import com.chainlesschain.android.feature.familyguard.data.entity.RewardCatalogEntity
import com.chainlesschain.android.feature.familyguard.domain.enforce.RewardTempException
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

/** 一条生效中的临时奖励 (M9→M4 temp_exception) 的 UI 投影。 */
data class ActiveRewardRow(
    val id: Long,
    val label: String,
    /** 到期时刻 (ms); null 不显示期限。 */
    val expiresAt: Long?,
)

data class FamilyRewardsUiState(
    val balance: Int = 0,
    val lifetimeEarned: Int = 0,
    val lifetimeSpent: Int = 0,
    val catalog: List<RewardCatalogItem> = emptyList(),
    val history: List<RewardHistoryRow> = emptyList(),
    /** 生效中的临时奖励 (兑换下发的 temp_exception, 未到期)。 */
    val activeRewards: List<ActiveRewardRow> = emptyList(),
    /** 上一次操作的反馈 (earn/兑换成功或被拒原因)；UI 弹 snackbar 后清。 */
    val message: String? = null,
)

/**
 * M9 奖励 / 积分屏的 ViewModel。把 [PointsEngine] 纯逻辑 + [PointsLedger] (Room 真持久账本)
 * + reward_catalog (家长 CRUD, Room 真持久) 接到界面 (主文档 §3.9)。
 *
 * v0.3: catalog 从 family_guard.db reward_catalog 读 (首跑空表自动种默认 5 项, 固定 id
 * 幂等); 家长可 [addCatalogItem]/[deactivateCatalogItem]。剩 follow-up: 配对真 child DID、
 * earn/spend P2P 同步、目录项编辑 UI 细化。
 */
@HiltViewModel
class FamilyRewardsViewModel @Inject constructor(
    private val ledger: PointsLedger,
    private val enforceRuleDao: EnforceRuleDao,
    private val catalogDao: RewardCatalogDao,
) : ViewModel() {

    private val _message = MutableStateFlow<String?>(null)

    init {
        viewModelScope.launch { seedDefaultCatalogIfEmpty() }
        viewModelScope.launch { cleanupExpired() }
    }

    /** 进屏时下线已到期临时奖励 (deactivateExpired 幂等; Epic D 定时清理是 follow-up)。 */
    internal suspend fun cleanupExpired() {
        enforceRuleDao.deactivateExpired(System.currentTimeMillis())
    }

    /** 首跑种默认目录。固定 id + upsert ⇒ 并发/重复调用幂等; 家长下架后不复活 (count>0 跳过)。 */
    internal suspend fun seedDefaultCatalogIfEmpty() {
        if (catalogDao.countForGroup(DEMO_GROUP_ID) == 0) {
            defaultCatalog().forEach { catalogDao.upsert(it.toEntity()) }
        }
    }

    val uiState: StateFlow<FamilyRewardsUiState> =
        combine(
            ledger.events,
            catalogDao.observeActiveForGroup(DEMO_GROUP_ID),
            enforceRuleDao.observeActiveNonExpired(System.currentTimeMillis()),
            _message,
        ) { events, catalogRows, ruleRows, message ->
            val now = System.currentTimeMillis()
            val balance = PointsEngine.computeBalance(DEMO_CHILD_DID, events, now)
            FamilyRewardsUiState(
                balance = balance.balance,
                lifetimeEarned = balance.lifetimeEarned,
                lifetimeSpent = balance.lifetimeSpent,
                catalog = catalogRows.mapNotNull { it.toDomain() },
                history = events
                    .filter { it.childDid == DEMO_CHILD_DID }
                    .sortedByDescending { it.timestamp }
                    .map { it.toRow() },
                activeRewards = activeRewardRows(ruleRows, now),
                message = message,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FamilyRewardsUiState())

    /** temp_exception 行 → 「生效中的奖励」UI 行 (纯映射, 过期/外类型/坏 config 过滤)。 */
    internal fun activeRewardRows(rules: List<EnforceRuleEntity>, now: Long): List<ActiveRewardRow> =
        rules
            .filter {
                it.ruleType == RewardTempException.RULE_TYPE &&
                    it.active && (it.expiresAt == null || it.expiresAt!! > now)
            }
            .mapNotNull { rule ->
                val config = RewardTempException.decodeConfig(rule.config) ?: return@mapNotNull null
                val label = when (config.kind) {
                    RewardTempException.KIND_SCREEN_TIME_MIN ->
                        "额外屏幕时间 ${config.valueMinutes} 分钟"
                    RewardTempException.KIND_APP_UNLOCK ->
                        "解锁 ${rule.target} ${config.valueMinutes} 分钟"
                    RewardTempException.KIND_DELAYED_BEDTIME_MIN ->
                        "今晚就寝推迟 ${config.valueMinutes} 分钟"
                    else -> return@mapNotNull null
                }
                ActiveRewardRow(id = rule.id, label = label, expiresAt = rule.expiresAt)
            }
            .sortedBy { it.expiresAt ?: Long.MAX_VALUE }

    /** 家长新增目录项 (CRUD 的 C; 改走同 id 再 upsert)。返回 Job 便于测试 join。 */
    fun addCatalogItem(
        name: String,
        cost: Int,
        kind: DeliverableKind,
        valueMinutes: Int,
        targetApps: List<String> = emptyList(),
        maxPerDay: Int = 0,
    ) = viewModelScope.launch {
        val trimmed = name.trim()
        if (trimmed.isBlank() || cost <= 0) {
            _message.update { "名称与积分价格不能为空" }
            return@launch
        }
        val item = RewardCatalogItem(
            id = "r-${UUID.randomUUID()}",
            familyGroupId = DEMO_GROUP_ID,
            name = trimmed,
            cost = cost,
            deliverable = Deliverable(kind, valueMinutes, targetApps),
            maxPerDay = maxPerDay,
            createdBy = DEMO_PARENT_DID,
            createdAt = System.currentTimeMillis(),
        )
        catalogDao.upsert(item.toEntity())
        _message.update { "已上架「$trimmed」" }
    }

    /** 家长下架目录项 (软删; 历史流水仍可回查)。 */
    fun deactivateCatalogItem(item: RewardCatalogItem) = viewModelScope.launch {
        catalogDao.setActive(item.id, false)
        _message.update { "已下架「${item.name}」" }
    }

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
        val delivered = if (decision.approved) deliverTempException(item, now) else 0
        _message.update {
            if (delivered > 0) "${decision.reason}，临时白名单已生效" else decision.reason
        }
    }

    /**
     * M9→M4 联动: 兑换批准后把 deliverable 折算成 enforce_rules `temp_exception` 行
     * (带 expires_at, 由 [RewardTempException] 纯函数生成)。返回下发行数;
     * 家长执行类 (全家活动/实物/零花钱) 为 0。
     */
    private suspend fun deliverTempException(item: RewardCatalogItem, now: Long): Int {
        val rows = RewardTempException.fromRedemption(
            kind = item.deliverable.kind.name,
            valueMinutes = item.deliverable.value,
            targetApps = item.deliverable.targetApps,
            childDid = DEMO_CHILD_DID,
            rewardId = item.id,
            now = now,
        )
        rows.forEach { enforceRuleDao.upsert(it) }
        return rows.size
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

    private fun RewardCatalogItem.toEntity() = RewardCatalogEntity(
        id = id,
        familyGroupId = familyGroupId,
        name = name,
        description = description,
        cost = cost,
        deliverableKind = deliverable.kind.name,
        deliverableValue = deliverable.value,
        targetApps = deliverable.targetApps.joinToString(","),
        maxPerDay = maxPerDay,
        active = active,
        createdBy = createdBy,
        createdAt = createdAt,
    )

    /** 未知 kind (未来版本 P2P 同步来的新枚举) 丢弃不崩。 */
    private fun RewardCatalogEntity.toDomain(): RewardCatalogItem? {
        val kind = DeliverableKind.entries.firstOrNull { it.name == deliverableKind } ?: return null
        return RewardCatalogItem(
            id = id,
            familyGroupId = familyGroupId,
            name = name,
            description = description,
            cost = cost,
            deliverable = Deliverable(
                kind = kind,
                value = deliverableValue,
                targetApps = targetApps.split(',').filter { it.isNotBlank() },
            ),
            maxPerDay = maxPerDay,
            active = active,
            createdBy = createdBy,
            createdAt = createdAt,
        )
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
