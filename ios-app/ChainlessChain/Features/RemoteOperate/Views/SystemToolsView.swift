import SwiftUI
import CoreP2P

/// 系统工具集合 — Phase 6.1.7 (B1 第 1 批 + B3 红档子集 — 后台型 9 skill 收纳)。
///
/// **顶部 horizontal picker** 9 子 tab:
/// - 应用 (app, 8 method)
/// - 安全 (security, 8 method)
/// - 浏览器 (userBrowser CDP, 18 method)
/// - 电源 (power, 10 method)
/// - 进程 (process, 6 method)
/// - 网络 (network, 11 method)
/// - 存储 (storage, 10 method)
/// - 设备 (device, 4 method)
/// - 系统信息 (sysinfo extended, 10 method)
///
/// **设计**: 每个子 view 走 list-of-actions + raw output 模式 — 不做 bespoke UI
/// (每个 skill ~150-300 LOC bespoke 不可能 land 在 Phase 6.1.7 1 晚)。Phase 7+ 按用户
/// 高频需求迭代 bespoke UI (e.g., 进程列表点击 kill 一键操作；网络 ping 实时图表)。
struct SystemToolsView: View {
    let pcPeerId: String

    @State private var selectedSubTab: SubTab = .app

    enum SubTab: String, CaseIterable, Identifiable {
        case app, security, userBrowser, power, process, network, storage, device, sysinfo

        var id: String { rawValue }

        var label: String {
            switch self {
            case .app:         return "应用"
            case .security:    return "安全"
            case .userBrowser: return "浏览器"
            case .power:       return "电源"
            case .process:     return "进程"
            case .network:     return "网络"
            case .storage:     return "存储"
            case .device:      return "设备"
            case .sysinfo:     return "系统"
            }
        }

        var icon: String {
            switch self {
            case .app:         return "app.badge"
            case .security:    return "lock.shield"
            case .userBrowser: return "globe"
            case .power:       return "power"
            case .process:     return "memorychip"
            case .network:     return "network"
            case .storage:     return "internaldrive"
            case .device:      return "iphone.and.arrow.forward"
            case .sysinfo:     return "cpu"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            subTabPicker
                .background(Color(.systemBackground))
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var subTabPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(SubTab.allCases) { tab in
                    pickerButton(tab)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func pickerButton(_ tab: SubTab) -> some View {
        let isSelected = selectedSubTab == tab
        Button {
            selectedSubTab = tab
        } label: {
            HStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 12, weight: .medium))
                Text(tab.label)
                    .font(.system(size: 12, weight: .medium))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
            )
            .foregroundColor(isSelected ? .accentColor : .primary)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var content: some View {
        switch selectedSubTab {
        case .app:         AppToolView(pcPeerId: pcPeerId)
        case .security:    SecurityToolView(pcPeerId: pcPeerId)
        case .userBrowser: UserBrowserToolView(pcPeerId: pcPeerId)
        case .power:       PowerToolView(pcPeerId: pcPeerId)
        case .process:     ProcessToolView(pcPeerId: pcPeerId)
        case .network:     NetworkToolView(pcPeerId: pcPeerId)
        case .storage:     StorageToolView(pcPeerId: pcPeerId)
        case .device:      DeviceToolView(pcPeerId: pcPeerId)
        case .sysinfo:     SysInfoExtendedToolView(pcPeerId: pcPeerId)
        }
    }
}

// MARK: - 通用 ActionRow 组件

/// 单个 skill 的操作行 — 点按执行 async action，结果 inline 显示。
struct ActionRow<Response>: View {
    let title: String
    let subtitle: String?
    let action: () async throws -> Response
    let formatter: (Response) -> String

    @State private var lastResult: String? = nil
    @State private var lastError: String? = nil
    @State private var running: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await run() }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.subheadline).fontWeight(.medium)
                        if let s = subtitle {
                            Text(s).font(.caption).foregroundColor(.secondary)
                        }
                    }
                    Spacer()
                    if running {
                        ProgressView().scaleEffect(0.7)
                    } else {
                        Image(systemName: "play.fill").foregroundColor(.accentColor)
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(.secondarySystemBackground)))
            }
            .buttonStyle(.plain)
            .disabled(running)

            if let r = lastResult {
                Text(r)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundColor(.secondary)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color(.tertiarySystemBackground)))
            }
            if let e = lastError {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
                    Text(e).font(.caption)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange.opacity(0.1)))
            }
        }
    }

    private func run() async {
        running = true
        defer { running = false }
        do {
            let r = try await action()
            await MainActor.run {
                lastResult = formatter(r); lastError = nil
            }
        } catch {
            await MainActor.run {
                lastError = error.localizedDescription; lastResult = nil
            }
        }
    }
}

