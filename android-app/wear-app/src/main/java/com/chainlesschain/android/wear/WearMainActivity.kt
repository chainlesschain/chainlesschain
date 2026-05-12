package com.chainlesschain.android.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition

/**
 * v1.2 #20 P0.2 Wear Phase 0 — main activity 占位。
 *
 * 显示 "等待手机推送" + 系统时间。Phase 1 接 Wearable Data Layer 后这里
 * 接 LiveData<ApprovalRequest>，有 pending request 时切到 ApprovalScreen。
 *
 * Wear compose 屏 anatomy:
 *   - TimeText 顶部 (Wear OS UX guideline 强制)
 *   - Vignette 边缘渐变（圆屏 OLED 标配，防 burn-in）
 *   - ScalingLazyColumn 中央滚动列表 (Phase 1+ 多 pending 时用)
 */
class WearMainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                WearMainScreen()
            }
        }
    }
}

@Composable
fun WearMainScreen() {
    val listState = rememberScalingLazyListState()
    Box(modifier = Modifier.fillMaxSize()) {
        Vignette(vignettePosition = VignettePosition.TopAndBottom)
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 8.dp),
            state = listState,
        ) {
            item {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "ChainlessChain Wear",
                        style = MaterialTheme.typography.title3,
                    )
                }
            }
            item {
                Text(
                    text = "等待手机推送…\n(高价值审批 / Cowork 任务)",
                    style = MaterialTheme.typography.caption1,
                )
            }
        }
    }
}

@Preview(device = "id:wearos_small_round", showSystemUi = true)
@Composable
fun WearMainScreenPreview() {
    MaterialTheme {
        WearMainScreen()
    }
}
