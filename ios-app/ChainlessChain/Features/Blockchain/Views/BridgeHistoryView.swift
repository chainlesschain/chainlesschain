//
//  BridgeHistoryView.swift
//  ChainlessChain
//
//  桥接历史视图
//  显示所有跨链桥接记录
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 桥接历史视图
struct BridgeHistoryView: View {
    @StateObject private var viewModel = BridgeHistoryViewModel()
    @State private var selectedFilter: BridgeStatusFilter = .all

    var body: some View {
        VStack(spacing: 0) {
            // 筛选器
            filterBar

            // 列表
            if viewModel.isLoading && viewModel.bridges.isEmpty {
                loadingView
            } else if viewModel.bridges.isEmpty {
                emptyView
            } else {
                bridgeList
            }
        }
        .navigationTitle("桥接历史")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(action: {
                        viewModel.exportHistory()
                    }) {
                        Label("导出记录", systemImage: "square.and.arrow.up")
                    }

                    Button(action: {
                        viewModel.refresh()
                    }) {
                        Label("刷新", systemImage: "arrow.clockwise")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .refreshable {
            await viewModel.refreshAsync()
        }
        .onAppear {
            viewModel.loadBridges()
        }
        .onChange(of: selectedFilter) { _, newFilter in
            viewModel.filterByStatus(newFilter)
        }
    }

    // MARK: - 筛选器栏

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(BridgeStatusFilter.allCases, id: \.self) { filter in
                    FilterChip(
                        title: filter.displayName,
                        count: viewModel.countForFilter(filter),
                        isSelected: selectedFilter == filter
                    ) {
                        selectedFilter = filter
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .background(Color(.systemBackground))
    }

    // MARK: - 加载视图

    private var loadingView: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
            Text("加载中...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "arrow.left.arrow.right.circle")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无桥接记录")
                .font(.headline)
                .foregroundColor(.secondary)

            Text(selectedFilter == .all ?
                 "您还没有进行过跨链桥接" :
                 "没有\(selectedFilter.displayName)的记录")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            if selectedFilter != .all {
                Button("查看全部记录") {
                    selectedFilter = .all
                }
                .font(.subheadline)
                .foregroundColor(.blue)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - 桥接列表

    private var bridgeList: some View {
        List {
            // 统计摘要
            Section {
                statisticsSummary
            }

            // 桥接记录
            Section(header: Text("记录列表")) {
                ForEach(viewModel.filteredBridges) { record in
                    NavigationLink(destination: BridgeTransactionView(bridgeRecord: record)) {
                        BridgeHistoryRow(record: record)
                    }
                }

                // 加载更多
                if viewModel.hasMore {
                    Button(action: {
                        viewModel.loadMore()
                    }) {
                        HStack {
                            Spacer()
                            if viewModel.isLoadingMore {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else {
                                Text("加载更多")
                                    .font(.subheadline)
                                    .foregroundColor(.blue)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 8)
                    }
                    .disabled(viewModel.isLoadingMore)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - 统计摘要

    private var statisticsSummary: some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                StatisticCard(
                    title: "总桥接次数",
                    value: "\(viewModel.totalCount)",
                    icon: "arrow.left.arrow.right",
                    color: .blue
                )

                StatisticCard(
                    title: "成功",
                    value: "\(viewModel.completedCount)",
                    icon: "checkmark.circle",
                    color: .green
                )
            }

            HStack(spacing: 16) {
                StatisticCard(
                    title: "进行中",
                    value: "\(viewModel.pendingCount)",
                    icon: "clock",
                    color: .orange
                )

                StatisticCard(
                    title: "失败",
                    value: "\(viewModel.failedCount)",
                    icon: "xmark.circle",
                    color: .red
                )
            }
        }
    }
}

// MARK: - 筛选芯片

struct FilterChip: View {
    let title: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.subheadline)

                if count > 0 {
                    Text("\(count)")
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(isSelected ? Color.white.opacity(0.3) : Color.gray.opacity(0.2))
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isSelected ? Color.blue : Color.gray.opacity(0.1))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}

// MARK: - 统计卡片

struct StatisticCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.1))
                    .frame(width: 40, height: 40)

                Image(systemName: icon)
                    .foregroundColor(color)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.headline)

                Text(title)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }
}

// MARK: - 桥接历史行

struct BridgeHistoryRow: View {
    let record: BridgeRecord

    var statusColor: Color {
        switch record.status {
        case .completed: return .green
        case .failed, .cancelled: return .red
        case .pending, .locking, .locked, .minting: return .orange
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            // 链图标组合
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.1))
                    .frame(width: 44, height: 44)

