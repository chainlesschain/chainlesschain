//
//  BridgeTransactionView.swift
//  ChainlessChain
//
//  桥接交易详情视图
//  显示跨链桥接的详细信息和状态
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI
import Combine

/// 桥接交易详情视图
struct BridgeTransactionView: View {
    let bridgeRecord: BridgeRecord
    @StateObject private var viewModel: BridgeTransactionViewModel
    @Environment(\.dismiss) var dismiss

    init(bridgeRecord: BridgeRecord) {
        self.bridgeRecord = bridgeRecord
        _viewModel = StateObject(wrappedValue: BridgeTransactionViewModel(record: bridgeRecord))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // 状态卡片
                statusCard

                // 链对信息
                chainPairCard

                // 交易详情
                transactionDetailsCard

                // 费用信息
                feeInfoCard

                // 时间线
                timelineCard

                // 操作按钮
                if !viewModel.record.status.isCompleted {
                    actionButtons
                }
            }
            .padding()
        }
        .navigationTitle("桥接详情")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: {
                    viewModel.refreshStatus()
                }) {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(viewModel.isRefreshing)
            }
        }
        .refreshable {
            await viewModel.refreshStatusAsync()
        }
    }

    // MARK: - 状态卡片

    private var statusCard: some View {
        VStack(spacing: 16) {
            // 状态图标
            ZStack {
                Circle()
                    .fill(viewModel.statusColor.opacity(0.1))
                    .frame(width: 80, height: 80)

                Image(systemName: viewModel.statusIcon)
                    .font(.system(size: 36))
                    .foregroundColor(viewModel.statusColor)
            }

            // 状态文本
            Text(viewModel.record.status.displayName)
                .font(.title2)
                .fontWeight(.bold)

            // 状态描述
            Text(viewModel.statusDescription)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            // 进度指示器（如果进行中）
            if !viewModel.record.status.isCompleted {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle())
                    .scaleEffect(0.8)
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 链对信息

    private var chainPairCard: some View {
        VStack(spacing: 16) {
            HStack(spacing: 0) {
                // 源链
                VStack(spacing: 8) {
                    chainCircle(chainId: viewModel.record.fromChainId)
                    Text(viewModel.record.fromChainName)
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)

                // 箭头和金额
                VStack(spacing: 4) {
                    Image(systemName: "arrow.right")
                        .font(.title3)
                        .foregroundColor(.blue)

                    Text(viewModel.record.amountDisplay)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.blue)
                }
                .padding(.horizontal, 8)

                // 目标链
                VStack(spacing: 8) {
                    chainCircle(chainId: viewModel.record.toChainId)
                    Text(viewModel.record.toChainName)
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    private func chainCircle(chainId: Int) -> some View {
        let chain = SupportedChain.allCases.first { $0.chainId == chainId }

        return ZStack {
            Circle()
                .fill(Color.blue.opacity(0.1))
                .frame(width: 50, height: 50)

            if let chain = chain {
                Text(String(chain.symbol.prefix(1)))
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(.blue)
            } else {
                Image(systemName: "questionmark")
                    .foregroundColor(.gray)
            }
        }
    }

    // MARK: - 交易详情

    private var transactionDetailsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("交易详情")
                .font(.headline)

            VStack(spacing: 12) {
                // 桥接ID
                DetailRow(
                    title: "桥接ID",
                    value: viewModel.record.id,
                    copyable: true
                )

                // 发送地址
                DetailRow(
                    title: "发送地址",
                    value: formatAddress(viewModel.record.senderAddress),
                    fullValue: viewModel.record.senderAddress,
                    copyable: true
                )

                // 接收地址
                DetailRow(
                    title: "接收地址",
                    value: formatAddress(viewModel.record.recipientAddress),
                    fullValue: viewModel.record.recipientAddress,
                    copyable: true
                )

                // 资产地址
                if viewModel.record.assetAddress != "0x0000000000000000000000000000000000000000" {
                    DetailRow(
                        title: "资产合约",
                        value: formatAddress(viewModel.record.assetAddress),
                        fullValue: viewModel.record.assetAddress,
                        copyable: true
                    )
                }

                // 桥接类型
                DetailRow(
                    title: "桥接类型",
                    value: viewModel.record.bridgeType.displayName
                )

                // 桥接协议
                DetailRow(
                    title: "桥接协议",
                    value: viewModel.record.protocol.displayName
                )

                // 源链交易哈希
                if let txHash = viewModel.record.fromTxHash {
                    DetailRow(
                        title: "源链交易",
                        value: formatAddress(txHash),
                        fullValue: txHash,
                        copyable: true,
                        explorerUrl: BlockchainConfig.shared.getExplorerUrl(
                            chainId: viewModel.record.fromChainId,
                            txHash: txHash
                        )
                    )
                }

                // 目标链交易哈希
                if let txHash = viewModel.record.toTxHash {
                    DetailRow(
                        title: "目标链交易",
                        value: formatAddress(txHash),
                        fullValue: txHash,
                        copyable: true,
                        explorerUrl: BlockchainConfig.shared.getExplorerUrl(
                            chainId: viewModel.record.toChainId,
                            txHash: txHash
                        )
                    )
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 费用信息

    private var feeInfoCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("费用信息")
                .font(.headline)

            VStack(spacing: 12) {
                if let estimatedFee = viewModel.record.estimatedFee {
                    HStack {
                        Text("预估费用")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text(WeiConverter.weiToEther(estimatedFee))
                            .font(.subheadline)
                    }
                }

                if let actualFee = viewModel.record.actualFee {
                    HStack {
                        Text("实际费用")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text(WeiConverter.weiToEther(actualFee))
                            .font(.subheadline)
                            .fontWeight(.medium)
                    }
                }

                if viewModel.record.estimatedFee == nil && viewModel.record.actualFee == nil {
                    Text("费用信息待确认")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 时间线

    private var timelineCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("时间线")
                .font(.headline)

            VStack(alignment: .leading, spacing: 0) {
                // 创建时间
                TimelineItem(
                    title: "桥接创建",
                    time: viewModel.record.createdAt,
                    isCompleted: true,
                    isLast: false
                )

                // 锁定时间
                TimelineItem(
                    title: "资产锁定",
                    time: viewModel.record.lockTimestamp,
                    isCompleted: viewModel.record.lockTimestamp != nil,
                    isLast: false
                )

                // 铸造时间
                TimelineItem(
                    title: "资产铸造",
                    time: viewModel.record.mintTimestamp,
                    isCompleted: viewModel.record.mintTimestamp != nil,
                    isLast: false
                )

                // 完成时间
                TimelineItem(
                    title: viewModel.record.status == .failed ? "桥接失败" :
                           viewModel.record.status == .cancelled ? "已取消" : "桥接完成",
                    time: viewModel.record.completedAt,
                    isCompleted: viewModel.record.status.isCompleted,
                    isLast: true,
                    isFailed: viewModel.record.status == .failed
                )
            }

            // 错误信息
            if let error = viewModel.record.errorMessage {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)

                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
                .padding()
                .background(Color.red.opacity(0.1))
                .cornerRadius(8)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 操作按钮

    private var actionButtons: some View {
        VStack(spacing: 12) {
            // 刷新状态按钮
            Button(action: {
                viewModel.refreshStatus()
            }) {
                HStack {
                    if viewModel.isRefreshing {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                    Text("刷新状态")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.blue)
                .cornerRadius(12)
            }
            .disabled(viewModel.isRefreshing)

            // 取消按钮（仅pending状态可取消）
            if viewModel.record.status == .pending {
                Button(action: {
                    viewModel.cancelBridge()
                }) {
                    Text("取消桥接")
                        .font(.subheadline)
                        .foregroundColor(.red)
                }
            }
        }
    }

    // MARK: - 辅助方法

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(8))...\(address.suffix(6))"
    }
}

// MARK: - 详情行

struct DetailRow: View {
    let title: String
    let value: String
    var fullValue: String?
    var copyable: Bool = false
    var explorerUrl: String?

    @State private var showCopied = false

    var body: some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            HStack(spacing: 8) {
                Text(value)
                    .font(.subheadline)
                    .lineLimit(1)

                if copyable {
                    Button(action: copyToClipboard) {
                        Image(systemName: showCopied ? "checkmark" : "doc.on.doc")
                            .font(.caption)
                            .foregroundColor(showCopied ? .green : .blue)
                    }
                }

                if let url = explorerUrl {
                    Link(destination: URL(string: url)!) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }
                }
            }
        }
    }

    private func copyToClipboard() {
        UIPasteboard.general.string = fullValue ?? value
        showCopied = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            showCopied = false
        }
    }
}

// MARK: - 时间线项

struct TimelineItem: View {
    let title: String
    let time: Date?
    let isCompleted: Bool
    let isLast: Bool
    var isFailed: Bool = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // 时间线指示器
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(isCompleted ?
                              (isFailed ? Color.red : Color.green) :
                              Color.gray.opacity(0.3))
                        .frame(width: 16, height: 16)

                    if isCompleted {
                        Image(systemName: isFailed ? "xmark" : "checkmark")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(.white)
                    }
                }

                if !isLast {
                    Rectangle()
                        .fill(isCompleted ? Color.green.opacity(0.3) : Color.gray.opacity(0.2))
                        .frame(width: 2, height: 40)
                }
            }

            // 内容
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(isCompleted ? .medium : .regular)
                    .foregroundColor(isCompleted ? .primary : .secondary)

                if let time = time {
                    Text(formatDateTime(time))
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else if !isCompleted {
                    Text("等待中...")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.bottom, isLast ? 0 : 24)

            Spacer()
        }
    }

    private func formatDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: date)
    }
}

