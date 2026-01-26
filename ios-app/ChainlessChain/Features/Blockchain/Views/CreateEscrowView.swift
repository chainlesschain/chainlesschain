//
//  CreateEscrowView.swift
//  ChainlessChain
//
//  创建托管视图
//  支持创建原生代币和ERC-20代币托管
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 创建托管视图
struct CreateEscrowView: View {
    let wallet: Wallet
    let onEscrowCreated: () -> Void

    @Environment(\.dismiss) var dismiss
    @StateObject private var escrowManager = EscrowManager.shared
    @StateObject private var tokenManager = TokenManager.shared
    @StateObject private var gasManager = GasManager.shared

    @State private var paymentType: PaymentType = .native
    @State private var selectedToken: Token?

    @State private var sellerAddress = ""
    @State private var arbitratorAddress = ""
    @State private var amount = ""
    @State private var title = ""
    @State private var description = ""

    @State private var selectedGasSpeed: GasSpeed = .standard
    @State private var gasPriceEstimate: GasPriceEstimate?

    @State private var isCreating = false
    @State private var showPasswordInput = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var showSuccess = false
    @State private var showTokenPicker = false

    var isValidSellerAddress: Bool {
        sellerAddress.starts(with: "0x") && sellerAddress.count == 42
    }

    var isValidArbitratorAddress: Bool {
        arbitratorAddress.starts(with: "0x") && arbitratorAddress.count == 42
    }

    var isValidAmount: Bool {
        guard let amountDecimal = Decimal(string: amount) else { return false }
        return amountDecimal > 0
    }

    var canCreate: Bool {
        isValidSellerAddress &&
        isValidArbitratorAddress &&
        isValidAmount &&
        !title.isEmpty &&
        gasPriceEstimate != nil &&
        (paymentType == .native || selectedToken != nil)
    }

    var chain: SupportedChain {
        wallet.chain ?? .ethereumMainnet
    }

    var availableTokens: [Token] {
        tokenManager.getTokens(for: chain)
    }

