import SwiftUI
import CoreP2P

/// Phase 3.3 → Phase 4.5 重写 — 顶部 skill tab picker，horizontal ScrollView +
/// button row + 自定义未读 badge overlay。
///
/// **Phase 4.5 改造原因** (per Phase 4 design §7.9 trap):
/// iOS HIG `Picker(.segmented)` 软上限 5 segment, 6 tab 视觉拥挤; segmented 也
/// 无原生 badge 接口。改用 horizontal ScrollView + Button row 后:
/// (a) 按需扩展 N tab 视觉舒适
/// (b) 自定义 badge overlay 给 notification tab 显未读数 (`bell.badge.fill`
///     icon + 红圆数字)
/// (c) 与 Discord / Slack 移动端 channel switcher pattern 一致
///
/// **Trade-off vs segmented**: 失去 iOS 原生 segmented "press 整段高亮" 效果;
/// 用 .accentColor 半透明背景近似。可用性 + 信息密度收益盖过视觉损失。
struct SkillTabPickerView: View {
    @Binding var selected: RemoteOperateView.SkillTab
    @ObservedObject var dispatcher: NotificationEventDispatcher

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(RemoteOperateView.SkillTab.allCases) { tab in
                    tabButton(for: tab)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func tabButton(for tab: RemoteOperateView.SkillTab) -> some View {
        let isSelected = selected == tab
        let unread = tab == .notification ? dispatcher.unreadCount : 0

        Button {
            selected = tab
        } label: {
            HStack(spacing: 4) {
                Image(systemName: iconName(for: tab, unread: unread))
                    .font(.system(size: 14, weight: .medium))
                Text(tab.label)
                    .font(.system(size: 13, weight: .medium))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 7)
                    .fill(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
            )
            .foregroundColor(isSelected ? Color.accentColor : Color.primary)
            .overlay(alignment: .topTrailing) {
                if unread > 0 {
                    unreadBadge(count: unread)
                        .offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
    }

    /// notification tab unread > 0 时切到 fill 变体（视觉强化未读）。
    private func iconName(for tab: RemoteOperateView.SkillTab, unread: Int) -> String {
        if tab == .notification && unread > 0 {
            return "bell.badge.fill"
        }
        return tab.icon
    }

    /// 红色圆形 badge — 显未读数（>99 显 "99+"）。
    private func unreadBadge(count: Int) -> some View {
        let display = count > 99 ? "99+" : "\(count)"
        return Text(display)
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .frame(minWidth: 16, minHeight: 16)
            .background(Capsule().fill(Color.red))
    }
}
