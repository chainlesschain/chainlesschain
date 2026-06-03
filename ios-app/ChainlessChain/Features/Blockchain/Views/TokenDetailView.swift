//
//  TokenDetailView.swift
//  ChainlessChain
//
//  代币详情视图
//  显示代币信息和余额，支持发送代币
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 代币详情视图
struct TokenDetailView: View {
    let wallet: Wallet
    let tokenWithBalance: TokenWithBalance

    @Environment(\.dismiss) var dismiss
    @State private var showSendToken = false
    @State private var showDeleteConfirm = false

    var token: Token {
        tokenWithBalance.token
    }

    var balance: String {
        tokenWithBalance.displayBalance
    }

    var balanceUSD: String? {
        tokenWithBalance.displayBalanceUSD
    }

    var body: some View {
        NavigationView {
            List {
                // 余额卡片
                Section {
                    BalanceCard(token: token, balance: balance, balanceUSD: balanceUSD)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                // 代币信息
                Section(header: Text("代币信息")) {
                    DetailRow(label: "名称", value: token.name)
                    DetailRow(label: "符号", value: token.symbol)
                    DetailRow(label: "小数位数", value: "\(token.decimals)")
                    DetailRow(label: "网络", value: token.chainName)

                    if !token.isNative {
                        CopyableRow(
                            label: "合约地址",
                            value: token.address,
                            displayValue: formatAddress(token.address),
                            onCopy: {
                                UIPasteboard.general.string = token.address
                            }
                        )
                    }

                    HStack {
                        Text("标准")
                            .foregroundColor(.secondary)

                        Spacer()

                        HStack(spacing: 4) {
                            Text(token.type == .erc20 ? "ERC-20" : "原生代币")
                                .fontWeight(.medium)

                            if token.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.caption)
                                    .foregroundColor(.blue)
                            }
                        }
                    }
                }

                // 操作
                Section {
                    Button(action: {
                        showSendToken = true
                    }) {
                        Label("发送代币", systemImage: "paperplane.fill")
                    }
                    .disabled(!tokenWithBalance.hasBalance)
                }

                // 删除（仅自定义代币）
                if token.isCustom {
                    Section {
                        Button(role: .destructive, action: {
                            showDeleteConfirm = true
                        }) {
                            Label("删除代币", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle(token.symbol)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showSendToken) {
                SendTokenView(wallet: wallet, token: token, currentBalance: balance)
            }
            .alert("删除代币", isPresented: $showDeleteConfirm) {
                Button("取消", role: .cancel) {}
                Button("删除", role: .destructive) {
                    Task {
                        await deleteToken()
                    }
                }
            } message: {
                Text("确定要删除 \(token.symbol) 吗？删除后可重新添加。")
            }
        }
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }

    private func deleteToken() async {
        do {
            try await TokenManager.shared.deleteToken(token)
            dismiss()
        } catch {
            Logger.shared.error("删除代币失败: \(error)")
        }
    }
}

/// 余额卡片
struct BalanceCard: View {
    let token: Token
    let balance: String
    let balanceUSD: String?

    var body: some View {
        VStack(spacing: 16) {
            TokenIcon(token: token)
                .scaleEffect(1.5)

            VStack(spacing: 4) {
                Text(balance)
                    .font(.system(size: 36, weight: .bold))

                Text(token.symbol)
                    .font(.title3)
                    .foregroundColor(.secondary)

                if let usd = balanceUSD {
                    Text(usd)
                        .font(.title3)
                        .foregroundColor(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .background(Color.blue.opacity(0.1))
        .cornerRadius(12)
        .padding()
    }
}

/// 发送代币视图
struct SendTokenView: View {
    let wallet: Wallet
    let token: Token
    let currentBalance: String

    @Environment(\.dismiss) var dismiss
    @StateObject private var tokenManager = TokenManager.shared
    @StateObject private var gasManager = GasManager.shared
    @StateObject private var walletManager = WalletManager.shared

    @State private var toAddress = ""
    @State private var amount = ""
    @State private var selectedGasSpeed: GasSpeed = .standard
    @State private var gasPriceEstimate: GasPriceEstimate?
    @State private var gasLimitEstimate: String?

    @State private var isEstimating = false
    @State private var isSending = false
    @State private var showPasswordInput = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var showSuccess = false
    @State private var txHash: String?

    var isValidAddress: Bool {
        toAddress.starts(with: "0x") && toAddress.count == 42
    }

    var isValidAmount: Bool {
        guard let amountDecimal = Decimal(string: amount) else { return false }
        guard let balanceDec = Decimal(string: currentBalance) else { return false }
        return amountDecimal > 0 && amountDecimal <= balanceDec
    }

    var canProceed: Bool {
        isValidAddress && isValidAmount && gasPriceEstimate != nil
    }

    var chain: SupportedChain {
        wallet.chain ?? .ethereumMainnet
    }

    var body: some View {
        NavigationView {
            Form {
                // 当前余额
                Section(header: Text("可用余额")) {
                    HStack {
                        Text("\(currentBalance) \(token.symbol)")
                            .font(.title3)
                            .fontWeight(.medium)

                        Spacer()

                        Button("全部") {
                            amount = currentBalance
                        }
                        .font(.caption)
                    }
                }

                // 接收地址
                Section(header: Text("接收方")) {
                    TextField("0x...", text: $toAddress)
                        .textContentType(.none)
                        .autocapitalization(.none)
                        .font(.system(.body, design: .monospaced))

                    if !toAddress.isEmpty && !isValidAddress {
                        Label("请输入有效的地址", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // 转账数量
                Section(header: Text("数量")) {
                    HStack {
                        TextField("0.0", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(.title2)
                            .fontWeight(.medium)

                        Text(token.symbol)
                            .font(.title3)
                            .foregroundColor(.secondary)
                    }

                    if !amount.isEmpty && !isValidAmount {
                        Label("金额无效或超出余额", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // Gas设置（复用SendTransactionView的逻辑）
                if let gasEstimate = gasPriceEstimate {
                    Section(header: Text("Gas费用")) {
                        GasSpeedSelector(
                            selectedSpeed: $selectedGasSpeed,
                            gasPriceEstimate: gasEstimate,
                            onChange: {}
                        )
                    }
                }

                // 发送按钮
                Section {
                    Button(action: {
                        showPasswordInput = true
                    }) {
                        HStack {
                            Spacer()

                            if isSending {
                                ProgressView()
                                Text("发送中...")
                            } else {
                                Text("确认发送")
                                    .fontWeight(.semibold)
                            }

                            Spacer()
                        }
                    }
                    .disabled(!canProceed || isSending)
                }
            }
            .navigationTitle("发送 \(token.symbol)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isSending)
                }
            }
            .onAppear {
                Task {
                    await estimateGasPrice()
                }
            }
            .sheet(isPresented: $showPasswordInput) {
                PasswordInputSheet(wallet: wallet) { password in
                    await sendToken(password: password)
                }
            }
            .alert("发送成功", isPresented: $showSuccess) {
                Button("完成", role: .cancel) {
                    dismiss()
                }
            } message: {
                if let hash = txHash {
                    Text("交易已提交\n\(hash)")
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

    private func estimateGasPrice() async {
        do {
            gasPriceEstimate = try await gasManager.getGasPriceEstimate(chain: chain)
        } catch {
            Logger.shared.error("Gas估算失败: \(error)")
        }
    }

    private func sendToken(password: String) async {
        isSending = true
        defer { isSending = false }

        do {
            // 解锁钱包
            _ = try await walletManager.unlockWallet(walletId: wallet.id, password: password)

            // 发送代币
            let record = try await tokenManager.transferToken(
                wallet: wallet,
                token: token,
                to: toAddress,
                amount: amount,
                gasLimit: gasLimitEstimate,
                gasPrice: gasPriceEstimate?.toWei(speed: selectedGasSpeed)
            )

            txHash = record.hash
            showSuccess = true

            Logger.shared.info("代币转账已发送: \(record.hash ?? "unknown")")
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

// MARK: - 预览

#if DEBUG
struct TokenDetailView_Previews: PreviewProvider {
    static var previews: some View {
        TokenDetailView(wallet: .preview, tokenWithBalance: .preview)

        SendTokenView(wallet: .preview, token: .preview, currentBalance: "1000.00")
            .previewDisplayName("发送代币")
    }
}
#endif
