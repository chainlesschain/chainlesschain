package com.chainlesschain.android.feature.familyguard.presentation.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.chainlesschain.android.feature.familyguard.presentation.family.FamilyMembersScreen

/**
 * 家庭 tab 的内部导航 host.
 *
 * MainContainer 的 "家庭" tab (index 3) 渲染本 composable。内部用嵌套 NavHost
 * 在占位壳子 [FamilyShellScreen] 与真实的家人页 [FamilyMembersScreen] (FAMILY-18)
 * 之间切换。系统返回键由 NavController back stack 自动处理 (popBackStack)。
 *
 * v0.1→当前: 仅 "家人" 卡接通到真页; AI陪学 / 任务 仍为占位 (屏幕未建)。
 * 后续这些 epic 落地时, 在此 NavHost 加对应 route 即可。
 *
 * @param onSosTriggered SOS 大红按钮 click; 真触发流程 FAMILY-40 接通, host 现接 snackbar。
 * @param onNavigateToAiStudy "AI陪学"卡 click; 由 :app 导航到全屏 AiStudyScreen (M6 MVP)。
 */
@Composable
fun FamilyGuardTab(
    onSosTriggered: () -> Unit,
    onNavigateToAiStudy: () -> Unit,
    onNavigateToTasks: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val navController = rememberNavController()
    NavHost(
        navController = navController,
        startDestination = Route.SHELL,
        modifier = modifier,
    ) {
        composable(Route.SHELL) {
            FamilyShellScreen(
                onSosTriggered = onSosTriggered,
                onNavigateToFamilyMembers = { navController.navigate(Route.MEMBERS) },
                onNavigateToAiStudy = onNavigateToAiStudy,
                onNavigateToTasks = onNavigateToTasks,
            )
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
}

private object Route {
    const val SHELL = "family_guard/shell"
    const val MEMBERS = "family_guard/members"
}
