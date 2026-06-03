import SwiftUI
import CoreP2P

/// 通知 skill 主 view — Phase 4.4。
///
/// **布局参考**（per Phase 4 design §6.4 + memory `feedback_ios_ui_mirrors_validated_android.md`）:
/// `android-app/feature-p2p/src/main/.../social/NotificationCenterScreen.kt`
/// 顶部 toolbar 含 "更多" 菜单（全部已读 / 清空 / 设置 / toggle 仅未读）+ List
/// of NotificationCard with swipe action + 空状态 + sheet detail + pull-to-refresh。
///
/// HIG 偏离白名单 (per Phase 4 design §10):
/// - Compose `TopAppBar + DropdownMenu` → SwiftUI `.toolbar { Menu { ... } }`
/// - Compose `LazyColumn` → SwiftUI `List(.insetGrouped)`
/// - Compose `ModalBottomSheet` → SwiftUI `.sheet(isPresented:)` / `.sheet(item:)`
/// - Compose `Pull-to-refresh` → SwiftUI `.refreshable`
/// - Compose `SnackbarHost` → SwiftUI 顶部 banner（per Phase 3 ErrorBanner pattern）
/// - 类型 filter 用 segmented Picker "全部 / 未读"（Phase 4 v0.1 不区分通知类型）
struct NotificationsView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        let webRTC = remoteDeps.webRTCClient
        return Inner(
            pcPeerId: pcPeerId,
            commands: remoteDeps.notification,
            dispatcher: remoteDeps.notificationDispatcher,
            offlineQueue: remoteDeps.offlineQueue,
            isDataChannelReady: { await webRTC.currentState == .ready },
            currentDIDProvider: pairingDeps.currentDIDProvider
        )
    }
}

// MARK: - Inner View

private struct Inner: View {
    @StateObject private var vm: RemoteNotificationsViewModel
    @State private var detailItem: NotificationHistoryItem?
    @State private var showSettingsSheet = false
    @State private var showClearConfirm = false

