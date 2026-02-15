//
//  PendingTransactionsView.swift
//  ChainlessChain
//
//  待处理交易视图
//  显示和管理待确认的区块链交易
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI
import Combine

/// 待处理交易视图
struct PendingTransactionsView: View {
    @EnvironmentObject var walletViewModel: WalletViewModel
    @StateObject private var viewModel = PendingTransactionsViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // 顶部统计
            statisticsBar

            // 交易列表
            if viewModel.isLoading && viewModel.transactions.isEmpty {
                loadingView
            } else if viewModel.transactions.isEmpty {
                emptyView
            } else {
                transactionsList
            }
        }
        .navigationTitle("待处理交易")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(action: {
                        viewModel.refresh()
                    }) {
                        Label("刷新", systemImage: "arrow.clockwise")
                    }

                    Button(role: .destructive, action: {
                        viewModel.showCancelAllConfirmation = true
                    }) {
                        Label("取消全部", systemImage: "xmark.circle")
                    }
                    .disabled(viewModel.transactions.isEmpty)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .alert("取消全部交易", isPresented: $viewModel.showCancelAllConfirmation) {
            Button("取消", role: .cancel) {}
            Button("确认取消", role: .destructive) {
                Task {
                    await viewModel.cancelAllTransactions()
                }
            }
        } message: {
            Text("确定要取消所有待处理的交易吗？这将需要支付Gas费用。")
        }
        .onAppear {
            viewModel.setWallet(walletViewModel.currentWallet)
            viewModel.startMonitoring()
        }
        .onDisappear {
            viewModel.stopMonitoring()
        }
    }

    // MARK: - 统计栏

    private var statisticsBar: some View {
        HStack(spacing: 0) {
            StatisticItem(
                title: "待处理",
                value: "\(viewModel.pendingCount)",
                color: .orange
            )

            Divider()
                .frame(height: 30)

            StatisticItem(
                title: "加速中",
                value: "\(viewModel.speedingUpCount)",
                color: .blue
            )

            Divider()
                .frame(height: 30)

            StatisticItem(
                title: "总Gas",
                value: viewModel.totalGasFormatted,
                color: .purple
            )
        }
        .padding(.vertical, 12)
        .background(Color(.secondarySystemBackground))
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

            Image(systemName: "checkmark.circle")
                .font(.system(size: 60))
                .foregroundColor(.green)

            Text("没有待处理交易")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("所有交易都已确认")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()
        }
    }

    // MARK: - 交易列表

    private var transactionsList: some View {
        List {
            ForEach(viewModel.transactions) { transaction in
                PendingTransactionRow(
                    transaction: transaction,
                    onSpeedUp: {
                        viewModel.speedUpTransaction(transaction)
                    },
                    onCancel: {
                        viewModel.cancelTransaction(transaction)
                    }
                )
            }
        }
        .listStyle(.plain)
        .refreshable {
            await viewModel.refreshAsync()
        }
    }
}

// MARK: - 统计项

struct StatisticItem: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.headline)
                .fontWeight(.bold)
                .foregroundColor(color)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 待处理交易行

struct PendingTransactionRow: View {
    let transaction: PendingTransaction
    let onSpeedUp: () -> Void
    let onCancel: () -> Void

    @State private var showActions = false

    var body: some View {
        VStack(spacing: 12) {
            // 主信息行
            HStack(spacing: 12) {
                // 交易类型图标
                ZStack {
                    Circle()
                        .fill(transaction.typeColor.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: transaction.typeIcon)
                        .foregroundColor(transaction.typeColor)
                }

                // 交易信息
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(transaction.typeDisplayName)
                            .font(.subheadline)
                            .fontWeight(.medium)

                        if transaction.isSpeedingUp {
                            Text("加速中")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.blue.opacity(0.1))
                                .foregroundColor(.blue)
                                .cornerRadius(4)
                        }
                    }

                    HStack(spacing: 8) {
                        Text(formatAddress(transaction.to))
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("•")
                            .foregroundColor(.secondary)

                        Text(transaction.valueFormatted)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // 状态和Gas
                VStack(alignment: .trailing, spacing: 4) {
                    // 等待时间
                    HStack(spacing: 4) {
                        Image(systemName: "clock")
                            .font(.caption2)

                        Text(formatWaitTime(transaction.createdAt))
                            .font(.caption)
                    }
                    .foregroundColor(.orange)

                    // Nonce
                    Text("Nonce: \(transaction.nonce)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            // 操作按钮（展开时显示）
            if showActions {
                HStack(spacing: 12) {
                    // 加速按钮
                    Button(action: onSpeedUp) {
                        HStack {
                            Image(systemName: "bolt.fill")
                            Text("加速")
                        }
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.blue)
                        .cornerRadius(8)
                    }
                    .disabled(transaction.isSpeedingUp)

                    // 取消按钮
                    Button(action: onCancel) {
                        HStack {
                            Image(systemName: "xmark")
                            Text("取消")
                        }
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.red)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.red.opacity(0.1))
                        .cornerRadius(8)
                    }

                    Spacer()

                    // Gas详情
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Gas Price")
                            .font(.caption2)
                            .foregroundColor(.secondary)

                        Text("\(transaction.gasPriceGwei) Gwei")
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                }
                .padding(.top, 8)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.2)) {
                showActions.toggle()
            }
        }
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }

    private func formatWaitTime(_ date: Date) -> String {
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 {
            return "\(seconds)秒"
        } else if seconds < 3600 {
            return "\(seconds / 60)分钟"
        } else {
            return "\(seconds / 3600)小时"
        }
    }
}

