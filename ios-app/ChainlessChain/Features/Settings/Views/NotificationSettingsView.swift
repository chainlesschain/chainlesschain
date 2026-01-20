import SwiftUI
import UserNotifications

/// Notification Settings View - Configure push notification preferences
struct NotificationSettingsView: View {
    @StateObject private var notificationManager = PushNotificationManager.shared
    @State private var showingPermissionAlert = false

    var body: some View {
        List {
            // MARK: - Authorization Status
            Section {
                HStack {
                    Image(systemName: authorizationIcon)
                        .foregroundColor(authorizationColor)
                        .font(.title2)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("通知权限")
                            .font(.headline)
                        Text(authorizationStatusText)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    if !notificationManager.isAuthorized {
                        Button("开启") {
                            requestPermission()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                }
                .padding(.vertical, 4)
            } header: {
                Text("状态")
            } footer: {
                if !notificationManager.isAuthorized {
                    Text("需要开启通知权限才能接收消息提醒")
                }
            }

            // MARK: - Message Notifications
            Section {
                Toggle(isOn: Binding(
                    get: { notificationManager.notificationSettings.messagesEnabled },
                    set: { newValue in
                        var settings = notificationManager.notificationSettings
                        settings.messagesEnabled = newValue
                        notificationManager.updateSettings(settings)
                    }
                )) {
                    Label("私聊消息", systemImage: "message.fill")
                }

                Toggle(isOn: Binding(
                    get: { notificationManager.notificationSettings.groupMessagesEnabled },
                    set: { newValue in
                        var settings = notificationManager.notificationSettings
                        settings.groupMessagesEnabled = newValue
                        notificationManager.updateSettings(settings)
                    }
                )) {
                    Label("群聊消息", systemImage: "person.3.fill")
                }
            } header: {
                Text("消息通知")
            }

            // MARK: - Display Settings
            Section {
                Toggle(isOn: Binding(
                    get: { notificationManager.notificationSettings.soundEnabled },
                    set: { newValue in
                        var settings = notificationManager.notificationSettings
                        settings.soundEnabled = newValue
                        notificationManager.updateSettings(settings)
                    }
                )) {
                    Label("声音", systemImage: "speaker.wave.2.fill")
                }

                Toggle(isOn: Binding(
                    get: { notificationManager.notificationSettings.badgeEnabled },
                    set: { newValue in
                        var settings = notificationManager.notificationSettings
                        settings.badgeEnabled = newValue
                        notificationManager.updateSettings(settings)
                    }
                )) {
                    Label("角标", systemImage: "app.badge.fill")
                }

                Toggle(isOn: Binding(
                    get: { notificationManager.notificationSettings.previewEnabled },
                    set: { newValue in
                        var settings = notificationManager.notificationSettings
                        settings.previewEnabled = newValue
                        notificationManager.updateSettings(settings)
                    }
                )) {
                    Label("显示内容预览", systemImage: "eye.fill")
                }
            } header: {
                Text("显示设置")
            } footer: {
                Text("关闭内容预览后，通知将仅显示"发来了一条消息"")
            }

            // MARK: - Quiet Hours
            Section {
                Toggle(isOn: Binding(
                    get: { notificationManager.notificationSettings.quietHoursEnabled },
                    set: { newValue in
                        var settings = notificationManager.notificationSettings
                        settings.quietHoursEnabled = newValue
                        notificationManager.updateSettings(settings)
                    }
                )) {
                    Label("免打扰时段", systemImage: "moon.fill")
                }

                if notificationManager.notificationSettings.quietHoursEnabled {
                    HStack {
                        Text("开始时间")
                        Spacer()
                        Picker("", selection: Binding(
                            get: { notificationManager.notificationSettings.quietHoursStart },
                            set: { newValue in
                                var settings = notificationManager.notificationSettings
                                settings.quietHoursStart = newValue
                                notificationManager.updateSettings(settings)
                            }
                        )) {
                            ForEach(0..<24, id: \.self) { hour in
                                Text(formatHour(hour)).tag(hour)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    HStack {
                        Text("结束时间")
                        Spacer()
                        Picker("", selection: Binding(
                            get: { notificationManager.notificationSettings.quietHoursEnd },
                            set: { newValue in
                                var settings = notificationManager.notificationSettings
                                settings.quietHoursEnd = newValue
                                notificationManager.updateSettings(settings)
                            }
                        )) {
                            ForEach(0..<24, id: \.self) { hour in
                                Text(formatHour(hour)).tag(hour)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
            } header: {
                Text("免打扰")
            } footer: {
                if notificationManager.notificationSettings.quietHoursEnabled {
                    Text("在 \(formatHour(notificationManager.notificationSettings.quietHoursStart)) 至 \(formatHour(notificationManager.notificationSettings.quietHoursEnd)) 期间不会收到通知提醒")
                }
            }

            // MARK: - Badge Management
            Section {
                Button(action: {
                    Task {
                        await notificationManager.clearBadge()
                    }
                }) {
                    Label("清除角标", systemImage: "app.badge.checkmark")
                }

                Button(action: {
                    notificationManager.removeAllDeliveredNotifications()
                }) {
                    Label("清除所有通知", systemImage: "trash")
                }
                .foregroundColor(.red)
            } header: {
                Text("管理")
            }

            // MARK: - Device Token (Debug)
            #if DEBUG
            if let deviceToken = notificationManager.deviceToken {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("设备令牌")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(deviceToken)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(nil)
                    }
                    .padding(.vertical, 4)

                    Button("复制令牌") {
                        UIPasteboard.general.string = deviceToken
                    }
                } header: {
                    Text("调试信息")
                }
            }
            #endif
        }
        .navigationTitle("通知设置")
        .navigationBarTitleDisplayMode(.inline)
        .alert("需要通知权限", isPresented: $showingPermissionAlert) {
            Button("取消", role: .cancel) {}
            Button("去设置") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
        } message: {
            Text("请在系统设置中开启通知权限，以便接收消息提醒")
        }
        .task {
            await notificationManager.checkAuthorizationStatus()
        }
    }

    // MARK: - Computed Properties

    private var authorizationIcon: String {
        switch notificationManager.authorizationStatus {
        case .authorized, .provisional:
            return "checkmark.circle.fill"
        case .denied:
            return "xmark.circle.fill"
        case .notDetermined:
            return "questionmark.circle.fill"
        @unknown default:
            return "questionmark.circle.fill"
        }
    }

    private var authorizationColor: Color {
        switch notificationManager.authorizationStatus {
        case .authorized, .provisional:
            return .green
        case .denied:
            return .red
        case .notDetermined:
            return .orange
        @unknown default:
            return .gray
        }
    }

    private var authorizationStatusText: String {
        switch notificationManager.authorizationStatus {
        case .authorized:
            return "已开启"
        case .provisional:
            return "临时授权"
        case .denied:
            return "已关闭 - 请在系统设置中开启"
        case .notDetermined:
            return "未设置"
        @unknown default:
            return "未知状态"
        }
    }

    // MARK: - Helper Methods

    private func formatHour(_ hour: Int) -> String {
        if hour == 0 {
            return "00:00"
        } else if hour < 10 {
            return "0\(hour):00"
        } else {
            return "\(hour):00"
        }
    }

    private func requestPermission() {
        Task {
            let granted = await notificationManager.requestAuthorization()
            if !granted {
                await MainActor.run {
                    showingPermissionAlert = true
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        NotificationSettingsView()
    }
}
