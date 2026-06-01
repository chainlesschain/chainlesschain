package com.chainlesschain.android.feature.familyguard.presentation.usageaccess

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Usage Access 授权引导卡 (FAMILY-20).
 *
 * 仅在 CHILD 端且 PACKAGE_USAGE_STATS 未授予时显 ([UsageAccessUiState.Denied]);
 * 其余态渲染空 (家长端 / 已授权不打扰)。点 "前往授权" 跳系统 "使用情况访问" 设置页;
 * 用户返回 (ON_RESUME) 自动 [UsageAccessViewModel.recheck] 刷新, 授权后卡自动消失。
 *
 * 嵌在 [com.chainlesschain.android.feature.familyguard.presentation.shell.FamilyShellScreen]。
 */
@Composable
fun UsageAccessCard(
    modifier: Modifier = Modifier,
    viewModel: UsageAccessViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    // 从系统设置返回时重查授予态 (Usage Access 无 runtime 回调, 只能 onResume 轮询)。
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.recheck()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // 只有 Denied 才显卡; Hidden / Granted 渲染空。
    if (state != UsageAccessUiState.Denied) return

    val context = LocalContext.current
    Card(
        modifier = modifier
            .fillMaxWidth()
            .semantics { contentDescription = TEST_TAG },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "开启「使用情况访问」",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Text(
                text = "家长需要看到孩子的 app 使用情况。请在系统设置中为本应用开启" +
                    "「使用情况访问」权限, 否则前台 app 监管无法工作。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Spacer(Modifier.height(4.dp))
            Button(onClick = { openUsageAccessSettings(context) }) {
                Text("前往授权")
            }
        }
    }
}

/**
 * 跳系统 "使用情况访问" 设置页。ACTION_USAGE_ACCESS_SETTINGS 不接 package URI,
 * 用户须在列表里手动找到本应用开启。FLAG_ACTIVITY_NEW_TASK: 从非 Activity context
 * 启动必需; runCatching: 个别 ROM (定制系统) 可能无此设置页, 防 ActivityNotFound 崩。
 */
private fun openUsageAccessSettings(context: android.content.Context) {
    val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

private const val TEST_TAG = "family_guard/usage_access/card"
