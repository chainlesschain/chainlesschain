import SwiftUI
import Combine

/// 任务执行监控视图
public struct TaskExecutionView: View {
    @StateObject private var viewModel = TaskExecutionViewModel()
    @State private var showingCreateTask = false

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 执行统计
                TaskExecutionStatsCard(
                    totalTasks: viewModel.totalTasks,
                    running: viewModel.runningTasks,
                    completed: viewModel.completedTasks,
                    failed: viewModel.failedTasks
                )
                .padding()

                // 任务列表
                List {
                    // 运行中的任务
                    if !viewModel.runningTasksList.isEmpty {
                        Section(header: Text("运行中")) {
                            ForEach(viewModel.runningTasksList) { task in
                                NavigationLink(destination: TaskDetailView(task: task)) {
                                    TaskExecutionRow(task: task)
                                }
                            }
                        }
                    }

                    // 等待中的任务
                    if !viewModel.pendingTasksList.isEmpty {
                        Section(header: Text("等待中")) {
                            ForEach(viewModel.pendingTasksList) { task in
                                NavigationLink(destination: TaskDetailView(task: task)) {
                                    TaskExecutionRow(task: task)
                                }
                            }
                        }
                    }

                    // 已完成的任务
                    if !viewModel.completedTasksList.isEmpty {
                        Section(header: Text("已完成")) {
                            ForEach(viewModel.completedTasksList) { task in
                                NavigationLink(destination: TaskDetailView(task: task)) {
                                    TaskExecutionRow(task: task)
                                }
                            }
                        }
                    }

                    // 失败的任务
                    if !viewModel.failedTasksList.isEmpty {
                        Section(header: Text("失败")) {
                            ForEach(viewModel.failedTasksList) { task in
                                NavigationLink(destination: TaskDetailView(task: task)) {
                                    TaskExecutionRow(task: task)
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("任务执行")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { viewModel.refresh() }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingCreateTask = true }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingCreateTask) {
                CreateTaskView(onCreate: { description, priority, dependencies in
                    Task {
                        await viewModel.createTask(
                            description: description,
                            priority: priority,
                            dependencies: dependencies
                        )
                        showingCreateTask = false
                    }
                })
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

// MARK: - 统计卡片

struct TaskExecutionStatsCard: View {
    let totalTasks: Int
    let running: Int
    let completed: Int
    let failed: Int

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 20) {
                TaskStatItem(title: "总任务", value: "\(totalTasks)", icon: "list.bullet", color: .blue)
                TaskStatItem(title: "运行中", value: "\(running)", icon: "gearshape.fill", color: .green)
            }

            HStack(spacing: 20) {
                TaskStatItem(title: "已完成", value: "\(completed)", icon: "checkmark.circle.fill", color: .purple)
                TaskStatItem(title: "失败", value: "\(failed)", icon: "xmark.circle.fill", color: .red)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct TaskStatItem: View {
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

// MARK: - 任务执行行

struct TaskExecutionRow: View {
    let task: TaskExecutionInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 任务描述和状态
            HStack {
                Text(task.description)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                Spacer()

                TaskStatusIcon(status: task.status)
            }

            // 任务详情
            HStack(spacing: 16) {
                // 优先级
                HStack(spacing: 4) {
                    Image(systemName: priorityIcon(task.priority))
                        .font(.caption2)
                        .foregroundColor(priorityColor(task.priority))
                    Text(task.priority)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // 执行者
                if let assignee = task.assignedAgent {
                    HStack(spacing: 4) {
                        Image(systemName: "person.fill")
                            .font(.caption2)
                        Text(assignee)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // 执行时间
                if let duration = task.duration {
                    Text(formatDuration(duration))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // 进度条（运行中的任务）
            if task.status == "running" {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(task.currentStep ?? "执行中...")
                            .font(.caption2)
                            .foregroundColor(.secondary)

                        Spacer()

                        Text("\(Int(task.progress * 100))%")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    ProgressView(value: task.progress)
                        .progressViewStyle(.linear)
                        .tint(progressColor(task.progress))
                }
            }

            // 依赖信息
            if !task.dependencies.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.caption2)
                        .foregroundColor(.orange)
                    Text("依赖 \(task.dependencies.count) 个任务")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func priorityIcon(_ priority: String) -> String {
        switch priority {
        case "高": return "exclamationmark.3"
        case "中": return "exclamationmark.2"
        default: return "exclamationmark"
        }
    }

    private func priorityColor(_ priority: String) -> Color {
        switch priority {
        case "高": return .red
        case "中": return .orange
        default: return .blue
        }
    }

    private func progressColor(_ progress: Double) -> Color {
        if progress < 0.3 {
            return .red
        } else if progress < 0.7 {
            return .orange
        } else {
            return .green
        }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        if seconds < 60 {
            return String(format: "%.1fs", seconds)
        } else if seconds < 3600 {
            return String(format: "%.1fm", seconds / 60)
        } else {
            return String(format: "%.1fh", seconds / 3600)
        }
    }
}

struct TaskStatusIcon: View {
    let status: String

    var body: some View {
        Image(systemName: icon)
            .font(.caption)
            .foregroundColor(color)
    }

    private var icon: String {
        switch status {
        case "running": return "gearshape.fill"
        case "pending": return "clock.fill"
        case "completed": return "checkmark.circle.fill"
        case "failed": return "xmark.circle.fill"
        default: return "questionmark.circle.fill"
        }
    }

    private var color: Color {
        switch status {
        case "running": return .green
        case "pending": return .orange
        case "completed": return .blue
        case "failed": return .red
        default: return .gray
        }
    }
}

// MARK: - 任务详情视图

struct TaskDetailView: View {
    let task: TaskExecutionInfo
    @StateObject private var viewModel: TaskDetailViewModel

    init(task: TaskExecutionInfo) {
        self.task = task
        _viewModel = StateObject(wrappedValue: TaskDetailViewModel(taskId: task.id))
    }

    var body: some View {
        List {
            // 基本信息
            Section(header: Text("基本信息")) {
                InfoRow(label: "ID", value: task.displayId)
                InfoRow(label: "状态", value: task.status)
                InfoRow(label: "优先级", value: task.priority)
                if let assignee = task.assignedAgent {
                    InfoRow(label: "执行者", value: assignee)
                }
            }

            // 描述
            Section(header: Text("任务描述")) {
                Text(task.description)
                    .font(.body)
            }

            // 执行进度
            if task.status == "running" {
                Section(header: Text("执行进度")) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(task.currentStep ?? "执行中...")
                                .font(.subheadline)
                            Spacer()
                            Text("\(Int(task.progress * 100))%")
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }

                        ProgressView(value: task.progress)
                            .progressViewStyle(.linear)
                    }
                }
            }

            // 执行时间线
            Section(header: Text("执行时间线")) {
                ForEach(viewModel.timeline) { event in
                    TimelineEventRow(event: event)
                }
            }

            // 依赖关系
            if !task.dependencies.isEmpty {
                Section(header: Text("依赖任务")) {
                    ForEach(task.dependencies, id: \.self) { depId in
                        Text(depId)
                            .font(.caption)
                    }
                }
            }

            // 结果
            if let result = task.result {
                Section(header: Text("执行结果")) {
                    Text(result)
                        .font(.caption)
                        .fontFamily(.monospaced)
                }
            }

            // 错误信息
            if let error = task.error {
                Section(header: Text("错误信息")) {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }

            // 操作
            Section {
                if task.status == "failed" {
                    Button(action: {
                        Task {
                            await viewModel.retryTask()
                        }
                    }) {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                            Text("重试")
                        }
                        .frame(maxWidth: .infinity)
                        .foregroundColor(.blue)
                    }
                }

                if task.status == "running" || task.status == "pending" {
                    Button(action: {
                        Task {
                            await viewModel.cancelTask()
                        }
                    }) {
                        HStack {
                            Image(systemName: "xmark.circle")
                            Text("取消")
                        }
                        .frame(maxWidth: .infinity)
                        .foregroundColor(.red)
                    }
                }
            }
        }
        .navigationTitle("任务详情")
        .onAppear {
            viewModel.startMonitoring()
        }
        .onDisappear {
            viewModel.stopMonitoring()
        }
    }
}

struct TimelineEventRow: View {
    let event: TimelineEvent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // 时间轴点
            Circle()
                .fill(event.type.color)
                .frame(width: 8, height: 8)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 4) {
                Text(event.message)
                    .font(.subheadline)

                Text(event.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
    }
}

// MARK: - 创建任务视图

struct CreateTaskView: View {
    @Environment(\.dismiss) var dismiss
    @State private var description = ""
    @State private var priority = "中"
    @State private var dependencies: [String] = []

    let onCreate: (String, String, [String]) -> Void

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("任务描述")) {
                    TextEditor(text: $description)
                        .frame(minHeight: 100)
                }

                Section(header: Text("优先级")) {
                    Picker("优先级", selection: $priority) {
                        Text("低").tag("低")
                        Text("中").tag("中")
                        Text("高").tag("高")
                    }
                    .pickerStyle(.segmented)
                }

                Section(header: Text("依赖任务")) {
                    Text("任务依赖管理功能正在开发中...")
                        .foregroundColor(.secondary)
                        .italic()
                }
            }
            .navigationTitle("创建任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("创建") {
                        onCreate(description, priority, dependencies)
                    }
                    .disabled(description.isEmpty)
                }
            }
        }
    }
}

// MARK: - ViewModel

class TaskExecutionViewModel: ObservableObject {
    @Published var runningTasksList: [TaskExecutionInfo] = []
    @Published var pendingTasksList: [TaskExecutionInfo] = []
    @Published var completedTasksList: [TaskExecutionInfo] = []
    @Published var failedTasksList: [TaskExecutionInfo] = []

