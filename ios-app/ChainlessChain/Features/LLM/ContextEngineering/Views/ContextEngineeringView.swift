import SwiftUI
import Combine

/// Context Engineering 监控视图
public struct ContextEngineeringView: View {
    @StateObject private var viewModel = ContextEngineeringViewModel()
    @State private var selectedTab = 0

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 统计卡片
                statsSection

                // 标签选择器
                Picker("", selection: $selectedTab) {
                    Text("缓存").tag(0)
                    Text("任务").tag(1)
                    Text("错误").tag(2)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding()

                // 内容区域
                tabContent
            }
            .navigationTitle("Context Engineering")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { Task { await viewModel.resetStats() } }) {
                            Label("重置统计", systemImage: "arrow.counterclockwise")
                        }
                        Button(action: { Task { await viewModel.clearErrors() } }) {
                            Label("清除错误", systemImage: "trash")
                        }
                        Button(action: { Task { await viewModel.clearTask() } }) {
                            Label("清除任务", systemImage: "xmark.circle")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .task {
                await viewModel.refresh()
            }
        }
    }

    // MARK: - Stats Section

    private var statsSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                StatCard(
                    title: "命中率",
                    value: viewModel.stats.hitRatePercent,
                    icon: "checkmark.circle",
                    color: hitRateColor
                )

                StatCard(
                    title: "缓存命中",
                    value: "\(viewModel.stats.cacheHits)",
                    icon: "bolt.fill",
                    color: .green
                )

                StatCard(
                    title: "未命中",
                    value: "\(viewModel.stats.cacheMisses)",
                    icon: "bolt.slash",
                    color: .orange
                )

                StatCard(
                    title: "总调用",
                    value: "\(viewModel.stats.totalCalls)",
                    icon: "arrow.clockwise",
                    color: .blue
                )
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
    }

    private var hitRateColor: Color {
        let rate = viewModel.stats.hitRate
        if rate >= 0.7 { return .green }
        if rate >= 0.4 { return .orange }
        return .red
    }

    // MARK: - Tab Content

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case 0:
            CacheInfoView(viewModel: viewModel)
        case 1:
            TaskInfoView(viewModel: viewModel)
        case 2:
            ErrorHistoryView(viewModel: viewModel)
        default:
            EmptyView()
        }
    }
}

// MARK: - Stat Card

private struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                Text(title)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(value)
                .font(.title2)
                .fontWeight(.bold)
        }
        .frame(width: 90)
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }
}

// MARK: - Cache Info View

private struct CacheInfoView: View {
    @ObservedObject var viewModel: ContextEngineeringViewModel

    var body: some View {
        List {
            Section(header: Text("KV-Cache 优化")) {
                InfoRow(label: "启用状态", value: "已启用")
                InfoRow(label: "静态前缀缓存", value: "活跃")
                InfoRow(label: "工具定义缓存", value: "活跃")
            }

            Section(header: Text("优化策略")) {
                VStack(alignment: .leading, spacing: 8) {
                    StrategyRow(icon: "1.circle.fill", text: "静态内容前置")
                    StrategyRow(icon: "2.circle.fill", text: "动态内容追加")
                    StrategyRow(icon: "3.circle.fill", text: "任务目标重述")
                    StrategyRow(icon: "4.circle.fill", text: "错误历史保留")
                }
                .padding(.vertical, 4)
            }

            Section(header: Text("Token 节省估算")) {
                InfoRow(label: "预估节省", value: "\(viewModel.estimatedTokensSaved) tokens")
                InfoRow(label: "节省比例", value: "\(viewModel.savingsPercent)%")
            }
        }
        .listStyle(InsetGroupedListStyle())
    }
}

private struct InfoRow: View {
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

private struct StrategyRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(.blue)
            Text(text)
                .font(.subheadline)
        }
    }
}

// MARK: - Task Info View

private struct TaskInfoView: View {
    @ObservedObject var viewModel: ContextEngineeringViewModel
    @State private var showingCreateTask = false

