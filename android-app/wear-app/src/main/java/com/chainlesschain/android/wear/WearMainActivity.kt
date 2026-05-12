package com.chainlesschain.android.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.chainlesschain.android.wear.sync.ApprovalRequest
import com.chainlesschain.android.wear.sync.WearApprovalStore

/**
 * v1.2 #20 P0.2 Wear Phase 1 — main activity 实时反映 [WearApprovalStore]。
 *
 * 空列表显示"等待手机推送"占位；有 pending 时显示 ScalingLazyColumn 列表
 * (kind/title/summary 三行 + 金额可选)。点 card 进 Phase 2 ApprovalScreen
 * (该 screen 加 BiometricPrompt + 大按钮)。
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
    val requests by WearApprovalStore.requests.collectAsState()
    val listState = rememberScalingLazyListState()

    Box(modifier = Modifier.fillMaxSize()) {
        Vignette(vignettePosition = VignettePosition.TopAndBottom)
        TimeText()

        if (requests.isEmpty()) {
            EmptyState()
        } else {
            ScalingLazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 8.dp),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                item {
                    Text(
                        text = "待审批 ${requests.size}",
                        style = MaterialTheme.typography.title3,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 28.dp, bottom = 4.dp),
                        textAlign = TextAlign.Center,
                    )
                }
                items(requests, key = { it.id }) { req ->
                    ApprovalCard(req)
                }
            }
        }
    }
}

@Composable
private fun EmptyState() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "ChainlessChain Wear",
            style = MaterialTheme.typography.title3,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "\n等待手机推送…\n(高价值审批 / Cowork 任务)",
            style = MaterialTheme.typography.caption1,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
internal fun ApprovalCard(request: ApprovalRequest) {
    val context = LocalContext.current
    Card(
        onClick = {
            context.startActivity(WearApprovalActivity.newIntent(context, request.id))
        },
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            Text(
                text = request.title,
                style = MaterialTheme.typography.body2,
            )
            Text(
                text = request.summary,
                style = MaterialTheme.typography.caption2,
                maxLines = 2,
            )
            request.amountFen?.let {
                Text(
                    text = "¥${"%.2f".format(it / 100.0)}",
                    style = MaterialTheme.typography.title3,
                )
            }
            request.severity?.let {
                Text(
                    text = "[${it.uppercase()}]",
                    style = MaterialTheme.typography.caption3,
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