// MARK: - 9 子 view

private struct AppToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ActionRow(
                    title: "列已安装应用", subtitle: "app.listInstalled (limit=20)",
                    action: { try await remoteDeps.application.listInstalled(pcPeerId: pcPeerId, limit: 20) },
                    formatter: { r in "\(r.total) 个应用，返回 \(r.apps.count)，首项: \(r.apps.first?.name ?? "-")" }
                )
                ActionRow(
                    title: "列运行中应用", subtitle: "app.listRunning",
                    action: { try await remoteDeps.application.listRunning(pcPeerId: pcPeerId, limit: 20) },
                    formatter: { r in "\(r.total) 个运行中，首项: \(r.apps.first?.name ?? "-")" }
                )
                ActionRow(
                    title: "最近使用应用", subtitle: "app.getRecent",
                    action: { try await remoteDeps.application.getRecent(pcPeerId: pcPeerId) },
                    formatter: { r in "\(r.total) 项；首项: \(r.apps.first?.name ?? "-")" }
                )
            }
            .padding(12)
        }
    }
}

private struct SecurityToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ActionRow(
                    title: "安全状态摘要", subtitle: "security.getStatus",
                    action: { try await remoteDeps.security.getStatus(pcPeerId: pcPeerId) },
                    formatter: { r in
                        let fw = r.security.firewallEnabled.map(String.init) ?? "?"
                        let av = r.security.antivirusInstalled.map(String.init) ?? "?"
                        return "platform=\(r.security.platform) | 防火墙=\(fw) | AV=\(av) | 待更新=\(r.security.pendingUpdates ?? 0)"
                    }
                )
                ActionRow(
                    title: "活动用户", subtitle: "security.getActiveUsers",
                    action: { try await remoteDeps.security.getActiveUsers(pcPeerId: pcPeerId) },
                    formatter: { r in "当前=\(r.currentUser) | 共 \(r.count) 用户" }
                )
                ActionRow(
                    title: "防火墙", subtitle: "security.getFirewallStatus",
                    action: { try await remoteDeps.security.getFirewallStatus(pcPeerId: pcPeerId) },
                    formatter: { r in
                        let en = r.enabled.map(String.init) ?? "?"
                        let rules = r.ruleCount.map(String.init) ?? "?"
                        return "enabled=\(en) | profiles=\(r.profiles.count) | rules=\(rules)"
                    }
                )
                ActionRow(
                    title: "杀毒软件", subtitle: "security.getAntivirusStatus",
                    action: { try await remoteDeps.security.getAntivirusStatus(pcPeerId: pcPeerId) },
                    formatter: { r in "installed=\(r.installed.map(String.init) ?? "?") | products=\(r.products.count)" }
                )
                ActionRow(
                    title: "加密状态", subtitle: "security.getEncryptionStatus",
                    action: { try await remoteDeps.security.getEncryptionStatus(pcPeerId: pcPeerId) },
                    formatter: { r in "type=\(r.type ?? "?") | enabled=\(r.enabled.map(String.init) ?? "?")" }
                )
                ActionRow(
                    title: "系统更新", subtitle: "security.getUpdates",
                    action: { try await remoteDeps.security.getUpdates(pcPeerId: pcPeerId) },
                    formatter: { r in "pending=\(r.pendingCount ?? 0) | updates=\(r.updates.count)" }
                )
            }
            .padding(12)
        }
    }
}

