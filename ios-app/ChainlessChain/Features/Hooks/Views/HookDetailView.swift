//
//  HookDetailView.swift
//  ChainlessChain
//
//  钩子详情视图
//  显示钩子配置和执行历史
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 钩子详情视图
struct HookDetailView: View {
    let hook: HookConfig
    @Environment(\.dismiss) private var dismiss
    @State private var showEditSheet = false
    @State private var showDeleteConfirm = false
    @State private var executionLogs: [HookExecutionLog] = []
    @State private var selectedTab = 0

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    // 基本信息卡片
                    infoCard

                    // 选项卡
                    Picker("", selection: $selectedTab) {
                        Text("配置").tag(0)
                        Text("脚本").tag(1)
                        Text("历史").tag(2)
                        Text("统计").tag(3)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .padding(.horizontal)

                    // 选项卡内容
                    switch selectedTab {
                    case 0:
                        configurationSection
                    case 1:
                        scriptSection
                    case 2:
                        historySection
                    case 3:
                        statisticsSection
                    default:
                        EmptyView()
                    }
                }
                .padding()
            }
            .navigationTitle("钩子详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") { dismiss() }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { showEditSheet = true }) {
                            Label("编辑", systemImage: "pencil")
                        }

                        Button(action: testHook) {
                            Label("测试执行", systemImage: "play")
                        }

                        Divider()

                        Button(role: .destructive, action: { showDeleteConfirm = true }) {
                            Label("删除", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showEditSheet) {
                EditHookView(hook: hook)
            }
            .alert("确认删除", isPresented: $showDeleteConfirm) {
                Button("取消", role: .cancel) { }
                Button("删除", role: .destructive) {
                    deleteHook()
                }
            } message: {
                Text("确定要删除钩子「\(hook.name)」吗？此操作不可撤销。")
            }
            .onAppear {
                loadExecutionLogs()
            }
        }
    }

    // MARK: - 基本信息卡片

    private var infoCard: some View {
        VStack(spacing: 12) {
            HStack {
                // 图标
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(typeColor.opacity(0.1))
                        .frame(width: 56, height: 56)

                    Image(systemName: typeIcon)
                        .font(.title2)
                        .foregroundColor(typeColor)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(hook.name)
                        .font(.title3)
                        .fontWeight(.bold)

                    HStack(spacing: 8) {
                        StatusBadge(enabled: hook.enabled)

                        Text(hook.event.rawValue)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.blue.opacity(0.1))
                            .foregroundColor(.blue)
                            .cornerRadius(6)
                    }
                }

                Spacer()
            }

            Divider()

            HStack {
                InfoItem(title: "类型", value: hook.type.rawValue)
                InfoItem(title: "优先级", value: "\(hook.priority)")
                InfoItem(title: "执行次数", value: "\(hook.executionCount)")
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 配置区域

    private var configurationSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "基本配置")

            ConfigRow(label: "钩子ID", value: hook.id)
            ConfigRow(label: "事件类型", value: hook.event.rawValue)
            ConfigRow(label: "执行类型", value: hook.type.rawValue)
            ConfigRow(label: "优先级", value: priorityDescription)
            ConfigRow(label: "超时时间", value: "\(hook.timeout)秒")

            if !hook.conditions.isEmpty {
                SectionHeader(title: "执行条件")

                ForEach(hook.conditions, id: \.self) { condition in
                    HStack {
                        Image(systemName: "checkmark.circle")
                            .foregroundColor(.green)
                        Text(condition)
                            .font(.subheadline)
                    }
                    .padding(.vertical, 4)
                }
            }

            if let matchTools = hook.matchTools, !matchTools.isEmpty {
                SectionHeader(title: "匹配工具")

                FlowLayout(spacing: 8) {
                    ForEach(matchTools, id: \.self) { tool in
                        Text(tool)
                            .font(.caption)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.orange.opacity(0.1))
                            .foregroundColor(.orange)
                            .cornerRadius(8)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 脚本区域

    private var scriptSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "脚本内容")

            if let script = hook.script {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(scriptLanguage)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.purple.opacity(0.1))
                            .foregroundColor(.purple)
                            .cornerRadius(4)

                        Spacer()

                        Button(action: copyScript) {
                            Image(systemName: "doc.on.doc")
                                .font(.caption)
                        }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(script)
                            .font(.system(.caption, design: .monospaced))
                            .padding()
                    }
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(8)
                }
            } else if let command = hook.command {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Shell命令")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(command)
                        .font(.system(.subheadline, design: .monospaced))
                        .padding()
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)
                }
            } else {
                Text("无脚本内容")
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 历史区域

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "执行历史")

            if executionLogs.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.title)
                        .foregroundColor(.gray)

                    Text("暂无执行记录")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else {
                ForEach(executionLogs) { log in
                    ExecutionLogRow(log: log)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 统计区域

    private var statisticsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "执行统计")

            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 12) {
                StatCard(
                    title: "总执行次数",
                    value: "\(hook.executionCount)",
                    icon: "play.circle",
                    color: .blue
                )

                StatCard(
                    title: "错误次数",
                    value: "\(hook.errorCount)",
                    icon: "exclamationmark.triangle",
                    color: .red
                )

                StatCard(
                    title: "成功率",
                    value: successRateText,
                    icon: "checkmark.circle",
                    color: .green
                )

                StatCard(
                    title: "平均耗时",
                    value: String(format: "%.0fms", hook.avgExecutionTime * 1000),
                    icon: "clock",
                    color: .orange
                )
            }

            if let lastExecutedAt = hook.lastExecutedAt {
                HStack {
                    Text("上次执行")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    Spacer()

                    Text(lastExecutedAt, style: .relative)
                        .font(.subheadline)
                }
                .padding(.top, 8)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 计算属性

    private var typeIcon: String {
        switch hook.type {
        case .sync: return "arrow.right"
        case .async: return "arrow.triangle.2.circlepath"
        case .command: return "terminal"
        case .script: return "doc.text"
        }
    }

    private var typeColor: Color {
        switch hook.type {
        case .sync: return .blue
        case .async: return .green
        case .command: return .orange
        case .script: return .purple
        }
    }

    private var priorityDescription: String {
        switch hook.priority {
        case 0..<100: return "系统 (\(hook.priority))"
        case 100..<500: return "高 (\(hook.priority))"
        case 500..<900: return "普通 (\(hook.priority))"
        default: return "低 (\(hook.priority))"
        }
    }

    private var scriptLanguage: String {
        guard let script = hook.script else { return "未知" }
        if script.contains("function") || script.contains("const") || script.contains("let") {
            return "JavaScript"
        } else if script.contains("def ") || script.contains("import ") {
            return "Python"
        } else {
            return "Bash"
        }
    }

    private var successRateText: String {
        guard hook.executionCount > 0 else { return "N/A" }
        let rate = Double(hook.executionCount - hook.errorCount) / Double(hook.executionCount) * 100
        return String(format: "%.1f%%", rate)
    }

    // MARK: - 方法

    private func loadExecutionLogs() {
        // 模拟加载执行日志
        executionLogs = []
    }

    private func testHook() {
        // 测试执行钩子
    }

    private func deleteHook() {
        try? HookRepository.shared.deleteHook(hook.id)
        dismiss()
    }

    private func copyScript() {
        if let script = hook.script {
            UIPasteboard.general.string = script
        }
    }
}

