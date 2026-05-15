import SwiftUI
import CoreP2P

/// 已配对桌面列表 — Phase 1.4 完整实现。
///
/// **布局优先参考已真机验证的 Android 端**（memory `feedback_ios_ui_mirrors_validated_android.md`）：
/// `android-app/app/src/main/java/com/chainlesschain/android/presentation/screens/peers/PairedDevicesScreen.kt`
/// + `PairedDevicesViewModel.kt`（v1.3+ 持久化层 issue #21 收口）。stats 顶部
/// + 列表 + 解除全部底部按钮 — 都照抄。
///
/// HIG 偏离白名单：(1) Android 用 LazyColumn DeviceCard 点击；iOS 改 List swipe
/// `.swipeActions(.trailing)`（HIG 标准；Android 无对位但 iOS 用户期待）。
/// (2) Android Card (elevation) → SwiftUI 默认 List row。
struct PairedDevicesListView: View {
    @EnvironmentObject var deps: PairingDependencies
    @State private var devices: [PairedDesktop] = []
    @State private var deviceToRemove: PairedDesktop?
    @State private var showRemoveAlert = false
    @State private var showRemoveAllAlert = false

    var body: some View {
        Group {
            if devices.isEmpty {
                emptyState
            } else {
                List {
                    Section {
                        ForEach(devices) { device in
                            DeviceRow(device: device)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        deviceToRemove = device
                                        showRemoveAlert = true
                                    } label: {
                                        Label("解除配对", systemImage: "trash")
                                    }
                                }
                        }
                    } header: {
                        Text("\(devices.count) 台桌面已配对")
                            .font(.subheadline).fontWeight(.semibold)
                            .foregroundColor(.primary)
                            .textCase(nil)
                    }

                    Section {
                        Button(role: .destructive) {
                            showRemoveAllAlert = true
                        } label: {
                            HStack {
                                Spacer()
                                Label("解除全部配对", systemImage: "xmark.circle")
                                Spacer()
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("已配对桌面")
        .navigationBarTitleDisplayMode(.inline)
        .onReceive(deps.pairedDesktopsStore.devicesPublisher().receive(on: DispatchQueue.main)) { newDevices in
            // 按 lastSeenAt 倒序（最近活跃最上）
            devices = newDevices.sorted { $0.lastSeenAt > $1.lastSeenAt }
        }
        .alert("解除配对", isPresented: $showRemoveAlert, presenting: deviceToRemove) { device in
            Button("解除", role: .destructive) {
                Task {
                    await deps.pairedDesktopsStore.remove(pcPeerId: device.pcPeerId)
                }
            }
            Button("取消", role: .cancel) {}
        } message: { device in
            Text("将解除与「\(device.deviceName)」的配对，需重新扫码才能恢复连接。")
        }
        .alert("解除全部配对", isPresented: $showRemoveAllAlert) {
            Button("全部解除", role: .destructive) {
                Task { await deps.pairedDesktopsStore.clear() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将解除全部 \(devices.count) 台桌面的配对，需逐一重新扫码才能恢复。")
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("尚未配对任何桌面")
                .font(.headline)
            Text("通过「扫描桌面」「显示我的」「手动输入」任一方式完成首次配对")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Row

private struct DeviceRow: View {
    let device: PairedDesktop

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: platformIcon(device.platform))
                .font(.system(size: 28))
                .foregroundColor(.blue)
                .frame(width: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.deviceName)
                    .font(.body).fontWeight(.medium)
                Text(device.pcPeerId)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("配对于 \(relativeTime(epochMs: device.pairedAt))")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func platformIcon(_ platform: String) -> String {
        switch platform {
        case "win32": return "pc"
        case "darwin": return "macbook"
        case "linux": return "desktopcomputer"
        default: return "desktopcomputer"
        }
    }

    private func relativeTime(epochMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(epochMs) / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.locale = Locale(identifier: "zh_CN")
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

#Preview {
    NavigationView {
        PairedDevicesListView()
            .environmentObject(PairingDependencies())
    }
}
