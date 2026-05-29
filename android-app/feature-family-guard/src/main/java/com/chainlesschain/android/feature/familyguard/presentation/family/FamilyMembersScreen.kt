package com.chainlesschain.android.feature.familyguard.presentation.family

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole

/**
 * 家人页屏幕 (FAMILY-18). 主文档 §3.1 v0.2: 家庭组 + 4 角色徽章 +
 * 4 状态点 (online/offline/SOS/unbind_pending).
 *
 * 子组件:
 *   - [UnbindPendingBanner] 顶部橙色横幅 (任一 relationship 在 unbind_pending)
 *   - [EmergencyUnbindBanner] 顶部红色横幅 (任一 relationship 紧急解绑生效中)
 *   - [FamilyMemberCard] 单成员卡 (含 RoleBadge + StatusDot + displayLabel)
 */
@Composable
fun FamilyMembersScreen(
    modifier: Modifier = Modifier,
    viewModel: FamilyMembersViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    FamilyMembersContent(state = state, modifier = modifier)
}

@Composable
internal fun FamilyMembersContent(
    state: FamilyMembersUiState,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .semantics { contentDescription = TestTag.Screen },
    ) {
        // 家庭组名称
        Text(
            text = state.familyGroupName ?: "家人",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(12.dp))

        // 紧急解绑横幅 (优先级最高)
        if (state.emergencyUnbindActive) {
            EmergencyUnbindBanner()
            Spacer(Modifier.height(12.dp))
        }
        // 待解绑横幅
        if (state.unbindPendingCount > 0) {
            UnbindPendingBanner(count = state.unbindPendingCount)
            Spacer(Modifier.height(12.dp))
        }

        // 成员列表
        when {
            state.isLoading -> Text(
                text = "加载中...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            state.members.isEmpty() -> EmptyStateContent()
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = TestTag.MemberList },
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 4.dp),
            ) {
                items(items = state.members, key = { it.memberDid }) { member ->
                    FamilyMemberCard(member = member)
                }
            }
        }
    }
}

@Composable
internal fun FamilyMemberCard(member: FamilyMemberUiModel) {
    val containerColor =
        if (member.hasActiveSos) Color(0xFFFFEBEE) // 红色 SOS 高亮
        else MaterialTheme.colorScheme.surfaceVariant
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = TestTag.memberCard(member.memberDid) },
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoleBadge(role = member.role, tier = member.tier)
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = member.displayLabel,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = member.memberDid,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            StatusDot(status = member.status, hasActiveSos = member.hasActiveSos)
        }
    }
}

@Composable
internal fun RoleBadge(role: MemberRole, tier: GuardianTier?) {
    val emoji = when (role) {
        MemberRole.PARENT -> if (tier == GuardianTier.PRIMARY) "👨‍🦱" else "👩"
        MemberRole.CHILD -> "👶"
        MemberRole.GUARDIAN -> "👴"
    }
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primaryContainer)
            .semantics { contentDescription = TestTag.roleBadge(role) },
        contentAlignment = Alignment.Center,
    ) {
        Text(text = emoji, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
internal fun StatusDot(
    status: FamilyMemberUiModel.MemberStatus,
    hasActiveSos: Boolean,
) {
    val color = when {
        hasActiveSos -> Color(0xFFD50000) // 红 - SOS
        status == FamilyMemberUiModel.MemberStatus.ACTIVE -> Color(0xFF43A047) // 绿
        status == FamilyMemberUiModel.MemberStatus.UNBIND_PENDING -> Color(0xFFFB8C00) // 橙
        status == FamilyMemberUiModel.MemberStatus.EMERGENCY_UNBOUND -> Color(0xFFD50000) // 红
        status == FamilyMemberUiModel.MemberStatus.FROZEN -> Color(0xFF6A1B9A) // 紫
        else -> Color(0xFF9E9E9E) // 灰 - inactive
    }
    Box(
        modifier = Modifier
            .size(12.dp)
            .clip(CircleShape)
            .background(color)
            .semantics { contentDescription = TestTag.statusDot(status, hasActiveSos) },
    )
}

@Composable
internal fun UnbindPendingBanner(count: Int) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = TestTag.UnbindBanner },
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0)),
    ) {
        Text(
            text = "⚠️ $count 个家人正在解绑流程中 (24h 冷却期内可撤销)",
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFFE65100),
        )
    }
}

@Composable
internal fun EmergencyUnbindBanner() {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = TestTag.EmergencyBanner },
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
    ) {
        Text(
            text = "🚨 紧急解绑已生效, 7 天宽限期内可撤销",
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = Color(0xFFB71C1C),
        )
    }
}

@Composable
internal fun EmptyStateContent() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("还没有家人, 请先完成配对", style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            text = "走配对流程 (FAMILY-13) 邀请家人加入家庭组",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

object TestTag {
    const val Screen = "family_guard/family/screen"
    const val MemberList = "family_guard/family/member_list"
    const val UnbindBanner = "family_guard/family/unbind_banner"
    const val EmergencyBanner = "family_guard/family/emergency_banner"

    fun memberCard(did: String) = "family_guard/family/member_card/$did"
    fun roleBadge(role: MemberRole) = "family_guard/family/role_badge/${role.name}"
    fun statusDot(status: FamilyMemberUiModel.MemberStatus, hasSos: Boolean) =
        "family_guard/family/status_dot/${status.name}/sos=$hasSos"
}
