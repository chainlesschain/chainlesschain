//
//  AdvancedMarketplaceView.swift
//  ChainlessChain
//
//  高级市场功能视图
//  提供市场分析、趋势图表、热门收藏等功能
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI
import Combine

/// 高级市场视图
struct AdvancedMarketplaceView: View {
    @StateObject private var viewModel = AdvancedMarketplaceViewModel()
    @State private var selectedTab: MarketplaceTab = .trending

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 顶部标签栏
                tabBar

                // 内容区域
                TabView(selection: $selectedTab) {
                    TrendingCollectionsView(viewModel: viewModel)
                        .tag(MarketplaceTab.trending)

                    MarketAnalyticsView(viewModel: viewModel)
                        .tag(MarketplaceTab.analytics)

                    RecentSalesView(viewModel: viewModel)
                        .tag(MarketplaceTab.sales)

                    WatchlistView(viewModel: viewModel)
                        .tag(MarketplaceTab.watchlist)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .navigationTitle("高级市场")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: {
                            viewModel.refresh()
                        }) {
                            Label("刷新数据", systemImage: "arrow.clockwise")
                        }

                        Button(action: {
                            viewModel.showFilters = true
                        }) {
                            Label("筛选", systemImage: "line.3.horizontal.decrease.circle")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $viewModel.showFilters) {
                MarketFilterSheet(viewModel: viewModel)
            }
        }
        .onAppear {
            viewModel.loadData()
        }
    }

    // MARK: - 标签栏

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(MarketplaceTab.allCases, id: \.self) { tab in
                    TabButton(
                        title: tab.title,
                        icon: tab.icon,
                        isSelected: selectedTab == tab
                    ) {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedTab = tab
                        }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(.systemBackground))
    }
}

// MARK: - 市场标签

enum MarketplaceTab: String, CaseIterable {
    case trending
    case analytics
    case sales
    case watchlist

    var title: String {
        switch self {
        case .trending: return "热门"
        case .analytics: return "分析"
        case .sales: return "成交"
        case .watchlist: return "关注"
        }
    }

    var icon: String {
        switch self {
        case .trending: return "flame.fill"
        case .analytics: return "chart.line.uptrend.xyaxis"
        case .sales: return "cart.fill"
        case .watchlist: return "star.fill"
        }
    }
}

// MARK: - 标签按钮

struct TabButton: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)

                Text(title)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(isSelected ? Color.blue : Color.gray.opacity(0.1))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}

// MARK: - 热门收藏视图

struct TrendingCollectionsView: View {
    @ObservedObject var viewModel: AdvancedMarketplaceViewModel

    var body: some View {
        ScrollView {
            if viewModel.isLoading {
                ProgressView()
                    .padding(.top, 50)
            } else {
                VStack(spacing: 20) {
                    // 时间筛选
                    timeFilterBar

                    // 热门收藏列表
                    LazyVStack(spacing: 12) {
                        ForEach(Array(viewModel.trendingCollections.enumerated()), id: \.element.id) { index, collection in
                            NavigationLink(destination: CollectionBrowserView(collection: collection)) {
                                TrendingCollectionRow(rank: index + 1, collection: collection)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
        }
        .refreshable {
            await viewModel.refreshAsync()
        }
    }

    private var timeFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TimeFilter.allCases, id: \.self) { filter in
                    Button(action: {
                        viewModel.selectedTimeFilter = filter
                    }) {
                        Text(filter.displayName)
                            .font(.caption)
                            .fontWeight(.medium)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(viewModel.selectedTimeFilter == filter ?
                                         Color.blue : Color.gray.opacity(0.1))
                            .foregroundColor(viewModel.selectedTimeFilter == filter ?
                                              .white : .primary)
                            .cornerRadius(12)
                    }
                }
            }
            .padding(.horizontal)
        }
    }
}

// MARK: - 热门收藏行

struct TrendingCollectionRow: View {
    let rank: Int
    let collection: NFTCollection

    var body: some View {
        HStack(spacing: 12) {
            // 排名
            Text("\(rank)")
                .font(.headline)
                .fontWeight(.bold)
                .foregroundColor(rankColor)
                .frame(width: 30)

            // 收藏图片
            AsyncImage(url: URL(string: collection.imageUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure, .empty:
                    Image(systemName: "photo.artframe")
                        .foregroundColor(.gray)
                @unknown default:
                    EmptyView()
                }
            }
            .frame(width: 50, height: 50)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // 收藏信息
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(collection.name)
                        .font(.subheadline)
                        .fontWeight(.semibold)

                    if collection.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption2)
                            .foregroundColor(.blue)
                    }
                }

