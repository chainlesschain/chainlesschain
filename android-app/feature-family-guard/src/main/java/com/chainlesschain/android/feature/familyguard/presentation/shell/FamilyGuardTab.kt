package com.chainlesschain.android.feature.familyguard.presentation.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.chainlesschain.android.feature.familyguard.presentation.family.FamilyMembersScreen
import com.chainlesschain.android.feature.familyguard.presentation.role.RoleSelectorScreen

/**
 * 家庭 tab 的内部导航 host.
 *
 * MainContainer 的 "家庭" tab (index 3) 渲染本 composable。内部用嵌套 NavHost
 * 在占位壳子 [FamilyShellScreen] 与真实的家人页 [FamilyMembersScreen] (FAMILY-18)
 * 之间切换。系统返回键由 NavController back stack 自动处理 (popBackStack)。
 *
 * SOS: v0.1 由 host 接 snackbar 占位; 现接 [SosShellViewModel] 真触发 (FAMILY-40)
 * —— 二次确认 → 落 pending sos_event → 5 分钟内可撤销。host 传入的 [onSosTriggered]
 * 仍保留 (供 :app 做额外埋点/反馈), 触发后一并回调。
 *
 * @param onSosTriggered SOS 触发后的 host 回调 (真写库在本 composable 内完成)。
 * @param onNavigateToAiStudy "AI陪学"卡 click; 由 :app 导航到全屏 AiStudyScreen (M6 MVP)。
 */
@Composable
fun FamilyGuardTab(
    onSosTriggered: () -> Unit,
    onNavigateToPairing: () -> Unit,
    onNavigateToAiStudy: () -> Unit,
    onNavigateToTasks: () -> Unit,
    onNavigateToRewards: () -> Unit,
    onNavigateToGentleness: () -> Unit,
    onNavigateToMistakeBook: () -> Unit,
    modifier: Modifier = Modifier,
    sosViewModel: SosShellViewModel = hiltViewModel(),
) {
    val navController = rememberNavController()
    val sosState by sosViewModel.uiState.collectAsState()
    var showSosConfirm by remember { mutableStateOf(false) }

    NavHost(
        navController = navController,
        startDestination = Route.SHELL,
        modifier = modifier,
    ) {
        composable(Route.SHELL) {
            FamilyShellScreen(
                onSosTriggered = { showSosConfirm = true },
                onNavigateToRole = { navController.navigate(Route.ROLE) },
                onNavigateToFamilyMembers = { navController.navigate(Route.MEMBERS) },
                onNavigateToPairing = onNavigateToPairing,
                onNavigateToAiStudy = onNavigateToAiStudy,
                onNavigateToTasks = onNavigateToTasks,
                onNavigateToRewards = onNavigateToRewards,
                onNavigateToGentleness = onNavigateToGentleness,
                onNavigateToMistakeBook = onNavigateToMistakeBook,
            )
        }
        composable(Route.ROLE) {
            Column(modifier = Modifier.fillMaxSize()) {
                TextButton(
                    onClick = { navController.popBackStack() },
                    modifier = Modifier.padding(start = 8.dp, top = 8.dp),
                ) {
                    Text(text = "← 返回", style = MaterialTheme.typography.labelLarge)
                }
                // 选定/改定角色后回到壳子。角色=CHILD 后 ChildIdentityProvider 才放行
                // childDid → SOS / 遥测 / 任务 才真正生效。
                RoleSelectorScreen(
                    modifier = Modifier.fillMaxWidth(),
                    onRoleConfirmed = { navController.popBackStack() },
                )
            }
        }
        composable(Route.MEMBERS) {
            Column(modifier = Modifier.fillMaxSize()) {
                TextButton(
                    onClick = { navController.popBackStack() },
                    modifier = Modifier.padding(start = 8.dp, top = 8.dp),
                ) {
                    Text(
                        text = "← 返回",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                FamilyMembersScreen(modifier = Modifier.fillMaxWidth())
            }
        }
    }

    // 二次确认: 防误触 (紧急按钮必须 deliberate)。
    if (showSosConfirm) {
        AlertDialog(
            onDismissRequest = { showSosConfirm = false },
            title = { Text("确认发送紧急求助？") },
            text = { Text("将立即向家长发送一条紧急求助 (SOS)。发送后 5 分钟内可撤销。") },
            confirmButton = {
                TextButton(onClick = {
                    showSosConfirm = false
                    sosViewModel.triggerSos()
                    onSosTriggered()
                }) { Text("发送 SOS") }
            },
            dismissButton = {
                TextButton(onClick = { showSosConfirm = false }) { Text("取消") }
            },
        )
    }

    // 触发结果反馈。
    when (val s = sosState) {
        is SosUiState.Sent -> AlertDialog(
            onDismissRequest = { sosViewModel.dismiss() },
            title = { Text("🆘 已发送紧急求助") },
            text = { Text("家长会收到通知。若为误触，可在 5 分钟内撤销。") },
            confirmButton = {
                TextButton(onClick = { sosViewModel.dismiss() }) { Text("知道了") }
            },
            dismissButton = {
                TextButton(onClick = { sosViewModel.cancelAsFalseAlarm(s.eventId) }) {
                    Text("撤销 (误触)")
                }
            },
        )
        is SosUiState.Cancelled -> AlertDialog(
            onDismissRequest = { sosViewModel.dismiss() },
            title = { Text("已撤销") },
            text = { Text("紧急求助已标记为误触并撤销。") },
            confirmButton = {
                TextButton(onClick = { sosViewModel.dismiss() }) { Text("好") }
            },
        )
        is SosUiState.Error -> AlertDialog(
            onDismissRequest = { sosViewModel.dismiss() },
            title = { Text("提示") },
            text = { Text(s.message) },
            confirmButton = {
                TextButton(onClick = { sosViewModel.dismiss() }) { Text("好") }
            },
        )
        SosUiState.Idle, SosUiState.Sending -> Unit
    }
}

private object Route {
    const val SHELL = "family_guard/shell"
    const val MEMBERS = "family_guard/members"
    const val ROLE = "family_guard/role"
}
