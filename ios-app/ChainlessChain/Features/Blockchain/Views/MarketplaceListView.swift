import SwiftUI

/// MarketplaceListView - NFT Marketplace listing view with filters
/// Phase 1.6: Marketplace UI
struct MarketplaceListView: View {
    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @StateObject private var walletManager = WalletManager.shared
    @State private var listings: [NFTListing] = []
    @State private var selectedFilter: MarketplaceFilter = .all
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var selectedListing: NFTListing?
    @State private var showingListNFTView = false

    private var currentWallet: Wallet? {
        walletManager.selectedWallet
    }

    private var filteredListings: [NFTListing] {
        guard let wallet = currentWallet else { return [] }

        switch selectedFilter {
        case .all:
            return listings
        case .myListings:
            return listings.filter { $0.seller.lowercased() == wallet.address.lowercased() }
        case .myPurchases:
            return listings.filter { $0.buyer?.lowercased() == wallet.address.lowercased() }
        case .active:
            return listings.filter { $0.status == .active }
        case .sold:
            return listings.filter { $0.status == .sold }
        }
    }

    var body: some View {
        NavigationView {
            ZStack {
                if isLoading && listings.isEmpty {
                    ProgressView("加载市场...")
                } else if listings.isEmpty {
                    emptyStateView
                } else {
                    VStack(spacing: 0) {
                        filterChipsView

                        ScrollView {
                            LazyVGrid(columns: [
                                GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12)
                            ], spacing: 12) {
                                ForEach(filteredListings) { listing in
                                    NFTListingCard(listing: listing)
                                        .onTapGesture {
                                            selectedListing = listing
                                        }
                                }
                            }
                            .padding()
                        }
                        .refreshable {
                            await loadListings()
                        }
                    }
                }
            }
            .navigationTitle("NFT 市场")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingListNFTView = true }) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.blue)
                    }
                }
            }
            .sheet(item: $selectedListing) { listing in
                NFTListingDetailView(listing: listing)
            }
            .sheet(isPresented: $showingListNFTView) {
                if let wallet = currentWallet {
                    ListNFTView(wallet: wallet)
                }
            }
            .alert("错误", isPresented: .constant(errorMessage != nil)) {
                Button("确定") { errorMessage = nil }
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
            .task {
                await loadListings()
                subscribeToEvents()
            }
        }
    }

    private var filterChipsView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach([MarketplaceFilter.all, .myListings, .myPurchases, .active, .sold], id: \.self) { filter in
                    FilterChip(
                        title: filterTitle(for: filter),
                        isSelected: selectedFilter == filter,
                        action: {
                            withAnimation {
                                selectedFilter = filter
                            }
                        }
                    )
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(UIColor.systemBackground))
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "bag.circle")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无上架 NFT")
                .font(.headline)

            Text("浏览市场或上架您的第一个 NFT")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button(action: { showingListNFTView = true }) {
                Label("上架 NFT", systemImage: "plus.circle.fill")
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(Color.blue)
                    .cornerRadius(10)
            }
        }
    }

    private func filterTitle(for filter: MarketplaceFilter) -> String {
        switch filter {
        case .all: return "全部"
        case .myListings: return "我的上架"
        case .myPurchases: return "我的购买"
        case .active: return "在售中"
        case .sold: return "已售出"
        }
    }

    @MainActor
    private func loadListings() async {
        guard let wallet = currentWallet else { return }
        isLoading = true
        errorMessage = nil

        do {
            listings = try await marketplaceManager.getListings(
                chain: wallet.chain,
                filter: .all
            )
        } catch {
            errorMessage = "加载失败: \(error.localizedDescription)"
        }

        isLoading = false
    }

    private func subscribeToEvents() {
        marketplaceManager.listingCreated
            .receive(on: DispatchQueue.main)
            .sink { listing in
                if !listings.contains(where: { $0.id == listing.id }) {
                    listings.insert(listing, at: 0)
                }
            }
            .store(in: &marketplaceManager.cancellables)

        marketplaceManager.listingUpdated
            .receive(on: DispatchQueue.main)
            .sink { updatedListing in
                if let index = listings.firstIndex(where: { $0.id == updatedListing.id }) {
                    listings[index] = updatedListing
                }
            }
            .store(in: &marketplaceManager.cancellables)

        marketplaceManager.listingSold
            .receive(on: DispatchQueue.main)
            .sink { soldListing in
                if let index = listings.firstIndex(where: { $0.id == soldListing.id }) {
                    listings[index] = soldListing
                }
            }
            .store(in: &marketplaceManager.cancellables)
    }
}

/// NFTListingCard - Individual NFT listing card
struct NFTListingCard: View {
    let listing: NFTListing

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // NFT Image
            if let imageUrl = listing.nft.imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .frame(height: 160)
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(height: 160)
                            .clipped()
                    case .failure:
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundColor(.gray)
                            .frame(height: 160)
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                Image(systemName: "photo")
                    .font(.largeTitle)
                    .foregroundColor(.gray)
                    .frame(height: 160)
            }

            // NFT Name
            Text(listing.nft.name ?? "Unknown NFT")
                .font(.headline)
                .lineLimit(1)

            // Collection Name
            if let collectionName = listing.nft.collection?.name {
                Text(collectionName)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            // Price
            HStack {
                Image(systemName: listing.paymentToken == nil ? "dollarsign.circle.fill" : "circle.fill")
                    .foregroundColor(.blue)
                    .font(.caption)

                Text(formatPrice(listing.price))
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Spacer()

                // Status Badge
                StatusBadge(status: listing.status)
            }
        }
        .padding(8)
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.1), radius: 4, x: 0, y: 2)
    }

    private func formatPrice(_ weiString: String) -> String {
        guard let wei = Decimal(string: weiString) else { return "0" }
        let ether = wei / Decimal(string: "1000000000000000000")!
        return String(format: "%.4f ETH", NSDecimalNumber(decimal: ether).doubleValue)
    }
}

/// StatusBadge - Listing status indicator
struct StatusBadge: View {
    let status: ListingStatus

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
        case .active: return "在售"
        case .sold: return "已售"
        case .canceled: return "已取消"
        }
    }

    private var statusColor: Color {
        switch status {
        case .active: return .green
        case .sold: return .blue
        case .canceled: return .gray
        }
    }
}

/// FilterChip - Filter selection chip
struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .foregroundColor(isSelected ? .white : .primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? Color.blue : Color(UIColor.secondarySystemBackground))
                .cornerRadius(16)
        }
    }
}

struct MarketplaceListView_Previews: PreviewProvider {
    static var previews: some View {
        MarketplaceListView()
    }
}
