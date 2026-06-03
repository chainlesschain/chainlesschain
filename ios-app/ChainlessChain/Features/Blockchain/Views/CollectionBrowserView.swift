//
//  CollectionBrowserView.swift
//  ChainlessChain
//
//  NFT收藏集浏览视图
//  展示收藏详情、NFT列表、统计信息
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 收藏集浏览视图
struct CollectionBrowserView: View {
    let collection: NFTCollection
    @StateObject private var viewModel: CollectionBrowserViewModel
    @State private var selectedTab: CollectionTab = .items

    init(collection: NFTCollection) {
        self.collection = collection
        _viewModel = StateObject(wrappedValue: CollectionBrowserViewModel(collection: collection))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // 收藏头部
                collectionHeader

                // 统计卡片
                statsCard

                // 标签栏
                tabBar

                // 内容区域
                contentView
            }
        }
        .navigationTitle(collection.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 12) {
                    Button(action: {
                        viewModel.toggleWatchlist()
                    }) {
                        Image(systemName: viewModel.isInWatchlist ? "star.fill" : "star")
                            .foregroundColor(viewModel.isInWatchlist ? .yellow : .gray)
                    }

                    ShareLink(item: "https://chainlesschain.app/collection/\(collection.id)") {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
        }
        .onAppear {
            viewModel.loadData()
        }
    }

    // MARK: - 收藏头部

    private var collectionHeader: some View {
        VStack(spacing: 16) {
            // Banner和头像
            ZStack(alignment: .bottom) {
                // Banner
                AsyncImage(url: URL(string: viewModel.bannerUrl ?? "")) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure, .empty:
                        LinearGradient(
                            colors: [.blue.opacity(0.3), .purple.opacity(0.3)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    @unknown default:
                        EmptyView()
                    }
                }
                .frame(height: 150)
                .clipped()

                // 收藏头像
                AsyncImage(url: URL(string: collection.imageUrl ?? "")) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure, .empty:
                        Image(systemName: "photo.artframe")
                            .font(.largeTitle)
                            .foregroundColor(.gray)
                    @unknown default:
                        EmptyView()
                    }
                }
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color(.systemBackground), lineWidth: 4)
                )
                .offset(y: 50)
            }

            Spacer()
                .frame(height: 50)

            // 收藏名称
            HStack(spacing: 6) {
                Text(collection.name)
                    .font(.title2)
                    .fontWeight(.bold)

                if collection.isVerified {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundColor(.blue)
                }
            }

            // 创建者信息
            if let creator = viewModel.creator {
                HStack(spacing: 4) {
                    Text("创建者:")
                        .foregroundColor(.secondary)

                    Text(formatAddress(creator))
                        .foregroundColor(.blue)
                }
                .font(.caption)
            }

            // 描述
            if let description = viewModel.description {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .padding(.horizontal)
            }

            // 社交链接
            socialLinks
        }
        .padding(.bottom)
    }

    // MARK: - 社交链接

    private var socialLinks: some View {
        HStack(spacing: 16) {
            if let website = viewModel.website {
                Link(destination: URL(string: website)!) {
                    Image(systemName: "globe")
                        .font(.title3)
                        .foregroundColor(.blue)
                }
            }

            if let twitter = viewModel.twitter {
                Link(destination: URL(string: "https://twitter.com/\(twitter)")!) {
                    Image(systemName: "bird")
                        .font(.title3)
                        .foregroundColor(.blue)
                }
            }

            if let discord = viewModel.discord {
                Link(destination: URL(string: discord)!) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.title3)
                        .foregroundColor(.blue)
                }
            }
        }
    }

    // MARK: - 统计卡片

    private var statsCard: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible()),
            GridItem(.flexible()),
            GridItem(.flexible())
        ], spacing: 0) {
            StatItem(title: "地板价", value: collection.floorPriceFormatted)
            StatItem(title: "交易量", value: collection.volumeFormatted)
            StatItem(title: "持有者", value: "\(viewModel.holdersCount)")
            StatItem(title: "总量", value: "\(viewModel.totalSupply)")
        }
        .padding()
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - 标签栏

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(CollectionTab.allCases, id: \.self) { tab in
                Button(action: {
                    withAnimation {
                        selectedTab = tab
                    }
                }) {
                    VStack(spacing: 8) {
                        Text(tab.title)
                            .font(.subheadline)
                            .fontWeight(selectedTab == tab ? .semibold : .regular)
                            .foregroundColor(selectedTab == tab ? .blue : .secondary)

                        Rectangle()
                            .fill(selectedTab == tab ? Color.blue : Color.clear)
                            .frame(height: 2)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.top)
        .background(Color(.systemBackground))
    }

    // MARK: - 内容区域

    @ViewBuilder
    private var contentView: some View {
        switch selectedTab {
        case .items:
            itemsGrid
        case .activity:
            activityList
        case .analytics:
            analyticsView
        }
    }

    // MARK: - NFT列表

    private var itemsGrid: some View {
        VStack(spacing: 12) {
            // 筛选和排序
            HStack {
                Menu {
                    Button("价格: 低到高") { viewModel.sortBy = .priceLowToHigh }
                    Button("价格: 高到低") { viewModel.sortBy = .priceHighToLow }
                    Button("最新上架") { viewModel.sortBy = .newest }
                    Button("稀有度") { viewModel.sortBy = .rarity }
                } label: {
                    HStack {
                        Text(viewModel.sortBy.displayName)
                        Image(systemName: "chevron.down")
                    }
                    .font(.caption)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(8)
                }

                Spacer()

                Toggle("仅在售", isOn: $viewModel.showOnlyForSale)
                    .toggleStyle(.switch)
                    .scaleEffect(0.8)
            }
            .padding(.horizontal)

            // NFT网格
            if viewModel.isLoading {
                ProgressView()
                    .padding(.top, 50)
            } else if viewModel.items.isEmpty {
                emptyItemsView
            } else {
                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ], spacing: 12) {
                    ForEach(viewModel.items) { item in
                        CollectionItemCard(item: item)
                    }
                }
                .padding()
            }
        }
    }

    private var emptyItemsView: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.system(size: 40))
                .foregroundColor(.gray)

            Text("暂无NFT")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding(.top, 50)
    }

    // MARK: - 活动列表

    private var activityList: some View {
        LazyVStack(spacing: 0) {
            ForEach(viewModel.activities) { activity in
                ActivityRow(activity: activity)
                Divider()
            }
        }
        .padding()
    }

    // MARK: - 分析视图

    private var analyticsView: some View {
        VStack(spacing: 20) {
            // 价格历史图表
            PriceHistoryChartView(
                data: viewModel.priceHistory,
                title: "地板价历史"
            )

            // 交易量图表
            VStack(alignment: .leading, spacing: 12) {
                Text("交易量")
                    .font(.headline)

                VolumeChartPlaceholder(data: viewModel.volumeHistory)
                    .frame(height: 150)
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(12)

            // 持有者分布
            VStack(alignment: .leading, spacing: 12) {
                Text("持有者分布")
                    .font(.headline)

                ForEach(viewModel.holderDistribution, id: \.range) { item in
                    HStack {
                        Text(item.range)
                            .font(.caption)
                            .frame(width: 80, alignment: .leading)

                        GeometryReader { geometry in
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.purple.opacity(0.7))
                                .frame(width: geometry.size.width * CGFloat(item.percentage / 100))
                        }
                        .frame(height: 20)

                        Text(String(format: "%.1f%%", item.percentage))
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 50, alignment: .trailing)
                    }
                }
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(12)
        }
        .padding()
    }

    // MARK: - 辅助方法

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }
}

