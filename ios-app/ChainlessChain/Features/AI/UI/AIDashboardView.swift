import SwiftUI

/// AI系统主控制面板
public struct AIDashboardView: View {
    @State private var selectedView: DashboardSection?

    public init() {}

    public var body: some View {
        NavigationView {
            List {
                // 快速统计
                Section {
                    DashboardStatsCard()
                }

                // 核心功能
                Section(header: Text("核心功能")) {
                    NavigationLink(destination: AIEngineMonitorView()) {
                        DashboardItem(
                            title: "AI引擎监控",
                            description: "16个AI引擎的状态和性能",
                            icon: "cpu",
                            color: .blue
                        )
                    }

                    NavigationLink(destination: AgentMonitorView()) {
                        DashboardItem(
                            title: "Agent监控",
                            description: "多智能体协作系统",
                            icon: "brain",
                            color: .purple
                        )
                    }

                    NavigationLink(destination: TaskExecutionView()) {
                        DashboardItem(
                            title: "任务执行",
                            description: "实时任务进度追踪",
                            icon: "list.bullet.clipboard",
                            color: .green
                        )
                    }
                }

                // 数据管理
                Section(header: Text("数据管理")) {
                    NavigationLink(destination: VectorStoreView()) {
                        DashboardItem(
                            title: "向量存储",
                            description: "语义搜索和知识库",
                            icon: "cube.fill",
                            color: .orange
                        )
                    }

                    NavigationLink(destination: ToolsSkillsView()) {
                        DashboardItem(
                            title: "工具与技能",
                            description: "21个工具和80+技能",
                            icon: "wrench.and.screwdriver.fill",
                            color: .pink
                        )
                    }
                }

                // 系统工具
                Section(header: Text("系统工具")) {
                    Button(action: {
                        Task {
                            await runSystemDiagnostics()
                        }
                    }) {
                        DashboardItem(
                            title: "系统诊断",
                            description: "检查所有组件状态",
                            icon: "stethoscope",
                            color: .red
                        )
                    }

                    Button(action: clearAllCaches) {
                        DashboardItem(
                            title: "清空缓存",
                            description: "释放内存空间",
                            icon: "trash.fill",
                            color: .gray
                        )
                    }
                }

                // 关于
                Section(header: Text("关于")) {
                    InfoRow(label: "版本", value: "v0.16.0")
                    InfoRow(label: "AI引擎", value: "16个")
                    InfoRow(label: "工具数量", value: "21个")
                    InfoRow(label: "技能数量", value: "80+")
                    InfoRow(label: "Agent", value: "5个内置")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("AI控制台")
        }
    }

    private func clearAllCaches() {
        CacheManager.shared.clearAll()
        Logger.shared.info("已清空所有缓存")
    }

    private func runSystemDiagnostics() async {
        Logger.shared.info("开始系统诊断...")

        // 检查AI引擎
        let engineManager = AIEngineManager.shared
        let engines = engineManager.getAllEngines()
        Logger.shared.info("AI引擎: \(engines.count)个已注册")

        // 检查Agent系统
        let orchestrator = AgentOrchestrator.shared
        let agents = orchestrator.getAllAgents()
        Logger.shared.info("Agent: \(agents.count)个可用")

        // 检查缓存
        let cacheStats = CacheManager.shared.getStatistics()
        Logger.shared.info("缓存统计: \(cacheStats)")

        // 检查向量存储
        let vectorStore = VectorStoreManager.shared.getStore()
        if let count = try? await vectorStore.count() {
            Logger.shared.info("向量存储: \(count)个向量")
        }

        Logger.shared.info("系统诊断完成")
    }
}

// MARK: - 统计卡片

struct DashboardStatsCard: View {
    @State private var stats: DashboardStats = DashboardStats()

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 20) {
                DashboardStatItem(
                    title: "引擎",
                    value: "\(stats.engines)",
                    icon: "cpu",
                    color: .blue
                )
                DashboardStatItem(
                    title: "Agent",
                    value: "\(stats.agents)",
                    icon: "brain",
                    color: .purple
                )
            }

            HStack(spacing: 20) {
                DashboardStatItem(
                    title: "任务",
                    value: "\(stats.tasks)",
                    icon: "list.bullet",
                    color: .green
                )
                DashboardStatItem(
                    title: "向量",
                    value: "\(stats.vectors)",
                    icon: "cube.fill",
                    color: .orange
                )
            }
        }
        .padding()
        .background(
            LinearGradient(
                gradient: Gradient(colors: [Color.blue.opacity(0.1), Color.purple.opacity(0.1)]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .cornerRadius(16)
        .onAppear {
            loadStats()
        }
    }

    private func loadStats() {
        Task {
            let engineManager = AIEngineManager.shared
            let orchestrator = AgentOrchestrator.shared
            let vectorStore = VectorStoreManager.shared.getStore()

            await MainActor.run {
                stats.engines = engineManager.getAllEngines().count
                stats.agents = orchestrator.getAllAgents().count
                // TODO: Get actual task count
                stats.tasks = 0
            }

            if let vectorCount = try? await vectorStore.count() {
                await MainActor.run {
                    stats.vectors = vectorCount
                }
            }
        }
    }
}

struct DashboardStatItem: View {
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

// MARK: - 面板项目

struct DashboardItem: View {
    let title: String
    let description: String
    let icon: String
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)
                .frame(width: 40, height: 40)
                .background(color.opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)

                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Models

struct DashboardStats {
    var engines: Int = 0
    var agents: Int = 0
    var tasks: Int = 0
    var vectors: Int = 0
}

enum DashboardSection: String, CaseIterable {
    case engines = "AI引擎"
    case agents = "Agent"
    case tasks = "任务"
    case vectors = "向量存储"
    case tools = "工具技能"
}

// MARK: - Preview

struct AIDashboardView_Previews: PreviewProvider {
    static var previews: some View {
        AIDashboardView()
    }
}
