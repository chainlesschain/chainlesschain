package com.chainlesschain.android.feature.familyguard.domain.model.permissions

/**
 * 默认权限模板 (FAMILY-12). 主文档 §3.1 v0.2 "权限矩阵" 一表的代码化。
 *
 * 配对流程 (FAMILY-13) 首次建立 family_relationship 时按 self 在该关系中扮演
 * 的角色调对应工厂 (parent→child, child→parent, guardian→child)。家长可在
 * 配对结束后用 FamilyRelationshipRepository.updatePermissions 微调字段。
 *
 * 模板默认值对应主文档 "默认 ✅ / ❌ / ⚠️" 标记; 安全 / 隐私默认值倾向保守
 * (L2/L3 telemetry 默认关, allow_app_disable 默认关, allow_companion_summary
 * 默认 STATS_ONLY)。
 */
object PermissionTemplates {

    /**
     * Parent → Child (家长看孩子). 主权限默认开:
     *   - L1 telemetry 默认
     *   - 通话 + 视频默认开; silent_observe 配额式开; force_pickup 默认关 (走紧急配额, FAMILY-36)
     *   - 规则编辑 + 任务派发 + 支付否决 + 位置查看 + 围栏编辑全开
     *   - app_disable / app_hide 默认关 (强档 v0.2 上线后才开)
     *   - SOS 接收 + 奖励默认开
     *   - companion 仅 STATS_ONLY (主文档 §3.6 黑盒承诺)
     */
    fun forParentToChild(): FamilyPermissions = FamilyPermissions(
        telemetryLevel = TelemetryLevel.L1,
        telemetryAppsBlocklist = emptyList(),
        telemetryQuietHours = emptyList(),
        allowMessage = true,
        allowAudioCall = true,
        allowVideoCall = true,
        allowSilentObserve = true,
        allowForcePickup = false,
        allowRemoteView = false,
        allowRuleEdit = true,
        allowTaskAssign = true,
        allowAppDisable = false,
        allowAppHide = false,
        allowPaymentVeto = true,
        allowLocationView = true,
        allowGeofenceEdit = true,
        allowSosReceive = true,
        allowRewardGrant = true,
        allowCompanionSummary = CompanionSummaryAccess.STATS_ONLY,
        allowEmergencyUnbind = false, // child→parent 方向才用
    )

    /**
     * Child → Parent (孩子能对家长做什么). 大部分关:
     *   - 仅消息 + 通话 + SOS + 紧急解绑可见
     *   - telemetry 反向不存在 (家长不需要孩子上报家长本身), 默认 L0
     *   - companion 黑盒 → NEVER (家长想看也看不到)
     */
    fun forChildToParent(): FamilyPermissions = FamilyPermissions(
        telemetryLevel = TelemetryLevel.L0,
        allowMessage = true,
        allowAudioCall = true,
        allowVideoCall = true,
        allowSilentObserve = false,
        allowForcePickup = false,
        allowRemoteView = false,
        allowRuleEdit = false,
        allowTaskAssign = false,
        allowAppDisable = false,
        allowAppHide = false,
        allowPaymentVeto = false,
        allowLocationView = true, // 双向可见家长位置 (孩子也能确认家长在哪)
        allowGeofenceEdit = false,
        allowSosReceive = false, // 孩子端不接 SOS, 它是 SOS 发起方
        allowRewardGrant = false,
        allowCompanionSummary = CompanionSummaryAccess.NEVER, // 双向同样不可见
        allowEmergencyUnbind = true, // 孩子端有紧急解绑权 (主文档 §3.1 v0.2)
    )

    /**
     * Secondary Guardian → Child (爷爷奶奶 看孙). 主文档 §3.1 v0.2 多家长冲突:
     *   - 可看 telemetry / 接 SOS / 派任务
     *   - **不可**解绑 (只能"退出监护"自己离开)
     *   - 规则编辑需 PRIMARY 确认 → allowRuleEdit=false
     *   - 支付审批 → 一票否决保留 (FAMILY-17 RuleMerger 处理冲突), 这里仍开
     */
    fun forGuardianSecondaryToChild(): FamilyPermissions = FamilyPermissions(
        telemetryLevel = TelemetryLevel.L1,
        allowMessage = true,
        allowAudioCall = true,
        allowVideoCall = true,
        allowSilentObserve = false, // 默认不给, 怕滥用 (爷爷可能不熟敏感性)
        allowForcePickup = false,
        allowRemoteView = false,
        allowRuleEdit = false, // 关键区别: 需 primary 确认
        allowTaskAssign = true,
        allowAppDisable = false,
        allowAppHide = false,
        allowPaymentVeto = true, // 一票否决保留
        allowLocationView = true,
        allowGeofenceEdit = false, // 不可改围栏
        allowSosReceive = true, // SOS 广播给所有 guardian
        allowRewardGrant = true, // 爷爷给积分天然合理
        allowCompanionSummary = CompanionSummaryAccess.STATS_ONLY,
        allowEmergencyUnbind = false,
    )
}