    var body: some View {
        Group {
            if let task = viewModel.currentTask {
                TaskDetailView(task: task, viewModel: viewModel)
            } else {
                VStack(spacing: 20) {
                    Image(systemName: "checklist")
                        .font(.system(size: 60))
                        .foregroundColor(.secondary)

                    Text("暂无活跃任务")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    Button(action: { showingCreateTask = true }) {
                        Label("创建任务", systemImage: "plus.circle.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sheet(isPresented: $showingCreateTask) {
            CreateTaskView(viewModel: viewModel)
        }
    }
}

private struct TaskDetailView: View {
    let task: TaskContext
    @ObservedObject var viewModel: ContextEngineeringViewModel

    var body: some View {
        List {
            Section(header: Text("目标")) {
                Text(task.objective)
                    .font(.headline)
            }

            Section(header: Text("进度")) {
                ForEach(Array(task.steps.enumerated()), id: \.offset) { index, step in
                    HStack {
                        Image(systemName: stepIcon(for: index))
                            .foregroundColor(stepColor(for: index))

                        Text(step.description)
                            .strikethrough(step.status == .completed)

                        Spacer()

                        if index == task.currentStep && step.status == .inProgress {
                            Button("完成") {
                                Task {
                                    await viewModel.completeCurrentStep()
                                }
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    }
                }
            }

            Section(header: Text("状态")) {
                InfoRow(label: "当前步骤", value: "\(task.currentStep + 1) / \(task.steps.count)")
                InfoRow(label: "状态", value: task.status.rawValue)
                InfoRow(label: "创建时间", value: formatDate(task.createdAt))
            }
        }
        .listStyle(InsetGroupedListStyle())
    }

    private func stepIcon(for index: Int) -> String {
        if index < task.currentStep {
            return "checkmark.circle.fill"
        } else if index == task.currentStep {
            return "arrow.right.circle.fill"
        } else {
            return "circle"
        }
    }

    private func stepColor(for index: Int) -> Color {
        if index < task.currentStep {
            return .green
        } else if index == task.currentStep {
            return .blue
        } else {
            return .secondary
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: date)
    }
}

private struct CreateTaskView: View {
    @ObservedObject var viewModel: ContextEngineeringViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var objective = ""
    @State private var stepsText = ""

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("目标")) {
                    TextField("任务目标", text: $objective)
                }

                Section(header: Text("步骤"), footer: Text("每行一个步骤")) {
                    TextEditor(text: $stepsText)
                        .frame(minHeight: 100)
                }
            }
            .navigationTitle("创建任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        Task {
                            let steps = stepsText.components(separatedBy: .newlines)
                                .map { $0.trimmingCharacters(in: .whitespaces) }
                                .filter { !$0.isEmpty }
                            await viewModel.createTask(objective: objective, steps: steps)
                            dismiss()
                        }
                    }
                    .disabled(objective.isEmpty)
                }
            }
        }
    }
}

// MARK: - Error History View

private struct ErrorHistoryView: View {
    @ObservedObject var viewModel: ContextEngineeringViewModel

    var body: some View {
        Group {
            if viewModel.errorHistory.isEmpty {
                VStack(spacing: 20) {
                    Image(systemName: "checkmark.shield")
                        .font(.system(size: 60))
                        .foregroundColor(.green)

                    Text("暂无错误记录")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    Text("错误历史用于帮助模型学习")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(viewModel.errorHistory) { error in
                        ErrorRow(error: error)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

private struct ErrorRow: View {
    let error: ErrorRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if let step = error.step {
                    Text(step)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.orange.opacity(0.2))
                        .cornerRadius(4)
                }

                Spacer()

                Text(formatDate(error.timestamp))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(error.message)
                .font(.body)

            if let resolution = error.resolution {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text(resolution)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}

// MARK: - View Model

@MainActor
class ContextEngineeringViewModel: ObservableObject {
    @Published var stats = CacheStats()
    @Published var currentTask: TaskContext?
    @Published var errorHistory: [ErrorRecord] = []
    @Published var estimatedTokensSaved = 0
    @Published var savingsPercent = 0

    private let contextEngineering = ContextEngineering.shared
    private var cancellables = Set<AnyCancellable>()

    init() {
        // 订阅变化
        contextEngineering.$stats
            .receive(on: DispatchQueue.main)
            .sink { [weak self] stats in
                self?.stats = stats
                self?.updateTokenSavings()
            }
            .store(in: &cancellables)

        contextEngineering.$currentTask
            .receive(on: DispatchQueue.main)
            .assign(to: &$currentTask)

        contextEngineering.$errorHistory
            .receive(on: DispatchQueue.main)
            .assign(to: &$errorHistory)
    }

    func refresh() async {
        stats = contextEngineering.getStats()
        currentTask = contextEngineering.getCurrentTask()
        errorHistory = contextEngineering.errorHistory
        updateTokenSavings()
    }

    func resetStats() async {
        contextEngineering.resetStats()
        await refresh()
    }

    func clearErrors() async {
        contextEngineering.clearErrors()
        await refresh()
    }

    func clearTask() async {
        contextEngineering.clearTask()
        await refresh()
    }

    func createTask(objective: String, steps: [String]) async {
        _ = contextEngineering.createTask(objective: objective, steps: steps)
        await refresh()
    }

    func completeCurrentStep() async {
        contextEngineering.completeCurrentStep()
        await refresh()
    }

    private func updateTokenSavings() {
        // 估算节省的 Token 数
        // 假设每次缓存命中节省约 500 tokens
        estimatedTokensSaved = stats.cacheHits * 500
        savingsPercent = stats.totalCalls > 0 ? Int(stats.hitRate * 50) : 0
    }
}

// MARK: - Preview

struct ContextEngineeringView_Previews: PreviewProvider {
    static var previews: some View {
        ContextEngineeringView()
    }
}
