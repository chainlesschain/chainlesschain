//
//  TransactionHistoryView.swift
//  ChainlessChain
//
//  交易历史列表视图
//  显示钱包的所有交易记录，支持筛选和详情查看
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI
import Combine

/// 交易历史视图
struct TransactionHistoryView: View {
    let wallet: Wallet

    @StateObject private var transactionManager = TransactionManager.shared
    @State private var transactions: [TransactionRecord] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var selectedTransaction: TransactionRecord?
    @State private var filterStatus: TransactionStatus?
    @State private var cancellables = Set<AnyCancellable>()

    var filteredTransactions: [TransactionRecord] {
        if let status = filterStatus {
            return transactions.filter { $0.status == status }
        }
        return transactions
    }

    var body: some View {
        List {
            // 筛选器
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        FilterChip(
                            title: "全部",
                            isSelected: filterStatus == nil,
                            action: { filterStatus = nil }
                        )

                        FilterChip(
                            title: "待确认",
                            isSelected: filterStatus == .pending,
                            action: { filterStatus = .pending }
                        )

                        FilterChip(
                            title: "确认中",
                            isSelected: filterStatus == .confirming,
                            action: { filterStatus = .confirming }
                        )

                        FilterChip(
                            title: "已确认",
                            isSelected: filterStatus == .confirmed,
                            action: { filterStatus = .confirmed }
                        )

                        FilterChip(
                            title: "失败",
                            isSelected: filterStatus == .failed,
                            action: { filterStatus = .failed }
                        )
                    }
                    .padding(.vertical, 4)
                }
            }
            .listRowInsets(EdgeInsets())

            // 交易列表
            if filteredTransactions.isEmpty {
                Section {
                    EmptyTransactionsView(filterStatus: filterStatus)
                }
            } else {
                Section(header: Text("交易记录")) {
                    ForEach(filteredTransactions) { transaction in
                        TransactionRow(transaction: transaction)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedTransaction = transaction
                            }
                    }
                }
            }
        }
        .navigationTitle("交易历史")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading {
                ProgressView("加载中...")
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(10)
                    .shadow(radius: 10)
            }
        }
        .refreshable {
            await loadTransactions()
        }
        .onAppear {
            loadTransactions()
            subscribeToEvents()
        }
        .sheet(item: $selectedTransaction) { transaction in
            TransactionDetailView(transaction: transaction)
        }
        .alert("错误", isPresented: $showError) {
            Button("确定", role: .cancel) {}
        } message: {
            if let error = errorMessage {
                Text(error)
            }
        }
    }

    /// 加载交易列表
    @Sendable
    private func loadTransactions() async {
        isLoading = true
        defer { isLoading = false }

        do {
            transactions = try await transactionManager.getTransactionHistory(
                walletId: wallet.id,
                chainId: wallet.chainId,
                limit: 100
            )
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    /// 订阅交易事件
    private func subscribeToEvents() {
        // 交易更新时刷新列表
        transactionManager.transactionUpdated
            .sink { _ in
                Task {
                    await loadTransactions()
                }
            }
            .store(in: &cancellables)

        // 交易确认时刷新
        transactionManager.transactionConfirmed
            .sink { _ in
                Task {
                    await loadTransactions()
                }
            }
            .store(in: &cancellables)

        // 交易失败时刷新
        transactionManager.transactionFailed
            .sink { _ in
                Task {
                    await loadTransactions()
                }
            }
            .store(in: &cancellables)
    }
}

/// 交易行视图
struct TransactionRow: View {
    let transaction: TransactionRecord

    var statusColor: Color {
        switch transaction.status {
        case .confirmed:
            return .green
        case .pending, .confirming:
            return .orange
        case .failed, .dropped:
            return .red
        case .replaced:
            return .gray
        }
    }

    var typeIcon: String {
        switch transaction.type {
        case .send:
            return "arrow.up.circle.fill"
        case .receive:
            return "arrow.down.circle.fill"
        case .contract, .approve:
            return "doc.text.fill"
        case .tokenTransfer:
            return "dollarsign.circle.fill"
        case .nftTransfer, .nftMint:
            return "photo.fill"
        case .escrowCreate, .escrowRelease:
            return "lock.shield.fill"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            // 类型图标
            Image(systemName: typeIcon)
                .font(.title2)
                .foregroundColor(transaction.type == .send ? .red : .green)
                .frame(width: 40, height: 40)
                .background(
                    Circle()
                        .fill(transaction.type == .send ? Color.red.opacity(0.1) : Color.green.opacity(0.1))
                )

            // 交易信息
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(transaction.type.displayName)
                        .font(.headline)

                    Spacer()

                    Text(transaction.status.displayName)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(statusColor.opacity(0.2))
                        .foregroundColor(statusColor)
                        .cornerRadius(10)
                }

                HStack {
                    Text(transaction.valueDisplay + " " + (transaction.chain?.symbol ?? "ETH"))
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Spacer()

                    if transaction.status == .confirming {
                        Text("\(transaction.confirmations)/12")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                HStack {
                    if let fee = transaction.fee {
                        Text("手续费: \(WeiConverter.weiToEther(fee)) " + (transaction.chain?.symbol ?? "ETH"))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    Text(transaction.createdAt, style: .relative)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// 空交易视图
struct EmptyTransactionsView: View {
    let filterStatus: TransactionStatus?

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            if let status = filterStatus {
                Text("没有\(status.displayName)的交易")
                    .font(.headline)
                    .foregroundColor(.secondary)
            } else {
                Text("暂无交易记录")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Text("您的交易记录将显示在这里")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

/// 筛选器标签
struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption)
                .fontWeight(.medium)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? Color.blue : Color.gray.opacity(0.2))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(16)
        }
    }
}

// MARK: - Extensions

extension TransactionRecord {
    var chain: SupportedChain? {
        SupportedChain.allCases.first { $0.chainId == chainId }
    }
}

// MARK: - 预览

#if DEBUG
struct TransactionHistoryView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            TransactionHistoryView(wallet: .preview)
        }

        TransactionRow(transaction: .preview)
            .previewLayout(.sizeThatFits)
            .padding()
            .previewDisplayName("交易行")

        EmptyTransactionsView(filterStatus: nil)
            .previewLayout(.sizeThatFits)
            .padding()
            .previewDisplayName("空状态")
    }
}

extension TransactionRecord {
    static let preview = TransactionRecord(
        id: "preview-tx",
        hash: "0x1234567890abcdef",
        walletId: "preview-wallet",
        chainId: 1,
        type: .send,
        status: .confirmed,
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: "100000000000000000",  // 0.1 ETH
        data: nil,
        nonce: "1",
        gasLimit: "21000",
        gasPrice: "20000000000",  // 20 Gwei
        gasUsed: "21000",
        fee: "420000000000000",  // 0.00042 ETH
        blockNumber: "12345678",
        blockHash: "0xabcd",
        confirmations: 15,
        errorMessage: nil,
        contractAddress: nil,
        createdAt: Date().addingTimeInterval(-3600),
        updatedAt: Date(),
        confirmedAt: Date()
    )
}
#endif
