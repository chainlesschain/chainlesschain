//
//  MCPServerDetailView.swift
//  ChainlessChain
//
//  MCP服务器详情视图
//  显示服务器信息、工具、资源、Prompts
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// MCP服务器详情视图
struct MCPServerDetailView: View {
    let server: MCPServerConfig
    @StateObject private var viewModel = MCPViewModel.shared
    @Environment(\.dismiss) var dismiss
    @State private var selectedTab: ServerDetailTab = .tools

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 服务器状态卡片
                serverStatusCard

                // 标签栏
                tabBar

                // 内容区域
                contentView
            }
            .navigationTitle(server.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: {
                            Task {
                                await viewModel.refreshTools()
                                await viewModel.refreshResources()
                                await viewModel.refreshPrompts()
                            }
                        }) {
                            Label("刷新", systemImage: "arrow.clockwise")
                        }

                        Button(action: {
                            // TODO: 编辑服务器
                        }) {
                            Label("编辑", systemImage: "pencil")
                        }

                        Button(role: .destructive, action: {
                            Task {
                                try? await viewModel.deleteServer(server.id)
                                dismiss()
                            }
                        }) {
                            Label("删除", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .onAppear {
                Task {
                    await viewModel.selectServer(server.id)
                }
            }
        }
    }

    // MARK: - 服务器状态卡片

    private var serverStatusCard: some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                // 状态指示
                VStack(spacing: 4) {
                    ZStack {
                        Circle()
                            .fill(statusColor.opacity(0.1))
                            .frame(width: 60, height: 60)

                        Image(systemName: statusIcon)
                            .font(.title2)
                            .foregroundColor(statusColor)
                    }

                    Text(statusText)
                        .font(.caption)
                        .foregroundColor(statusColor)
                }

                // 服务器信息
                VStack(alignment: .leading, spacing: 4) {
                    Text(server.baseURL ?? "未配置URL")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack(spacing: 12) {
                        StatBadge(
                            icon: "wrench",
                            value: "\(viewModel.serverTools.count)",
                            label: "工具"
                        )

                        StatBadge(
                            icon: "doc",
                            value: "\(viewModel.serverResources.count)",
                            label: "资源"
                        )

                        StatBadge(
                            icon: "text.bubble",
                            value: "\(viewModel.serverPrompts.count)",
                            label: "Prompts"
                        )
                    }
                }

                Spacer()
            }

            // 连接/断开按钮
            if server.enabled {
                Button(action: {
                    Task {
                        if isConnected {
                            await viewModel.disconnectServer(server.id)
                        } else {
                            try? await viewModel.connectServer(server.id)
                        }
                    }
                }) {
                    HStack {
                        if viewModel.isConnecting {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Image(systemName: isConnected ? "stop.fill" : "play.fill")
                        }
                        Text(isConnected ? "断开连接" : "连接")
                    }
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(isConnected ? Color.red : Color.blue)
                    .cornerRadius(8)
                }
                .disabled(viewModel.isConnecting)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - 标签栏

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(ServerDetailTab.allCases, id: \.self) { tab in
                Button(action: {
                    withAnimation {
                        selectedTab = tab
                    }
                }) {
                    VStack(spacing: 6) {
                        HStack(spacing: 4) {
                            Image(systemName: tab.icon)
                            Text(tab.title)
                        }
                        .font(.subheadline)
                        .fontWeight(selectedTab == tab ? .semibold : .regular)
                        .foregroundColor(selectedTab == tab ? .blue : .secondary)

                        Rectangle()
                            .fill(selectedTab == tab ? Color.blue : Color.clear)
                            .frame(height: 2)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.top)
        .background(Color(.systemBackground))
    }

    // MARK: - 内容区域

    @ViewBuilder
    private var contentView: some View {
        switch selectedTab {
        case .tools:
            MCPToolsListView()
        case .resources:
            MCPResourceBrowserView()
        case .prompts:
            MCPPromptListView()
        case .metrics:
            metricsView
        }
    }

    // MARK: - 指标视图

    private var metricsView: some View {
        ScrollView {
            VStack(spacing: 16) {
                // 连接指标
                VStack(alignment: .leading, spacing: 12) {
                    Text("连接指标")
                        .font(.headline)

                    let metrics = viewModel.getMetrics()

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        MetricCard(
                            title: "总调用次数",
                            value: "\(metrics.totalCalls)",
                            icon: "arrow.left.arrow.right"
                        )

                        MetricCard(
                            title: "成功率",
                            value: String(format: "%.1f%%", metrics.successRate),
                            icon: "checkmark.circle"
                        )

                        MetricCard(
                            title: "失败次数",
                            value: "\(metrics.failedCalls)",
                            icon: "xmark.circle"
                        )

                        if let avgLatency = averageLatency {
                            MetricCard(
                                title: "平均延迟",
                                value: "\(Int(avgLatency * 1000))ms",
                                icon: "clock"
                            )
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)

                // 最近调用
                VStack(alignment: .leading, spacing: 12) {
                    Text("最近调用")
                        .font(.headline)

                    if viewModel.recentToolCalls.isEmpty {
                        Text("暂无调用记录")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .padding()
                    } else {
                        ForEach(Array(viewModel.recentToolCalls.prefix(10).enumerated()), id: \.offset) { _, call in
                            RecentCallRow(call: call)
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
            }
            .padding()
        }
    }

    // MARK: - 计算属性

    private var isConnected: Bool {
        viewModel.connectedServers.contains(where: { $0.id == server.id })
    }

    private var statusColor: Color {
        if isConnected {
            return .green
        }
        return .gray
    }

    private var statusIcon: String {
        if isConnected {
            return "checkmark.circle.fill"
        }
        return "circle"
    }

    private var statusText: String {
        if isConnected {
            return "已连接"
        }
        return "未连接"
    }

    private var averageLatency: TimeInterval? {
        let metrics = viewModel.getMetrics()
        let allLatencies = metrics.toolLatencies.values.flatMap { $0 }
        guard !allLatencies.isEmpty else { return nil }
        return allLatencies.reduce(0, +) / Double(allLatencies.count)
    }
}

// MARK: - 服务器详情标签

enum ServerDetailTab: CaseIterable {
    case tools
    case resources
    case prompts
    case metrics

    var title: String {
        switch self {
        case .tools: return "工具"
        case .resources: return "资源"
        case .prompts: return "Prompts"
        case .metrics: return "指标"
        }
    }

    var icon: String {
        switch self {
        case .tools: return "wrench"
        case .resources: return "doc"
        case .prompts: return "text.bubble"
        case .metrics: return "chart.bar"
        }
    }
}

// MARK: - 统计徽章

struct StatBadge: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(value)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - 指标卡片

struct MetricCard: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .foregroundColor(.blue)

            Text(value)
                .font(.title2)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
    }
}

// MARK: - 最近调用行

struct RecentCallRow: View {
    let call: MCPToolCallEvent

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(call.success ? Color.green : Color.red)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(call.toolName)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(call.serverName)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(call.latency * 1000))ms")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text(formatTime(call.timestamp))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 6)
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}

// MARK: - 预览

#if DEBUG
struct MCPServerDetailView_Previews: PreviewProvider {
    static var previews: some View {
        MCPServerDetailView(server: MCPServerConfig(
            name: "测试服务器",
            baseURL: "http://localhost:3000"
        ))
    }
}
#endif