private struct UserBrowserToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ActionRow(
                    title: "查找浏览器", subtitle: "userBrowser.findBrowsers",
                    action: { try await remoteDeps.userBrowser.findBrowsers(pcPeerId: pcPeerId) },
                    formatter: { r in "\(r.browsers.count) 个浏览器: \(r.browsers.map { $0.type }.joined(separator: ", "))" }
                )
                ActionRow(
                    title: "连接状态", subtitle: "userBrowser.getStatus",
                    action: { try await remoteDeps.userBrowser.getStatus(pcPeerId: pcPeerId) },
                    formatter: { r in "connected=\(r.connected) | type=\(r.browserType ?? "-") | tabs=\(r.tabCount ?? 0)" }
                )
                ActionRow(
                    title: "列标签页", subtitle: "userBrowser.listTabs (需先 connect)",
                    action: { try await remoteDeps.userBrowser.listTabs(pcPeerId: pcPeerId) },
                    formatter: { r in "\(r.total) 个 tab; 首项: \(r.tabs.first?.url ?? "-")" }
                )
                ActionRow(
                    title: "活动标签页", subtitle: "userBrowser.getActiveTab",
                    action: { try await remoteDeps.userBrowser.getActiveTab(pcPeerId: pcPeerId) },
                    formatter: { r in "url=\(r.tab?.url ?? "-") | title=\(r.tab?.title ?? "-")" }
                )
            }
            .padding(12)
        }
    }
}

private struct PowerToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("⚠️ 锁屏 / 关机 / 重启 等为高危操作，桌面端默认要求二次确认 (confirm)")
                    .font(.caption).foregroundColor(.orange).padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange.opacity(0.1)))

                ActionRow(
                    title: "锁屏 (lock)", subtitle: "power.lock (NORMAL 权限)",
                    action: { try await remoteDeps.power.lock(pcPeerId: pcPeerId) },
                    formatter: { r in "\(r.message) | action=\(r.action)" }
                )
                ActionRow(
                    title: "睡眠 (请求 confirm)", subtitle: "power.sleep",
                    action: { try await remoteDeps.power.sleep(pcPeerId: pcPeerId, confirm: true) },
                    formatter: { r in
                        if r.requiresConfirmation {
                            return "需 confirm; confirmId=\(r.confirmId ?? "-")"
                        } else {
                            return "已执行: \(r.message)"
                        }
                    }
                )
                ActionRow(
                    title: "查看定时任务", subtitle: "power.getSchedule",
                    action: { try await remoteDeps.power.getSchedule(pcPeerId: pcPeerId) },
                    formatter: { r in "\(r.total) 个定时任务" }
                )
            }
            .padding(12)
        }
    }
}

private struct ProcessToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ActionRow(
                    title: "列进程 (Top 20 by CPU)", subtitle: "process.list",
                    action: { try await remoteDeps.process.list(pcPeerId: pcPeerId, limit: 20, sortBy: "cpu") },
                    formatter: { r in
                        let top3 = r.processes.prefix(3).map { "\($0.name)(pid=\($0.pid))" }.joined(separator: ", ")
                        return "\(r.total) 个进程; Top: \(top3)"
                    }
                )
                ActionRow(
                    title: "搜索 chrome", subtitle: "process.search query=chrome",
                    action: { try await remoteDeps.process.search(pcPeerId: pcPeerId, query: "chrome") },
                    formatter: { r in "\(r.total) 项匹配" }
                )
            }
            .padding(12)
        }
    }
}

