package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 防幻觉警示条 — 当 LLM 回答里引用了 vault 中**不存在**的 event id 时显示。
 *
 * 后端 (packages/personal-data-hub/lib/prompt-builder.js `validateCitations`)
 * 把 LLM 输出里 `[evt-xxx]` token 与实际喂进 prompt 的 factIds 求交，未命中
 * 的计入 `hallucinatedCitations`，并置 `warning = "hallucinated-citations"`。
 * 这层判定一直存在，但 v0.1 安卓侧只是静默丢弃，用户看不到「这条可能是编的」
 * 提示。本组件把它显式化。
 *
 * 三条 ask 路径共用（HubAskScreen 的 Path-Y / 桌面 ask，HubAskCard 的 in-APK
 * cc），所以提到 ui/personalDataHub 顶层而非藏在单个文件里。
 *
 * 设计取舍：用 tertiaryContainer 而非 errorContainer —— 幻觉是「请核对」而非
 * 「调用失败」，红色会和真正的 errorMessage 撞语义。⚠ 前缀保证不依赖配色也能
 * 读出告警意图。`count <= 0` 时不渲染任何东西（调用方可无脑传入）。
 *
 * 与 web-panel 的 `<a-alert type="warning">`(PersonalDataHub.vue) 文案对齐。
 */
@Composable
fun PdhHallucinationBanner(
    count: Int,
    modifier: Modifier = Modifier,
) {
    if (count <= 0) return
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.tertiaryContainer,
        shape = RoundedCornerShape(8.dp),
    ) {
        Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text(
                "⚠",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            Spacer(Modifier.size(8.dp))
            Column {
                Text(
                    "可能存在编造",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "模型引用了 $count 条本机记录里不存在的事件 id —— 这部分内容可能是编的，请自行核对。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
        }
    }
}
