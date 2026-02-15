import SwiftUI
import Combine

/// Agent监控视图
public struct AgentMonitorView: View {
    @StateObject private var viewModel = AgentMonitorViewModel()

    public init() {}

    public var body: some View {
        NavigationView {
            List {
                // 概览统计
                Section {
                    AgentOverviewCard(
                        totalAgents: viewModel.totalAgents,
                        activeAgents: viewModel.activeAgents,
                        runningTasks: viewModel.runningTasks,
                        completedTasks: viewModel.completedTasks
                    )
                }

                // Agent列表
                Section(header: Text("智能体")) {
                    ForEach(viewModel.agents) { agent in
                        NavigationLink(destination: AgentDetailView(agent: agent)) {
                            AgentRow(agent: agent)
                        }
                    }
                }

                // 运行中的任务
                Section(header: Text("运行中的任务")) {
                    if viewModel.activeTasks.isEmpty {
                        Text("暂无运行中的任务")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    } else {
                        ForEach(viewModel.activeTasks) { task in
                            TaskRow(task: task)
                        }
                    }
                }

                // 任务依赖图
                Section(header: Text("任务依赖关系")) {
                    if viewModel.hasDependencies {
                        DependencyGraphView(dependencies: viewModel.taskDependencies)
                    } else {
                        Text("暂无任务依赖")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }
                }

                // Agent通信日志
                Section(header: Text("通信日志")) {
                    ForEach(viewModel.communicationLogs.prefix(10)) { log in
                        CommunicationLogRow(log: log)
                    }
                }
            }
            .navigationTitle("Agent监控")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { viewModel.refresh() }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .onAppear {
                viewModel.startMonitoring()
            }
            .onDisappear {
                viewModel.stopMonitoring()
            }
        }
    }
}

// MARK: - 概览卡片

struct AgentOverviewCard: View {
    let totalAgents: Int
    let activeAgents: Int
    let runningTasks: Int
    let completedTasks: Int

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 20) {
                AgentStatItem(title: "智能体", value: "\(totalAgents)", icon: "brain", color: .blue)
                AgentStatItem(title: "活跃", value: "\(activeAgents)", icon: "bolt.fill", color: .green)
            }

            HStack(spacing: 20) {
                AgentStatItem(title: "运行中", value: "\(runningTasks)", icon: "gearshape.fill", color: .orange)
                AgentStatItem(title: "已完成", value: "\(completedTasks)", icon: "checkmark.circle.fill", color: .purple)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct AgentStatItem: View {
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

// MARK: - Agent行

struct AgentRow: View {
    let agent: AgentDisplayInfo

    var body: some View {
        HStack(spacing: 12) {
            // Agent图标
            Image(systemName: agent.icon)
                .font(.title2)
                .foregroundColor(agent.stateColor)
                .frame(width: 40, height: 40)
                .background(agent.stateColor.opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(agent.name)
                        .font(.headline)

                    Text("(\(agent.role))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Text("\(agent.capabilities.count) 项能力")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // 状态指示器
            AgentStateBadge(state: agent.state)
        }
        .padding(.vertical, 4)
    }
}

struct AgentStateBadge: View {
    let state: String

    var body: some View {
        Text(state)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(stateColor.opacity(0.2))
            .foregroundColor(stateColor)
            .cornerRadius(4)
    }

    var stateColor: Color {
        switch state {
        case "执行中": return .green
        case "空闲": return .blue
        case "思考中": return .orange
        case "错误": return .red
        default: return .gray
        }
    }
}

// MARK: - 任务行

struct TaskRow: View {
    let task: TaskDisplayInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(task.description)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Spacer()

                TaskStatusBadge(status: task.status)
            }

            HStack(spacing: 16) {
                Label("优先级: \(task.priority)", systemImage: "flag.fill")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if let assignee = task.assignedTo {
                    Label(assignee, systemImage: "person.fill")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // 进度条
            if task.status == "执行中" {
                ProgressView(value: task.progress)
                    .progressViewStyle(.linear)
            }
        }
        .padding(.vertical, 4)
    }
}

struct TaskStatusBadge: View {
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
        case "执行中": return .green
        case "等待中": return .orange
        case "已完成": return .blue
        case "失败": return .red
        default: return .gray
        }
    }
}

// MARK: - 依赖图视图

struct DependencyGraphView: View {
    let dependencies: [TaskDependency]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(dependencies) { dep in
                HStack(spacing: 8) {
                    Text(dep.fromTask)
                        .font(.caption)
                        .padding(8)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(4)

                    Image(systemName: "arrow.right")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(dep.toTask)
                        .font(.caption)
                        .padding(8)
                        .background(Color.green.opacity(0.1))
                        .cornerRadius(4)
                }
            }
        }
    }
}

// MARK: - 通信日志行

