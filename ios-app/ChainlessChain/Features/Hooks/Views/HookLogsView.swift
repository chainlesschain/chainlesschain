//
//  HookLogsView.swift
//  ChainlessChain
//
//  钩子日志视图
//  显示钩子执行日志
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI
import Combine

/// 钩子日志视图
struct HookLogsView: View {
    @StateObject private var viewModel = HookLogsViewModel()
    @State private var selectedLog: HookLog?
    @State private var filterEvent: HookEvent?
    @State private var filterResult: HookResult?
    @State private var searchText = ""

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 过滤器
                filterBar

                // 统计卡片
                statsCards

                // 日志列表
                if viewModel.filteredLogs.isEmpty {
                    emptyView
                } else {
                    logsList
                }
            }
            .navigationTitle("执行日志")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: viewModel.refresh) {
                            Label("刷新", systemImage: "arrow.clockwise")
                        }

                        Button(action: viewModel.clearLogs) {
                            Label("清空日志", systemImage: "trash")
                        }

                        Divider()

                        Button(action: viewModel.exportLogs) {
                            Label("导出日志", systemImage: "square.and.arrow.up")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(item: $selectedLog) { log in
                LogDetailView(log: log)
            }
            .onAppear {
                viewModel.loadLogs()
            }
        }
    }

    // MARK: - 过滤器

    private var filterBar: some View {
        VStack(spacing: 8) {
            // 搜索栏
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.gray)

                TextField("搜索钩子名称...", text: $searchText)
                    .onChange(of: searchText) { newValue in
                        viewModel.searchQuery = newValue
                    }

                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.gray)
                    }
                }
            }
            .padding(10)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(10)

            // 快速过滤
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    FilterChip(title: "全部", isSelected: filterEvent == nil && filterResult == nil) {
                        filterEvent = nil
                        filterResult = nil
                        viewModel.filterEvent = nil
                        viewModel.filterResult = nil
                    }

                    FilterChip(title: "成功", isSelected: filterResult == .continue, color: .green) {
                        filterResult = .continue
                        viewModel.filterResult = .continue
                    }

                    FilterChip(title: "拒绝", isSelected: filterResult == .reject, color: .red) {
                        filterResult = .reject
                        viewModel.filterResult = .reject
                    }

                    FilterChip(title: "错误", isSelected: filterResult == .error, color: .orange) {
                        filterResult = .error
                        viewModel.filterResult = .error
                    }

                    Divider()
                        .frame(height: 20)

                    ForEach([HookEvent.preToolUse, .postToolUse, .sessionStart], id: \.self) { event in
                        FilterChip(title: event.rawValue, isSelected: filterEvent == event) {
                            filterEvent = event
                            viewModel.filterEvent = event
                        }
                    }
                }
            }
        }
        .padding()
    }

    // MARK: - 统计卡片

    private var statsCards: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                LogStatCard(
                    title: "总执行",
                    value: "\(viewModel.stats.total)",
                    icon: "play.circle",
                    color: .blue
                )

                LogStatCard(
                    title: "成功",
                    value: "\(viewModel.stats.success)",
                    icon: "checkmark.circle",
                    color: .green
                )

                LogStatCard(
                    title: "拒绝",
                    value: "\(viewModel.stats.rejected)",
                    icon: "xmark.circle",
                    color: .red
                )

                LogStatCard(
                    title: "错误",
                    value: "\(viewModel.stats.errors)",
                    icon: "exclamationmark.triangle",
                    color: .orange
                )

                LogStatCard(
                    title: "平均耗时",
                    value: String(format: "%.0fms", viewModel.stats.avgDuration * 1000),
                    icon: "clock",
                    color: .purple
                )
            }
            .padding(.horizontal)
        }
        .padding(.bottom, 8)
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 50))
                .foregroundColor(.gray)

            Text("暂无执行日志")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("钩子执行后，日志将显示在这里")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Spacer()
        }
    }

    // MARK: - 日志列表

    private var logsList: some View {
        List {
            ForEach(viewModel.filteredLogs) { log in
                LogRow(log: log)
                    .onTapGesture {
                        selectedLog = log
                    }
            }
        }
        .listStyle(PlainListStyle())
        .refreshable {
            viewModel.refresh()
        }
    }
}

// MARK: - ViewModel

@MainActor
class HookLogsViewModel: ObservableObject {
    @Published var logs: [HookLog] = []
    @Published var searchQuery = ""
    @Published var filterEvent: HookEvent?
    @Published var filterResult: HookResult?
    @Published var stats = LogStats()

    private let maxLogs = 500

    var filteredLogs: [HookLog] {
        var result = logs

        if let event = filterEvent {
            result = result.filter { $0.event == event }
        }

        if let resultFilter = filterResult {
            result = result.filter { $0.result == resultFilter }
        }

        if !searchQuery.isEmpty {
            let query = searchQuery.lowercased()
            result = result.filter {
                $0.hookName.lowercased().contains(query) ||
                $0.event.rawValue.lowercased().contains(query)
            }
        }

        return result.sorted { $0.timestamp > $1.timestamp }
    }

    func loadLogs() {
        // 模拟加载日志数据
        logs = generateMockLogs()
        calculateStats()
    }

    func refresh() {
        loadLogs()
    }

    func clearLogs() {
        logs = []
        calculateStats()
    }

    func exportLogs() {
        // 导出日志为JSON
    }

