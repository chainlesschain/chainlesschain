import SwiftUI
import Combine

/// 混合搜索视图
public struct HybridSearchView: View {
    @StateObject private var viewModel = HybridSearchViewModel()
    @State private var searchText = ""
    @State private var selectedTab = 0

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 搜索栏
                searchBar

                // 统计卡片
                statsSection

                // 标签选择器
                Picker("", selection: $selectedTab) {
                    Text("搜索结果").tag(0)
                    Text("配置").tag(1)
                    Text("历史").tag(2)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding()

                // 内容区域
                tabContent
            }
            .navigationTitle("Hybrid Search")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { Task { await viewModel.resetStats() } }) {
                            Label("重置统计", systemImage: "arrow.counterclockwise")
                        }
                        Button(action: { viewModel.clearHistory() }) {
                            Label("清除历史", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .task {
                await viewModel.loadStats()
            }
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField("输入搜索关键词...", text: $searchText)
                .textFieldStyle(PlainTextFieldStyle())
                .onSubmit {
                    Task {
                        await viewModel.search(searchText)
                    }
                }

            if !searchText.isEmpty {
                Button(action: { searchText = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }

            Button(action: {
                Task {
                    await viewModel.search(searchText)
                }
            }) {
                Text("搜索")
                    .fontWeight(.medium)
            }
            .buttonStyle(.borderedProminent)
            .disabled(searchText.isEmpty)
        }
        .padding()
        .background(Color(.systemBackground))
    }

    // MARK: - Stats Section

    private var statsSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                StatCard(
                    title: "文档数",
                    value: "\(viewModel.stats.documentCount)",
                    icon: "doc.text",
                    color: .blue
                )

                StatCard(
                    title: "Vector 权重",
                    value: String(format: "%.0f%%", viewModel.stats.vectorWeight * 100),
                    icon: "waveform",
                    color: .purple
                )

                StatCard(
                    title: "BM25 权重",
                    value: String(format: "%.0f%%", viewModel.stats.textWeight * 100),
                    icon: "textformat",
                    color: .orange
                )

                StatCard(
                    title: "平均延迟",
                    value: String(format: "%.0fms", viewModel.stats.avgLatencyMs),
                    icon: "clock",
                    color: .green
                )

                StatCard(
                    title: "搜索次数",
                    value: "\(viewModel.stats.totalSearches)",
                    icon: "magnifyingglass",
                    color: .teal
                )
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Tab Content

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case 0:
            SearchResultsView(viewModel: viewModel)
        case 1:
            ConfigurationView(viewModel: viewModel)
        case 2:
            SearchHistoryView(viewModel: viewModel)
        default:
            EmptyView()
        }
    }
}

// MARK: - Stat Card

private struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                Text(title)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(value)
                .font(.title2)
                .fontWeight(.bold)
        }
        .frame(width: 90)
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }
}

// MARK: - Search Results View

private struct SearchResultsView: View {
    @ObservedObject var viewModel: HybridSearchViewModel

