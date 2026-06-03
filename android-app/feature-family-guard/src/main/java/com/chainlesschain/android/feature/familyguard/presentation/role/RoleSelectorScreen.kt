package com.chainlesschain.android.feature.familyguard.presentation.role

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState

/**
 * FAMILY-04 屏幕. 按 lockState 切 3 子组件 (对齐 ticket "3 个 UI state"):
 *
 *   - [Unselected]      → [RoleChooserContent]      家长 / 孩子双卡, 任选其一
 *   - [LockPending]     → [LockPendingContent]      显倒计时 + 可改一次
 *   - [Locked]          → [LockedContent]           显已锁, 提示重置 app 路径
 *
 * 整合点 (本 ticket 范围外): FAMILY-06 DocApp Routing 会判
 *   if (!isFamilyMemberConfigured) navigate(RoleSelector) else navigate(Home)
 */
@Composable
fun RoleSelectorScreen(
    modifier: Modifier = Modifier,
    viewModel: RoleSelectorViewModel = hiltViewModel(),
    onRoleConfirmed: (AppRole) -> Unit = {},
) {
    val state by viewModel.lockState.collectAsStateWithLifecycle()
    val message by viewModel.userMessage.collectAsStateWithLifecycle()

    LaunchedEffect(message) {
        val msg = message ?: return@LaunchedEffect
        if (msg is RoleSelectorViewModel.UserMessage.RoleSelected) {
            onRoleConfirmed(msg.role)
        }
        viewModel.consumeMessage()
    }

    when (val s = state) {
        RoleLockState.Unselected -> RoleChooserContent(
            modifier = modifier,
            onRoleClick = viewModel::onRoleClicked,
        )
        is RoleLockState.LockPending -> LockPendingContent(
            modifier = modifier,
            state = s,
            onChangeClick = viewModel::onRoleClicked,
        )
        is RoleLockState.Locked -> LockedContent(
            modifier = modifier,
            state = s,
        )
    }
}

@Composable
internal fun RoleChooserContent(
    modifier: Modifier = Modifier,
    onRoleClick: (AppRole) -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp)
            .semantics { contentDescription = TestTag.UnselectedScreen },
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "选择本机角色",
            style = MaterialTheme.typography.headlineMedium,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "选定后 24 小时内可改, 之后永久锁定。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(modifier = Modifier.height(32.dp))

        RoleCard(
            title = "家长",
            description = "看孩子使用数据 · 接 SOS · 派任务 · 编规则",
            onClick = { onRoleClick(AppRole.PARENT) },
            testTag = TestTag.SelectParentButton,
        )
        Spacer(modifier = Modifier.height(16.dp))
        RoleCard(
            title = "孩子",
            description = "AI 陪学 · 完成任务 · 锁屏 SOS 求助",
            onClick = { onRoleClick(AppRole.CHILD) },
            testTag = TestTag.SelectChildButton,
        )
    }
}

@Composable
internal fun LockPendingContent(
    modifier: Modifier = Modifier,
    state: RoleLockState.LockPending,
    onChangeClick: (AppRole) -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp)
            .semantics { contentDescription = TestTag.LockPendingScreen },
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "已选: ${state.role.displayName()}",
            style = MaterialTheme.typography.headlineMedium,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "24 小时内可改 (锁定时间 ${state.lockAtMs} ms)",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(32.dp))

        OutlinedButton(
            onClick = { onChangeClick(state.role.opposite()) },
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = TestTag.ChangeRoleButton },
        ) {
            Text("改为${state.role.opposite().displayName()}")
        }
    }
}

@Composable
internal fun LockedContent(
    modifier: Modifier = Modifier,
    state: RoleLockState.Locked,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp)
            .semantics { contentDescription = TestTag.LockedScreen },
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "已锁: ${state.role.displayName()}",
            style = MaterialTheme.typography.headlineMedium,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "角色已永久锁定。如需换角色, 请到系统设置 → 应用 → ChainlessChain → 清除数据。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun RoleCard(
    title: String,
    description: String,
    onClick: () -> Unit,
    testTag: String,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = testTag },
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleLarge)
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
                Text("选这个")
            }
        }
    }
}

private fun AppRole.displayName(): String = when (this) {
    AppRole.PARENT -> "家长"
    AppRole.CHILD -> "孩子"
}

private fun AppRole.opposite(): AppRole = when (this) {
    AppRole.PARENT -> AppRole.CHILD
    AppRole.CHILD -> AppRole.PARENT
}

/** Test tag 集中托管, 避免硬编码字符串到 UI test。 */
object TestTag {
    const val UnselectedScreen = "family_guard/role_selector/unselected"
    const val LockPendingScreen = "family_guard/role_selector/lock_pending"
    const val LockedScreen = "family_guard/role_selector/locked"
    const val SelectParentButton = "family_guard/role_selector/select_parent"
    const val SelectChildButton = "family_guard/role_selector/select_child"
    const val ChangeRoleButton = "family_guard/role_selector/change_role"
}
