import SwiftUI

/// DAppDiscoveryView - DApp discovery, favorites, and categories
/// Phase 2.0: DApp Browser
struct DAppDiscoveryView: View {
    @StateObject private var browserManager = DAppBrowserManager.shared
    @State private var selectedCategory: DAppCategory?
    @State private var searchQuery = ""
    @State private var searchResults: [DApp] = []
    @State private var categoryDApps: [DApp] = []
    @State private var showingBrowser = false
    @State private var selectedDApp: DApp?
    @State private var isSearching = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Search Bar
                    searchBarView

                    // Search Results or Main Content
                    if isSearching && !searchQuery.isEmpty {
                        searchResultsSection
                    } else {
                        // Favorites Section
                        if !browserManager.favorites.isEmpty {
                            favoritesSection
                        }

                        // Categories
                        categoriesSection

                        // Featured DApps
                        featuredSection
                    }
                }
                .padding()
            }
            .navigationTitle("发现 DApp")
            .navigationBarTitleDisplayMode(.large)
            .sheet(isPresented: $showingBrowser) {
                if let dapp = selectedDApp {
                    DAppBrowserView(initialUrl: dapp.url)
                }
            }
            .sheet(item: $selectedCategory) { category in
                CategoryDAppsView(category: category)
            }
            .alert("错误", isPresented: .constant(errorMessage != nil)) {
                Button("确定") { errorMessage = nil }
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
            .task {
                await loadData()
            }
        }
    }

    // MARK: - Search Bar

    private var searchBarView: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.gray)

            TextField("搜索 DApp...", text: $searchQuery)
                .textFieldStyle(.plain)
                .onChange(of: searchQuery) { newValue in
                    isSearching = !newValue.isEmpty
                    if !newValue.isEmpty {
                        Task {
                            await performSearch(query: newValue)
                        }
                    }
                }

            if !searchQuery.isEmpty {
                Button(action: {
                    searchQuery = ""
                    isSearching = false
                    searchResults = []
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.gray)
                }
            }
        }
        .padding(10)
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(10)
    }

    // MARK: - Search Results

    private var searchResultsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("搜索结果")
                .font(.headline)

            if searchResults.isEmpty {
                Text("未找到匹配的 DApp")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding()
            } else {
                ForEach(searchResults) { dapp in
                    DAppRow(dapp: dapp, onTap: {
                        openDApp(dapp)
                    }, onFavoriteToggle: {
                        Task {
                            await toggleFavorite(dapp)
                        }
                    })
                }
            }
        }
    }

    // MARK: - Favorites Section

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "star.fill")
                    .foregroundColor(.yellow)
                Text("我的收藏")
                    .font(.headline)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(browserManager.favorites) { dapp in
                        FavoriteDAppCard(dapp: dapp, onTap: {
                            openDApp(dapp)
                        })
                    }
                }
            }
        }
    }

    // MARK: - Categories Section

    private var categoriesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("分类")
                .font(.headline)

            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 12) {
                ForEach(DAppCategory.allCategories, id: \.self) { category in
                    CategoryCard(category: category, onTap: {
                        selectedCategory = category
                    })
                }
            }
        }
    }

    // MARK: - Featured Section

    private var featuredSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("热门 DApp")
                .font(.headline)

            ForEach(browserManager.featuredDApps) { dapp in
                FeaturedDAppRow(dapp: dapp, onTap: {
                    openDApp(dapp)
                }, onFavoriteToggle: {
                    Task {
                        await toggleFavorite(dapp)
                    }
                })
            }
        }
    }

    // MARK: - Actions

    @MainActor
    private func loadData() async {
        do {
            try await browserManager.loadDApps()
        } catch {
            errorMessage = "加载失败: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func performSearch(query: String) async {
        do {
            searchResults = try await browserManager.searchDApps(query: query)
        } catch {
            errorMessage = "搜索失败: \(error.localizedDescription)"
        }
    }

    private func openDApp(_ dapp: DApp) {
        selectedDApp = dapp
        showingBrowser = true

        Task {
            do {
                try await browserManager.recordVisit(
                    dappId: dapp.id,
                    url: dapp.url,
                    title: dapp.name
                )
            } catch {
                print("Failed to record visit: \(error)")
            }
        }
    }

    @MainActor
    private func toggleFavorite(_ dapp: DApp) async {
        do {
            try await browserManager.toggleFavorite(dappId: dapp.id)
        } catch {
            errorMessage = "操作失败: \(error.localizedDescription)"
        }
    }
}

// MARK: - DApp Row