// MARK: - 待处理交易模型

struct PendingTransaction: Identifiable {
    let id: String
    let hash: String
    let type: TransactionType
    let from: String
    let to: String
    let value: Decimal
    let nonce: Int
    let gasPrice: Decimal
    let gasLimit: Int
    let data: String?
    var isSpeedingUp: Bool
    let createdAt: Date
    let chainId: Int

    var typeDisplayName: String {
        switch type {
        case .transfer: return "转账"
        case .swap: return "兑换"
        case .approve: return "授权"
        case .contract: return "合约调用"
        case .bridge: return "跨链"
        case .nft: return "NFT"
        }
    }

    var typeIcon: String {
        switch type {
        case .transfer: return "arrow.up.right"
        case .swap: return "arrow.left.arrow.right"
        case .approve: return "checkmark.shield"
        case .contract: return "doc.text"
        case .bridge: return "link"
        case .nft: return "photo.artframe"
        }
    }

    var typeColor: Color {
        switch type {
        case .transfer: return .blue
        case .swap: return .purple
        case .approve: return .green
        case .contract: return .orange
        case .bridge: return .cyan
        case .nft: return .pink
        }
    }

    var valueFormatted: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 6
        let chain = SupportedChain.allCases.first { $0.chainId == chainId }
        return "\(formatter.string(from: value as NSDecimalNumber) ?? "0") \(chain?.symbol ?? "ETH")"
    }

    var gasPriceGwei: String {
        let gwei = gasPrice / 1_000_000_000
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        return formatter.string(from: gwei as NSDecimalNumber) ?? "0"
    }
}

enum TransactionType {
    case transfer
    case swap
    case approve
    case contract
    case bridge
    case nft
}

// MARK: - ViewModel

@MainActor
class PendingTransactionsViewModel: ObservableObject {
    @Published var transactions: [PendingTransaction] = []
    @Published var isLoading = false
    @Published var showCancelAllConfirmation = false

    private var currentWallet: Wallet?
    private var monitoringTask: Task<Void, Never>?
    private let transactionManager = TransactionManager.shared

    // MARK: - Computed Properties

    var pendingCount: Int {
        transactions.filter { !$0.isSpeedingUp }.count
    }

    var speedingUpCount: Int {
        transactions.filter { $0.isSpeedingUp }.count
    }

    var totalGasFormatted: String {
        let total = transactions.reduce(Decimal(0)) { result, tx in
            result + (tx.gasPrice * Decimal(tx.gasLimit))
        }
        let ether = total / pow(10, 18)

        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 4

        return formatter.string(from: ether as NSDecimalNumber) ?? "0"
    }

    // MARK: - Public Methods

    func setWallet(_ wallet: Wallet?) {
        currentWallet = wallet
        loadTransactions()
    }

    func startMonitoring() {
        monitoringTask = Task {
            while !Task.isCancelled {
                await refreshAsync()
                try? await Task.sleep(nanoseconds: 10_000_000_000) // 10秒
            }
        }
    }

    func stopMonitoring() {
        monitoringTask?.cancel()
        monitoringTask = nil
    }

    func refresh() {
        loadTransactions()
    }

    func refreshAsync() async {
        isLoading = true
        // 模拟刷新
        try? await Task.sleep(nanoseconds: 500_000_000)
        loadMockData()
        isLoading = false
    }