// MARK: - ViewModel

@MainActor
class BridgeTransactionViewModel: ObservableObject {
    @Published var record: BridgeRecord
    @Published var isRefreshing = false

    private let bridgeManager = BridgeManager.shared
    private var refreshTimer: Timer?

    init(record: BridgeRecord) {
        self.record = record

        // 如果未完成，启动自动刷新
        if !record.status.isCompleted {
            startAutoRefresh()
        }
    }

    deinit {
        refreshTimer?.invalidate()
    }

    // MARK: - Computed Properties

    var statusColor: Color {
        switch record.status {
        case .completed: return .green
        case .failed, .cancelled: return .red
        case .pending: return .orange
        case .locking, .locked, .minting: return .blue
        }
    }

    var statusIcon: String {
        switch record.status {
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .cancelled: return "minus.circle.fill"
        case .pending: return "clock.fill"
        case .locking: return "lock.fill"
        case .locked: return "lock.circle.fill"
        case .minting: return "sparkles"
        }
    }

    var statusDescription: String {
        switch record.status {
        case .completed:
            return "资产已成功转移到目标链"
        case .failed:
            return record.errorMessage ?? "桥接过程中发生错误"
        case .cancelled:
            return "桥接已被取消"
        case .pending:
            return "等待交易确认..."
        case .locking:
            return "正在源链锁定资产..."
        case .locked:
            return "资产已锁定，等待目标链铸造..."
        case .minting:
            return "正在目标链铸造资产..."
        }
    }

