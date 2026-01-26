package com.chainlesschain.android.feature.p2p.ui.call

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.call.CallEvent
import com.chainlesschain.android.feature.p2p.viewmodel.call.CallViewModel
import kotlinx.coroutines.flow.collectLatest

/**
 * 来电界面
 *
 * 显示来电提示，用户可以选择接听或拒绝
 *
 * 功能：
 * - 显示来电者信息
 * - 来电铃声动画
 * - 接听/拒绝按钮
 * - 通话类型标识（语音/视频）
 *
 * @param callerDid 来电者DID
 * @param callerName 来电者名称
 * @param isVideoCall 是否视频通话
 * @param onAccept 接听回调
 * @param onReject 拒绝回调
 * @param onNavigateToCall 跳转到通话界面回调
 * @param viewModel 通话ViewModel
 *
 * @since v0.32.0
 */
@Composable
fun IncomingCallScreen(
    callerDid: String,
    callerName: String,
    isVideoCall: Boolean,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onNavigateToCall: () -> Unit,
    viewModel: CallViewModel = hiltViewModel()
) {
    val snackbarHostState = remember { SnackbarHostState() }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is CallEvent.CallAccepted -> {
                    onNavigateToCall()
                }
                is CallEvent.CallRejected -> {
                    onReject()
                }
                is CallEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                else -> {}
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.primaryContainer
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // 顶部：来电标题
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = if (isVideoCall) "视频通话" else "语音通话",
                    style = MaterialTheme.typography.titleMedium,
                    color = Color.White.copy(alpha = 0.8f)
                )

                Text(
                    text = "来电",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }

            // 中间：来电者信息
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                // 头像（带呼吸动画）
                PulsingAvatar(isVideoCall = isVideoCall)

                // 来电者名称
                Text(
                    text = callerName,
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )

                // 来电者DID
                Text(
                    text = callerDid,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.7f)
                )
            }

            // 底部：接听/拒绝按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                // 拒绝按钮
                CallActionButton(
                    icon = Icons.Default.CallEnd,
                    label = "拒绝",
                    backgroundColor = Color.Red,
                    onClick = { viewModel.rejectCall() }
                )

                // 接听按钮
                CallActionButton(
                    icon = if (isVideoCall) Icons.Default.Videocam else Icons.Default.Call,
                    label = "接听",
                    backgroundColor = Color.Green,
                    onClick = { viewModel.acceptCall() }
                )
            }
        }

        // Snackbar
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter)
        )
    }
}

/**
 * 呼吸动画头像
 */
@Composable
private fun PulsingAvatar(isVideoCall: Boolean) {
    // 呼吸动画
    val infiniteTransition = rememberInfiniteTransition(label = "pulsing")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )

    Box(
        contentAlignment = Alignment.Center
    ) {
        // 外圈（呼吸效果）
        Box(
            modifier = Modifier
                .size(180.dp)
                .scale(scale)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.2f))
        )

        // 内圈（头像）
        Box(
            modifier = Modifier
                .size(140.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = if (isVideoCall) Icons.Default.Videocam else Icons.Default.Person,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        }
    }
}

/**
 * 通话操作按钮
 */
@Composable
private fun CallActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    backgroundColor: Color,
    onClick: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 圆形按钮
        FloatingActionButton(
            onClick = onClick,
            containerColor = backgroundColor,
            contentColor = Color.White,
            modifier = Modifier.size(72.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                modifier = Modifier.size(32.dp)
            )
        }

        // 按钮标签
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White,
            fontWeight = FontWeight.Medium
        )
    }
}
