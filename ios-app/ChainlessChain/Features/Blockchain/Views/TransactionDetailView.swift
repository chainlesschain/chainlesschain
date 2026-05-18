//
//  TransactionDetailView.swift
//  ChainlessChain
//
//  交易详情视图
//  显示交易的完整信息和状态
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 交易详情视图
struct TransactionDetailView: View {
    let transaction: TransactionRecord

    @Environment(\.dismiss) var dismiss
    @State private var showCopyConfirmation = false

    var chain: SupportedChain? {
        SupportedChain.allCases.first { $0.chainId == transaction.chainId }
    }

    var explorerUrl: URL? {
        guard let chain = chain,
              let hash = transaction.hash else {
            return nil
        }
        let config = NetworkConfig.config(for: chain)
        return config.explorerUrl(for: hash).flatMap { URL(string: $0) }
    }

    var body: some View {
        NavigationView {
            List {
                // 状态卡片
                Section {
                    StatusCard(transaction: transaction)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                // 基本信息
                Section(header: Text("基本信息")) {
                    DetailRow(label: "类型", value: transaction.type.displayName)
                    DetailRow(label: "状态", value: transaction.status.displayName, valueColor: statusColor)

                    if transaction.status == .confirming {
                        DetailRow(
                            label: "确认数",
                            value: "\(transaction.confirmations)/12"
                        )
                    }

                    if let chain = chain {
                        DetailRow(label: "网络", value: chain.name)
                    }

                    DetailRow(
                        label: "时间",
                        value: transaction.createdAt.formatted(date: .numeric, time: .shortened)
                    )
                }

                // 交易哈希
                if let hash = transaction.hash {
                    Section(header: Text("交易哈希")) {
                        CopyableRow(
                            value: hash,
                            displayValue: formatHash(hash),
                            onCopy: {
                                UIPasteboard.general.string = hash
                                showCopyConfirmation = true
                            }
                        )

                        if explorerUrl != nil {
                            Link(destination: explorerUrl!) {
                                HStack {
                                    Text("在区块浏览器中查看")
                                        .font(.body)
                                        .foregroundColor(.blue)

                                    Spacer()

                                    Image(systemName: "arrow.up.right.square")
                                        .foregroundColor(.blue)
                                }
                            }
                        }
                    }
                }

                // 地址信息
                Section(header: Text("地址")) {
                    CopyableRow(
                        label: "发送方",
                        value: transaction.from,
                        displayValue: formatAddress(transaction.from),
                        onCopy: {
                            UIPasteboard.general.string = transaction.from
                            showCopyConfirmation = true
                        }
                    )

                    CopyableRow(
                        label: "接收方",
                        value: transaction.to,
                        displayValue: formatAddress(transaction.to),
                        onCopy: {
                            UIPasteboard.general.string = transaction.to
                            showCopyConfirmation = true
                        }
                    )
                }

                // 金额信息
                Section(header: Text("金额")) {
                    DetailRow(
                        label: "转账金额",
                        value: transaction.valueDisplay + " " + (chain?.symbol ?? "ETH")
                    )

                    if let fee = transaction.fee {
                        DetailRow(
                            label: "手续费",
                            value: WeiConverter.weiToEther(fee) + " " + (chain?.symbol ?? "ETH")
                        )
                    }
                }

                // Gas信息
                Section(header: Text("Gas详情")) {
                    DetailRow(label: "Gas限制", value: transaction.gasLimit)

                    DetailRow(
                        label: "Gas价格",
                        value: WeiConverter.weiToGwei(transaction.gasPrice) + " Gwei"
                    )

                    if let gasUsed = transaction.gasUsed {
                        DetailRow(label: "Gas使用", value: gasUsed)
                    }
                }

                // 区块信息
                if let blockNumber = transaction.blockNumber {
                    Section(header: Text("区块信息")) {
                        DetailRow(
                            label: "区块号",
                            value: String(Int(blockNumber.dropFirst(2), radix: 16) ?? 0)
                        )

                        if let blockHash = transaction.blockHash {
                            CopyableRow(
                                label: "区块哈希",
                                value: blockHash,
                                displayValue: formatHash(blockHash),
                                onCopy: {
                                    UIPasteboard.general.string = blockHash
                                    showCopyConfirmation = true
                                }
                            )
                        }
                    }
                }

                // 合约信息
                if let contractAddress = transaction.contractAddress {
                    Section(header: Text("合约")) {
                        CopyableRow(
                            label: "合约地址",
                            value: contractAddress,
                            displayValue: formatAddress(contractAddress),
                            onCopy: {
                                UIPasteboard.general.string = contractAddress
                                showCopyConfirmation = true
                            }
                        )
                    }
                }

                // 错误信息
                if let error = transaction.errorMessage {
                    Section(header: Text("错误信息")) {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // 附加数据
                if let data = transaction.data, !data.isEmpty, data != "0x" {
                    Section(header: Text("数据")) {
                        Text(data)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(nil)
                            .textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("交易详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
            .overlay(alignment: .top) {
                if showCopyConfirmation {
                    CopyConfirmationBanner()
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .onAppear {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                withAnimation {
                                    showCopyConfirmation = false
                                }
                            }
                        }
                }
            }
        }
    }

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

    private func formatHash(_ hash: String) -> String {
        guard hash.count > 10 else { return hash }
        let start = hash.prefix(10)
        let end = hash.suffix(8)
        return "\(start)...\(end)"
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }
}

/// 状态卡片
struct StatusCard: View {
    let transaction: TransactionRecord

    var statusIcon: String {
        switch transaction.status {
        case .confirmed:
            return "checkmark.circle.fill"
        case .pending:
            return "clock.fill"
        case .confirming:
            return "hourglass"
        case .failed, .dropped:
            return "xmark.circle.fill"
        case .replaced:
            return "arrow.triangle.2.circlepath"
        }
    }

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

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: statusIcon)
                .font(.system(size: 60))
                .foregroundColor(statusColor)

            Text(transaction.status.displayName)
                .font(.title2)
                .fontWeight(.semibold)

            if transaction.status == .confirming {
                ProgressView(value: Double(transaction.confirmations), total: 12)
                    .progressViewStyle(.linear)
                    .tint(statusColor)
                    .frame(width: 200)

                Text("\(transaction.confirmations)/12 确认")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .background(statusColor.opacity(0.1))
        .cornerRadius(12)
        .padding()
    }
}

/// 详情行
struct DetailRow: View {
    let label: String
    var value: String
    var valueColor: Color = .primary

    var body: some View {
        HStack {
            Text(label)
                .font(.body)
                .foregroundColor(.secondary)

            Spacer()

            Text(value)
                .font(.body)
                .fontWeight(.medium)
                .foregroundColor(valueColor)
                .multilineTextAlignment(.trailing)
        }
    }
}

/// 可复制行
struct CopyableRow: View {
    var label: String? = nil
    let value: String
    var displayValue: String
    let onCopy: () -> Void

    var body: some View {
        HStack {
            if let label = label {
                Text(label)
                    .font(.body)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Text(displayValue)
                .font(.system(.body, design: .monospaced))
                .fontWeight(.medium)
                .lineLimit(1)

            Button(action: onCopy) {
                Image(systemName: "doc.on.doc")
                    .foregroundColor(.blue)
            }
        }
    }
}

/// 复制确认横幅
struct CopyConfirmationBanner: View {
    var body: some View {
        HStack {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)

            Text("已复制到剪贴板")
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(10)
        .shadow(radius: 10)
        .padding(.top, 60)
    }
}

// MARK: - 预览

#if DEBUG
struct TransactionDetailView_Previews: PreviewProvider {
    static var previews: some View {
        TransactionDetailView(transaction: .preview)

        TransactionDetailView(transaction: .previewPending)
            .previewDisplayName("待确认")

        TransactionDetailView(transaction: .previewFailed)
            .previewDisplayName("失败")
    }
}

extension TransactionRecord {
    static let previewPending = TransactionRecord(
        id: "preview-pending",
        hash: "0xabcdef1234567890",
        walletId: "preview-wallet",
        chainId: 1,
        type: .send,
        status: .pending,
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: "100000000000000000",
        data: nil,
        nonce: "1",
        gasLimit: "21000",
        gasPrice: "20000000000",
        gasUsed: nil,
        fee: nil,
        blockNumber: nil,
        blockHash: nil,
        confirmations: 0,
        errorMessage: nil,
        contractAddress: nil,
        createdAt: Date(),
        updatedAt: Date(),
        confirmedAt: nil
    )

    static let previewFailed = TransactionRecord(
        id: "preview-failed",
        hash: "0xfailed1234567890",
        walletId: "preview-wallet",
        chainId: 1,
        type: .send,
        status: .failed,
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: "100000000000000000",
        data: nil,
        nonce: "1",
        gasLimit: "21000",
        gasPrice: "20000000000",
        gasUsed: "21000",
        fee: "420000000000000",
        blockNumber: "12345678",
        blockHash: "0xblockhash",
        confirmations: 1,
        errorMessage: "Insufficient funds",
        contractAddress: nil,
        createdAt: Date().addingTimeInterval(-600),
        updatedAt: Date(),
        confirmedAt: nil
    )
}
#endif
