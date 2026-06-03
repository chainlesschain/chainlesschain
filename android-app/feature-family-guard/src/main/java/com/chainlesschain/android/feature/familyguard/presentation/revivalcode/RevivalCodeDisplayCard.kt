package com.chainlesschain.android.feature.familyguard.presentation.revivalcode

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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode

/**
 * 复活码一次性显示卡 (FAMILY-08).
 *
 * 主文档 §3.1 v0.2: "配对时孩子端单独生成一个离线复活码 (6 位数字, 存离线,
 * 可记在小本本)"。本 composable 即配对流程 FAMILY-13 第 7 步插槽; v0.1
 * 范围内仅 UI 组件 + 用户确认回调 (真正集成到 Flow C QR 配对 留 FAMILY-13)。
 *
 * 安全约束 (UI 层):
 *   1. 大字号显示 (28sp), 远离系统截屏 watermark (前后景对比足够)
 *   2. **不**提供"复制到剪贴板"按钮 — 强迫用户线下记录 (避免代码进系统剪贴板缓存)
 *   3. **不**提供"导出图片"按钮
 *   4. "我已记下" 按钮触发 [onConfirmed], 调用方应立即把 [code] 让出引用
 *   5. UI 不存任何 code 副本 (仅渲染期间持有, 参数引用)
 *
 * 红色警告条带 (#D50000) 让用户感知"此屏唯一一次"。
 */
@Composable
fun RevivalCodeDisplayCard(
    code: RevivalCode,
    onConfirmed: () -> Unit,
    modifier: Modifier = Modifier,
    onRegenerateClicked: (() -> Unit)? = null,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
            .semantics { contentDescription = TestTag.Card },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 红色警告横幅
            Text(
                text = "⚠️ 仅显示一次",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = Color(0xFFD50000),
            )
            Spacer(Modifier.height(8.dp))

            Text(
                text = "复活码 (紧急解绑用)",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))

            // 6 位数字大字号显示, 间距增强易读
            Text(
                text = code.value.spaceEveryThree(),
                fontSize = 32.sp,
                fontWeight = FontWeight.Black,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.semantics { contentDescription = TestTag.CodeText },
            )
            Spacer(Modifier.height(16.dp))

            Text(
                text = "请记在纸上 / 小本子, 不要存到手机相册 / 截图。\n" +
                    "孩子忘记或被家长滥用时, 输入此码可立即解除监管。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))

            Button(
                onClick = onConfirmed,
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = TestTag.ConfirmButton },
            ) {
                Text("我已记下, 继续")
            }

            if (onRegenerateClicked != null) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onRegenerateClicked,
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = TestTag.RegenerateButton },
                ) {
                    Text("重新生成 (作废上一个)")
                }
            }
        }
    }
}

private fun String.spaceEveryThree(): String =
    chunked(3).joinToString(" ")

object TestTag {
    const val Card = "family_guard/revival_code/card"
    const val CodeText = "family_guard/revival_code/code_text"
    const val ConfirmButton = "family_guard/revival_code/confirm_button"
    const val RegenerateButton = "family_guard/revival_code/regenerate_button"
}
