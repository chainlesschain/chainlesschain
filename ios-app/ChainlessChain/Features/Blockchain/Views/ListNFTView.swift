import SwiftUI

/// ListNFTView - Create NFT listing for marketplace
/// Phase 1.6: Marketplace UI
struct ListNFTView: View {
    let wallet: Wallet

    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @StateObject private var nftManager = NFTManager.shared
    @StateObject private var tokenManager = TokenManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var myNFTs: [NFT] = []
    @State private var tokens: [Token] = []
    @State private var selectedNFT: NFT?
    @State private var priceText = ""
    @State private var selectedPaymentType: PaymentType = .native
    @State private var selectedToken: Token?
    @State private var password = ""
    @State private var showingNFTPicker = false
    @State private var showingTokenPicker = false
    @State private var isLoading = false
    @State private var isEstimatingGas = false
    @State private var gasEstimate: GasEstimate?
    @State private var errorMessage: String?
    @State private var successMessage: String?

    enum PaymentType {
        case native
        case erc20
    }

    private var isFormValid: Bool {
        selectedNFT != nil &&
        !priceText.isEmpty &&
        Double(priceText) != nil &&
        Double(priceText)! > 0 &&
        (selectedPaymentType == .native || selectedToken != nil) &&
        !password.isEmpty
    }

    private var totalCost: String {
        guard let estimate = gasEstimate else { return "计算中..." }
        let gasCostWei = BigInt(estimate.gasLimit) * BigInt(estimate.gasPrice)
        let gasCostEther = WeiConverter.weiToEther(gasCostWei.description)
        return String(format: "%.6f ETH", gasCostEther)
    }

    var body: some View {
        NavigationView {
            Form {
                // NFT Selection
                nftSelectionSection

                // Price Input
                priceSection

                // Payment Type
                paymentTypeSection

                // Gas Settings
                if let estimate = gasEstimate {
                    gasSection(estimate: estimate)
                }

                // Preview
                if selectedNFT != nil && !priceText.isEmpty {
                    listingPreviewSection
                }

                // Password
                passwordSection

                // Submit Button
                submitSection
            }
            .navigationTitle("上架 NFT")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
            .alert("错误", isPresented: .constant(errorMessage != nil)) {
                Button("确定") { errorMessage = nil }
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
            .alert("成功", isPresented: .constant(successMessage != nil)) {
                Button("确定") {
                    successMessage = nil
                    dismiss()
                }
            } message: {
                if let success = successMessage {
                    Text(success)
                }
            }
            .sheet(isPresented: $showingNFTPicker) {
                NFTPickerView(nfts: myNFTs, selectedNFT: $selectedNFT)
            }
            .sheet(isPresented: $showingTokenPicker) {
                TokenPickerView(tokens: tokens, selectedToken: $selectedToken)
            }
            .task {
                await loadData()
            }
            .onChange(of: priceText) { _ in
                Task {
                    await estimateGas()
                }
            }
            .onChange(of: selectedPaymentType) { _ in
                Task {
                    await estimateGas()
                }
            }
        }
    }

    private var nftSelectionSection: some View {
        Section("选择 NFT") {
            if let nft = selectedNFT {
                HStack(spacing: 12) {
                    // NFT Image
                    if let imageUrl = nft.imageUrl, let url = URL(string: imageUrl) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: 60, height: 60)
                                    .cornerRadius(8)
                            default:
                                Image(systemName: "photo")
                                    .frame(width: 60, height: 60)
                            }
                        }
                    } else {
                        Image(systemName: "photo")
                            .frame(width: 60, height: 60)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(nft.name ?? "Unknown")
                            .font(.headline)

                        Text("Token ID: \(nft.tokenId)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text(nft.standard.rawValue.uppercased())
                            .font(.caption2)
                            .foregroundColor(.blue)
                    }

                    Spacer()

                    Button("更换") {
                        showingNFTPicker = true
                    }
                    .font(.caption)
                }
            } else {
                Button(action: { showingNFTPicker = true }) {
                    Label("选择 NFT", systemImage: "photo.on.rectangle.angled")
                        .frame(maxWidth: .infinity)
                }
            }