    // MARK: - Public Methods

    func refreshStatus() {
        Task {
            await refreshStatusAsync()
        }
    }

    func refreshStatusAsync() async {
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            if let updated = try await bridgeManager.getBridge(bridgeId: record.id) {
                record = updated

                // 如果完成，停止自动刷新
                if record.status.isCompleted {
                    refreshTimer?.invalidate()
                    refreshTimer = nil
                }
            }
        } catch {
            Logger.shared.error("[BridgeTransaction] 刷新状态失败: \(error)")
        }
    }

    func cancelBridge() {
        // TODO: 实现取消桥接逻辑
        Logger.shared.info("[BridgeTransaction] 取消桥接: \(record.id)")
    }

    // MARK: - Private Methods

    private func startAutoRefresh() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            self?.refreshStatus()
        }
    }
}

// MARK: - 预览

#if DEBUG
struct BridgeTransactionView_Previews: PreviewProvider {
    static var sampleRecord: BridgeRecord {
        BridgeRecord(
            id: "sample-bridge-id",
            fromChainId: 1,
            toChainId: 137,
            fromTxHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            toTxHash: nil,
            assetAddress: "0x0000000000000000000000000000000000000000",
            amount: "1000000000000000000",
            senderAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
            recipientAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
            status: .locked,
            bridgeType: .lockMint,
            protocol: .native,
            lockTimestamp: Date().addingTimeInterval(-60),
            createdAt: Date().addingTimeInterval(-120),
            estimatedFee: "100000000000000000"
        )
    }

    static var previews: some View {
        NavigationView {
            BridgeTransactionView(bridgeRecord: sampleRecord)
        }
    }
}
#endif