// MARK: - 辅助视图

private struct StatusBadge: View {
    let enabled: Bool

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(enabled ? Color.green : Color.gray)
                .frame(width: 8, height: 8)

            Text(enabled ? "已启用" : "已禁用")
                .font(.caption)
                .foregroundColor(enabled ? .green : .gray)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(enabled ? Color.green.opacity(0.1) : Color.gray.opacity(0.1))
        .cornerRadius(6)
    }
}

private struct InfoItem: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)

            Text(value)
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct SectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.headline)
            .padding(.top, 8)
    }
}

private struct ConfigRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            Text(value)
                .font(.subheadline)
        }
        .padding(.vertical, 4)
    }
}

private struct StatCard: View {
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
                .font(.title3)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

private struct ExecutionLogRow: View {
    let log: HookExecutionLog

    var body: some View {
        HStack {
            Image(systemName: log.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundColor(log.success ? .green : .red)

            VStack(alignment: .leading, spacing: 2) {
                Text(log.timestamp, style: .relative)
                    .font(.subheadline)

                if let message = log.message {
                    Text(message)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Text(String(format: "%.0fms", log.duration * 1000))
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 8)
    }
}

/// 执行日志
struct HookExecutionLog: Identifiable {
    let id = UUID()
    let timestamp: Date
    let success: Bool
    let duration: TimeInterval
    let message: String?
}

/// 流式布局
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = flowLayout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = flowLayout(proposal: proposal, subviews: subviews)

        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func flowLayout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)

            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }

            positions.append(CGPoint(x: currentX, y: currentY))
            currentX += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }

        return (CGSize(width: maxWidth, height: currentY + lineHeight), positions)
    }
}

/// 编辑钩子视图占位符
struct EditHookView: View {
    let hook: HookConfig
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Text("编辑钩子: \(hook.name)")
                .navigationTitle("编辑钩子")
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("取消") { dismiss() }
                    }
                }
        }
    }
}

// MARK: - 预览

#if DEBUG
struct HookDetailView_Previews: PreviewProvider {
    static var previews: some View {
        HookDetailView(hook: HookConfig(
            event: .preToolUse,
            name: "工具权限检查",
            type: .sync,
            script: """
            if (hookContext.tool === 'dangerous_tool') {
                result.action = 'reject';
                result.message = '该工具被禁止使用';
            }
            """
        ))
    }
}
#endif