    init(
        pcPeerId: String,
        commands: NotificationCommands,
        dispatcher: NotificationEventDispatcher,
        offlineQueue: OfflineCommandQueue?,
        isDataChannelReady: @escaping @Sendable () async -> Bool,
        currentDIDProvider: @escaping () -> String?
    ) {
        _vm = StateObject(wrappedValue: RemoteNotificationsViewModel(
            pcPeerId: pcPeerId,
            commands: commands,
            dispatcher: dispatcher,
            offlineQueue: offlineQueue,
            isDataChannelReady: isDataChannelReady,
            currentDIDProvider: currentDIDProvider
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Filter row
            Picker("Filter", selection: $vm.unreadOnly) {
                Text("全部").tag(false)
                Text("未读").tag(true)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .onChange(of: vm.unreadOnly) { _ in
                Task { await vm.loadHistory() }
            }

            // Error banner (top)
            if let err = vm.lastError {
                errorBanner(err)
            }

            // Body
            if vm.isLoading && vm.history.isEmpty {
                loadingState
            } else if vm.history.isEmpty {
                emptyState
            } else {
                listView
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("通知")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                moreMenu
            }
        }
        .task {
            await vm.loadHistory()
        }
        .sheet(item: $detailItem) { item in
            NotificationDetailSheet(item: item)
        }
        .sheet(isPresented: $showSettingsSheet) {
            NotificationSettingsSheet(vm: vm)
        }
        .alert("清空所有通知？", isPresented: $showClearConfirm) {
            Button("清空", role: .destructive) {
                Task { await vm.clearAll() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将删除桌面端所有 \(vm.history.count) 条通知，无法撤销。")
        }
    }

    // MARK: - States

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "bell.slash")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text(vm.unreadOnly ? "暂无未读通知" : "暂无通知")
                .font(.headline)
            Text("桌面 push 的通知会出现在这里")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("加载中…")
                .font(.callout)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var listView: some View {
        List {
            ForEach(vm.history) { item in
                NotificationRow(item: item)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        detailItem = item
                        // tap 即标已读（与桌面端通知行为一致）
                        if !item.read {
                            Task { await vm.markAsRead(id: item.id) }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            Task { await vm.delete(id: item.id) }
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                        if !item.read {
                            Button {
                                Task { await vm.markAsRead(id: item.id) }
                            } label: {
                                Label("已读", systemImage: "envelope.open")
                            }
                            .tint(.blue)
                        }
                    }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await vm.refresh() }
    }

    // MARK: - Toolbar

    private var moreMenu: some View {
        Menu {
            Button {
                Task { await vm.markAllAsRead() }
            } label: {
                Label("全部已读", systemImage: "checkmark.circle")
            }
            .disabled(vm.unreadCount == 0)

            Button(role: .destructive) {
                showClearConfirm = true
            } label: {
                Label("清空", systemImage: "trash")
            }
            .disabled(vm.history.isEmpty)

            Divider()

            Button {
                showSettingsSheet = true
                Task { await vm.loadDesktopSettings() }
            } label: {
                Label("设置", systemImage: "gear")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    // MARK: - Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "info.circle.fill")
                .foregroundColor(.white)
            Text(message)
                .font(.caption)
                .foregroundColor(.white)
                .lineLimit(2)
            Spacer()
            Button {
                vm.clearError()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.white.opacity(0.8))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(message.contains("离线") ? Color.orange : Color.red)
    }
}

// MARK: - Row

private struct NotificationRow: View {
    let item: NotificationHistoryItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: sourceIcon)
                .font(.title3)
                .foregroundColor(item.read ? .secondary : .accentColor)
                .frame(width: 32, height: 32)
                .background(
                    Circle()
                        .fill(item.read ? Color(.systemGray5) : Color.accentColor.opacity(0.15))
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(item.title)
                        .font(.body)
                        .fontWeight(item.read ? .regular : .semibold)
                        .lineLimit(1)
                    if !item.read {
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 6, height: 6)
                    }
                    Spacer()
                    priorityBadge
                }
                Text(item.body)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                Text(relativeDate)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var sourceIcon: String {
        switch item.source {
        case "pc": return "desktopcomputer"
        case "mobile": return "iphone"
        default: return "bell"
        }
    }

    @ViewBuilder
    private var priorityBadge: some View {
        if item.priority == .urgent || item.priority == .high {
            Text(item.priority.rawValue.uppercased())
                .font(.system(size: 9, weight: .bold))
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(item.priority == .urgent ? Color.red : Color.orange)
                .foregroundColor(.white)
                .cornerRadius(3)
        } else {
            EmptyView()
        }
    }

    private var relativeDate: String {
        let date = Date(timeIntervalSince1970: TimeInterval(item.createdAt) / 1000.0)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Detail Sheet

private struct NotificationDetailSheet: View {
    let item: NotificationHistoryItem
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Header
                    HStack(spacing: 8) {
                        Image(systemName: sourceIcon)
                        Text(sourceLabel)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text(priorityLabel)
                            .font(.caption)
                            .foregroundColor(priorityColor)
                    }
                    Divider()

                    // Title + body
                    Text(item.title)
                        .font(.title3)
                        .fontWeight(.semibold)
                    Text(item.body)
                        .font(.body)

                    Divider()

                    // Time + status
                    LabeledRow(label: "创建", value: formattedDate(item.createdAt))
                    if let readAt = item.readAt {
                        LabeledRow(label: "已读", value: formattedDate(readAt))
                    }
                    LabeledRow(label: "状态", value: item.read ? "已读" : "未读")
                    LabeledRow(label: "ID", value: item.id, monospaced: true)

                    // Custom data (Phase 4 v0.1 仅显，不交互)
                    if let data = item.data, !data.isEmpty {
                        Divider()
                        Text("附加数据")
                            .font(.headline)
                        ForEach(data.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                            LabeledRow(label: key, value: value, monospaced: true)
                        }
                    }
                }
                .padding(16)
            }
            .navigationTitle("通知详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private var sourceIcon: String {
        switch item.source {
        case "pc": return "desktopcomputer"
        case "mobile": return "iphone"
        default: return "bell"
        }
    }

    private var sourceLabel: String {
        switch item.source {
        case "pc": return "桌面端"
        case "mobile": return "其它移动设备"
        default: return item.source
        }
    }

    private var priorityLabel: String {
        switch item.priority {
        case .urgent: return "🔴 紧急"
        case .high: return "🟠 高"
        case .normal: return "⚪ 普通"
        case .low: return "⚪ 低"
        }
    }

    private var priorityColor: Color {
        switch item.priority {
        case .urgent: return .red
        case .high: return .orange
        case .normal, .low: return .secondary
        }
    }

    private func formattedDate(_ ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

private struct LabeledRow: View {
    let label: String
    let value: String
    var monospaced: Bool = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(width: 60, alignment: .leading)
            Text(value)
                .font(monospaced ? .system(.caption, design: .monospaced) : .caption)
                .foregroundColor(.primary)
                .lineLimit(3)
                .truncationMode(.middle)
            Spacer()
        }
    }
}

// MARK: - Settings Sheet

/// Phase 4.4 v0.1 — 桌面端 settings readonly 显示 + 链接到 iOS 系统设置（per OQ-4）。
/// 桌面端 settings 编辑由桌面端管理；iOS UN center 设置由 PushNotificationManager
/// 既有 NotificationSettingsView 管（不在本 sheet 内嵌，保持本 sheet 轻量）。
private struct NotificationSettingsSheet: View {
    @ObservedObject var vm: RemoteNotificationsViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        HStack {
                            Label("打开 iOS 通知权限", systemImage: "iphone.gen3.badge.play")
                            Spacer()
                            Image(systemName: "arrow.up.forward.app")
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("iOS 端")
                } footer: {
                    Text("在系统设置中管理 ChainlessChain 的通知权限、声音、横幅、锁屏显示等。")
                }

                Section {
                    if let s = vm.desktopSettings {
                        SettingsReadonlyRow(label: "启用", value: s.enabled ? "✓" : "✗")
                        SettingsReadonlyRow(label: "免打扰", value: s.quietHoursEnabled ? "✓" : "✗")
                        if s.quietHoursEnabled {
                            if let start = s.quietHoursStart {
                                SettingsReadonlyRow(label: "开始", value: start)
                            }
                            if let end = s.quietHoursEnd {
                                SettingsReadonlyRow(label: "结束", value: end)
                            }
                        }
                        SettingsReadonlyRow(label: "声音", value: s.soundEnabled ? "✓" : "✗")
                        SettingsReadonlyRow(label: "震动", value: s.vibrationEnabled ? "✓" : "✗")
                        SettingsReadonlyRow(label: "预览", value: s.showPreview ? "✓" : "✗")
                        Button {
                            Task { await vm.loadDesktopSettings() }
                        } label: {
                            Label("刷新桌面端 settings", systemImage: "arrow.clockwise")
                        }
                    } else {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    }
                } header: {
                    Text("桌面端")
                } footer: {
                    Text("桌面端通知设置由桌面端管理（在桌面 V6 设置中调整），iOS 端只读。")
                }
            }
            .navigationTitle("通知设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }
}

private struct SettingsReadonlyRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .foregroundColor(.secondary)
                .font(.system(.body, design: .monospaced))
        }
    }
}