    var body: some View {
        Group {
            if viewModel.isSearching {
                VStack {
                    ProgressView()
                    Text("搜索中...")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.searchResults.isEmpty {
                VStack(spacing: 20) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 60))
                        .foregroundColor(.secondary)

                    Text("输入关键词开始搜索")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    Text("使用 Vector + BM25 混合搜索")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(viewModel.searchResults) { result in
                        SearchResultRow(result: result)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

// MARK: - Search Result Row

private struct SearchResultRow: View {
    let result: SearchResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 标题和来源
            HStack {
                Text(result.document.title ?? "无标题")
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                SourceBadge(source: result.source)
            }

            // 内容预览
            Text(result.document.content)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .lineLimit(2)

            // 分数信息
            HStack(spacing: 16) {
                ScoreLabel(label: "总分", value: result.score)

                if result.vectorScore > 0 {
                    ScoreLabel(label: "Vector", value: result.vectorScore, color: .purple)
                }

                if result.bm25Score > 0 {
                    ScoreLabel(label: "BM25", value: result.bm25Score, color: .orange)
                }

                if result.rrfScore > 0 {
                    ScoreLabel(label: "RRF", value: result.rrfScore, color: .blue)
                }
            }
            .font(.caption)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Source Badge

private struct SourceBadge: View {
    let source: SearchResultSource

    var body: some View {
        Text(source.rawValue.uppercased())
            .font(.caption2)
            .fontWeight(.bold)
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(badgeColor)
            .cornerRadius(4)
    }

    private var badgeColor: Color {
        switch source {
        case .vector:
            return .purple
        case .bm25:
            return .orange
        case .hybrid:
            return .blue
        }
    }
}

// MARK: - Score Label

private struct ScoreLabel: View {
    let label: String
    let value: Double
    var color: Color = .primary

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .foregroundColor(.secondary)
            Text(String(format: "%.3f", value))
                .fontWeight(.medium)
                .foregroundColor(color)
        }
    }
}

// MARK: - Configuration View

private struct ConfigurationView: View {
    @ObservedObject var viewModel: HybridSearchViewModel

    var body: some View {
        List {
            Section(header: Text("权重配置")) {
                VStack(alignment: .leading) {
                    HStack {
                        Text("Vector 权重")
                        Spacer()
                        Text(String(format: "%.0f%%", viewModel.vectorWeight * 100))
                            .foregroundColor(.purple)
                    }
                    Slider(value: $viewModel.vectorWeight, in: 0...1, step: 0.1) { _ in
                        viewModel.updateWeights()
                    }
                }

                VStack(alignment: .leading) {
                    HStack {
                        Text("BM25 权重")
                        Spacer()
                        Text(String(format: "%.0f%%", viewModel.textWeight * 100))
                            .foregroundColor(.orange)
                    }
                    Slider(value: $viewModel.textWeight, in: 0...1, step: 0.1) { _ in
                        viewModel.updateWeights()
                    }
                }
            }

            Section(header: Text("BM25 参数")) {
                HStack {
                    Text("k1 (词频饱和度)")
                    Spacer()
                    Text(String(format: "%.1f", viewModel.stats.k1))
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("b (长度归一化)")
                    Spacer()
                    Text(String(format: "%.2f", viewModel.stats.b))
                        .foregroundColor(.secondary)
                }
            }

            Section(header: Text("RRF 参数")) {
                HStack {
                    Text("k 值")
                    Spacer()
                    Text("\(viewModel.stats.rrfK)")
                        .foregroundColor(.secondary)
                }
            }

            Section(header: Text("搜索开关")) {
                Toggle("启用 Vector Search", isOn: $viewModel.enableVector)
                    .onChange(of: viewModel.enableVector) { _ in
                        viewModel.updateConfig()
                    }

                Toggle("启用 BM25 Search", isOn: $viewModel.enableBM25)
                    .onChange(of: viewModel.enableBM25) { _ in
                        viewModel.updateConfig()
                    }
            }
        }
        .listStyle(InsetGroupedListStyle())
    }
}

// MARK: - Search History View

private struct SearchHistoryView: View {
    @ObservedObject var viewModel: HybridSearchViewModel

    var body: some View {
        Group {
            if viewModel.searchHistory.isEmpty {
                VStack(spacing: 20) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 60))
                        .foregroundColor(.secondary)

                    Text("暂无搜索历史")
                        .font(.headline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(viewModel.searchHistory) { event in
                        SearchHistoryRow(event: event)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

// MARK: - Search History Row

private struct SearchHistoryRow: View {
    let event: SearchEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(event.query)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                Text(event.source.uppercased())
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.blue.opacity(0.2))
                    .cornerRadius(4)
            }

            HStack {
                Label("\(event.resultCount) 结果", systemImage: "doc.text")

                Spacer()

                Label(String(format: "%.0fms", event.latencyMs), systemImage: "clock")

                Spacer()

                Text(formatDate(event.timestamp))
            }
            .font(.caption)
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}

// MARK: - View Model

@MainActor
class HybridSearchViewModel: ObservableObject {
    @Published var stats = SearchStats()
    @Published var searchResults: [SearchResult] = []
    @Published var searchHistory: [SearchEvent] = []
    @Published var isSearching = false

    // Configuration
    @Published var vectorWeight: Double = 0.6
    @Published var textWeight: Double = 0.4
    @Published var enableVector: Bool = true
    @Published var enableBM25: Bool = true

    private let searchEngine = HybridSearchEngine.shared

    init() {
        loadStats()
    }

    func loadStats() async {
        stats = searchEngine.getStats()
        searchHistory = searchEngine.getSearchHistory()
        vectorWeight = stats.vectorWeight
        textWeight = stats.textWeight
    }

    func loadStats() {
        Task {
            await loadStats()
        }
    }

    func search(_ query: String) async {
        guard !query.isEmpty else { return }

        isSearching = true

        var options = SearchOptions()
        options.enableVector = enableVector
        options.enableBM25 = enableBM25
        options.limit = 20

        searchResults = await searchEngine.search(query, options: options)
        searchHistory = searchEngine.getSearchHistory()
        stats = searchEngine.getStats()

        isSearching = false
    }

    func updateWeights() {
        // 确保权重总和为 1
        let total = vectorWeight + textWeight
        if total > 0 {
            let normalizedVector = vectorWeight / total
            let normalizedText = textWeight / total
            searchEngine.updateWeights(vectorWeight: normalizedVector, textWeight: normalizedText)
        }
    }

    func updateConfig() {
        var config = searchEngine.config
        config.enableVector = enableVector
        config.enableBM25 = enableBM25
        searchEngine.configure(config)
    }

    func resetStats() async {
        searchEngine.resetStats()
        await loadStats()
    }

    func clearHistory() {
        searchEngine.clearSearchHistory()
        searchHistory = []
    }
}

// MARK: - Preview

struct HybridSearchView_Previews: PreviewProvider {
    static var previews: some View {
        HybridSearchView()
    }
}