struct DAppRow: View {
    let dapp: DApp
    let onTap: () -> Void
    let onFavoriteToggle: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Icon
                if let iconUrl = dapp.iconUrl, let url = URL(string: iconUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 50, height: 50)
                                .cornerRadius(10)
                        default:
                            Image(systemName: dapp.category.icon)
                                .font(.title2)
                                .frame(width: 50, height: 50)
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(10)
                        }
                    }
                } else {
                    Image(systemName: dapp.category.icon)
                        .font(.title2)
                        .frame(width: 50, height: 50)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(10)
                }

                // Info
                VStack(alignment: .leading, spacing: 4) {
                    Text(dapp.name)
                        .font(.headline)
                        .foregroundColor(.primary)

                    if let description = dapp.description {
                        Text(description)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }

                    Text(dapp.displayUrl)
                        .font(.caption2)
                        .foregroundColor(.blue)
                }

                Spacer()

                // Favorite Button
                Button(action: onFavoriteToggle) {
                    Image(systemName: dapp.isFavorite ? "star.fill" : "star")
                        .foregroundColor(dapp.isFavorite ? .yellow : .gray)
                }
                .buttonStyle(.plain)
            }
            .padding()
            .background(Color(UIColor.secondarySystemBackground))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Favorite DApp Card

struct FavoriteDAppCard: View {
    let dapp: DApp
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                // Icon
                if let iconUrl = dapp.iconUrl, let url = URL(string: iconUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 60, height: 60)
                                .cornerRadius(12)
                        default:
                            Image(systemName: dapp.category.icon)
                                .font(.largeTitle)
                                .frame(width: 60, height: 60)
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(12)
                        }
                    }
                } else {
                    Image(systemName: dapp.category.icon)
                        .font(.largeTitle)
                        .frame(width: 60, height: 60)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(12)
                }

                Text(dapp.name)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)
                    .frame(width: 80)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Category Card

struct CategoryCard: View {
    let category: DAppCategory
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                Image(systemName: category.icon)
                    .font(.title2)
                    .foregroundColor(.blue)
                    .frame(width: 50, height: 50)
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(10)

                Text(category.rawValue)
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color(UIColor.secondarySystemBackground))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Featured DApp Row

struct FeaturedDAppRow: View {
    let dapp: DApp
    let onTap: () -> Void
    let onFavoriteToggle: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Icon
                if let iconUrl = dapp.iconUrl, let url = URL(string: iconUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 60, height: 60)
                                .cornerRadius(12)
                        default:
                            placeholderIcon
                        }
                    }
                } else {
                    placeholderIcon
                }

                // Info
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(dapp.name)
                            .font(.headline)

                        CategoryBadge(category: dapp.category)
                    }

                    if let description = dapp.description {
                        Text(description)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }

                    HStack(spacing: 4) {
                        Image(systemName: "eye.fill")
                            .font(.caption2)
                        Text("\(dapp.visitCount) 次访问")
                            .font(.caption2)
                    }
                    .foregroundColor(.secondary)
                }

                Spacer()

                // Favorite Button
                Button(action: onFavoriteToggle) {
                    Image(systemName: dapp.isFavorite ? "star.fill" : "star")
                        .foregroundColor(dapp.isFavorite ? .yellow : .gray)
                        .font(.title3)
                }
                .buttonStyle(.plain)
            }
            .padding()
            .background(Color(UIColor.secondarySystemBackground))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }

    private var placeholderIcon: some View {
        Image(systemName: dapp.category.icon)
            .font(.title)
            .frame(width: 60, height: 60)
            .background(
                LinearGradient(
                    colors: [Color.blue, Color.purple],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .foregroundColor(.white)
            .cornerRadius(12)
    }
}

// MARK: - Category Badge

struct CategoryBadge: View {
    let category: DAppCategory

    var body: some View {
        Text(category.rawValue)
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(categoryColor)
            .cornerRadius(4)
    }

    private var categoryColor: Color {
        switch category {
        case .defi: return .blue
        case .nft: return .purple
        case .gaming: return .green
        case .social: return .orange
        case .marketplace: return .pink
        case .bridge: return .cyan
        case .dao: return .indigo
        case .tools: return .gray
        case .other: return .secondary
        }
    }
}

// MARK: - Category DApps View

struct CategoryDAppsView: View {
    let category: DAppCategory

    @StateObject private var browserManager = DAppBrowserManager.shared
    @State private var dapps: [DApp] = []
    @State private var selectedDApp: DApp?
    @State private var showingBrowser = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(dapps) { dapp in
                        DAppRow(dapp: dapp, onTap: {
                            selectedDApp = dapp
                            showingBrowser = true
                        }, onFavoriteToggle: {
                            Task {
                                try? await browserManager.toggleFavorite(dappId: dapp.id)
                                await loadDApps()
                            }
                        })
                    }
                }
                .padding()
            }
            .navigationTitle(category.rawValue)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") { dismiss() }
                }
            }
            .sheet(isPresented: $showingBrowser) {
                if let dapp = selectedDApp {
                    DAppBrowserView(initialUrl: dapp.url)
                }
            }
            .task {
                await loadDApps()
            }
        }
    }

    @MainActor
    private func loadDApps() async {
        do {
            dapps = try await browserManager.getDAppsByCategory(category)
        } catch {
            print("Failed to load category DApps: \(error)")
        }
    }
}

struct DAppDiscoveryView_Previews: PreviewProvider {
    static var previews: some View {
        DAppDiscoveryView()
    }
}
