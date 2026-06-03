package com.chainlesschain.android.feature.familyguard.presentation.sos

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * SOS 大红按钮 (FAMILY-06 placeholder, 真触发逻辑 FAMILY-40/41 落地).
 *
 * 主文档 §3.7 五触发途径之一: "应用内大红色 SOS 按钮 (home tab 固定位)"。
 * v0.1 ticket FAMILY-06 范围: 渲染 + click 回调; 真触发流程 (Repository 写
 * sos_event + 录音 + broadcast call) 留 FAMILY-40。
 *
 * 设计:
 *   - 圆形, 直径 96dp; 与 Material FAB 区分 (FAB 56dp), 更醒目
 *   - 颜色 #D50000 (Material Red A700) — 高紧急色, 不出现在普通 UI
 *   - 阴影 + 不需要 ripple (减少误触感, 强调"严肃按钮")
 *   - contentDescription 用于无障碍读屏
 */
@Composable
fun SosTriggerButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(
                    if (enabled) Color(0xFFD50000) else Color(0xFF9E9E9E),
                )
                .clickable(enabled = enabled, onClick = onClick)
                .semantics { contentDescription = TestTag.SosButton },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "SOS",
                color = Color.White,
                fontWeight = FontWeight.Black,
                fontSize = 24.sp,
            )
        }
        Text(
            text = "紧急求助",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

object TestTag {
    const val SosButton = "family_guard/sos/trigger_button"
}
