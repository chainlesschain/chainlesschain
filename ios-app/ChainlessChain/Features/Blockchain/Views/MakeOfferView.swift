import SwiftUI

/// MakeOfferView - Make offer on NFT listing
/// Phase 1.6: Marketplace UI
struct MakeOfferView: View {
    let wallet: Wallet
    let listing: NFTListing

    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @StateObject private var tokenManager = TokenManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var tokens: [Token] = []
    @State private var priceText = ""
    @State private var selectedPaymentType: PaymentType = .native
    @State private var selectedToken: Token?
    @State private var selectedExpiration: ExpirationOption = .oneDay
    @State private var password = ""
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

    enum ExpirationOption: Int, CaseIterable {
        case oneHour = 3600
        case sixHours = 21600
        case oneDay = 86400
        case threeDays = 259200
        case sevenDays = 604800
        case thirtyDays = 2592000

        var title: String {
            switch self {
            case .oneHour: return "1 小时"
            case .sixHours: return "6 小时"
            case .oneDay: return "1 天"
            case .threeDays: return "3 天"
            case .sevenDays: return "7 天"
            case .thirtyDays: return "30 天"
            }
        }
    }

    private var isFormValid: Bool {
        !priceText.isEmpty &&
        Double(priceText) != nil &&
        Double(priceText)! > 0 &&
        (selectedPaymentType == .native || selectedToken != nil) &&
        !password.isEmpty
    }

    private var listingPrice: Double? {
        guard let weiString = listing.price as String?,
              let wei = Decimal(string: weiString) else {
            return nil
        }
        let ether = wei / Decimal(string: "1000000000000000000")!
        return NSDecimalNumber(decimal: ether).doubleValue
    }

    private var offerPrice: Double? {
        Double(priceText)
    }

