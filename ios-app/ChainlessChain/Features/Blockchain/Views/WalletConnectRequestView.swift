import SwiftUI

/// WalletConnectRequestView - Handle WalletConnect requests
/// Phase 2.0: DApp Browser
struct WalletConnectRequestView: View {
    let request: WalletConnectRequest

    @StateObject private var wcManager = WalletConnectManager.shared
    @StateObject private var walletManager = WalletManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var password = ""
    @State private var isProcessing = false
    @State private var errorMessage: String?
    @State private var showingDetails = false

    private var currentWallet: Wallet? {
        walletManager.selectedWallet
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // DApp Info
                    dappInfoSection

                    // Request Type
                    requestTypeSection

                    // Request Details
                    requestDetailsSection

                    // Gas Info (if transaction)
                    if isTransactionRequest {
                        gasInfoSection
                    }

                    // Password Input (if required)
                    if request.method.requiresPassword {
                        passwordSection
                    }

                    // Action Buttons
                    actionButtonsSection
                }
                .padding()
            }
            .navigationTitle("请求确认")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("取消") {
                        Task { await rejectRequest() }
                    }
                }
            }
            .alert("错误", isPresented: .constant(errorMessage != nil)) {
                Button("确定") { errorMessage = nil }
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
        }
    }

    // MARK: - DApp Info Section

    private var dappInfoSection: some View {
        VStack(spacing: 12) {
            // DApp Icon
            if let iconUrl = request.dappIconUrl, let url = URL(string: iconUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 80, height: 80)
                            .cornerRadius(16)
                    default:
                        placeholderIcon
                    }
                }
            } else {
                placeholderIcon
            }

            // DApp Name
            Text(request.dappName)
                .font(.title2)
                .fontWeight(.bold)

            // Request Time
            Text(request.timestamp, style: .relative)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(16)
    }

    private var placeholderIcon: some View {
        Image(systemName: "link.circle.fill")
            .font(.system(size: 60))
            .foregroundColor(.blue)
            .frame(width: 80, height: 80)
    }

    // MARK: - Request Type Section

    private var requestTypeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: request.method.icon)
                    .foregroundColor(.blue)
                    .font(.title3)

                Text(request.method.displayName)
                    .font(.headline)
            }

            Text(requestDescription)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - Request Details Section

    private var requestDetailsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("请求详情")
                    .font(.headline)

                Spacer()

                Button(action: { showingDetails.toggle() }) {
                    Image(systemName: showingDetails ? "chevron.up" : "chevron.down")
                        .foregroundColor(.blue)
                }
            }

            if showingDetails {
                requestDetailsContent
            }
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    @ViewBuilder
    private var requestDetailsContent: some View {
        switch request.params {
        case .signMessage(let message, let address):
            VStack(alignment: .leading, spacing: 8) {
                InfoRow(label: "地址", value: shortAddress(address))
                InfoRow(label: "消息", value: message)
            }

        case .signTypedData(let typedData, let address):
            VStack(alignment: .leading, spacing: 8) {
                InfoRow(label: "地址", value: shortAddress(address))
                Text("类型化数据")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(typedData)
                    .font(.system(.caption, design: .monospaced))
                    .padding(8)
                    .background(Color(UIColor.tertiarySystemBackground))
                    .cornerRadius(8)
            }

        case .sendTransaction(let tx), .signTransaction(let tx):
            VStack(alignment: .leading, spacing: 8) {
                InfoRow(label: "发送方", value: shortAddress(tx.from))
                if let to = tx.to {
                    InfoRow(label: "接收方", value: shortAddress(to))
                }
                if let value = tx.value, value != "0" {
                    InfoRow(label: "金额", value: formatValue(value))
                }
                if let data = tx.data, !data.isEmpty {
                    InfoRow(label: "数据", value: "\(data.prefix(20))...")
                }
            }

        case .switchChain(let chainId):
            InfoRow(label: "切换到链", value: chainId)

        case .addChain(let chainData):
            VStack(alignment: .leading, spacing: 8) {
                InfoRow(label: "链名称", value: chainData.chainName)
                InfoRow(label: "Chain ID", value: chainData.chainId)
                InfoRow(label: "货币", value: chainData.nativeCurrency.symbol)
            }

        case .watchAsset(let asset):
            VStack(alignment: .leading, spacing: 8) {
                InfoRow(label: "代币符号", value: asset.symbol)
                InfoRow(label: "合约地址", value: shortAddress(asset.address))
                InfoRow(label: "精度", value: "\(asset.decimals)")
            }
        }
    }

    // MARK: - Gas Info Section

    private var gasInfoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Gas 费用")
                .font(.headline)

            if let tx = transactionParams {
                if let gas = tx.gas {
                    InfoRow(label: "Gas Limit", value: gas)
                }
                if let gasPrice = tx.gasPrice {
                    InfoRow(label: "Gas Price", value: formatGasPrice(gasPrice))
                }
            }
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - Password Section

    private var passwordSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("钱包密码")
                .font(.headline)

            SecureField("请输入密码确认", text: $password)
                .textFieldStyle(.roundedBorder)

            Text("此操作需要钱包密码验证")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - Action Buttons Section

    private var actionButtonsSection: some View {
        HStack(spacing: 12) {
            // Reject Button
            Button(action: {
                Task { await rejectRequest() }
            }) {
                Text("拒绝")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .foregroundColor(.white)
                    .background(Color.red)
                    .cornerRadius(12)
            }
            .disabled(isProcessing)

            // Approve Button
            Button(action: {
                Task { await approveRequest() }
            }) {
                if isProcessing {
                    HStack {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        Text("处理中...")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                } else {
                    Text("批准")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding()
                }
            }
            .foregroundColor(.white)
            .background(isFormValid ? Color.green : Color.gray)
            .cornerRadius(12)
            .disabled(!isFormValid || isProcessing)
        }
    }

    // MARK: - Computed Properties

    private var isFormValid: Bool {
        if request.method.requiresPassword {
            return !password.isEmpty
        }
        return true
    }

    private var isTransactionRequest: Bool {
        switch request.params {
        case .sendTransaction, .signTransaction:
            return true
        default:
            return false
        }
    }

    private var transactionParams: TransactionParams? {
        switch request.params {
        case .sendTransaction(let tx), .signTransaction(let tx):
            return tx
        default:
            return nil
        }
    }

    private var requestDescription: String {
        request.params.description
    }

    // MARK: - Actions

    @MainActor
    private func approveRequest() async {
        guard let wallet = currentWallet else {
            errorMessage = "未选择钱包"
            return
        }

        isProcessing = true
        errorMessage = nil

        do {
            switch request.params {
            case .signMessage(let message, _):
                _ = try await wcManager.approveSignMessage(
                    requestId: request.id,
                    message: message,
                    wallet: wallet,
                    password: password
                )

            case .signTypedData:
                // TODO: Implement typed data signing
                throw WalletConnectError.invalidMethod

            case .sendTransaction(let tx):
                _ = try await wcManager.approveSendTransaction(
                    requestId: request.id,
                    transaction: tx,
                    wallet: wallet,
                    password: password
                )

            case .signTransaction:
                // TODO: Implement transaction signing without sending
                throw WalletConnectError.invalidMethod

            case .switchChain, .addChain, .watchAsset:
                // These don't require password
                // TODO: Implement chain/asset management
                break
            }

            dismiss()
        } catch {
            errorMessage = "操作失败: \(error.localizedDescription)"
        }

        isProcessing = false
    }

    @MainActor
    private func rejectRequest() async {
        do {
            try await wcManager.rejectRequest(requestId: request.id, reason: "User rejected")
            dismiss()
        } catch {
            errorMessage = "拒绝失败: \(error.localizedDescription)"
        }
    }

    // MARK: - Helper Methods

    private func shortAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }

    private func formatValue(_ weiString: String) -> String {
        guard let wei = Decimal(string: weiString) else { return "0" }
        let ether = wei / Decimal(string: "1000000000000000000")!
        return String(format: "%.6f ETH", NSDecimalNumber(decimal: ether).doubleValue)
    }

    private func formatGasPrice(_ weiString: String) -> String {
        guard let wei = Decimal(string: weiString) else { return "0" }
        let gwei = wei / Decimal(string: "1000000000")!
        return String(format: "%.2f Gwei", NSDecimalNumber(decimal: gwei).doubleValue)
    }
}

// MARK: - Info Row

private struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(1)
        }
    }
}

struct WalletConnectRequestView_Previews: PreviewProvider {
    static var previews: some View {
        let request = WalletConnectRequest(
            id: "1",
            sessionTopic: "topic",
            dappName: "Uniswap",
            dappIconUrl: nil,
            method: .personalSign,
            params: .signMessage(message: "Hello World", address: "0x1234567890123456789012345678901234567890"),
            chainId: 1
        )
        WalletConnectRequestView(request: request)
    }
}
