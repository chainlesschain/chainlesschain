import SwiftUI

/// NFTListingDetailView - Detailed NFT listing view with buy/offer actions
/// Phase 1.6: Marketplace UI
struct NFTListingDetailView: View {
    let listing: NFTListing

    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @StateObject private var walletManager = WalletManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var offers: [NFTOffer] = []
    @State private var events: [MarketplaceEvent] = []
    @State private var isLoadingOffers = false
    @State private var isLoadingEvents = false
    @State private var showingBuyConfirmation = false
    @State private var showingMakeOfferView = false
    @State private var showingCancelConfirmation = false
    @State private var showingAcceptOfferSheet = false
    @State private var selectedOffer: NFTOffer?
    @State private var errorMessage: String?
    @State private var successMessage: String?

    private var currentWallet: Wallet? {
        walletManager.selectedWallet
    }

    private var isSeller: Bool {
        guard let wallet = currentWallet else { return false }
        return listing.seller.lowercased() == wallet.address.lowercased()
    }

    private var canBuy: Bool {
        guard let wallet = currentWallet else { return false }
        return listing.canBuy(walletAddress: wallet.address)
    }

    private var canCancel: Bool {
        guard let wallet = currentWallet else { return false }
        return listing.canCancel(walletAddress: wallet.address)
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // NFT Image
                    nftImageSection

                    // Listing Info Card
                    listingInfoCard

                    // Price Card
                    priceCard

                    // Seller Info
                    sellerInfoCard

                    // Action Buttons
                    actionButtonsSection

                    // Offers Section
                    if !offers.isEmpty || isSeller {
                        offersSection
                    }

                    // Event History
                    if !events.isEmpty {
                        eventHistorySection
                    }
                }
                .padding()
            }
            .navigationTitle("NFT 详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") { dismiss() }
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
            .sheet(isPresented: $showingMakeOfferView) {
                if let wallet = currentWallet {
                    MakeOfferView(
                        wallet: wallet,
                        listing: listing
                    )
                }
            }
            .sheet(isPresented: $showingAcceptOfferSheet) {
                if let offer = selectedOffer, let wallet = currentWallet {
                    AcceptOfferSheet(
                        offer: offer,
                        wallet: wallet,
                        onAccept: { password in
                            await acceptOffer(offer, password: password)
                        }
                    )
                }
            }
            .task {
                await loadData()
            }
        }
    }

    private var nftImageSection: some View {
        Group {
            if let imageUrl = listing.nft.imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .frame(height: 300)
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxHeight: 300)
                            .cornerRadius(12)
                    case .failure:
                        Image(systemName: "photo")
                            .font(.system(size: 80))
                            .foregroundColor(.gray)
                            .frame(height: 300)
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                Image(systemName: "photo")
                    .font(.system(size: 80))
                    .foregroundColor(.gray)
                    .frame(height: 300)
            }
        }
    }

    private var listingInfoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(listing.nft.name ?? "Unknown NFT")
                .font(.title2)
                .fontWeight(.bold)

            if let collection = listing.nft.collection {
                HStack {
                    Image(systemName: "square.stack.3d.up")
                        .foregroundColor(.blue)
                    Text(collection.name)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }

            if let description = listing.nft.description {
                Text(description)
                    .font(.body)
                    .foregroundColor(.secondary)
                    .lineLimit(3)
            }

            // Token ID and Contract
            VStack(alignment: .leading, spacing: 4) {
                InfoRow(label: "Token ID", value: listing.tokenId)
                InfoRow(label: "合约地址", value: shortAddress(listing.nftContract))
                InfoRow(label: "标准", value: listing.nft.standard.rawValue.uppercased())
            }
            .font(.caption)
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var priceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("价格")
                .font(.subheadline)
                .foregroundColor(.secondary)

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: listing.paymentToken == nil ? "dollarsign.circle.fill" : "circle.fill")
                    .foregroundColor(.blue)
                    .font(.title3)

                Text(formatPrice(listing.price))
                    .font(.title)
                    .fontWeight(.bold)

                Spacer()

                StatusBadge(status: listing.status)
            }

            // USD Value (if available)
            if listing.status == .active {
                Text("≈ $XX.XX USD")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(
            LinearGradient(
                gradient: Gradient(colors: [Color.blue.opacity(0.1), Color.blue.opacity(0.05)]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .cornerRadius(12)
    }

    private var sellerInfoCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(isSeller ? "您是卖家" : "卖家")
                .font(.subheadline)
                .foregroundColor(.secondary)

            HStack {
                Image(systemName: "person.circle.fill")
                    .foregroundColor(.blue)
                    .font(.title2)

                VStack(alignment: .leading, spacing: 2) {
                    Text(shortAddress(listing.seller))
                        .font(.body)
                        .fontWeight(.medium)

                    if let buyer = listing.buyer {
                        Text("买家: \(shortAddress(buyer))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                if isSeller {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundColor(.green)
                }
            }
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var actionButtonsSection: some View {
        VStack(spacing: 12) {
            if canBuy {
                Button(action: { showingBuyConfirmation = true }) {
                    Label("立即购买", systemImage: "cart.fill")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                }
                .confirmationDialog("确认购买", isPresented: $showingBuyConfirmation) {
                    Button("确认购买 \(formatPrice(listing.price))") {
                        Task { await buyNFT() }
                    }
                    Button("取消", role: .cancel) {}
                }
            }

            if listing.status == .active && !isSeller {
                Button(action: { showingMakeOfferView = true }) {
                    Label("出价", systemImage: "hand.raised.fill")
                        .font(.headline)
                        .foregroundColor(.blue)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(12)
                }
            }

            if canCancel {
                Button(action: { showingCancelConfirmation = true }) {
                    Label("取消上架", systemImage: "xmark.circle.fill")
                        .font(.headline)
                        .foregroundColor(.red)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.red.opacity(0.1))
                        .cornerRadius(12)
                }
                .confirmationDialog("确认取消", isPresented: $showingCancelConfirmation) {
                    Button("确认取消上架", role: .destructive) {
                        Task { await cancelListing() }
                    }
                    Button("取消", role: .cancel) {}
                }
            }
        }
    }

    private var offersSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("出价")
                    .font(.headline)

                Spacer()

                if isLoadingOffers {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }

            if offers.isEmpty {
                Text("暂无出价")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(UIColor.tertiarySystemBackground))
                    .cornerRadius(8)
            } else {
                ForEach(offers) { offer in
                    OfferRow(
                        offer: offer,
                        isSeller: isSeller,
                        onAccept: {
                            selectedOffer = offer
                            showingAcceptOfferSheet = true
                        },
                        onCancel: { await cancelOffer(offer) }
                    )
                }
            }
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var eventHistorySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("历史记录")
                    .font(.headline)

                Spacer()

                if isLoadingEvents {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }

            ForEach(events) { event in
                EventRow(event: event)
            }
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - Actions

    @MainActor
    private func loadData() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await loadOffers() }
            group.addTask { await loadEvents() }
        }
    }

    @MainActor
    private func loadOffers() async {
        isLoadingOffers = true
        do {
            offers = try await marketplaceManager.getOffers(
                nftContract: listing.nftContract,
                tokenId: listing.tokenId,
                chain: listing.chain
            )
        } catch {
            print("Failed to load offers: \(error)")
        }
        isLoadingOffers = false
    }

    @MainActor
    private func loadEvents() async {
        isLoadingEvents = true
        // Load events from database
        isLoadingEvents = false
    }

    @MainActor
    private func buyNFT() async {
        guard let wallet = currentWallet else { return }

        do {
            _ = try await marketplaceManager.buyNFT(listing: listing, wallet: wallet)
            successMessage = "购买成功!"
        } catch {
            errorMessage = "购买失败: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func cancelListing() async {
        guard let wallet = currentWallet else { return }

        do {
            try await marketplaceManager.cancelListing(listing: listing, wallet: wallet)
            successMessage = "取消成功!"
        } catch {
            errorMessage = "取消失败: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func acceptOffer(_ offer: NFTOffer, password: String) async {
        guard let wallet = currentWallet else { return }

        do {
            try await marketplaceManager.acceptOffer(
                offer: offer,
                wallet: wallet,
                nftOwnerAddress: listing.seller
            )
            successMessage = "接受出价成功!"
            showingAcceptOfferSheet = false
        } catch {
            errorMessage = "接受出价失败: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func cancelOffer(_ offer: NFTOffer) async {
        guard let wallet = currentWallet else { return }

        do {
            try await marketplaceManager.cancelOffer(offer: offer, wallet: wallet)
            await loadOffers()
        } catch {
            errorMessage = "取消出价失败: \(error.localizedDescription)"
        }
    }

    // MARK: - Helpers

    private func formatPrice(_ weiString: String) -> String {
        guard let wei = Decimal(string: weiString) else { return "0" }
        let ether = wei / Decimal(string: "1000000000000000000")!
        return String(format: "%.4f ETH", NSDecimalNumber(decimal: ether).doubleValue)
    }

    private func shortAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }
}

// MARK: - Supporting Views

struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
    }
}