    private var isPriceBelowListing: Bool {
        guard let listing = listingPrice,
              let offer = offerPrice else {
            return false
        }
        return offer < listing
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
                // NFT Info
                nftInfoSection

                // Price Input
                priceSection

                // Payment Type
                paymentTypeSection

                // Expiration
                expirationSection

                // Gas Settings
                if let estimate = gasEstimate {
                    gasSection(estimate: estimate)
                }

                // Offer Preview
                if !priceText.isEmpty {
                    offerPreviewSection
                }

                // Password
                passwordSection

                // Submit Button
                submitSection
            }
            .navigationTitle("出价")
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
            .sheet(isPresented: $showingTokenPicker) {
                TokenPickerView(tokens: tokens, selectedToken: $selectedToken)
            }
            .task {
                await loadTokens()
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

    private var nftInfoSection: some View {
        Section("NFT 信息") {
            HStack(spacing: 12) {
                // NFT Image
                if let imageUrl = listing.nft.imageUrl, let url = URL(string: imageUrl) {
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
                    Text(listing.nft.name ?? "Unknown NFT")
                        .font(.headline)

                    if let collection = listing.nft.collection {
                        Text(collection.name)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Text("Token ID: \(listing.tokenId)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            HStack {
                Text("上架价格")
                Spacer()
                Text(formatPrice(listing.price))
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)
            }
        }
    }

    private var priceSection: some View {
        Section("出价金额") {
            HStack {
                TextField("0.0", text: $priceText)
                    .keyboardType(.decimalPad)
                    .font(.title3)

                Text(selectedPaymentType == .native ? "ETH" : (selectedToken?.symbol ?? "Token"))
                    .foregroundColor(.secondary)
            }

            if let listing = listingPrice, let offer = offerPrice {
                HStack {
                    Text("上架价格")
                    Spacer()
                    Text(String(format: "%.4f", listing))
                        .foregroundColor(.secondary)
                }
                .font(.caption)

                if isPriceBelowListing {
                    HStack {
                        Image(systemName: "info.circle.fill")
                            .foregroundColor(.orange)
                        Text("您的出价低于上架价格")
                            .foregroundColor(.orange)
                    }
                    .font(.caption)
                } else {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.red)
                        Text("建议直接购买而非出价")
                            .foregroundColor(.red)
                    }
                    .font(.caption)
                }
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

    private var expirationSection: some View {
        Section("过期时间") {
            Picker("有效期", selection: $selectedExpiration) {
                ForEach(ExpirationOption.allCases, id: \.self) { option in
                    Text(option.title).tag(option)
                }
            }

            HStack {
                Text("过期时间")
                Spacer()
                Text(expirationDate, style: .date)
                    .foregroundColor(.secondary)
                Text(expirationDate, style: .time)
                    .foregroundColor(.secondary)
            }
            .font(.caption)
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

    private var offerPreviewSection: some View {
        Section("出价预览") {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("NFT")
                    Spacer()
                    Text(listing.nft.name ?? "Unknown")
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("出价金额")
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

                HStack {
                    Text("有效期")
                    Spacer()
                    Text(selectedExpiration.title)
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

            if selectedPaymentType == .erc20 {
                Text("出价需要两次交易:\n1. 授权 ERC-20 代币\n2. 提交出价")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                Text("提交出价不会立即扣款，仅在卖家接受时才会转账")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var submitSection: some View {
        Section {
            Button(action: { Task { await makeOffer() } }) {
                if isLoading {
                    HStack {
                        ProgressView()
                        Text("处理中...")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("提交出价")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(!isFormValid || isLoading)
            .foregroundColor(.white)
            .listRowBackground(isFormValid && !isLoading ? Color.blue : Color.gray)
        }
    }

    // MARK: - Computed Properties

    private var expirationDate: Date {
        Date().addingTimeInterval(TimeInterval(selectedExpiration.rawValue))
    }

    // MARK: - Actions

    @MainActor
    private func loadTokens() async {
        do {
            tokens = try await tokenManager.getTokens(chain: wallet.chain)
        } catch {
            errorMessage = "加载代币失败: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func estimateGas() async {
        guard let price = Double(priceText), price > 0 else {
            gasEstimate = nil
            return
        }

        isEstimatingGas = true
        defer { isEstimatingGas = false }

        do {
            // Estimate gas for makeOffer transaction
            let gasLimit = "150000" // Typical offer gas
            let gasPrice = try await GasManager.shared.getCurrentGasPrice(chain: wallet.chain, speed: .standard)
            gasEstimate = GasEstimate(gasLimit: gasLimit, gasPrice: gasPrice)
        } catch {
            print("Gas estimation failed: \(error)")
        }
    }

    @MainActor
    private func makeOffer() async {
        guard let price = Double(priceText), price > 0 else {
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            // Convert price to Wei
            let priceWei = WeiConverter.etherToWei(priceText)

            // Determine payment token
            let paymentToken: String? = selectedPaymentType == .native ? nil : selectedToken?.address

            // Create offer
            let offer = try await marketplaceManager.makeOffer(
                wallet: wallet,
                nftContract: listing.nftContract,
                tokenId: listing.tokenId,
                price: priceWei,
                paymentToken: paymentToken,
                expiresIn: selectedExpiration.rawValue
            )

            successMessage = "出价成功!\n出价 ID: \(offer.offerId)\n有效期至: \(offer.expiresAt.formatted())"
        } catch {
            errorMessage = "出价失败: \(error.localizedDescription)"
        }

        isLoading = false
    }

    // MARK: - Helpers

    private func formatPrice(_ weiString: String) -> String {
        guard let wei = Decimal(string: weiString) else { return "0" }
        let ether = wei / Decimal(string: "1000000000000000000")!
        return String(format: "%.4f ETH", NSDecimalNumber(decimal: ether).doubleValue)
    }
}

struct MakeOfferView_Previews: PreviewProvider {
    static var previews: some View {
        let wallet = Wallet(
            id: "1",
            address: "0x123",
            name: "Test",
            chainId: 1,
            encryptedPrivateKey: Data(),
            createdAt: Date()
        )
        let nft = NFT(
            id: "1",
            contractAddress: "0x1234",
            tokenId: "1",
            chainId: 1,
            standard: .erc721,
            name: "Test NFT",
            imageUrl: nil,
            imageData: nil,
            balance: "1",
            attributes: []
        )
        let listing = NFTListing(
            id: "1",
            listingId: "1",
            contractAddress: "0xMarket",
            chainId: 1,
            nftContract: "0x1234",
            tokenId: "1",
            seller: "0xSeller",
            price: "1000000000000000000",
            paymentToken: nil,
            status: .active,
            buyer: nil,
            nft: nft
        )
        MakeOfferView(wallet: wallet, listing: listing)
    }
}