    @Published var totalTasks: Int = 0
    @Published var runningTasks: Int = 0
    @Published var completedTasks: Int = 0
    @Published var failedTasks: Int = 0

    private var timer: Timer?

    func startMonitoring() {
        loadData()

        // 每秒刷新一次
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.loadData()
        }
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    func loadData() {
        // NOTE: 使用模拟数据用于 UI 演示。生产环境中应从 AgentOrchestrator 获取实时任务数据
        // 集成方式: let tasks = await AgentOrchestrator.shared.getAllTasks()

        totalTasks = runningTasksList.count + pendingTasksList.count + completedTasksList.count + failedTasksList.count
        runningTasks = runningTasksList.count
        completedTasks = completedTasksList.count
        failedTasks = failedTasksList.count
    }

    func refresh() {
        loadData()
    }

    func createTask(description: String, priority: String, dependencies: [String]) async {
        // NOTE: UI 演示功能。生产环境中应调用 AgentOrchestrator 创建实际任务
        // 集成方式: await AgentOrchestrator.shared.createTask(description: description, priority: priority)
        Logger.shared.info("创建任务: \(description)")
        loadData()
    }
}

class TaskDetailViewModel: ObservableObject {
    let taskId: String
    @Published var timeline: [TimelineEvent] = []

    private var timer: Timer?