struct OfferRow: View {
    let offer: NFTOffer
    let isSeller: Bool
    let onAccept: () -> Void
    let onCancel: () async -> Void

    @StateObject private var walletManager = WalletManager.shared

    private var isMyOffer: Bool {
        guard let wallet = walletManager.selectedWallet else { return false }
        return offer.buyer.lowercased() == wallet.address.lowercased()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(formatPrice(offer.price))
                        .font(.headline)

                    Text("出价者: \(shortAddress(offer.buyer))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                OfferStatusBadge(status: offer.status)
            }

            Text("过期时间: \(offer.expiresAt, style: .relative)")
                .font(.caption)
                .foregroundColor(offer.isExpired ? .red : .secondary)

            if offer.status == .pending && !offer.isExpired {
                HStack(spacing: 8) {
                    if isSeller {
                        Button("接受") { onAccept() }
                            .font(.caption)
                            .foregroundColor(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.green)
                            .cornerRadius(6)
                    }

                    if isMyOffer {
                        Button("取消") {
                            Task { await onCancel() }
                        }
                        .font(.caption)
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.red)
                        .cornerRadius(6)
                    }
                }
            }
        }
        .padding()
        .background(Color(UIColor.tertiarySystemBackground))
        .cornerRadius(8)
    }

    private func formatPrice(_ weiString: String) -> String {
        guard let wei = Decimal(string: weiString) else { return "0" }
        let ether = wei / Decimal(string: "1000000000000000000")!
        return String(format: "%.4f ETH", NSDecimalNumber(decimal: ether).doubleValue)
    }

    private func shortAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }
}

