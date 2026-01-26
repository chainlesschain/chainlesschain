//
//  EscrowListView.swift
//  ChainlessChain
//
//  托管列表视图
//  显示所有托管交易，支持筛选和状态查看
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 托管列表视图
struct EscrowListView: View {
    let wallet: Wallet

    @StateObject private var escrowManager = EscrowManager.shared
    @State private var escrows: [Escrow] = []
    @State private var selectedFilter: EscrowFilter = .all
    @State private var isLoading = false
    @State private var showCreateEscrow = false
    @State private var selectedEscrow: Escrow?
    @State private var errorMessage: String?
    @State private var showError = false

    var filteredEscrows: [Escrow] {
        escrowManager.getEscrows(filter: selectedFilter, walletAddress: wallet.address)
    }

    var hasEscrows: Bool {
        !filteredEscrows.isEmpty
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 筛选器
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(EscrowFilter.allCases, id: \.self) { filter in
                            FilterChip(
                                title: filter.displayName,
                                isSelected: selectedFilter == filter,
                                count: countEscrows(for: filter)
                            ) {
                                selectedFilter = filter
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical, 12)
                .background(Color(.systemBackground))

                Divider()

                // 托管列表
                if hasEscrows {
                    List {
                        ForEach(filteredEscrows) { escrow in
                            EscrowRow(escrow: escrow, wallet: wallet)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    selectedEscrow = escrow
                                }
                        }
                    }
                    .listStyle(.plain)
                } else if !isLoading {
                    EmptyEscrowView(filter: selectedFilter)
                }

                if isLoading {
                    ProgressView("加载中...")
                        .padding()
                }
            }
            .navigationTitle("托管交易")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        showCreateEscrow = true
                    }) {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .refreshable {
                await loadEscrows()
            }
            .onAppear {
                Task {
                    await loadEscrows()
                }
            }
            .sheet(isPresented: $showCreateEscrow) {
                CreateEscrowView(wallet: wallet) {
                    Task {
                        await loadEscrows()
                    }
                }
            }
            .sheet(item: $selectedEscrow) { escrow in
                EscrowDetailView(wallet: wallet, escrow: escrow)
            }
            .alert("错误", isPresented: $showError) {
                Button("确定", role: .cancel) {}
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
        }
    }

    /// 加载托管列表
    private func loadEscrows() async {
        isLoading = true
        defer { isLoading = false }

        // Escrows are already loaded in EscrowManager
        // Just trigger UI update
        escrows = escrowManager.escrows
    }

    /// 统计筛选器数量
    private func countEscrows(for filter: EscrowFilter) -> Int {
        return escrowManager.getEscrows(filter: filter, walletAddress: wallet.address).count
    }
}

/// 筛选器芯片
struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)

                if count > 0 {
                    Text("\(count)")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(isSelected ? .white : .secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(isSelected ? Color.white.opacity(0.3) : Color.gray.opacity(0.2))
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(isSelected ? Color.blue : Color(.systemGray6))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}

/// 托管行视图
struct EscrowRow: View {
    let escrow: Escrow
    let wallet: Wallet

    var body: some View {
        HStack(spacing: 12) {
            // 状态图标
            ZStack {
                Circle()
                    .fill(escrow.stateColor.opacity(0.2))
                    .frame(width: 44, height: 44)

                Image(systemName: escrow.state.icon)
                    .font(.system(size: 20))
                    .foregroundColor(escrow.stateColor)
            }

            // 托管信息
            VStack(alignment: .leading, spacing: 4) {
                // 标题或地址
                Text(escrow.title ?? "托管交易")
                    .font(.headline)
                    .lineLimit(1)

                // 角色标签
                if let role = escrow.userRole(walletAddress: wallet.address) {
                    HStack(spacing: 4) {
                        Image(systemName: role.icon)
                            .font(.caption2)
                        Text(role.displayName)
                            .font(.caption)
                    }
                    .foregroundColor(.blue)
                }

                // 金额
                Text(escrow.amountDisplay)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // 状态和时间
            VStack(alignment: .trailing, spacing: 4) {
                Text(escrow.state.displayName)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(escrow.stateColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(escrow.stateColor.opacity(0.1))
                    .cornerRadius(8)

                Text(formatDate(escrow.createdAt))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 8)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

/// 空托管视图
struct EmptyEscrowView: View {
    let filter: EscrowFilter

    var message: String {
        switch filter {
        case .all:
            return "暂无托管交易"
        case .asBuyer:
            return "暂无购买记录"
        case .asSeller:
            return "暂无销售记录"
        case .asArbitrator:
            return "暂无仲裁任务"
        case .active:
            return "暂无进行中的交易"
        case .completed:
            return "暂无已完成的交易"
        case .disputed:
            return "暂无争议交易"
        }
    }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text(message)
                .font(.headline)
                .foregroundColor(.secondary)

            Text("点击右上角「+」创建新的托管交易")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

// MARK: - 预览

#if DEBUG
struct EscrowListView_Previews: PreviewProvider {
    static var previews: some View {
        EscrowListView(wallet: .preview)

        EscrowRow(escrow: .preview, wallet: .preview)
            .previewLayout(.sizeThatFits)
            .padding()
            .previewDisplayName("托管行")

        EmptyEscrowView(filter: .all)
            .previewLayout(.sizeThatFits)
            .frame(height: 300)
            .previewDisplayName("空状态")
    }
}
#endif
