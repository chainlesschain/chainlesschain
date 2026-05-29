package com.chainlesschain.android.feature.familyguard.presentation.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.familyguard.presentation.sos.SosTriggerButton

/**
 * FAMILY-06 Family-Guard shell screen.
 *
 * 主文档 §2.1 架构图 + ticket FAMILY-06 范围: 顶部 SOS 大红按钮 + 3 sub-section
 * (家人 / AI 陪学 / 任务). 后两 v0.1 显占位文案; "任务" 灰显 (per ticket "其他灰显").
 *
 * Bottom tab 集成在 :app 的 MainContainer/BottomNavigationBar; 本 composable
 * 即"家庭" tab 的内容。
 *
 * Subsection navigation (家人 / AI 陪学 / 任务 切换) 在 v0.1 仅垂直堆叠卡片,
 * 真正的 NavHost 内部路由留 FAMILY-13 起 (配对完成后), 或 FAMILY-18 家人页 UI 落地时。
 *
 * @param onSosTriggered click 回调; v0.1 host (MainContainer) 可只接 toast/snackbar,
 *   真触发流程 FAMILY-40 接通。
 */
@Composable
fun FamilyShellScreen(
    onSosTriggered: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .semantics { contentDescription = TestTag.Screen },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "AI 陪学",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )

        SosTriggerButton(onClick = onSosTriggered)

        HorizontalDivider()

        SectionCard(
            title = "家人",
            description = "查看家长 / 孩子绑定关系, 配对邀请, 解绑流程",
            enabled = true,
            testTag = TestTag.SectionFamily,
        )

        SectionCard(
            title = "AI 陪学",
            description = "学习 tab + 陪伴 tab 双轨; 错题本 + 学情报告",
            enabled = true,
            testTag = TestTag.SectionAi,
        )

        SectionCard(
            title = "任务",
            description = "家长派作业 / 家务 / 锻炼; AI 批改 + 积分奖励 (即将开放)",
            enabled = false,
            testTag = TestTag.SectionTasks,
        )

        Spacer(Modifier.height(8.dp))

        Text(
            text = "v0.1 MVP: 家人 + AI 陪学 + SOS 三件套优先; 任务模块 v0.2 上线。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SectionCard(
    title: String,
    description: String,
    enabled: Boolean,
    testTag: String,
) {
    val containerColor =
        if (enabled) MaterialTheme.colorScheme.surfaceVariant
        else Color(0x66BDBDBD) // disabled grey overlay
    val titleColor =
        if (enabled) MaterialTheme.colorScheme.onSurface
        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = testTag },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        elevation = CardDefaults.cardElevation(defaultElevation = if (enabled) 2.dp else 0.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = titleColor,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = titleColor.copy(alpha = 0.7f),
                )
            }
            Spacer(Modifier.width(8.dp))
            if (!enabled) {
                Text(
                    text = "灰显",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

object TestTag {
    const val Screen = "family_guard/shell/screen"
    const val SectionFamily = "family_guard/shell/section_family"
    const val SectionAi = "family_guard/shell/section_ai"
    const val SectionTasks = "family_guard/shell/section_tasks"
}
