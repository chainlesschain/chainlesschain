//
//  EscrowDetailView.swift
//  ChainlessChain
//
//  托管详情视图
//  显示托管完整信息和操作按钮
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 托管详情视图
struct EscrowDetailView: View {
    let wallet: Wallet
    let escrow: Escrow

    @Environment(\.dismiss) var dismiss
    @StateObject private var escrowManager = EscrowManager.shared
    @StateObject private var gasManager = GasManager.shared

    @State private var showPasswordInput = false
    @State private var pendingAction: EscrowAction?
    @State private var isPerformingAction = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var showSuccess = false
    @State private var successMessage: String?
    @State private var gasPriceEstimate: GasPriceEstimate?
    @State private var selectedGasSpeed: GasSpeed = .standard

    var userRole: EscrowRole? {
        escrow.userRole(walletAddress: wallet.address)
    }

    var availableActions: [EscrowAction] {
        var actions: [EscrowAction] = []

        if escrow.canMarkDelivered(walletAddress: wallet.address) {
            actions.append(.markDelivered)
        }

        if escrow.canRelease(walletAddress: wallet.address) {
            actions.append(.release)
        }

        if escrow.canRefund(walletAddress: wallet.address) {
            actions.append(.refund)
        }

        if escrow.canDispute(walletAddress: wallet.address) {
            actions.append(.dispute)
        }

        if escrow.canResolveDispute(walletAddress: wallet.address) {
            actions.append(.resolveToSeller)
            actions.append(.resolveToBuyer)
        }

        return actions
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // 状态卡片
                    StatusCard(escrow: escrow)

                    // 基本信息
                    if let title = escrow.title {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(title)
                                .font(.title2)
                                .fontWeight(.bold)

                            if let description = escrow.description {
                                Text(description)
                                    .font(.body)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                    }

                    // 托管信息
                    VStack(spacing: 0) {
                        DetailRow(label: "托管ID", value: formatEscrowId(escrow.escrowId))
                        Divider().padding(.leading)

                        DetailRow(label: "金额", value: escrow.amountDisplay)
                        Divider().padding(.leading)

                        DetailRow(label: "支付类型", value: escrow.paymentType.displayName)
                        Divider().padding(.leading)

                        if let tokenAddress = escrow.tokenAddress {
                            CopyableRow(
                                label: "代币地址",
                                value: tokenAddress,
                                displayValue: formatAddress(tokenAddress),
                                onCopy: {
                                    UIPasteboard.general.string = tokenAddress
                                }
                            )
                            Divider().padding(.leading)
                        }

                        DetailRow(label: "网络", value: escrow.chain?.name ?? "未知")
                        Divider().padding(.leading)

                        DetailRow(label: "状态", value: escrow.state.displayName)
                    }
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                    .padding(.horizontal)

                    // 参与方信息
                    VStack(spacing: 0) {
                        ParticipantRow(
                            label: "买家",
                            address: escrow.buyer,
                            isCurrentUser: escrow.buyer.lowercased() == wallet.address.lowercased()
                        )
                        Divider().padding(.leading)

                        ParticipantRow(
                            label: "卖家",
                            address: escrow.seller,
                            isCurrentUser: escrow.seller.lowercased() == wallet.address.lowercased()
                        )
                        Divider().padding(.leading)

                        ParticipantRow(
                            label: "仲裁者",
                            address: escrow.arbitrator,
                            isCurrentUser: escrow.arbitrator.lowercased() == wallet.address.lowercased()
                        )
                    }
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                    .padding(.horizontal)

                    // 时间信息
                    VStack(spacing: 0) {
                        DetailRow(label: "创建时间", value: formatFullDate(escrow.createdAt))

                        if let deliveredAt = escrow.deliveredAt {
                            Divider().padding(.leading)
                            DetailRow(label: "交付时间", value: formatFullDate(deliveredAt))
                        }

                        if let completedAt = escrow.completedAt {
                            Divider().padding(.leading)
                            DetailRow(label: "完成时间", value: formatFullDate(completedAt))
                        }
                    }
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                    .padding(.horizontal)

                    // 操作按钮
                    if !availableActions.isEmpty {
                        VStack(spacing: 12) {
                            ForEach(availableActions, id: \.self) { action in
                                ActionButton(action: action) {
                                    pendingAction = action
                                    showPasswordInput = true
                                }
                                .disabled(isPerformingAction)
                            }
                        }
                        .padding(.horizontal)
                    }

                    // 事件历史
                    let events = escrowManager.getEvents(for: escrow.escrowId)
                    if !events.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("事件历史")
                                .font(.headline)
                                .padding(.horizontal)

                            ForEach(events) { event in
                                EventRow(event: event)
                            }
                        }
                        .padding(.vertical)
                    }
                }
                .padding(.vertical)
            }
            .navigationTitle("托管详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                Task {
                    await estimateGasPrice()
                }
            }
            .sheet(isPresented: $showPasswordInput) {
                if let action = pendingAction {
                    PasswordInputSheet(wallet: wallet) { password in
                        await performAction(action, password: password)
                    }
                }
            }
            .alert("成功", isPresented: $showSuccess) {
                Button("确定", role: .cancel) {}
            } message: {
                if let message = successMessage {
                    Text(message)
                }
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

    /// 执行操作
    private func performAction(_ action: EscrowAction, password: String) async {
        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            _ = try await WalletManager.shared.unlockWallet(walletId: wallet.id, password: password)

            let gasPrice = gasPriceEstimate?.toWei(speed: selectedGasSpeed)

            switch action {
            case .markDelivered:
                _ = try await escrowManager.markAsDelivered(
                    escrow: escrow,
                    wallet: wallet,
                    gasPrice: gasPrice
                )
                successMessage = "已标记为已交付"

            case .release:
                _ = try await escrowManager.release(
                    escrow: escrow,
                    wallet: wallet,
                    gasPrice: gasPrice
                )
                successMessage = "资金已释放给卖家"

            case .refund:
                _ = try await escrowManager.refund(
                    escrow: escrow,
                    wallet: wallet,
                    gasPrice: gasPrice
                )
                successMessage = "已退款"

            case .dispute:
                _ = try await escrowManager.dispute(
                    escrow: escrow,
                    wallet: wallet,
                    gasPrice: gasPrice
                )
                successMessage = "已发起争议"

            case .resolveToSeller:
                _ = try await escrowManager.resolveDisputeToSeller(
                    escrow: escrow,
                    wallet: wallet,
                    gasPrice: gasPrice
                )
                successMessage = "争议已解决，资金给卖家"

            case .resolveToBuyer:
                _ = try await escrowManager.resolveDisputeToBuyer(
                    escrow: escrow,
                    wallet: wallet,
                    gasPrice: gasPrice
                )
                successMessage = "争议已解决，资金退还买家"

            default:
                break
            }

            showSuccess = true
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    private func estimateGasPrice() async {
        do {
            gasPriceEstimate = try await gasManager.getGasPriceEstimate(chain: wallet.chain ?? .ethereumMainnet)
        } catch {
            Logger.shared.error("Gas估算失败: \(error)")
        }
    }

    private func formatEscrowId(_ id: String) -> String {
        guard id.count > 10 else { return id }
        let start = id.prefix(10)
        let end = id.suffix(6)
        return "\(start)...\(end)"
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }

    private func formatFullDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = Locale(identifier: "zh_CN")
        return formatter.string(from: date)
    }
}