struct CommunicationLogRow: View {
    let log: CommunicationLog

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "arrow.right.circle.fill")
                    .foregroundColor(.blue)
                    .font(.caption)

                Text("\(log.from) → \(log.to)")
                    .font(.caption)
                    .fontWeight(.medium)

                Spacer()

                Text(log.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Text(log.message)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - ViewModel

class AgentMonitorViewModel: ObservableObject {
    @Published var agents: [AgentDisplayInfo] = []
    @Published var activeTasks: [TaskDisplayInfo] = []
    @Published var taskDependencies: [TaskDependency] = []
    @Published var communicationLogs: [CommunicationLog] = []

    @Published var totalAgents: Int = 0
    @Published var activeAgents: Int = 0
    @Published var runningTasks: Int = 0
    @Published var completedTasks: Int = 0

    private var timer: Timer?

    var hasDependencies: Bool {
        !taskDependencies.isEmpty
    }

    func startMonitoring() {
        loadData()

        // 每2秒刷新一次
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.loadData()
        }
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    func loadData() {
        let orchestrator = AgentOrchestrator.shared

        // 加载Agent信息
        agents = orchestrator.getAllAgents().map { agent in
            AgentDisplayInfo(
                id: agent.id,
                name: agent.name,
                role: roleString(agent.role),
                state: stateString(agent.state),
                capabilities: agent.capabilities,
                icon: iconForRole(agent.role)
            )
        }

        totalAgents = agents.count
        activeAgents = agents.filter { $0.state == "执行中" || $0.state == "思考中" }.count

        // 加载任务信息（模拟数据）
        loadTasksData()

        // 加载通信日志（模拟数据）
        loadCommunicationLogs()
    }

    func refresh() {
        loadData()
    }

    private func loadTasksData() {
        // NOTE: 使用模拟数据用于 UI 演示。生产环境中应从 AgentOrchestrator 获取实时任务数据
        // 集成方式: activeTasks = await AgentOrchestrator.shared.getActiveTasks(agentId: agentId)

        activeTasks = []
        runningTasks = 0
        completedTasks = 0

        taskDependencies = []
    }

    private func loadCommunicationLogs() {
        // NOTE: 使用模拟数据用于 UI 演示。生产环境中应从 Agent 通信系统获取日志
        // 集成方式: communicationLogs = await AgentCommunicationSystem.shared.getLogs(agentId: agentId)

        communicationLogs = []
    }

    private func roleString(_ role: AgentRole) -> String {
        switch role {
        case .coordinator: return "协调者"
        case .executor: return "执行者"
        case .analyzer: return "分析师"
        case .coder: return "编码者"
        case .documentWriter: return "文档撰写"
        case .researcher: return "研究员"
        case .validator: return "验证者"
        }
    }

    private func stateString(_ state: AgentState) -> String {
        switch state {
        case .idle: return "空闲"
        case .thinking: return "思考中"
        case .executing: return "执行中"
        case .waiting: return "等待中"
        case .error: return "错误"
        }
    }

    private func iconForRole(_ role: AgentRole) -> String {
        switch role {
        case .coordinator: return "person.3.fill"
        case .executor: return "gearshape.fill"
        case .analyzer: return "chart.bar.fill"
        case .coder: return "chevron.left.forwardslash.chevron.right"
        case .documentWriter: return "doc.text.fill"
        case .researcher: return "magnifyingglass"
        case .validator: return "checkmark.shield.fill"
        }
    }
}

// MARK: - Models

struct AgentDisplayInfo: Identifiable {
    let id: String
    let name: String
    let role: String
    let state: String
    let capabilities: [String]
    let icon: String

    var stateColor: Color {
        switch state {
        case "执行中": return .green
        case "空闲": return .blue
        case "思考中": return .orange
        case "错误": return .red
        default: return .gray
        }
    }
}

struct TaskDisplayInfo: Identifiable {
    let id: String
    let description: String
    let status: String
    let priority: String
    let assignedTo: String?
    let progress: Double
}

struct TaskDependency: Identifiable {
    let id: String
    let fromTask: String
    let toTask: String
}

struct CommunicationLog: Identifiable {
    let id: String
    let from: String
    let to: String
    let message: String
    let timestamp: Date
}

// MARK: - Agent详情视图

struct AgentDetailView: View {
    let agent: AgentDisplayInfo

    var body: some View {
        List {
            Section(header: Text("基本信息")) {
                InfoRow(label: "名称", value: agent.name)
                InfoRow(label: "角色", value: agent.role)
                InfoRow(label: "状态", value: agent.state)
                InfoRow(label: "能力数量", value: "\(agent.capabilities.count)")
            }

            Section(header: Text("能力列表")) {
                ForEach(agent.capabilities, id: \.self) { capability in
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.caption)
                        Text(capability)
                            .font(.subheadline)
                    }
                }
            }

            Section(header: Text("执行历史")) {
                Text("执行历史功能正在开发中...")
                    .foregroundColor(.secondary)
                    .italic()
            }

            Section(header: Text("性能统计")) {
                Text("性能统计功能正在开发中...")
                    .foregroundColor(.secondary)
                    .italic()
            }
        }
        .navigationTitle(agent.name)
    }
}

// MARK: - Preview

struct AgentMonitorView_Previews: PreviewProvider {
    static var previews: some View {
        AgentMonitorView()
    }
}