                Image(systemName: "arrow.left.arrow.right")
                    .foregroundColor(.blue)
            }

            // 桥接信息
            VStack(alignment: .leading, spacing: 4) {
                Text("\(record.fromChainName) → \(record.toChainName)")
                    .font(.subheadline)
                    .fontWeight(.medium)

                HStack(spacing: 8) {
                    Text(record.amountDisplay)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("•")
                        .foregroundColor(.secondary)

                    Text(formatDate(record.createdAt))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // 状态标签
            VStack(alignment: .trailing, spacing: 4) {
                StatusBadge(status: record.status)

                if let duration = calculateDuration() {
                    Text(duration)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: date)
    }

    private func calculateDuration() -> String? {
        guard let completedAt = record.completedAt else {
            if !record.status.isCompleted {
                let duration = Date().timeIntervalSince(record.createdAt)
                return formatDuration(duration)
            }
            return nil
        }

        let duration = completedAt.timeIntervalSince(record.createdAt)
        return formatDuration(duration)
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        if seconds < 60 {
            return "\(Int(seconds))秒"
        } else if seconds < 3600 {
            return "\(Int(seconds / 60))分钟"
        } else {
            return "\(Int(seconds / 3600))小时"
        }
    }
}

// MARK: - 状态徽章

struct StatusBadge: View {
    let status: BridgeStatus

    var statusColor: Color {
        switch status {
        case .completed: return .green
        case .failed, .cancelled: return .red
        case .pending, .locking, .locked, .minting: return .orange
        }
    }

    var body: some View {
        Text(status.displayName)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor.opacity(0.1))
            .foregroundColor(statusColor)
            .cornerRadius(6)
    }
}

// MARK: - 筛选枚举

enum BridgeStatusFilter: CaseIterable {
    case all
    case pending
    case completed
    case failed

    var displayName: String {
        switch self {
        case .all: return "全部"
        case .pending: return "进行中"
        case .completed: return "已完成"
        case .failed: return "失败"
        }
    }

    var statuses: [BridgeStatus] {
        switch self {
        case .all: return BridgeStatus.allCases
        case .pending: return [.pending, .locking, .locked, .minting]
        case .completed: return [.completed]
        case .failed: return [.failed, .cancelled]
        }
    }
}

extension BridgeStatus: CaseIterable {
    public static var allCases: [BridgeStatus] {
        [.pending, .locking, .locked, .minting, .completed, .failed, .cancelled]
    }
}

// MARK: - ViewModel

@MainActor
class BridgeHistoryViewModel: ObservableObject {
    @Published var bridges: [BridgeRecord] = []
    @Published var filteredBridges: [BridgeRecord] = []
    @Published var isLoading = false
    @Published var isLoadingMore = false
    @Published var hasMore = true

    private let bridgeManager = BridgeManager.shared
    private var currentFilter: BridgeStatusFilter = .all
    private var offset = 0
    private let pageSize = 20

    // MARK: - Computed Properties

    var totalCount: Int {
        bridges.count
    }

    var completedCount: Int {
        bridges.filter { $0.status == .completed }.count
    }

    var pendingCount: Int {
        bridges.filter { [.pending, .locking, .locked, .minting].contains($0.status) }.count
    }

    var failedCount: Int {
        bridges.filter { $0.status == .failed || $0.status == .cancelled }.count
    }

    func countForFilter(_ filter: BridgeStatusFilter) -> Int {
        bridges.filter { filter.statuses.contains($0.status) }.count
    }

    // MARK: - Public Methods

    func loadBridges() {
        guard !isLoading else { return }

        isLoading = true
        offset = 0

        Task {
            do {
                bridges = try await bridgeManager.getBridgeHistory(limit: pageSize, offset: 0)
                hasMore = bridges.count >= pageSize
                applyFilter()
            } catch {
                Logger.shared.error("[BridgeHistory] 加载失败: \(error)")
            }
            isLoading = false
        }
    }

    func loadMore() {
        guard !isLoadingMore && hasMore else { return }

        isLoadingMore = true
        offset += pageSize

        Task {
            do {
                let moreBridges = try await bridgeManager.getBridgeHistory(limit: pageSize, offset: offset)
                bridges.append(contentsOf: moreBridges)
                hasMore = moreBridges.count >= pageSize
                applyFilter()
            } catch {
                Logger.shared.error("[BridgeHistory] 加载更多失败: \(error)")
            }
            isLoadingMore = false
        }
    }

    func refresh() {
        loadBridges()
    }

    func refreshAsync() async {
        isLoading = true
        offset = 0

        do {
            bridges = try await bridgeManager.getBridgeHistory(limit: pageSize, offset: 0)
            hasMore = bridges.count >= pageSize
            applyFilter()
        } catch {
            Logger.shared.error("[BridgeHistory] 刷新失败: \(error)")
        }
        isLoading = false
    }

    func filterByStatus(_ filter: BridgeStatusFilter) {
        currentFilter = filter
        applyFilter()
    }

    func exportHistory() {
        // TODO: 实现导出功能
        Logger.shared.info("[BridgeHistory] 导出历史记录")
    }

    // MARK: - Private Methods

    private func applyFilter() {
        if currentFilter == .all {
            filteredBridges = bridges
        } else {
            filteredBridges = bridges.filter { currentFilter.statuses.contains($0.status) }
        }
    }
}

// MARK: - 预览

#if DEBUG
struct BridgeHistoryView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            BridgeHistoryView()
        }
    }
}
#endif