/// 状态卡片
struct StatusCard: View {
    let escrow: Escrow

    var body: some View {
        VStack(spacing: 16) {
            // 状态图标
            ZStack {
                Circle()
                    .fill(escrow.stateColor.opacity(0.2))
                    .frame(width: 80, height: 80)

                Image(systemName: escrow.state.icon)
                    .font(.system(size: 40))
                    .foregroundColor(escrow.stateColor)
            }

            // 状态文本
            VStack(spacing: 4) {
                Text(escrow.state.displayName)
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(escrow.stateColor)

                Text(escrow.state.description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            // 进度条
            if escrow.state != .disputed {
                ProgressView(value: Double(escrow.stateProgress), total: 100)
                    .progressViewStyle(.linear)
                    .tint(escrow.stateColor)
                    .padding(.horizontal)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .background(escrow.stateColor.opacity(0.05))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}

/// 参与方行
struct ParticipantRow: View {
    let label: String
    let address: String
    let isCurrentUser: Bool

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 4) {
                    Text(formatAddress(address))
                        .font(.system(.body, design: .monospaced))

                    if isCurrentUser {
                        Text("(我)")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }

                    Button(action: {
                        UIPasteboard.general.string = address
                    }) {
                        Image(systemName: "doc.on.doc")
                            .font(.caption)
                    }
                }
            }
        }
        .padding()
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }
}

/// 操作按钮
struct ActionButton: View {
    let action: EscrowAction
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Label(action.displayName, systemImage: action.icon)
                .frame(maxWidth: .infinity)
                .padding()
                .background(action.color)
                .foregroundColor(.white)
                .cornerRadius(12)
        }
    }
}

/// 事件行
struct EventRow: View {
    let event: EscrowEvent

    var body: some View {
        HStack(spacing: 12) {
            // 事件图标
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.2))
                    .frame(width: 32, height: 32)

                Image(systemName: event.eventType.icon)
                    .font(.system(size: 14))
                    .foregroundColor(.blue)
            }

            // 事件信息
            VStack(alignment: .leading, spacing: 2) {
                Text(event.eventType.displayName)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(formatDate(event.timestamp))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // 交易哈希
            if let hash = event.transactionHash {
                Button(action: {
                    UIPasteboard.general.string = hash
                }) {
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
        .cornerRadius(8)
        .padding(.horizontal)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - 预览

#if DEBUG
struct EscrowDetailView_Previews: PreviewProvider {
    static var previews: some View {
        EscrowDetailView(wallet: .preview, escrow: .preview)

        EscrowDetailView(wallet: .preview, escrow: .previewDelivered)
            .previewDisplayName("已交付")
    }
}
#endif
