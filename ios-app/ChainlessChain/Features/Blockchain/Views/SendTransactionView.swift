//
//  SendTransactionView.swift
//  ChainlessChain
//
//  发送交易视图
//  支持发送原生代币，Gas估算和三档Gas价格
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 发送交易视图
struct SendTransactionView: View {
    let wallet: Wallet

    @Environment(\.dismiss) var dismiss
    @StateObject private var transactionManager = TransactionManager.shared
    @StateObject private var gasManager = GasManager.shared
    @StateObject private var walletManager = WalletManager.shared
    @StateObject private var walletViewModel = WalletViewModel()

    @State private var toAddress = ""
    @State private var amount = ""
    @State private var selectedGasSpeed: GasSpeed = .standard
    @State private var gasPriceEstimate: GasPriceEstimate?
    @State private var gasLimitEstimate: String?
    @State private var totalCost: String?

    @State private var isEstimating = false
    @State private var isSending = false
    @State private var showPasswordInput = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var showSuccess = false
    @State private var txHash: String?

    var balance: String {
        walletViewModel.getBalance(for: wallet.id)?.formattedValue ?? "0"
    }

    var isValidAddress: Bool {
        toAddress.starts(with: "0x") && toAddress.count == 42
    }

    var isValidAmount: Bool {
        guard let amountDecimal = Decimal(string: amount) else { return false }
        return amountDecimal > 0
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
                // 钱包信息
                Section(header: Text("发送方")) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("当前钱包")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text(wallet.displayName)
                                .font(.body)
                                .fontWeight(.medium)
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 4) {
                            Text("余额")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text("\(balance) \(chain.symbol)")
                                .font(.body)
                                .fontWeight(.medium)
                        }
                    }
                }

                // 接收地址
                Section(header: Text("接收方")) {
                    TextField("0x...", text: $toAddress)
                        .textContentType(.none)
                        .autocapitalization(.none)
                        .font(.system(.body, design: .monospaced))
                        .onChange(of: toAddress) { _ in
                            estimateGas()
                        }

                    if !toAddress.isEmpty && !isValidAddress {
                        Label("请输入有效的以太坊地址", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // 转账金额
                Section(header: Text("金额")) {
                    HStack {
                        TextField("0.0", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(.title2)
                            .fontWeight(.medium)
                            .onChange(of: amount) { _ in
                                estimateGas()
                            }

                        Text(chain.symbol)
                            .font(.title3)
                            .foregroundColor(.secondary)
                    }

                    Button(action: {
                        useMaxAmount()
                    }) {
                        Text("使用全部余额")
                            .font(.caption)
                    }

                    if !amount.isEmpty && !isValidAmount {
                        Label("请输入有效金额", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // Gas设置
                if let gasEstimate = gasPriceEstimate {
                    Section(header: Text("Gas费用")) {
                        GasSpeedSelector(
                            selectedSpeed: $selectedGasSpeed,
                            gasPriceEstimate: gasEstimate,
                            onChange: {
                                calculateTotalCost()
                            }
                        )

                        if let gasLimit = gasLimitEstimate {
                            DetailRow(label: "Gas限制", value: gasLimit)
                        }

                        if let total = totalCost {
                            DetailRow(
                                label: "预估手续费",
                                value: total + " \(chain.symbol)",
                                valueColor: .orange
                            )
                        }
                    }
                } else if isEstimating {
                    Section(header: Text("Gas费用")) {
                        HStack {
                            ProgressView()
                            Text("正在估算...")
                                .foregroundColor(.secondary)
                        }
                    }
                }

                // 总计
                if let total = totalCost, isValidAmount {
                    Section(header: Text("总计")) {
                        HStack {
                            Text("转账金额")
                            Spacer()
                            Text("\(amount) \(chain.symbol)")
                                .fontWeight(.medium)
                        }

                        HStack {
                            Text("手续费")
                            Spacer()
                            Text("\(total) \(chain.symbol)")
                                .fontWeight(.medium)
                                .foregroundColor(.orange)
                        }

                        Divider()

                        HStack {
                            Text("总支出")
                                .fontWeight(.semibold)
                            Spacer()

                            if let amountDec = Decimal(string: amount),
                               let totalDec = Decimal(string: total) {
                                let sum = amountDec + totalDec
                                Text("\(String(describing: sum)) \(chain.symbol)")
                                    .fontWeight(.semibold)
                                    .foregroundColor(.blue)
                            }
                        }
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
                                    .progressViewStyle(.circular)
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
            .navigationTitle("发送 \(chain.symbol)")
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
                    await walletViewModel.loadBalance(for: wallet)
                }
                estimateGasPrice()
            }
            .sheet(isPresented: $showPasswordInput) {
                PasswordInputSheet(wallet: wallet) { password in
                    await sendTransaction(password: password)
                }
            }
            .alert("发送成功", isPresented: $showSuccess) {
                Button("查看详情", role: .none) {
                    openTransactionInExplorer()
                }
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

    /// 估算Gas价格
    private func estimateGasPrice() {
        Task {
            do {
                gasPriceEstimate = try await gasManager.getGasPriceEstimate(chain: chain)
                estimateGas()
            } catch {
                Logger.shared.error("Gas价格估算失败: \(error)")
            }
        }
    }

    /// 估算Gas限制
    private func estimateGas() {
        guard isValidAddress && isValidAmount else {
            return
        }

        Task {
            isEstimating = true
            defer { isEstimating = false }

            do {
                let valueInWei = WeiConverter.etherToWei(amount)

                gasLimitEstimate = try await gasManager.estimateGasLimit(
                    from: wallet.address,
                    to: toAddress,
                    value: valueInWei,
                    chain: chain
                )

                calculateTotalCost()
            } catch {
                Logger.shared.error("Gas限制估算失败: \(error)")
            }
        }
    }

    /// 计算总费用
    private func calculateTotalCost() {
        guard let gasEstimate = gasPriceEstimate,
              let gasLimit = gasLimitEstimate else {
            return
        }

        let gasPriceWei = gasEstimate.toWei(speed: selectedGasSpeed)

        guard let gasLimitDec = Decimal(string: gasLimit),
              let gasPriceDec = Decimal(string: gasPriceWei) else {
            return
        }

        let costInWei = gasLimitDec * gasPriceDec
        totalCost = WeiConverter.weiToEther(String(describing: costInWei))
    }

    /// 发送交易
    private func sendTransaction(password: String) async {
        isSending = true
        defer { isSending = false }

        do {
            // 解锁钱包
            _ = try await walletManager.unlockWallet(walletId: wallet.id, password: password)

            // 准备交易参数
            let valueInWei = WeiConverter.etherToWei(amount)
            let gasPriceWei = gasPriceEstimate!.toWei(speed: selectedGasSpeed)

            // 发送交易
            let record = try await transactionManager.sendTransaction(
                wallet: wallet,
                to: toAddress,
                value: valueInWei,
                gasLimit: gasLimitEstimate,
                gasPrice: gasPriceWei,
                chain: chain
            )

            txHash = record.hash
            showSuccess = true

            Logger.shared.info("交易已发送: \(record.hash ?? "unknown")")
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    private func useMaxAmount() {
        guard let balanceDec = Decimal(string: balance) else {
            amount = "0"
            return
        }

        let feeDec = Decimal(string: totalCost ?? "0") ?? 0
        let sendable = max(0, balanceDec - feeDec)
        amount = NSDecimalNumber(decimal: sendable).stringValue
    }

    private func openTransactionInExplorer() {
        defer { dismiss() }

        guard let hash = txHash,
              let explorer = NetworkConfig.config(for: chain).explorerUrl(for: hash),
              let url = URL(string: explorer) else {
            return
        }

        UIApplication.shared.open(url)
    }

}

/// Gas速度选择器
struct GasSpeedSelector: View {
    @Binding var selectedSpeed: GasSpeed
    let gasPriceEstimate: GasPriceEstimate
    let onChange: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                GasSpeedButton(
                    title: "慢速",
                    price: gasPriceEstimate.slow,
                    speed: .slow,
                    isSelected: selectedSpeed == .slow,
                    action: {
                        selectedSpeed = .slow
                        onChange()
                    }
                )

                GasSpeedButton(
                    title: "标准",
                    price: gasPriceEstimate.standard,
                    speed: .standard,
                    isSelected: selectedSpeed == .standard,
                    action: {
                        selectedSpeed = .standard
                        onChange()
                    }
                )

                GasSpeedButton(
                    title: "快速",
                    price: gasPriceEstimate.fast,
                    speed: .fast,
                    isSelected: selectedSpeed == .fast,
                    action: {
                        selectedSpeed = .fast
                        onChange()
                    }
                )
            }
        }
    }
}

/// Gas速度按钮
struct GasSpeedButton: View {
    let title: String
    let price: String
    let speed: GasSpeed
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(title)
                    .font(.caption)
                    .fontWeight(.medium)

                Text("\(price)")
                    .font(.caption2)
                    .foregroundColor(.secondary)

                Text("Gwei")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(isSelected ? Color.blue : Color.gray.opacity(0.2))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(8)
        }
    }
}

// MARK: - 预览

#if DEBUG
struct SendTransactionView_Previews: PreviewProvider {
    static var previews: some View {
        SendTransactionView(wallet: .preview)

        GasSpeedSelector(
            selectedSpeed: .constant(.standard),
            gasPriceEstimate: GasPriceEstimate(
                slow: "10",
                standard: "20",
                fast: "30"
            ),
            onChange: {}
        )
        .previewLayout(.sizeThatFits)
        .padding()
        .previewDisplayName("Gas选择器")
    }
}
#endif
