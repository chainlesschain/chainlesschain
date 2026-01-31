import SwiftUI
import Combine

/// AI引擎监控视图
public struct AIEngineMonitorView: View {
    @StateObject private var viewModel = AIEngineMonitorViewModel()

    public init() {}

    public var body: some View {
        NavigationView {
            List {
                // 概览卡片
                Section {
                    OverviewCard(
                        totalEngines: viewModel.totalEngines,
                        activeEngines: viewModel.activeEngines,
                        totalCapabilities: viewModel.totalCapabilities
                    )
                }

                // 引擎列表
                Section(header: Text("AI引擎")) {
                    ForEach(viewModel.engines) { engine in
                        NavigationLink(destination: EngineDetailView(engine: engine)) {
                            EngineRow(engine: engine)
                        }
                    }
                }

                // 性能统计
                Section(header: Text("性能统计")) {
                    PerformanceStats(stats: viewModel.performanceStats)
                }

                // 缓存信息
                Section(header: Text("缓存状态")) {
                    CacheInfoView(cacheStats: viewModel.cacheStats)
                }
            }
            .navigationTitle("AI引擎监控")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { viewModel.refresh() }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .onAppear {
                viewModel.loadData()
            }
        }
    }
}

// MARK: - 概览卡片

struct OverviewCard: View {
    let totalEngines: Int
    let activeEngines: Int
    let totalCapabilities: Int

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 20) {
                StatItem(title: "引擎总数", value: "\(totalEngines)", icon: "cpu", color: .blue)
                StatItem(title: "运行中", value: "\(activeEngines)", icon: "bolt.fill", color: .green)
                StatItem(title: "功能数", value: "\(totalCapabilities)", icon: "star.fill", color: .orange)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct StatItem: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)

            Text(value)
                .font(.title2)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 引擎行

struct EngineRow: View {
    let engine: EngineInfo

    var body: some View {
        HStack(spacing: 12) {
            // 引擎图标
            Image(systemName: engine.icon)
                .font(.title2)
                .foregroundColor(engine.statusColor)
                .frame(width: 40, height: 40)
                .background(engine.statusColor.opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(engine.name)
                    .font(.headline)

                Text("\(engine.capabilities) 功能")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // 状态指示器
            StatusBadge(status: engine.status)
        }
        .padding(.vertical, 4)
    }
}

struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(status)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor.opacity(0.2))
            .foregroundColor(statusColor)
            .cornerRadius(4)
    }

    var statusColor: Color {
        switch status {
        case "运行中": return .green
        case "空闲": return .blue
        case "错误": return .red
        default: return .gray
        }
    }
}

// MARK: - 性能统计

struct PerformanceStats: View {
    let stats: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(stats.keys.sorted(), id: \.self) { key in
                HStack {
                    Text(key)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text(stats[key] ?? "")
                        .fontWeight(.medium)
                }
            }
        }
    }
}

// MARK: - 缓存信息

struct CacheInfoView: View {
    let cacheStats: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(cacheStats.keys.sorted(), id: \.self) { key in
                HStack {
                    Image(systemName: "memorychip")
                        .foregroundColor(.blue)
                    Text(key)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text(cacheStats[key] ?? "")
                        .font(.caption)
                        .fontWeight(.medium)
                }
            }

            Button(action: clearAllCaches) {
                HStack {
                    Image(systemName: "trash")
                    Text("清空所有缓存")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(Color.red.opacity(0.1))
                .foregroundColor(.red)
                .cornerRadius(8)
            }
            .padding(.top, 8)
        }
    }

    func clearAllCaches() {
        CacheManager.shared.clearAll()
    }
}

// MARK: - ViewModel

class AIEngineMonitorViewModel: ObservableObject {
    @Published var engines: [EngineInfo] = []
    @Published var totalEngines: Int = 0
    @Published var activeEngines: Int = 0
    @Published var totalCapabilities: Int = 0
    @Published var performanceStats: [String: String] = [:]
    @Published var cacheStats: [String: String] = [:]

    func loadData() {
        let manager = AIEngineManager.shared

        // 加载引擎信息
        engines = manager.getAllEngines().map { engine in
            EngineInfo(
                id: engine.engineType.rawValue,
                name: engine.engineName,
                type: engine.engineType,
                icon: engine.engineType.icon,
                status: statusString(for: engine.status),
                capabilities: engine.capabilities.count
            )
        }

        totalEngines = engines.count
        activeEngines = engines.filter { $0.status == "运行中" }.count
        totalCapabilities = engines.reduce(0) { $0 + $1.capabilities }

        // 加载性能统计
        let stats = manager.getStatistics()
        performanceStats = [
            "已注册引擎": "\(stats["totalEngines"] ?? 0)",
            "活跃引擎": "\(stats["activeAgents"] ?? 0)"
        ]

        // 加载缓存统计
        let cache = CacheManager.shared.getStatistics()
        cacheStats = cache.mapValues { "\($0)" }
    }

    func refresh() {
        loadData()
    }

    private func statusString(for state: AIEngineStatus) -> String {
        switch state {
        case .idle: return "空闲"
        case .initializing: return "初始化中"
        case .running: return "运行中"
        case .error: return "错误"
        }
    }
}

// MARK: - Models

struct EngineInfo: Identifiable {
    let id: String
    let name: String
    let type: AIEngineType
    let icon: String
    let status: String
    let capabilities: Int

    var statusColor: Color {
        switch status {
        case "运行中": return .green
        case "空闲": return .blue
        case "错误": return .red
        default: return .gray
        }
    }
}

// MARK: - 引擎详情视图

struct EngineDetailView: View {
    let engine: EngineInfo

    var body: some View {
        List {
            Section(header: Text("基本信息")) {
                InfoRow(label: "名称", value: engine.name)
                InfoRow(label: "类型", value: engine.type.displayName)
                InfoRow(label: "状态", value: engine.status)
                InfoRow(label: "功能数量", value: "\(engine.capabilities)")
            }

            Section(header: Text("功能列表")) {
                Text("功能列表待实现")
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle(engine.name)
    }
}

struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
    }
}

// MARK: - Preview

struct AIEngineMonitorView_Previews: PreviewProvider {
    static var previews: some View {
        AIEngineMonitorView()
    }
}
