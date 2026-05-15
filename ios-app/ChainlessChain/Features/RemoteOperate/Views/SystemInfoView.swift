import SwiftUI
import CoreP2P

/// 系统信息 skill view — Phase 3.5 (OQ-3: 5s polling)。
///
/// **布局**：4 cards (CPU / Memory / Disk / Network) + 顶部 last-updated +
/// 手动刷新按钮。Auto-refresh on appear / stop on disappear。
struct SystemInfoView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        Inner(
            pcPeerId: pcPeerId,
            systemInfo: remoteDeps.systemInfo,
            currentDIDProvider: pairingDeps.currentDIDProvider
        )
    }
}

private struct Inner: View {
    @StateObject private var vm: SystemInfoViewModel

    init(pcPeerId: String, systemInfo: SystemInfoCommands, currentDIDProvider: @escaping () -> String?) {
        _vm = StateObject(wrappedValue: SystemInfoViewModel(
            pcPeerId: pcPeerId,
            systemInfo: systemInfo,
            currentDIDProvider: currentDIDProvider
        ))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let err = vm.lastError {
                    errorBanner(err)
                }
                statusBar

                if let info = vm.info {
                    if let cpu = info.cpu { cpuCard(cpu) }
                    if let memory = info.memory { memoryCard(memory) }
                    if let disk = info.disk { diskCard(disk) }
                    if let network = info.network { networkCard(network) }
                    if let uptime = info.uptime { uptimeCard(uptime) }
                } else if !vm.busy {
                    emptyState
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .refreshable { await vm.refresh() }
        .onAppear { vm.onAppear() }
        .onDisappear { vm.onDisappear() }
    }

    // MARK: - Subviews

    private var statusBar: some View {
        HStack(spacing: 8) {
            Image(systemName: vm.busy ? "arrow.clockwise.circle" : "clock")
                .foregroundColor(.blue)
                .symbolEffect(.rotate, isActive: vm.busy)
            if let updated = vm.lastUpdated {
                Text("更新于 \(formatTime(updated))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                Text(vm.busy ? "拉取中…" : "未拉取")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            Text("每 \(Int(vm.pollingIntervalSeconds))s 刷新")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(.systemBackground)))
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer().frame(height: 60)
            Image(systemName: "cpu")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("等待桌面端响应…")
                .font(.headline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func cpuCard(_ cpu: CpuInfo) -> some View {
        infoCard(
            title: "CPU",
            icon: "cpu",
            primary: cpu.usagePercent.map { String(format: "%.1f%%", $0) } ?? "—",
            primarySubtitle: "占用率",
            secondaryRows: [
                ("型号", cpu.model ?? "—"),
                ("核心", cpu.cores.map(String.init) ?? "—"),
                ("频率", cpu.speedMhz.map { "\($0) MHz" } ?? "—"),
            ]
        )
    }

    private func memoryCard(_ mem: MemoryInfo) -> some View {
        infoCard(
            title: "内存",
            icon: "memorychip",
            primary: mem.usagePercent.map { String(format: "%.1f%%", $0) } ?? "—",
            primarySubtitle: "占用率",
            secondaryRows: [
                ("总", formatBytes(mem.totalBytes)),
                ("已用", formatBytes(mem.usedBytes)),
                ("空闲", formatBytes(mem.freeBytes)),
            ]
        )
    }

    private func diskCard(_ disk: DiskInfo) -> some View {
        infoCard(
            title: "磁盘",
            icon: "internaldrive",
            primary: disk.usagePercent.map { String(format: "%.1f%%", $0) } ?? "—",
            primarySubtitle: disk.mountPoint ?? "占用率",
            secondaryRows: [
                ("总", formatBytes(disk.totalBytes)),
                ("已用", formatBytes(disk.usedBytes)),
                ("空闲", formatBytes(disk.freeBytes)),
            ]
        )
    }

    private func networkCard(_ net: NetworkInfo) -> some View {
        infoCard(
            title: "网络",
            icon: "network",
            primary: net.ipv4 ?? "—",
            primarySubtitle: net.interfaceName ?? "IPv4",
            secondaryRows: [
                ("已发", formatBytes(net.bytesSent)),
                ("已收", formatBytes(net.bytesReceived)),
            ]
        )
    }

    private func uptimeCard(_ uptime: Int64) -> some View {
        let days = uptime / 86400
        let hours = (uptime % 86400) / 3600
        let minutes = (uptime % 3600) / 60
        let formatted = days > 0
            ? "\(days)天 \(hours)小时"
            : (hours > 0 ? "\(hours)小时 \(minutes)分钟" : "\(minutes)分钟")
        return infoCard(
            title: "运行时长",
            icon: "stopwatch",
            primary: formatted,
            primarySubtitle: "桌面 uptime",
            secondaryRows: []
        )
    }

    private func infoCard(title: String, icon: String, primary: String, primarySubtitle: String, secondaryRows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundColor(.blue)
                Text(title)
                    .font(.headline)
                Spacer()
            }
            HStack(alignment: .firstTextBaseline) {
                Text(primary)
                    .font(.title.weight(.semibold))
                    .foregroundColor(.primary)
                Text(primarySubtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
            }
            if !secondaryRows.isEmpty {
                Divider()
                ForEach(secondaryRows, id: \.0) { row in
                    HStack {
                        Text(row.0).font(.caption).foregroundColor(.secondary)
                        Spacer()
                        Text(row.1).font(.caption).foregroundColor(.primary)
                            .lineLimit(1).truncationMode(.middle)
                    }
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemBackground)))
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(message)
                .font(.caption).lineLimit(3)
            Spacer()
            Button { vm.clearError() } label: {
                Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.red.opacity(0.1)))
    }

    private func formatBytes(_ bytes: Int64?) -> String {
        guard let bytes = bytes, bytes > 0 else { return "—" }
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        if bytes < 1024 * 1024 * 1024 { return String(format: "%.1f MB", Double(bytes) / (1024 * 1024)) }
        return String(format: "%.2f GB", Double(bytes) / (1024 * 1024 * 1024))
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }
}
