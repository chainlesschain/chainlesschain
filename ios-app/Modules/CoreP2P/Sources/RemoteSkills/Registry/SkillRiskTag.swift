import Foundation

/// Skill 风险等级 — Phase 3.1，与 Android `SkillRiskTag` (registry/SkillMetadata.kt) 1:1 对齐。
///
/// 决定 UI 是否需 ApprovalUI 二次确认 + 风险 badge 颜色。
public enum SkillRiskTag: String, Codable, Sendable, Equatable, CaseIterable {
    /// 只读 / 无副作用（如 system.info / clipboard.get / file.list）。
    /// UI 直接执行无需提示。
    case Safe

    /// 修改桌面状态但可恢复（如 clipboard.set / notification.show / browser.navigate）。
    /// UI 显黄色 badge，无需 ApprovalUI（用户已通过 tap 表达意图）。
    case Mutating

    /// 高风险 / 不可逆 / 系统级（如 system.shutdown / file.delete / process.kill）。
    /// UI 显红色 badge + **强 ApprovalUI** 二次确认。
    case Privileged
}
