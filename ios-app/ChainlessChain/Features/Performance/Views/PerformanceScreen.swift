//
//  PerformanceScreen.swift
//  ChainlessChain
//
//  性能面板视图
//  显示系统性能指标和告警
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 性能面板视图
struct PerformanceScreen: View {
    @StateObject private var monitor = PerformanceMonitor.shared
    @StateObject private var alertManager = AlertManager.shared

    @State private var selectedTab: PerformanceTab = .overview

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 标签栏
                tabBar

                // 内容区域
                TabView(selection: $selectedTab) {
                    overviewTab
                        .tag(PerformanceTab.overview)

                    metricsTab
                        .tag(PerformanceTab.metrics)

                    alertsTab
                        .tag(PerformanceTab.alerts)

                    startupTab
                        .tag(PerformanceTab.startup)
                }
                .tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))
            }
            .navigationTitle("性能监控")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: toggleMonitoring) {
                        Image(systemName: monitor.isMonitoring ? "stop.circle.fill" : "play.circle.fill")
                            .foregroundColor(monitor.isMonitoring ? .green : .gray)
                    }
                }
            }
            .onAppear {
                if !monitor.isMonitoring {
                    monitor.startMonitoring()
                }
            }
        }
    }

    // MARK: - 标签栏

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(PerformanceTab.allCases, id: \.self) { tab in
                Button(action: {
                    withAnimation {
                        selectedTab = tab
                    }
                }) {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon)
                            .font(.title3)

                        Text(tab.title)
                            .font(.caption2)
                    }
                    .foregroundColor(selectedTab == tab ? .blue : .secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(selectedTab == tab ? Color.blue.opacity(0.1) : Color.clear)
                }
            }
        }
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - 概览标签

    private var overviewTab: some View {
        ScrollView {
            VStack(spacing: 16) {
                // 实时指标卡片
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    MetricCardView(
                        title: "CPU",
                        value: String(format: "%.1f%%", monitor.currentMetrics.cpuUsage),
                        icon: "cpu",
                        color: cpuColor
                    )

                    MetricCardView(
                        title: "内存",
                        value: String(format: "%.0fMB", monitor.currentMetrics.memoryUsageMB),
                        icon: "memorychip",
                        color: memoryColor
                    )

                    MetricCardView(
                        title: "FPS",
                        value: String(format: "%.0f", monitor.currentMetrics.fps),
                        icon: "speedometer",
                        color: fpsColor
                    )

                    MetricCardView(
                        title: "热状态",
                        value: monitor.currentMetrics.thermalState.description,
                        icon: "thermometer",
                        color: thermalColor
                    )
                }

                // 活跃告警
                if !alertManager.activeAlerts.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("活跃告警")
                            .font(.headline)

                        ForEach(alertManager.activeAlerts.prefix(3)) { alert in
                            AlertRow(alert: alert)
                        }

                        if alertManager.activeAlerts.count > 3 {
                            Text("还有 \(alertManager.activeAlerts.count - 3) 个告警")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                }

                // 系统状态
                VStack(alignment: .leading, spacing: 12) {
                    Text("系统状态")
                        .font(.headline)

                    HStack {
                        SystemStatusRow(
                            icon: "battery.100",
                            label: "电量",
                            value: String(format: "%.0f%%", monitor.currentMetrics.batteryLevel),
                            isCharging: monitor.currentMetrics.isCharging
                        )

                        Spacer()

                        SystemStatusRow(
                            icon: "internaldrive",
                            label: "磁盘",
                            value: formatDiskSpace(monitor.currentMetrics.diskFreeMB)
                        )
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
            }
            .padding()
        }
    }

    // MARK: - 指标标签

    private var metricsTab: some View {
        ScrollView {
            VStack(spacing: 16) {
                // CPU图表
                PerformanceChartView(
                    title: "CPU使用率",
                    data: monitor.getMetricsHistory(limit: 60).map { $0.cpuUsage },
                    color: .blue,
                    unit: "%",
                    maxValue: 100
                )

                // 内存图表
                PerformanceChartView(
                    title: "内存使用",
                    data: monitor.getMetricsHistory(limit: 60).map { $0.memoryUsageMB },
                    color: .green,
                    unit: "MB"
                )

                // FPS图表
                PerformanceChartView(
                    title: "帧率",
                    data: monitor.getMetricsHistory(limit: 60).map { $0.fps },
                    color: .orange,
                    unit: "FPS",
                    maxValue: 60
                )
            }
            .padding()
        }
    }

    // MARK: - 告警标签

    private var alertsTab: some View {
        VStack(spacing: 0) {
            // 告警统计
            HStack(spacing: 16) {
                AlertStatCard(
                    title: "活跃",
                    count: alertManager.activeAlerts.count,
                    color: .red
                )

                AlertStatCard(
                    title: "今日",
                    count: alertManager.getAlertStats().last24hCount,
                    color: .orange
                )

                AlertStatCard(
                    title: "总计",
                    count: alertManager.getAlertStats().totalAlerts,
                    color: .gray
                )
            }
            .padding()

            Divider()

            // 告警列表
            if alertManager.activeAlerts.isEmpty && alertManager.alertHistory.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
                    Image(systemName: "checkmark.shield.fill")
                        .font(.system(size: 50))
                        .foregroundColor(.green)
                    Text("系统运行正常")
                        .font(.headline)
                    Text("暂无告警")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Spacer()
                }
            } else {
                List {
                    if !alertManager.activeAlerts.isEmpty {
                        Section(header: Text("活跃告警")) {
                            ForEach(alertManager.activeAlerts) { alert in
                                AlertRow(alert: alert)
                            }
                        }
                    }

                    if !alertManager.alertHistory.isEmpty {
                        Section(header: Text("历史告警")) {
                            ForEach(alertManager.alertHistory.prefix(20)) { alert in
                                AlertRow(alert: alert)
                            }
                        }
                    }
                }
                .listStyle(InsetGroupedListStyle())
            }
        }
    }

    // MARK: - 启动标签

    private var startupTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 启动时间
                if let summary = StartupTimeTracker.shared.getSummary() {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("启动时间")
                            .font(.headline)

                        HStack(spacing: 20) {
                            StartupTimeCard(
                                title: "总时间",
                                time: summary.totalMs,
                                color: .blue
                            )

                            StartupTimeCard(
                                title: "预主阶段",
                                time: summary.preMainMs,
                                color: .green
                            )

                            StartupTimeCard(
                                title: "主阶段",
                                time: summary.mainMs,
                                color: .orange
                            )
                        }
                    }
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                }

                // 启动里程碑
                if let report = StartupOptimizer.shared.getReport() {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("启动里程碑")
                            .font(.headline)

                        ForEach(report.milestones) { milestone in
                            MilestoneRow(milestone: milestone)
                        }
                    }
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(12)

                    // 延迟任务
                    if !report.deferredTasks.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("延迟任务")
                                .font(.headline)

                            ForEach(report.deferredTasks) { task in
                                DeferredTaskRow(task: task)
                            }
                        }
                        .padding()
                        .background(Color(.systemBackground))
                        .cornerRadius(12)
                    }
                }
            }
            .padding()
        }
    }

    // MARK: - 辅助方法

    private func toggleMonitoring() {
        if monitor.isMonitoring {
            monitor.stopMonitoring()
        } else {
            monitor.startMonitoring()
        }
    }

    private var cpuColor: Color {
        let usage = monitor.currentMetrics.cpuUsage
        if usage >= 90 { return .red }
        if usage >= 70 { return .orange }
        return .blue
    }

    private var memoryColor: Color {
        let usage = monitor.currentMetrics.memoryUsageMB
        if usage >= 500 { return .red }
        if usage >= 300 { return .orange }
        return .green
    }

    private var fpsColor: Color {
        let fps = monitor.currentMetrics.fps
        if fps <= 20 { return .red }
        if fps <= 30 { return .orange }
        return .green
    }

    private var thermalColor: Color {
        switch monitor.currentMetrics.thermalState {
        case .nominal: return .green
        case .fair: return .yellow
        case .serious: return .orange
        case .critical: return .red
        @unknown default: return .gray
        }
    }

    private func formatDiskSpace(_ mb: Double) -> String {
        if mb >= 1024 {
            return String(format: "%.1fGB", mb / 1024)
        }
        return String(format: "%.0fMB", mb)
    }
}