struct OfferStatusBadge: View {
    let status: OfferStatus

    var body: some View {
        Text(statusText)
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(statusColor)
            .cornerRadius(4)
    }

    private var statusText: String {
        switch status {
        case .pending: return "待定"
        case .accepted: return "已接受"
        case .canceled: return "已取消"
        }
    }

    private var statusColor: Color {
        switch status {
        case .pending: return .orange
        case .accepted: return .green
        case .canceled: return .gray
        }
    }
}

struct EventRow: View {
    let event: MarketplaceEvent

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: eventIcon)
                .foregroundColor(eventColor)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(eventDescription)
                    .font(.subheadline)

                Text(event.timestamp, style: .relative)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 8)
    }

    private var eventIcon: String {
        switch event.eventType {
        case "listed": return "tag.fill"
        case "sold": return "cart.fill"
        case "canceled": return "xmark.circle.fill"
        case "offerMade": return "hand.raised.fill"
        case "offerAccepted": return "checkmark.circle.fill"
        case "offerCanceled": return "xmark.circle"
        default: return "circle.fill"
        }
    }

    private var eventColor: Color {
        switch event.eventType {
        case "listed": return .blue
        case "sold": return .green
        case "canceled": return .red
        case "offerMade": return .orange
        case "offerAccepted": return .green
        case "offerCanceled": return .gray
        default: return .gray
        }
    }

    private var eventDescription: String {
        switch event.eventType {
        case "listed": return "NFT 已上架"
        case "sold": return "NFT 已售出"
        case "canceled": return "上架已取消"
        case "offerMade": return "收到新出价"
        case "offerAccepted": return "出价已接受"
        case "offerCanceled": return "出价已取消"
        default: return event.eventType
        }
    }
}

struct AcceptOfferSheet: View {
    let offer: NFTOffer
    let wallet: Wallet
    let onAccept: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var isProcessing = false

    var body: some View {
        NavigationView {
            Form {
                Section("出价详情") {
                    HStack {
                        Text("价格")
                        Spacer()
                        Text(formatPrice(offer.price))
                            .fontWeight(.semibold)
                    }

                    HStack {
                        Text("出价者")
                        Spacer()
                        Text(shortAddress(offer.buyer))
                            .font(.caption)
                    }
                }

                Section("确认") {
                    SecureField("钱包密码", text: $password)
                }

                Section {
                    Button(action: {
                        Task {
                            isProcessing = true
                            await onAccept(password)
                            isProcessing = false
                        }
                    }) {
                        if isProcessing {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("接受出价")
                                .frame(maxWidth: .infinity)
                                .foregroundColor(.white)
                        }
                    }
                    .disabled(password.isEmpty || isProcessing)
                    .listRowBackground(Color.green)
                }
            }
            .navigationTitle("接受出价")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }

    private func formatPrice(_ weiString: String) -> String {
        guard let wei = Decimal(string: weiString) else { return "0" }
        let ether = wei / Decimal(string: "1000000000000000000")!
        return String(format: "%.4f ETH", NSDecimalNumber(decimal: ether).doubleValue)
    }

    private func shortAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }
}

struct NFTListingDetailView_Previews: PreviewProvider {
    static var previews: some View {
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
        NFTListingDetailView(listing: listing)
    }
}
