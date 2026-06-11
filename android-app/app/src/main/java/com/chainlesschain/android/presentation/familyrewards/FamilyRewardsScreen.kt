package com.chainlesschain.android.presentation.familyrewards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.presentation.aistudy.DeliverableKind
import com.chainlesschain.android.presentation.aistudy.RewardCatalogItem

/**
 * M9 奖励 / 积分屏。家庭 tab「积分」卡导航至此 (主文档 §3.9)。
 *
 * 显当前余额 + 可交互演示: 「模拟完成作业」赚积分 (经防作弊/单日上限引擎) +
 * 兑换目录 (经余额/上限引擎校验) + 积分历史。引擎为纯逻辑, 账本为内存 seam;
 * 真持久 / earn 由 M5 自动触发 / spend→M4 白名单 等为设备阻塞 follow-up。
 */
@Composable
fun FamilyRewardsScreen(
    onBack: () -> Unit,
    viewModel: FamilyRewardsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onBack) { Text("← 返回") }
                Text(
                    text = "积分 / 奖励",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
            }
            HorizontalDivider()

            BalanceCard(state)

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = { viewModel.simulateHomeworkEarn(100) }) { Text("模拟满分作业 +30") }
                OutlinedButton(onClick = { viewModel.simulateHomeworkEarn(75) }) { Text("75 分 +10") }
            }

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                if (state.activeRewards.isNotEmpty()) {
                    item {
                        SectionHeader("生效中的奖励")
                    }
                    items(items = state.activeRewards, key = { "active-${it.id}" }) { active ->
                        ActiveRewardCard(active)
                    }
                    item { Spacer(Modifier.height(8.dp)) }
                }
                item {
                    SectionHeader("兑换目录")
                }
                items(items = state.catalog, key = { it.id }) { reward ->
                    RewardCard(
                        reward = reward,
                        affordable = state.balance >= reward.cost,
                        onRedeem = { viewModel.redeem(reward) },
                        onDeactivate = { viewModel.deactivateCatalogItem(reward) },
                    )
                }
                item {
                    Spacer(Modifier.height(8.dp))
                    SectionHeader("家长管理")
                    AddRewardForm(onAdd = { name, cost, kind, value ->
                        viewModel.addCatalogItem(name, cost, kind, value)
                    })
                }
                item {
                    Spacer(Modifier.height(8.dp))
                    SectionHeader("积分历史")
                    if (state.history.isEmpty()) {
                        Text(
                            text = "还没有积分记录。点上方按钮模拟一次作业完成试试。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(items = state.history, key = { it.id }) { row ->
                    HistoryRow(row)
                }
            }
        }
    }
}

@Composable
private fun BalanceCard(state: FamilyRewardsUiState) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("当前积分", style = MaterialTheme.typography.labelMedium)
            Text(
                text = "${state.balance}",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "累计赚取 ${state.lifetimeEarned} · 累计兑换 ${state.lifetimeSpent}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ActiveRewardCard(active: ActiveRewardRow) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = active.label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            active.expiresAt?.let {
                Text(
                    text = "至 ${timeFormat.format(java.util.Date(it))}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private val timeFormat = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(vertical = 4.dp),
    )
}

@Composable
private fun RewardCard(
    reward: RewardCatalogItem,
    affordable: Boolean,
    onRedeem: () -> Unit,
    onDeactivate: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(reward.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    text = "${reward.cost} 积分" + if (reward.maxPerDay > 0) " · 每日上限 ${reward.maxPerDay} 次" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onDeactivate) { Text("下架") }
            Button(onClick = onRedeem, enabled = affordable) { Text(if (affordable) "兑换" else "积分不足") }
        }
    }
}

/** 家长新增目录项 (M9 catalog CRUD 的最小表单: 名称 + 价格 + 类型 + 分钟数)。 */
@Composable
private fun AddRewardForm(onAdd: (String, Int, DeliverableKind, Int) -> Unit) {
    var name by remember { mutableStateOf("") }
    var cost by remember { mutableStateOf("50") }
    var minutes by remember { mutableStateOf("30") }
    var kind by remember { mutableStateOf(DeliverableKind.SCREEN_TIME_MIN) }
    var kindMenu by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("奖励名称（如：额外 30 分钟游戏）") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = cost,
                    onValueChange = { cost = it.filter(Char::isDigit).take(5) },
                    label = { Text("积分价") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = minutes,
                    onValueChange = { minutes = it.filter(Char::isDigit).take(5) },
                    label = { Text("分钟数") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                Column {
                    AssistChip(onClick = { kindMenu = true }, label = { Text(kind.label()) })
                    DropdownMenu(expanded = kindMenu, onDismissRequest = { kindMenu = false }) {
                        DeliverableKind.entries.forEach { k ->
                            DropdownMenuItem(
                                text = { Text(k.label()) },
                                onClick = {
                                    kind = k
                                    kindMenu = false
                                },
                            )
                        }
                    }
                }
            }
            Button(
                onClick = { onAdd(name, cost.toIntOrNull() ?: 0, kind, minutes.toIntOrNull() ?: 0) },
                enabled = name.isNotBlank() && (cost.toIntOrNull() ?: 0) > 0,
            ) { Text("上架奖励") }
        }
    }
}

private fun DeliverableKind.label(): String = when (this) {
    DeliverableKind.SCREEN_TIME_MIN -> "屏幕时间"
    DeliverableKind.APP_UNLOCK -> "解锁应用"
    DeliverableKind.DELAYED_BEDTIME_MIN -> "推迟就寝"
    DeliverableKind.FAMILY_ACTIVITY -> "全家活动"
    DeliverableKind.REAL_WORLD_VOUCHER -> "实物奖励"
    DeliverableKind.CASH -> "零花钱"
}

@Composable
private fun HistoryRow(row: RewardHistoryRow) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(row.label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        val sign = if (row.signedAmount >= 0) "+" else ""
        Text(
            text = "$sign${row.signedAmount}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (row.signedAmount >= 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
        )
    }
}