    var body: some View {
        NavigationView {
            Form {
                // 支付类型选择
                Section(header: Text("支付类型")) {
                    Picker("支付方式", selection: $paymentType) {
                        Text(PaymentType.native.displayName).tag(PaymentType.native)
                        Text(PaymentType.erc20.displayName).tag(PaymentType.erc20)
                    }
                    .pickerStyle(.segmented)

                    if paymentType == .erc20 {
                        Button(action: {
                            showTokenPicker = true
                        }) {
                            HStack {
                                Text("选择代币")
                                    .foregroundColor(.secondary)

                                Spacer()

                                if let token = selectedToken {
                                    Text("\(token.symbol)")
                                        .foregroundColor(.primary)
                                } else {
                                    Text("未选择")
                                        .foregroundColor(.secondary)
                                }

                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        if selectedToken == nil {
                            Label("请选择要使用的代币", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }
                    }
                }

                // 基本信息
                Section(header: Text("交易信息")) {
                    TextField("交易标题", text: $title)

                    TextField("交易描述（可选）", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                // 参与方
                Section(header: Text("参与方")) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("卖家地址")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("0x...", text: $sellerAddress)
                            .textContentType(.none)
                            .autocapitalization(.none)
                            .font(.system(.body, design: .monospaced))

                        if !sellerAddress.isEmpty && !isValidSellerAddress {
                            Label("请输入有效的地址", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("仲裁者地址")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("0x...", text: $arbitratorAddress)
                            .textContentType(.none)
                            .autocapitalization(.none)
                            .font(.system(.body, design: .monospaced))

                        if !arbitratorAddress.isEmpty && !isValidArbitratorAddress {
                            Label("请输入有效的地址", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }

                    Text("仲裁者是中立的第三方，用于解决交易争议")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // 金额
                Section(header: Text("托管金额")) {
                    HStack {
                        TextField("0.0", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(.title2)
                            .fontWeight(.medium)

                        if paymentType == .native {
                            Text(chain.symbol)
                                .font(.title3)
                                .foregroundColor(.secondary)
                        } else if let token = selectedToken {
                            Text(token.symbol)
                                .font(.title3)
                                .foregroundColor(.secondary)
                        }
                    }

                    if !amount.isEmpty && !isValidAmount {
                        Label("请输入有效的金额", systemImage: "exclamationmark.triangle.fill")
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
                            onChange: {}
                        )
                    }
                }

                // 说明
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "info.circle")
                                .foregroundColor(.blue)
                            Text("托管交易流程")
                                .font(.headline)
                        }

                        Text("1. 买家创建托管并存入资金")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("2. 卖家交付商品/服务后标记为已交付")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("3. 买家确认收货，资金释放给卖家")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("4. 如有争议，仲裁者介入处理")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                // 创建按钮
                Section {
                    Button(action: {
                        showPasswordInput = true
                    }) {
                        HStack {
                            Spacer()

                            if isCreating {
                                ProgressView()
                                Text("创建中...")
                            } else {
                                Text("创建托管")
                                    .fontWeight(.semibold)
                            }

                            Spacer()
                        }
                    }
                    .disabled(!canCreate || isCreating)
                }
            }
            .navigationTitle("创建托管")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isCreating)
                }
            }
            .onAppear {
                Task {
                    await estimateGasPrice()
                }
            }
            .sheet(isPresented: $showTokenPicker) {
                TokenPickerView(tokens: availableTokens, selectedToken: $selectedToken)
            }
            .sheet(isPresented: $showPasswordInput) {
                PasswordInputSheet(wallet: wallet) { password in
                    await createEscrow(password: password)
                }
            }
            .alert("创建成功", isPresented: $showSuccess) {
                Button("完成", role: .cancel) {
                    onEscrowCreated()
                    dismiss()
                }
            } message: {
                Text("托管交易已创建，资金已锁定")
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

    private func createEscrow(password: String) async {
        isCreating = true
        defer { isCreating = false }

        do {
            _ = try await WalletManager.shared.unlockWallet(walletId: wallet.id, password: password)

            let gasPrice = gasPriceEstimate?.toWei(speed: selectedGasSpeed)

            if paymentType == .native {
                // 创建原生代币托管
                let amountInWei = WeiConverter.etherToWei(amount)

                _ = try await escrowManager.createNativeEscrow(
                    wallet: wallet,
                    seller: sellerAddress,
                    arbitrator: arbitratorAddress,
                    amount: amountInWei,
                    title: title,
                    description: description.isEmpty ? nil : description,
                    gasPrice: gasPrice
                )
            } else {
                // 创建ERC-20代币托管
                guard let token = selectedToken else {
                    throw EscrowError.invalidOperation
                }

                let amountInWei = convertToTokenWei(amount, decimals: token.decimals)

                _ = try await escrowManager.createERC20Escrow(
                    wallet: wallet,
                    seller: sellerAddress,
                    arbitrator: arbitratorAddress,
                    tokenAddress: token.address,
                    amount: amountInWei,
                    title: title,
                    description: description.isEmpty ? nil : description,
                    gasPrice: gasPrice
                )
            }

            showSuccess = true
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    private func convertToTokenWei(_ amount: String, decimals: Int) -> String {
        guard let amountDecimal = Decimal(string: amount) else {
            return "0"
        }

        let multiplier = Decimal(sign: .plus, exponent: decimals, significand: 1)
        let result = amountDecimal * multiplier

        return "\(result)"
    }
}

/// 代币选择器视图
struct TokenPickerView: View {
    let tokens: [Token]
    @Binding var selectedToken: Token?

    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            List {
                ForEach(tokens) { token in
                    Button(action: {
                        selectedToken = token
                        dismiss()
                    }) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(token.symbol)
                                    .font(.headline)

                                Text(token.name)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            if selectedToken?.id == token.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                    }
                }
            }
            .navigationTitle("选择代币")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("取消") {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - 预览

#if DEBUG
struct CreateEscrowView_Previews: PreviewProvider {
    static var previews: some View {
        CreateEscrowView(wallet: .preview) {}
    }
}
#endif