                Text("地板价: \(collection.floorPriceFormatted)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // 交易量和变化
            VStack(alignment: .trailing, spacing: 4) {
                Text(collection.volumeFormatted)
                    .font(.subheadline)
                    .fontWeight(.medium)

                HStack(spacing: 2) {
                    Image(systemName: collection.volumeChange >= 0 ?
                          "arrow.up" : "arrow.down")
                        .font(.caption2)

                    Text(String(format: "%.1f%%", abs(collection.volumeChange)))
                        .font(.caption)
                }
                .foregroundColor(collection.volumeChange >= 0 ? .green : .red)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var rankColor: Color {
        switch rank {
        case 1: return .yellow
        case 2: return .gray
        case 3: return .orange
        default: return .secondary
        }
    }
}

// MARK: - 市场分析视图

struct MarketAnalyticsView: View {
    @ObservedObject var viewModel: AdvancedMarketplaceViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // 市场概览卡片
                marketOverviewCard

                // 交易量图表
                volumeChartCard

                // 价格分布
                priceDistributionCard

                // 链分布
                chainDistributionCard
            }
            .padding()
        }
    }

    private var marketOverviewCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("市场概览")
                .font(.headline)

            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 12) {
                MetricCard(
                    title: "总交易量",
                    value: viewModel.totalVolume,
                    change: viewModel.volumeChange24h,
                    icon: "chart.bar.fill",
                    color: .blue
                )

                MetricCard(
                    title: "24h交易数",
                    value: "\(viewModel.transactions24h)",
                    change: viewModel.transactionsChange,
                    icon: "arrow.left.arrow.right",
                    color: .green
                )

                MetricCard(
                    title: "活跃钱包",
                    value: "\(viewModel.activeWallets)",
                    change: nil,
                    icon: "wallet.pass.fill",
                    color: .purple
                )

                MetricCard(
                    title: "平均价格",
                    value: viewModel.averagePrice,
                    change: viewModel.priceChange24h,
                    icon: "dollarsign.circle.fill",
                    color: .orange
                )
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    private var volumeChartCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("交易量趋势")
                    .font(.headline)

                Spacer()

                Picker("时间", selection: $viewModel.chartTimeRange) {
                    Text("7天").tag(7)
                    Text("30天").tag(30)
                    Text("90天").tag(90)
                }
                .pickerStyle(.segmented)
                .frame(width: 180)
            }

            // 简化图表（可以用Charts框架增强）
            VolumeChartPlaceholder(data: viewModel.volumeHistory)
                .frame(height: 200)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    private var priceDistributionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("价格分布")
                .font(.headline)

            ForEach(viewModel.priceDistribution, id: \.range) { item in
                HStack {
                    Text(item.range)
                        .font(.caption)
                        .frame(width: 80, alignment: .leading)

                    GeometryReader { geometry in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.blue.opacity(0.7))
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
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    private var chainDistributionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("链分布")
                .font(.headline)

            HStack(spacing: 16) {
                ForEach(viewModel.chainDistribution, id: \.chainId) { item in
                    VStack(spacing: 8) {
                        ZStack {
                            Circle()
                                .fill(chainColor(item.chainId).opacity(0.1))
                                .frame(width: 50, height: 50)

                            Text(chainSymbol(item.chainId))
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(chainColor(item.chainId))
                        }

                        Text(String(format: "%.0f%%", item.percentage))
                            .font(.caption)
                            .fontWeight(.medium)

                        Text(chainName(item.chainId))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    private func chainColor(_ chainId: Int) -> Color {
        switch chainId {
        case 1: return .blue
        case 137: return .purple
        case 56: return .yellow
        case 42161: return .cyan
        default: return .gray
        }
    }

    private func chainSymbol(_ chainId: Int) -> String {
        SupportedChain.allCases.first { $0.chainId == chainId }?.symbol ?? "?"
    }

    private func chainName(_ chainId: Int) -> String {
        SupportedChain.allCases.first { $0.chainId == chainId }?.name ?? "Unknown"
    }
}

// MARK: - 图表占位符

struct VolumeChartPlaceholder: View {
    let data: [VolumeDataPoint]

    var body: some View {
        GeometryReader { geometry in
            if data.isEmpty {
                Text("加载中...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .foregroundColor(.secondary)
            } else {
                Path { path in
                    let maxValue = data.map { $0.volume }.max() ?? 1
                    let stepX = geometry.size.width / CGFloat(data.count - 1)

                    for (index, point) in data.enumerated() {
                        let x = CGFloat(index) * stepX
                        let y = geometry.size.height * (1 - CGFloat(point.volume / maxValue))

                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(Color.blue, lineWidth: 2)

                // 填充区域
                Path { path in
                    let maxValue = data.map { $0.volume }.max() ?? 1
                    let stepX = geometry.size.width / CGFloat(data.count - 1)

                    path.move(to: CGPoint(x: 0, y: geometry.size.height))

                    for (index, point) in data.enumerated() {
                        let x = CGFloat(index) * stepX
                        let y = geometry.size.height * (1 - CGFloat(point.volume / maxValue))
                        path.addLine(to: CGPoint(x: x, y: y))
                    }

                    path.addLine(to: CGPoint(x: geometry.size.width, y: geometry.size.height))
                    path.closeSubpath()
                }
                .fill(
                    LinearGradient(
                        colors: [Color.blue.opacity(0.3), Color.blue.opacity(0.05)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            }
        }
    }
}

// MARK: - 指标卡片

struct MetricCard: View {
    let title: String
    let value: String
    let change: Double?
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)

                Spacer()

                if let change = change {
                    HStack(spacing: 2) {
                        Image(systemName: change >= 0 ? "arrow.up" : "arrow.down")
                            .font(.caption2)

                        Text(String(format: "%.1f%%", abs(change)))
                            .font(.caption)
                    }
                    .foregroundColor(change >= 0 ? .green : .red)
                }
            }

            Text(value)
                .font(.headline)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - 最近成交视图

struct RecentSalesView: View {
    @ObservedObject var viewModel: AdvancedMarketplaceViewModel

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.recentSales) { sale in
                    RecentSaleRow(sale: sale)
                }
            }
            .padding()
        }
        .refreshable {
            await viewModel.refreshSalesAsync()
        }
    }
}

// MARK: - 最近成交行

struct RecentSaleRow: View {
    let sale: NFTSale

    var body: some View {
        HStack(spacing: 12) {
            // NFT图片
            AsyncImage(url: URL(string: sale.imageUrl ?? "")) { phase in
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
            .frame(width: 60, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // 交易信息
            VStack(alignment: .leading, spacing: 4) {
                Text(sale.nftName ?? "Unknown NFT")
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(sale.collectionName ?? "Unknown Collection")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(spacing: 4) {
                    Text(formatAddress(sale.seller))
                    Image(systemName: "arrow.right")
                        .font(.caption2)
                    Text(formatAddress(sale.buyer))
                }
                .font(.caption2)
                .foregroundColor(.secondary)
            }

            Spacer()

            // 价格和时间
            VStack(alignment: .trailing, spacing: 4) {
                Text(sale.priceFormatted)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)

                Text(formatTimeAgo(sale.timestamp))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
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

// MARK: - 关注列表视图

struct WatchlistView: View {
    @ObservedObject var viewModel: AdvancedMarketplaceViewModel

    var body: some View {
        ScrollView {
            if viewModel.watchlist.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
                        .frame(height: 50)

                    Image(systemName: "star.circle")
                        .font(.system(size: 60))
                        .foregroundColor(.gray)

                    Text("暂无关注")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    Text("添加收藏或NFT到关注列表\n以便跟踪价格变化")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(viewModel.watchlist) { item in
                        WatchlistRow(item: item) {
                            viewModel.removeFromWatchlist(item)
                        }
                    }
                }
                .padding()
            }
        }
    }
}

// MARK: - 关注列表行

struct WatchlistRow: View {
    let item: WatchlistItem
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: item.imageUrl ?? "")) { phase in
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
            .frame(width: 50, height: 50)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(item.currentPrice)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                HStack(spacing: 2) {
                    Image(systemName: item.priceChange >= 0 ? "arrow.up" : "arrow.down")
                        .font(.caption2)

                    Text(String(format: "%.1f%%", abs(item.priceChange)))
                        .font(.caption)
                }
                .foregroundColor(item.priceChange >= 0 ? .green : .red)

                Button(action: onRemove) {
                    Image(systemName: "star.slash")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - 筛选Sheet

struct MarketFilterSheet: View {
    @ObservedObject var viewModel: AdvancedMarketplaceViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section("链") {
                    ForEach(SupportedChain.allCases.filter { !$0.isTestnet }, id: \.rawValue) { chain in
                        Toggle(chain.name, isOn: Binding(
                            get: { viewModel.selectedChains.contains(chain.chainId) },
                            set: { isOn in
                                if isOn {
                                    viewModel.selectedChains.insert(chain.chainId)
                                } else {
                                    viewModel.selectedChains.remove(chain.chainId)
                                }
                            }
                        ))
                    }
                }

                Section("价格范围") {
                    HStack {
                        TextField("最低价", text: $viewModel.minPrice)
                            .keyboardType(.decimalPad)
                        Text("-")
                        TextField("最高价", text: $viewModel.maxPrice)
                            .keyboardType(.decimalPad)
                    }
                }

                Section("排序") {
                    Picker("排序方式", selection: $viewModel.sortBy) {
                        Text("交易量").tag(SortOption.volume)
                        Text("地板价").tag(SortOption.floorPrice)
                        Text("涨跌幅").tag(SortOption.change)
                    }
                }
            }
            .navigationTitle("筛选")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("重置") {
                        viewModel.resetFilters()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("应用") {
                        viewModel.applyFilters()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }
}

// MARK: - 数据模型

struct NFTCollection: Identifiable {
    let id: String
    let name: String
    let imageUrl: String?
    let floorPrice: Decimal
    let volume: Decimal
    let volumeChange: Double
    let isVerified: Bool
    let chainId: Int

    var floorPriceFormatted: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 4
        return "\(formatter.string(from: floorPrice as NSDecimalNumber) ?? "0") ETH"
    }

    var volumeFormatted: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        return "\(formatter.string(from: volume as NSDecimalNumber) ?? "0") ETH"
    }
}

struct VolumeDataPoint: Identifiable {
    let id = UUID()
    let date: Date
    let volume: Double
}

struct PriceDistribution {
    let range: String
    let percentage: Double
}

struct ChainDistribution {
    let chainId: Int
    let percentage: Double
}

struct NFTSale: Identifiable {
    let id: String
    let nftName: String?
    let collectionName: String?
    let imageUrl: String?
    let seller: String
    let buyer: String
    let price: Decimal
    let timestamp: Date
    let chainId: Int

    var priceFormatted: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 4
        let chain = SupportedChain.allCases.first { $0.chainId == chainId }
        return "\(formatter.string(from: price as NSDecimalNumber) ?? "0") \(chain?.symbol ?? "ETH")"
    }
}

struct WatchlistItem: Identifiable {
    let id: String
    let name: String
    let imageUrl: String?
    let currentPrice: String
    let priceChange: Double
}

enum TimeFilter: String, CaseIterable {
    case hour1 = "1h"
    case hour24 = "24h"
    case day7 = "7d"
    case day30 = "30d"

    var displayName: String { rawValue }
}

enum SortOption {
    case volume
    case floorPrice
    case change
}

// MARK: - ViewModel

@MainActor
class AdvancedMarketplaceViewModel: ObservableObject {
    @Published var trendingCollections: [NFTCollection] = []
    @Published var recentSales: [NFTSale] = []
    @Published var watchlist: [WatchlistItem] = []
    @Published var volumeHistory: [VolumeDataPoint] = []
    @Published var priceDistribution: [PriceDistribution] = []
    @Published var chainDistribution: [ChainDistribution] = []

    @Published var totalVolume: String = "0 ETH"
    @Published var volumeChange24h: Double = 0
    @Published var transactions24h: Int = 0
    @Published var transactionsChange: Double = 0
    @Published var activeWallets: Int = 0
    @Published var averagePrice: String = "0 ETH"
    @Published var priceChange24h: Double = 0

    @Published var selectedTimeFilter: TimeFilter = .hour24
    @Published var chartTimeRange: Int = 7
    @Published var showFilters = false

    @Published var selectedChains: Set<Int> = []
    @Published var minPrice: String = ""
    @Published var maxPrice: String = ""
    @Published var sortBy: SortOption = .volume

    @Published var isLoading = false

    // MARK: - Public Methods

    func loadData() {
        isLoading = true

        // 模拟数据加载
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.loadMockData()
            self.isLoading = false
        }
    }

    func refresh() {
        loadData()
    }

    func refreshAsync() async {
        isLoading = true
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        loadMockData()
        isLoading = false
    }

    func refreshSalesAsync() async {
        try? await Task.sleep(nanoseconds: 500_000_000)
        // 刷新成交数据
    }

    func removeFromWatchlist(_ item: WatchlistItem) {
        watchlist.removeAll { $0.id == item.id }
    }

    func resetFilters() {
        selectedChains.removeAll()
        minPrice = ""
        maxPrice = ""
        sortBy = .volume
    }

    func applyFilters() {
        refresh()
    }

    // MARK: - Private Methods

    private func loadMockData() {
        // 热门收藏
        trendingCollections = [
            NFTCollection(id: "1", name: "Bored Ape Yacht Club", imageUrl: nil, floorPrice: 35.5, volume: 1250.5, volumeChange: 12.5, isVerified: true, chainId: 1),
            NFTCollection(id: "2", name: "CryptoPunks", imageUrl: nil, floorPrice: 52.3, volume: 890.2, volumeChange: -5.2, isVerified: true, chainId: 1),
            NFTCollection(id: "3", name: "Azuki", imageUrl: nil, floorPrice: 8.2, volume: 456.8, volumeChange: 25.3, isVerified: true, chainId: 1),
            NFTCollection(id: "4", name: "Doodles", imageUrl: nil, floorPrice: 3.5, volume: 234.1, volumeChange: 8.7, isVerified: true, chainId: 1),
            NFTCollection(id: "5", name: "CloneX", imageUrl: nil, floorPrice: 2.8, volume: 189.5, volumeChange: -2.1, isVerified: true, chainId: 1),
        ]

        // 市场统计
        totalVolume = "12,450.5 ETH"
        volumeChange24h = 15.3
        transactions24h = 3456
        transactionsChange = 8.2
        activeWallets = 12580
        averagePrice = "0.85 ETH"
        priceChange24h = -2.5

        // 交易量历史
        volumeHistory = (0..<30).map { day in
            VolumeDataPoint(
                date: Date().addingTimeInterval(TimeInterval(-day * 86400)),
                volume: Double.random(in: 100...500)
            )
        }.reversed()

        // 价格分布
        priceDistribution = [
            PriceDistribution(range: "0-0.1 ETH", percentage: 35.2),
            PriceDistribution(range: "0.1-1 ETH", percentage: 28.5),
            PriceDistribution(range: "1-10 ETH", percentage: 22.3),
            PriceDistribution(range: "10-100 ETH", percentage: 10.8),
            PriceDistribution(range: ">100 ETH", percentage: 3.2),
        ]

        // 链分布
        chainDistribution = [
            ChainDistribution(chainId: 1, percentage: 65.5),
            ChainDistribution(chainId: 137, percentage: 18.3),
            ChainDistribution(chainId: 42161, percentage: 10.2),
            ChainDistribution(chainId: 56, percentage: 6.0),
        ]

        // 最近成交
        recentSales = [
            NFTSale(id: "1", nftName: "BAYC #1234", collectionName: "Bored Ape Yacht Club", imageUrl: nil, seller: "0x1234...5678", buyer: "0xabcd...efgh", price: 35.5, timestamp: Date().addingTimeInterval(-120), chainId: 1),
            NFTSale(id: "2", nftName: "Punk #5678", collectionName: "CryptoPunks", imageUrl: nil, seller: "0x2345...6789", buyer: "0xbcde...fghi", price: 52.0, timestamp: Date().addingTimeInterval(-300), chainId: 1),
            NFTSale(id: "3", nftName: "Azuki #9012", collectionName: "Azuki", imageUrl: nil, seller: "0x3456...7890", buyer: "0xcdef...ghij", price: 8.5, timestamp: Date().addingTimeInterval(-600), chainId: 1),
        ]
    }
}

// MARK: - 预览

#if DEBUG
struct AdvancedMarketplaceView_Previews: PreviewProvider {
    static var previews: some View {
        AdvancedMarketplaceView()
    }
}
#endif