    func speedUpTransaction(_ transaction: PendingTransaction) {
        guard let index = transactions.firstIndex(where: { $0.id == transaction.id }),
              let wallet = currentWallet else {
            return
        }

        // 更新状态
        transactions[index].isSpeedingUp = true

        Task {
            do {
                // 1. 获取当前Gas价格并提高 20%
                let currentGasPrice = try await GasManager.shared.getGasPrice(chainId: wallet.chainId)
                let newGasPrice = String(format: "%.0f", Double(currentGasPrice) ?? 0 * 1.2)

                // 2. 使用相同的 nonce 重新发送交易（替换原交易）
                // 注意：这里简化实现，实际应该保留原交易的所有参数
                let hash = try await transactionManager.sendTransaction(
                    wallet: wallet,
                    to: transaction.to,
                    value: transaction.value,
                    gasPrice: newGasPrice,
                    nonce: transaction.nonce
                )

                Logger.shared.info("[PendingTransactions] 交易加速成功，新交易哈希: \(hash)")

                // 更新交易哈希
                await MainActor.run {
                    if let idx = self.transactions.firstIndex(where: { $0.id == transaction.id }) {
                        self.transactions[idx].hash = hash
                        self.transactions[idx].isSpeedingUp = false
                    }
                }
            } catch {
                Logger.shared.error("[PendingTransactions] 加速交易失败: \(error)")
                await MainActor.run {
                    if let idx = self.transactions.firstIndex(where: { $0.id == transaction.id }) {
                        self.transactions[idx].isSpeedingUp = false
                    }
                }
            }
        }
    }

    func cancelTransaction(_ transaction: PendingTransaction) {
        guard let wallet = currentWallet else {
            return
        }

        Task {
            do {
                // 1. 获取当前Gas价格并提高 10%（确保优先处理）
                let currentGasPrice = try await GasManager.shared.getGasPrice(chainId: wallet.chainId)
                let newGasPrice = String(format: "%.0f", Double(currentGasPrice) ?? 0 * 1.1)

                // 2. 发送 0 值交易到自己的地址，使用相同的 nonce
                // 这样可以替换原交易，从而取消它
                let hash = try await transactionManager.sendTransaction(
                    wallet: wallet,
                    to: wallet.address,  // 发送给自己
                    value: "0",          // 0 值
                    gasPrice: newGasPrice,
                    nonce: transaction.nonce  // 相同的 nonce
                )

                Logger.shared.info("[PendingTransactions] 交易取消成功，替换交易哈希: \(hash)")

                // 从列表中移除被取消的交易
                await MainActor.run {
                    self.transactions.removeAll { $0.id == transaction.id }
                }
            } catch {
                Logger.shared.error("[PendingTransactions] 取消交易失败: \(error)")
            }
        }
    }

    func cancelAllTransactions() async {
        for transaction in transactions {
            cancelTransaction(transaction)
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    // MARK: - Private Methods

    private func loadTransactions() {
        isLoading = true

        // 模拟加载
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.loadMockData()
            self.isLoading = false
        }
    }

    private func loadMockData() {
        // 模拟数据
        transactions = [
            PendingTransaction(
                id: "1",
                hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                type: .transfer,
                from: "0xabc123",
                to: "0xdef456",
                value: 1.5,
                nonce: 42,
                gasPrice: 30_000_000_000,
                gasLimit: 21000,
                data: nil,
                isSpeedingUp: false,
                createdAt: Date().addingTimeInterval(-120),
                chainId: 1
            ),
            PendingTransaction(
                id: "2",
                hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                type: .swap,
                from: "0xabc123",
                to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
                value: 0.5,
                nonce: 43,
                gasPrice: 35_000_000_000,
                gasLimit: 150000,
                data: "0x...",
                isSpeedingUp: true,
                createdAt: Date().addingTimeInterval(-300),
                chainId: 1
            ),
            PendingTransaction(
                id: "3",
                hash: "0x567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234",
                type: .approve,
                from: "0xabc123",
                to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                value: 0,
                nonce: 44,
                gasPrice: 25_000_000_000,
                gasLimit: 45000,
                data: "0x...",
                isSpeedingUp: false,
                createdAt: Date().addingTimeInterval(-60),
                chainId: 1
            ),
        ]
    }
}

// MARK: - 预览

#if DEBUG
struct PendingTransactionsView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            PendingTransactionsView()
                .environmentObject(WalletViewModel())
        }
    }
}
#endif