    init(taskId: String) {
        self.taskId = taskId
    }

    func startMonitoring() {
        loadTimeline()

        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.loadTimeline()
        }
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    private func loadTimeline() {
        // NOTE: 使用模拟数据用于 UI 演示。生产环境中应从 AgentOrchestrator 获取任务时间线
        // 集成方式: timeline = await AgentOrchestrator.shared.getTaskTimeline(taskId: taskId)
    }

    func retryTask() async {
        // NOTE: UI 演示功能。生产环境中应调用 AgentOrchestrator 重试任务
        // 集成方式: await AgentOrchestrator.shared.retryTask(taskId: taskId)
        Logger.shared.info("重试任务: \(taskId)")
    }

    func cancelTask() async {
        // NOTE: UI 演示功能。生产环境中应调用 AgentOrchestrator 取消任务
        // 集成方式: await AgentOrchestrator.shared.cancelTask(taskId: taskId)
        Logger.shared.info("取消任务: \(taskId)")
    }
}

// MARK: - Models

struct TaskExecutionInfo: Identifiable {
    let id: String
    let description: String
    let status: String
    let priority: String
    let assignedAgent: String?
    let progress: Double
    let currentStep: String?
    let dependencies: [String]
    let startTime: Date?
    let endTime: Date?
    let result: String?
    let error: String?

    var displayId: String {
        String(id.prefix(8)) + "..."
    }

    var duration: TimeInterval? {
        guard let start = startTime else { return nil }
        let end = endTime ?? Date()
        return end.timeIntervalSince(start)
    }
}

struct TimelineEvent: Identifiable {
    let id: String
    let timestamp: Date
    let message: String
    let type: EventType

    enum EventType {
        case start
        case progress
        case complete
        case error

        var color: Color {
            switch self {
            case .start: return .blue
            case .progress: return .green
            case .complete: return .purple
            case .error: return .red
            }
        }
    }
}

// MARK: - Preview

struct TaskExecutionView_Previews: PreviewProvider {
    static var previews: some View {
        TaskExecutionView()
    }
}