            if myNFTs.isEmpty {
                Text("您还没有 NFT")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var priceSection: some View {
        Section("设置价格") {
            HStack {
                TextField("0.0", text: $priceText)
                    .keyboardType(.decimalPad)
                    .font(.title3)

                Text(selectedPaymentType == .native ? "ETH" : (selectedToken?.symbol ?? "Token"))
                    .foregroundColor(.secondary)
            }

            if let price = Double(priceText), price > 0 {
                HStack {
                    Text("约")
                    Spacer()
                    Text("$XX.XX USD")
                        .foregroundColor(.secondary)
                }
                .font(.caption)
            }
        }
    }

    private var paymentTypeSection: some View {
        Section("支付方式") {
            Picker("支付方式", selection: $selectedPaymentType) {
                Text("原生代币 (ETH)").tag(PaymentType.native)
                Text("ERC-20 代币").tag(PaymentType.erc20)
            }
            .pickerStyle(.segmented)

            if selectedPaymentType == .erc20 {
                if let token = selectedToken {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(token.symbol)
                                .font(.headline)
                            Text(token.name)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Button("更换") {
                            showingTokenPicker = true
                        }
                        .font(.caption)
                    }
                } else {
                    Button(action: { showingTokenPicker = true }) {
                        Label("选择代币", systemImage: "circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private func gasSection(estimate: GasEstimate) -> some View {
        Section("Gas 设置") {
            HStack {
                Text("Gas Limit")
                Spacer()
                Text("\(estimate.gasLimit)")
                    .foregroundColor(.secondary)
            }

            HStack {
                Text("Gas Price")
                Spacer()
                Text("\(WeiConverter.weiToGwei(estimate.gasPrice)) Gwei")
                    .foregroundColor(.secondary)
            }

            HStack {
                Text("预估费用")
                Spacer()
                Text(totalCost)
                    .fontWeight(.semibold)
            }
        }
    }

    private var listingPreviewSection: some View {
        Section("上架预览") {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("NFT")
                    Spacer()
                    Text(selectedNFT?.name ?? "Unknown")
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("价格")
                    Spacer()
                    Text("\(priceText) \(selectedPaymentType == .native ? "ETH" : (selectedToken?.symbol ?? ""))")
                        .fontWeight(.semibold)
                        .foregroundColor(.blue)
                }

                HStack {
                    Text("支付方式")
                    Spacer()
                    Text(selectedPaymentType == .native ? "原生代币" : (selectedToken?.name ?? "ERC-20"))
                        .foregroundColor(.secondary)
                }

                if let estimate = gasEstimate {
                    HStack {
                        Text("Gas 费用")
                        Spacer()
                        Text(totalCost)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }

    private var passwordSection: some View {
        Section("确认") {
            SecureField("钱包密码", text: $password)

            Text("上架 NFT 需要两次交易:\n1. 授权 NFT 给市场合约\n2. 创建上架记录")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    private var submitSection: some View {
        Section {
            Button(action: { Task { await listNFT() } }) {
                if isLoading {
                    HStack {
                        ProgressView()
                        Text("处理中...")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("确认上架")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(!isFormValid || isLoading)
            .foregroundColor(.white)
            .listRowBackground(isFormValid && !isLoading ? Color.blue : Color.gray)
        }
    }

    // MARK: - Actions

    @MainActor
    private func loadData() async {
        do {
            myNFTs = try await nftManager.getNFTsByOwner(
                ownerAddress: wallet.address,
                chain: wallet.chain
            )

            tokens = try await tokenManager.getTokens(chain: wallet.chain)
        } catch {
            errorMessage = "加载失败: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func estimateGas() async {
        guard selectedNFT != nil,
              let price = Double(priceText),
              price > 0 else {
            gasEstimate = nil
            return
        }

        isEstimatingGas = true
        defer { isEstimatingGas = false }

        do {
            // Estimate gas for listNFT transaction
            let gasLimit = "200000" // Typical marketplace listing gas
            let gasPrice = try await GasManager.shared.getCurrentGasPrice(chain: wallet.chain, speed: .standard)
            gasEstimate = GasEstimate(gasLimit: gasLimit, gasPrice: gasPrice)
        } catch {
            print("Gas estimation failed: \(error)")
        }
    }

    @MainActor
    private func listNFT() async {
        guard let nft = selectedNFT,
              let price = Double(priceText),
              price > 0 else {
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            // Convert price to Wei
            let priceWei = WeiConverter.etherToWei(priceText)

            // Determine payment token
            let paymentToken: String? = selectedPaymentType == .native ? nil : selectedToken?.address

            // Create listing
            let listing = try await marketplaceManager.listNFT(
                wallet: wallet,
                nft: nft,
                price: priceWei,
                paymentToken: paymentToken
            )

            successMessage = "NFT 上架成功!\n上架 ID: \(listing.listingId)"
        } catch {
            errorMessage = "上架失败: \(error.localizedDescription)"
        }

        isLoading = false
    }
}

// MARK: - Supporting Views

struct NFTPickerView: View {
    let nfts: [NFT]
    @Binding var selectedNFT: NFT?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List(nfts) { nft in
                Button(action: {
                    selectedNFT = nft
                    dismiss()
                }) {
                    HStack(spacing: 12) {
                        if let imageUrl = nft.imageUrl, let url = URL(string: imageUrl) {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                        .frame(width: 50, height: 50)
                                        .cornerRadius(8)
                                default:
                                    Image(systemName: "photo")
                                        .frame(width: 50, height: 50)
                                }
                            }
                        } else {
                            Image(systemName: "photo")
                                .frame(width: 50, height: 50)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text(nft.name ?? "Unknown NFT")
                                .font(.headline)

                            Text("Token ID: \(nft.tokenId)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        if selectedNFT?.id == nft.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.blue)
                        }
                    }
                }
            }
            .navigationTitle("选择 NFT")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }
}

struct TokenPickerView: View {
    let tokens: [Token]
    @Binding var selectedToken: Token?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List(tokens) { token in
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
            .navigationTitle("选择代币")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }
}

struct GasEstimate {
    let gasLimit: String
    let gasPrice: String
}

struct ListNFTView_Previews: PreviewProvider {
    static var previews: some View {
        let wallet = Wallet(
            id: "1",
            address: "0x123",
            name: "Test",
            chainId: 1,
            encryptedPrivateKey: Data(),
            createdAt: Date()
        )
        ListNFTView(wallet: wallet)
    }
}