private struct NetworkToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ActionRow(
                    title: "网络状态", subtitle: "network.getStatus",
                    action: { try await remoteDeps.network.getStatus(pcPeerId: pcPeerId) },
                    formatter: { r in
                        "online=\(r.online) | gw=\(r.gateway ?? "-") | DNS=\(r.dns.joined(separator: ", "))"
                    }
                )
                ActionRow(
                    title: "网卡列表", subtitle: "network.getInterfaces",
                    action: { try await remoteDeps.network.getInterfaces(pcPeerId: pcPeerId) },
                    formatter: { r in "\(r.interfaces.count) 个网卡" }
                )
                ActionRow(
                    title: "公网 IP", subtitle: "network.getPublicIP",
                    action: { try await remoteDeps.network.getPublicIP(pcPeerId: pcPeerId) },
                    formatter: { r in "ip=\(r.ip)" }
                )
                ActionRow(
                    title: "Wi-Fi 信息", subtitle: "network.getWifi",
                    action: { try await remoteDeps.network.getWifi(pcPeerId: pcPeerId) },
                    formatter: { r in "ssid=\(r.wifi.ssid ?? "-") | signal=\(r.wifi.signal ?? 0)" }
                )
                ActionRow(
                    title: "Ping 1.1.1.1", subtitle: "network.ping",
                    action: { try await remoteDeps.network.ping(pcPeerId: pcPeerId, host: "1.1.1.1", count: 4) },
                    formatter: { r in "loss=\(r.packetLoss)% | rtt=\(String(format: "%.1f", r.avgRttMs))ms" }
                )
            }
            .padding(12)
        }
    }
}

private struct StorageToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ActionRow(
                    title: "全盘汇总", subtitle: "storage.getStats",
                    action: { try await remoteDeps.storage.getStats(pcPeerId: pcPeerId) },
                    formatter: { r in
                        "总盘=\(r.totalDisks) | total=\(byteFmt(r.totalBytes)) | used=\(byteFmt(r.usedBytes))"
                    }
                )
                ActionRow(
                    title: "磁盘列表", subtitle: "storage.getDisks",
                    action: { try await remoteDeps.storage.getDisks(pcPeerId: pcPeerId) },
                    formatter: { r in "\(r.disks.count) 块盘" }
                )
                ActionRow(
                    title: "/Users 使用情况", subtitle: "storage.getUsage path=/Users",
                    action: { try await remoteDeps.storage.getUsage(pcPeerId: pcPeerId, path: "/Users") },
                    formatter: { r in
                        "\(byteFmt(r.usedBytes)) / \(byteFmt(r.totalBytes)) (\(String(format: "%.1f", r.usagePercent))%)"
                    }
                )
                ActionRow(
                    title: "清理预演 (dryRun)", subtitle: "storage.cleanup categories=[cache,temp]",
                    action: { try await remoteDeps.storage.cleanup(pcPeerId: pcPeerId, categories: ["cache", "temp"], dryRun: true) },
                    formatter: { r in "可释放 \(byteFmt(r.bytesFreed)) | 项=\(r.itemsRemoved)" }
                )
            }
            .padding(12)
        }
    }
}

private struct DeviceToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("device skill 仅 4 method (register/disconnect/setPermission/updateDevice) — 多数用例需 deviceId / 权限，需结合 Settings 配对流程使用")
                    .font(.caption).foregroundColor(.secondary).padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color(.secondarySystemBackground)))
                ActionRow(
                    title: "注册测试设备 (无害)", subtitle: "device.register name=iPhone-test",
                    action: { try await remoteDeps.device.register(pcPeerId: pcPeerId, deviceName: "iPhone-test-\(Int.random(in: 1000...9999))") },
                    formatter: { r in "deviceId=\(r.deviceId) | at=\(r.registeredAt ?? "-")" }
                )
            }
            .padding(12)
        }
    }
}