// MARK: - 收藏标签

enum CollectionTab: CaseIterable {
    case items
    case activity
    case analytics

    var title: String {
        switch self {
        case .items: return "NFT"
        case .activity: return "活动"
        case .analytics: return "分析"
        }
    }
}

// MARK: - 排序选项

enum CollectionSortOption {
    case priceLowToHigh
    case priceHighToLow
    case newest
    case rarity

    var displayName: String {
        switch self {
        case .priceLowToHigh: return "价格: 低到高"
        case .priceHighToLow: return "价格: 高到低"
        case .newest: return "最新上架"
        case .rarity: return "稀有度"
        }
    }
}

// MARK: - 统计项

struct StatItem: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.subheadline)
                .fontWeight(.semibold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

// MARK: - 收藏项卡片

struct CollectionItemCard: View {
    let item: CollectionItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 图片
            AsyncImage(url: URL(string: item.imageUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure, .empty:
                    Image(systemName: "photo")
                        .font(.largeTitle)
                        .foregroundColor(.gray)
                @unknown default:
                    EmptyView()
                }
            }
            .frame(height: 150)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // 名称
            Text(item.name)
                .font(.subheadline)
                .fontWeight(.medium)
                .lineLimit(1)

            // 价格
            if let price = item.price {
                HStack {
                    Image(systemName: "tag.fill")
                        .font(.caption2)
                        .foregroundColor(.blue)

                    Text(price)
                        .font(.caption)
                        .foregroundColor(.blue)
                        .fontWeight(.medium)
                }
            } else {
                Text("未上架")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            // 稀有度
            if let rarity = item.rarityRank {
                HStack {
                    Image(systemName: "sparkles")
                        .font(.caption2)
                        .foregroundColor(.purple)

                    Text("#\(rarity)")
                        .font(.caption2)
                        .foregroundColor(.purple)
                }
            }
        }
        .padding(8)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - 活动行

struct ActivityRow: View {
    let activity: CollectionActivity

    var body: some View {
        HStack(spacing: 12) {
            // 活动类型图标
            Image(systemName: activity.type.icon)
                .foregroundColor(activity.type.color)
                .frame(width: 24)

            // NFT缩略图
            AsyncImage(url: URL(string: activity.imageUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure, .empty:
                    Image(systemName: "photo")
                        .foregroundColor(.gray)
                @unknown default:
                    EmptyView()
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            // 活动信息
            VStack(alignment: .leading, spacing: 2) {
                Text(activity.itemName)
                    .font(.subheadline)
                    .fontWeight(.medium)

                HStack(spacing: 4) {
                    Text(activity.type.displayName)
                        .foregroundColor(activity.type.color)

                    if let from = activity.fromAddress {
                        Text("by")
                            .foregroundColor(.secondary)
                        Text(formatAddress(from))
                    }
                }
                .font(.caption)
            }

            Spacer()

            // 价格和时间
            VStack(alignment: .trailing, spacing: 2) {
                if let price = activity.price {
                    Text(price)
                        .font(.caption)
                        .fontWeight(.medium)
                }

                Text(formatTimeAgo(activity.timestamp))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 8)
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 8 else { return address }
        return "\(address.prefix(4))...\(address.suffix(4))"
    }

    private func formatTimeAgo(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - 数据模型

struct CollectionItem: Identifiable {
    let id: String
    let name: String
    let imageUrl: String?
    let price: String?
    let rarityRank: Int?
}

struct CollectionActivity: Identifiable {
    let id: String
    let type: ActivityType
    let itemName: String
    let imageUrl: String?
    let price: String?
    let fromAddress: String?
    let toAddress: String?
    let timestamp: Date
}

enum ActivityType {
    case sale
    case listing
    case transfer
    case mint

    var displayName: String {
        switch self {
        case .sale: return "售出"
        case .listing: return "上架"
        case .transfer: return "转移"
        case .mint: return "铸造"
        }
    }

    var icon: String {
        switch self {
        case .sale: return "cart.fill"
        case .listing: return "tag.fill"
        case .transfer: return "arrow.right"
        case .mint: return "sparkles"
        }
    }

    var color: Color {
        switch self {
        case .sale: return .green
        case .listing: return .blue
        case .transfer: return .orange
        case .mint: return .purple
        }
    }
}

struct HolderDistribution {
    let range: String
    let percentage: Double
}

struct PriceDataPoint: Identifiable {
    let id = UUID()
    let date: Date
    let price: Double
}

// MARK: - ViewModel

@MainActor
class CollectionBrowserViewModel: ObservableObject {
    let collection: NFTCollection

    @Published var isLoading = false
    @Published var isInWatchlist = false

    @Published var bannerUrl: String?
    @Published var creator: String?
    @Published var description: String?
    @Published var website: String?
    @Published var twitter: String?
    @Published var discord: String?

    @Published var holdersCount: Int = 0
    @Published var totalSupply: Int = 0

    @Published var items: [CollectionItem] = []
    @Published var activities: [CollectionActivity] = []
    @Published var priceHistory: [PriceDataPoint] = []
    @Published var volumeHistory: [VolumeDataPoint] = []
    @Published var holderDistribution: [HolderDistribution] = []

    @Published var sortBy: CollectionSortOption = .priceLowToHigh
    @Published var showOnlyForSale = false

    init(collection: NFTCollection) {
        self.collection = collection
    }

    func loadData() {
        isLoading = true

        // 模拟加载数据
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.loadMockData()
            self.isLoading = false
        }
    }

    func toggleWatchlist() {
        isInWatchlist.toggle()
    }

    private func loadMockData() {
        creator = "0x1234567890abcdef1234567890abcdef12345678"
        description = "这是一个独特的NFT收藏系列，包含独特的数字艺术品。"
        website = "https://example.com"
        twitter = "example_nft"
        holdersCount = 5420
        totalSupply = 10000

        items = (1...20).map { i in
            CollectionItem(
                id: "\(i)",
                name: "\(collection.name) #\(i)",
                imageUrl: nil,
                price: Bool.random() ? "\(Double.random(in: 0.1...10)) ETH" : nil,
                rarityRank: Int.random(in: 1...10000)
            )
        }

        activities = (1...10).map { i in
            CollectionActivity(
                id: "\(i)",
                type: [.sale, .listing, .transfer, .mint].randomElement()!,
                itemName: "\(collection.name) #\(Int.random(in: 1...10000))",
                imageUrl: nil,
                price: "\(Double.random(in: 0.1...10)) ETH",
                fromAddress: "0x\(String(repeating: "a", count: 40))",
                toAddress: "0x\(String(repeating: "b", count: 40))",
                timestamp: Date().addingTimeInterval(TimeInterval(-i * 3600))
            )
        }

        priceHistory = (0..<30).map { day in
            PriceDataPoint(
                date: Date().addingTimeInterval(TimeInterval(-day * 86400)),
                price: Double.random(in: 1...50)
            )
        }.reversed()

        volumeHistory = (0..<30).map { day in
            VolumeDataPoint(
                date: Date().addingTimeInterval(TimeInterval(-day * 86400)),
                volume: Double.random(in: 10...200)
            )
        }.reversed()

        holderDistribution = [
            HolderDistribution(range: "1个", percentage: 45.2),
            HolderDistribution(range: "2-5个", percentage: 28.5),
            HolderDistribution(range: "6-10个", percentage: 15.3),
            HolderDistribution(range: "11-50个", percentage: 8.2),
            HolderDistribution(range: ">50个", percentage: 2.8),
        ]
    }
}

// MARK: - 预览

#if DEBUG
struct CollectionBrowserView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            CollectionBrowserView(collection: NFTCollection(
                id: "1",
                name: "Sample Collection",
                imageUrl: nil,
                floorPrice: 1.5,
                volume: 250.5,
                volumeChange: 12.5,
                isVerified: true,
                chainId: 1
            ))
        }
    }
}
#endif