    private func calculateStats() {
        let total = logs.count
        let success = logs.filter { $0.result == .continue }.count
        let rejected = logs.filter { $0.result == .reject }.count
        let errors = logs.filter { $0.result == .error }.count
        let avgDuration = logs.isEmpty ? 0 : logs.reduce(0) { $0 + $1.duration } / Double(logs.count)

        stats = LogStats(
            total: total,
            success: success,
            rejected: rejected,
            errors: errors,
            avgDuration: avgDuration
        )
    }

    private func generateMockLogs() -> [HookLog] {
        // 生成模拟数据用于预览
        let events: [HookEvent] = [.preToolUse, .postToolUse, .sessionStart, .preFileAccess]
        let results: [HookResult] = [.continue, .continue, .continue, .reject, .error]
        let hookNames = ["工具权限检查", "日志记录", "安全审计", "性能监控"]

        return (0..<20).map { i in
            HookLog(
                id: UUID().uuidString,
                hookId: UUID().uuidString,
                hookName: hookNames.randomElement()!,
                event: events.randomElement()!,
                result: results.randomElement()!,
                timestamp: Date().addingTimeInterval(-Double(i * 300)),
                duration: Double.random(in: 0.005...0.2),
                input: ["tool": "example", "params": ["key": "value"]],
                output: ["status": "ok"],
                errorMessage: nil
            )
        }
    }
}

// MARK: - 数据模型

struct HookLog: Identifiable {
    let id: String
    let hookId: String
    let hookName: String
    let event: HookEvent
    let result: HookResult
    let timestamp: Date
    let duration: TimeInterval
    let input: [String: Any]?
    let output: [String: Any]?
    let errorMessage: String?
}

struct LogStats {
    var total: Int = 0
    var success: Int = 0
    var rejected: Int = 0
    var errors: Int = 0
    var avgDuration: TimeInterval = 0
}

// MARK: - 辅助视图

private struct FilterChip: View {
    let title: String
    let isSelected: Bool
    var color: Color = .blue
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? color : Color(.secondarySystemBackground))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(16)
        }
    }
}

private struct LogStatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(color)

            Text(value)
                .font(.headline)
                .fontWeight(.bold)

            Text(title)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(width: 70)
        .padding(.vertical, 12)
        .background(Color(.systemBackground))
        .cornerRadius(10)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

private struct LogRow: View {
    let log: HookLog

    var body: some View {
        HStack(spacing: 12) {
            // 结果图标
            ZStack {
                Circle()
                    .fill(resultColor.opacity(0.1))
                    .frame(width: 40, height: 40)

                Image(systemName: resultIcon)
                    .foregroundColor(resultColor)
            }

            // 信息
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(log.hookName)
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Spacer()

                    Text(log.timestamp, style: .relative)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                HStack(spacing: 8) {
                    Text(log.event.rawValue)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.blue.opacity(0.1))
                        .foregroundColor(.blue)
                        .cornerRadius(4)

                    Text(String(format: "%.0fms", log.duration * 1000))
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    Spacer()

                    Text(resultText)
                        .font(.caption2)
                        .foregroundColor(resultColor)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var resultIcon: String {
        switch log.result {
        case .continue: return "checkmark"
        case .reject: return "xmark"
        case .modify: return "pencil"
        case .error: return "exclamationmark.triangle"
        }
    }

    private var resultColor: Color {
        switch log.result {
        case .continue: return .green
        case .reject: return .red
        case .modify: return .blue
        case .error: return .orange
        }
    }

    private var resultText: String {
        switch log.result {
        case .continue: return "通过"
        case .reject: return "拒绝"
        case .modify: return "修改"
        case .error: return "错误"
        }
    }
}

// MARK: - 日志详情视图

struct LogDetailView: View {
    let log: HookLog
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // 基本信息
                    VStack(alignment: .leading, spacing: 12) {
                        DetailRow(label: "钩子名称", value: log.hookName)
                        DetailRow(label: "事件类型", value: log.event.rawValue)
                        DetailRow(label: "执行结果", value: resultText, color: resultColor)
                        DetailRow(label: "执行时间", value: log.timestamp.formatted())
                        DetailRow(label: "耗时", value: String(format: "%.2fms", log.duration * 1000))
                    }
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(12)

                    // 输入数据
                    if let input = log.input {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("输入数据")
                                .font(.headline)

                            Text(formatJSON(input))
                                .font(.system(.caption, design: .monospaced))
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(8)
                        }
                    }

                    // 输出数据
                    if let output = log.output {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("输出数据")
                                .font(.headline)

                            Text(formatJSON(output))
                                .font(.system(.caption, design: .monospaced))
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(8)
                        }
                    }

                    // 错误信息
                    if let error = log.errorMessage {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("错误信息")
                                .font(.headline)
                                .foregroundColor(.red)

                            Text(error)
                                .font(.subheadline)
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.red.opacity(0.1))
                                .cornerRadius(8)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("日志详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") { dismiss() }
                }
            }
        }
    }

    private var resultText: String {
        switch log.result {
        case .continue: return "通过"
        case .reject: return "拒绝"
        case .modify: return "修改"
        case .error: return "错误"
        }
    }

    private var resultColor: Color {
        switch log.result {
        case .continue: return .green
        case .reject: return .red
        case .modify: return .blue
        case .error: return .orange
        }
    }

    private func formatJSON(_ dict: [String: Any]) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: dict, options: .prettyPrinted),
           let string = String(data: data, encoding: .utf8) {
            return string
        }
        return String(describing: dict)
    }
}

private struct DetailRow: View {
    let label: String
    let value: String
    var color: Color = .primary

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            Text(value)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundColor(color)
        }
    }
}

// MARK: - 预览

#if DEBUG
struct HookLogsView_Previews: PreviewProvider {
    static var previews: some View {
        HookLogsView()
    }
}
#endif
