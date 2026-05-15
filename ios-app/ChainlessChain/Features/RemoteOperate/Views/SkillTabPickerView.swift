import SwiftUI
import CoreP2P

/// Phase 3.3 — RemoteOperateView 顶部 5-tab segmented picker + risk badge。
///
/// **HIG 偏离**（design doc §4.5 白名单）：Compose `TabRow` →
/// SwiftUI `Picker(selection:) { ... }.pickerStyle(.segmented)`。risk badge
/// 用小圆点显在 segmented label 旁。
struct SkillTabPickerView: View {
    @Binding var selected: RemoteOperateView.SkillTab

    var body: some View {
        Picker("Skill", selection: $selected) {
            ForEach(RemoteOperateView.SkillTab.allCases) { tab in
                HStack(spacing: 4) {
                    Image(systemName: tab.icon)
                    Text(tab.label)
                }
                .tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}