private struct SysInfoExtendedToolView: View {
    let pcPeerId: String
    @EnvironmentObject var remoteDeps: RemoteDependencies
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ActionRow(
                    title: "CPU", subtitle: "sysinfo.getCPU",
                    action: { try await remoteDeps.systemInfo.getCPU(pcPeerId: pcPeerId) },
                    formatter: { r in
                        let brand = r.brand ?? "?"
                        return "\(brand) | \(r.cores)C/\(r.threads)T @ \(String(format: "%.1f", r.speed))GHz | 用量=\(String(format: "%.1f", r.usage))%"
                    }
                )
                ActionRow(
                    title: "内存", subtitle: "sysinfo.getMemory",
                    action: { try await remoteDeps.systemInfo.getMemory(pcPeerId: pcPeerId) },
                    formatter: { r in
                        "used \(byteFmt(r.usedBytes)) / total \(byteFmt(r.totalBytes)) (\(String(format: "%.1f", r.usagePercent))%)"
                    }
                )
                ActionRow(
                    title: "操作系统", subtitle: "sysinfo.getOS",
                    action: { try await remoteDeps.systemInfo.getOS(pcPeerId: pcPeerId) },
                    formatter: { r in
                        "\(r.platform) / \(r.distro ?? "?") / kernel \(r.kernel ?? "?") / host \(r.hostname ?? "?")"
                    }
                )
                ActionRow(
                    title: "运行时长", subtitle: "sysinfo.getUptime",
                    action: { try await remoteDeps.systemInfo.getUptime(pcPeerId: pcPeerId) },
                    formatter: { r in
                        let hours = r.uptimeSeconds / 3600
                        return "\(hours)h (boot=\(r.bootTime ?? "-"))"
                    }
                )
                ActionRow(
                    title: "电池", subtitle: "sysinfo.getBattery",
                    action: { try await remoteDeps.systemInfo.getBattery(pcPeerId: pcPeerId) },
                    formatter: { r in
                        if r.hasBattery {
                            return "\(r.percent ?? 0)% | charging=\(r.isCharging.map(String.init) ?? "?")"
                        } else {
                            return "无电池 (台式机)"
                        }
                    }
                )
                ActionRow(
                    title: "温度", subtitle: "sysinfo.getTemperature",
                    action: { try await remoteDeps.systemInfo.getTemperature(pcPeerId: pcPeerId) },
                    formatter: { r in
                        let cpu = r.cpuCelsius.map { String(format: "%.1f°C", $0) } ?? "-"
                        let gpu = r.gpuCelsius.map { String(format: "%.1f°C", $0) } ?? "-"
                        return "CPU=\(cpu) | GPU=\(gpu) | 传感器=\(r.sensors.count)"
                    }
                )
                ActionRow(
                    title: "硬件", subtitle: "sysinfo.getHardware",
                    action: { try await remoteDeps.systemInfo.getHardware(pcPeerId: pcPeerId) },
                    formatter: { r in
                        "\(r.manufacturer ?? "?") / \(r.model ?? "?") / SN=\(r.serial ?? "-")"
                    }
                )
                ActionRow(
                    title: "性能快照", subtitle: "sysinfo.getPerformance",
                    action: { try await remoteDeps.systemInfo.getPerformance(pcPeerId: pcPeerId) },
                    formatter: { r in
                        let load = r.loadAvg1m.map { String(format: "%.2f", $0) } ?? "-"
                        return "CPU=\(String(format: "%.1f", r.cpuUsage))% | mem=\(String(format: "%.1f", r.memoryUsagePercent))% | load1m=\(load)"
                    }
                )
            }
            .padding(12)
        }
    }
}

// MARK: - Helpers

private func byteFmt(_ bytes: Int64) -> String {
    let fmt = ByteCountFormatter()
    fmt.allowedUnits = [.useGB, .useMB, .useKB]
    fmt.countStyle = .file
    return fmt.string(fromByteCount: bytes)
}