// MARK: - 性能标签枚举

enum PerformanceTab: CaseIterable {
    case overview
    case metrics
    case alerts
    case startup

    var title: String {
        switch self {
        case .overview: return "概览"
        case .metrics: return "指标"
        case .alerts: return "告警"
        case .startup: return "启动"
        }
    }

    var icon: String {
        switch self {
        case .overview: return "gauge"
        case .metrics: return "chart.line.uptrend.xyaxis"
        case .alerts: return "bell"
        case .startup: return "timer"
        }
    }
}

// MARK: - 告警行

struct AlertRow: View {
    let alert: PerformanceAlert

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: alert.type.icon)
                .foregroundColor(severityColor)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(alert.type.displayName)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(alert.message)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            if alert.isResolved {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                Text(formatTime(alert.timestamp))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var severityColor: Color {
        switch alert.severity {
        case .info: return .blue
        case .warning: return .orange
        case .critical: return .red
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}

// MARK: - 告警统计卡片

struct AlertStatCard: View {
    let title: String
    let count: Int
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text("\(count)")
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(color)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }
}

// MARK: - 系统状态行

struct SystemStatusRow: View {
    let icon: String
    let label: String
    let value: String
    var isCharging: Bool = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundColor(.blue)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(spacing: 4) {
                    Text(value)
                        .font(.subheadline)
                        .fontWeight(.medium)

                    if isCharging {
                        Image(systemName: "bolt.fill")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }
            }
        }
    }
}

// MARK: - 启动时间卡片

struct StartupTimeCard: View {
    let title: String
    let time: Double
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(String(format: "%.0fms", time))
                .font(.headline)
                .foregroundColor(color)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 里程碑行

struct MilestoneRow: View {
    let milestone: StartupMilestone

    var body: some View {
        HStack {
            Circle()
                .fill(milestone.isOptional ? Color.gray : Color.blue)
                .frame(width: 8, height: 8)

            Text(milestone.name)
                .font(.subheadline)

            Spacer()

            Text(String(format: "%.0fms", milestone.elapsed * 1000))
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - 延迟任务行

struct DeferredTaskRow: View {
    let task: DeferredTask

    var body: some View {
        HStack {
            Image(systemName: statusIcon)
                .foregroundColor(statusColor)
                .frame(width: 20)

            Text(task.name)
                .font(.subheadline)

            Spacer()

            if let duration = task.duration {
                Text(String(format: "%.0fms", duration * 1000))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var statusIcon: String {
        switch task.status {
        case .pending: return "clock"
        case .running: return "arrow.clockwise"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        }
    }

    private var statusColor: Color {
        switch task.status {
        case .pending: return .gray
        case .running: return .blue
        case .completed: return .green
        case .failed: return .red
        }
    }
}

// MARK: - 预览

#if DEBUG
struct PerformanceScreen_Previews: PreviewProvider {
    static var previews: some View {
        PerformanceScreen()
    }
}
#endif
