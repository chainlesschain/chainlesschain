import Foundation
import SwiftUI
import Combine
import CoreCommon

@MainActor
class KnowledgeViewModel: ObservableObject {
    @Published var items: [KnowledgeItem] = []
    @Published var filteredItems: [KnowledgeItem] = []
    @Published var searchText = ""
    @Published var selectedCategory: String?
    @Published var selectedTag: String?
    @Published var showFavoritesOnly = false
    @Published var isLoading = false
    @Published var isSearching = false
    @Published var isLoadingMore = false
    @Published var hasMoreItems = true
    @Published var errorMessage: String?
    @Published var statistics: KnowledgeStatistics?
    @Published var useSemanticSearch = false // Toggle for semantic search

    @Published var categories: [String] = []
    @Published var tags: [String] = []

    private let repository = KnowledgeRepository.shared
    private let logger = Logger.shared
    private let ragManager = RAGManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var searchTask: Task<Void, Never>?

    // Pagination
    private let pageSize = 50
    private var currentOffset = 0

    // Debounce intervals
    private let keywordDebounceInterval: TimeInterval = 0.3  // 300ms for keyword search
    private let semanticDebounceInterval: TimeInterval = 0.5 // 500ms for semantic search

    init() {
        // Set repository for RAG manager
        ragManager.setKnowledgeRepository(repository)

        // Setup debounced search
        setupDebouncedSearch()

        Task {
            await loadInitialData()
            await initializeRAG()
        }
    }

    // MARK: - Debounced Search Setup

    private func setupDebouncedSearch() {
        $searchText
            .removeDuplicates()
            .debounce(for: .seconds(useSemanticSearch ? semanticDebounceInterval : keywordDebounceInterval), scheduler: DispatchQueue.main)
            .sink { [weak self] newValue in
                guard let self = self else { return }
                Task { @MainActor in
                    await self.debouncedSearchHandler(newValue)
                }
            }
            .store(in: &cancellables)
    }

    private func debouncedSearchHandler(_ query: String) async {
        // Cancel previous search task
        searchTask?.cancel()

        guard !query.isEmpty else {
            // If search is cleared, show all items
            applyFilters()
            return
        }

        searchTask = Task {
            isSearching = true
            defer { isSearching = false }

            if useSemanticSearch && ragManager.isInitialized {
                await performSemanticSearch(query)
            } else {
                applyFilters()
            }
        }
    }

    // MARK: - RAG Initialization

    private func initializeRAG() async {
        do {
            try await ragManager.initialize()
            logger.info("RAG system initialized", category: "Knowledge")
        } catch {
            logger.error("Failed to initialize RAG", error: error, category: "Knowledge")
        }
    }

    // MARK: - Data Loading

    func loadInitialData() async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await loadItems()
            try await loadCategories()
            try await loadTags()
            try await loadStatistics()
        } catch {
            handleError(error)
        }
    }

    func loadItems() async throws {
        logger.info("Loading knowledge items (paginated)", category: "Knowledge")

        // Reset pagination state
        currentOffset = 0
        hasMoreItems = true

        let newItems = try repository.getAll(limit: pageSize, offset: 0)
        self.items = newItems
        hasMoreItems = newItems.count >= pageSize
        currentOffset = newItems.count
        applyFilters()

        logger.info("Loaded \(newItems.count) items (page 1)", category: "Knowledge")
    }

    /// Load more items for pagination
    func loadMoreItems() async {
        guard !isLoadingMore && hasMoreItems else { return }

        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let newItems = try repository.getAll(limit: pageSize, offset: currentOffset)

            if newItems.isEmpty {
                hasMoreItems = false
                return
            }

            items.append(contentsOf: newItems)
            currentOffset += newItems.count
            hasMoreItems = newItems.count >= pageSize
            applyFilters()

            logger.info("Loaded \(newItems.count) more items (offset: \(currentOffset))", category: "Knowledge")
        } catch {
            logger.error("Failed to load more items", error: error, category: "Knowledge")
        }
    }

    /// Check if should load more when reaching end of list
    func loadMoreIfNeeded(currentItem: KnowledgeItem) {
        guard let index = filteredItems.firstIndex(where: { $0.id == currentItem.id }) else { return }

        // Load more when within 5 items of the end
        if index >= filteredItems.count - 5 {
            Task {
                await loadMoreItems()
            }
        }
    }

    func loadCategories() async throws {
        categories = try repository.getAllCategories()
    }

    func loadTags() async throws {
        tags = try repository.getAllTags()
    }

    func loadStatistics() async throws {
        statistics = try repository.getStatistics()
    }

    func refresh() async {
        await loadInitialData()
    }

    // MARK: - Filtering

    func applyFilters() {
        // Use semantic search if enabled and there's search text
        if useSemanticSearch && !searchText.isEmpty && ragManager.isInitialized {
            Task {
                await performSemanticSearch(searchText)
            }
            return
        }

        var result = items

        // 搜索过滤 (keyword search)
        if !searchText.isEmpty {
            result = result.filter { item in
                item.title.localizedCaseInsensitiveContains(searchText) ||
                item.content.localizedCaseInsensitiveContains(searchText) ||
                item.tags.contains { $0.localizedCaseInsensitiveContains(searchText) }
            }
        }

        // 分类过滤
        if let category = selectedCategory {
            result = result.filter { $0.category == category }
        }

        // 标签过滤
        if let tag = selectedTag {
            result = result.filter { $0.tags.contains(tag) }
        }

        // 收藏过滤
        if showFavoritesOnly {
            result = result.filter { $0.isFavorite }
        }

        filteredItems = result
    }

    private func performSemanticSearch(_ query: String) async {
        do {
            logger.info("Performing semantic search: \(query)", category: "Knowledge")

            let retrievedDocs = try await ragManager.retrieve(query: query)

            // Convert retrieved documents back to KnowledgeItems
            let retrievedIds = Set(retrievedDocs.map { $0.id })
            var result = items.filter { retrievedIds.contains($0.id) }

            // Sort by relevance score (maintain order from RAG results)
            let scoreMap = Dictionary(uniqueKeysWithValues: retrievedDocs.map { ($0.id, $0.score) })
            result.sort { (scoreMap[$0.id] ?? 0) > (scoreMap[$1.id] ?? 0) }

            // Apply additional filters
            if let category = selectedCategory {
                result = result.filter { $0.category == category }
            }

            if let tag = selectedTag {
                result = result.filter { $0.tags.contains(tag) }
            }

            if showFavoritesOnly {
                result = result.filter { $0.isFavorite }
            }

            filteredItems = result
            logger.info("Semantic search returned \(result.count) results", category: "Knowledge")

        } catch {
            logger.error("Semantic search failed, falling back to keyword search", error: error, category: "Knowledge")
            // Fallback to keyword search
            useSemanticSearch = false
            applyFilters()
        }
    }

    func clearFilters() {
        searchText = ""
        selectedCategory = nil
        selectedTag = nil
        showFavoritesOnly = false
        applyFilters()
    }

    // MARK: - CRUD Operations

    func create(title: String, content: String, contentType: KnowledgeItem.ContentType = .text, tags: [String] = [], category: String? = nil) async throws {
        let item = KnowledgeItem(
            title: title,
            content: content,
            contentType: contentType,
            tags: tags,
            category: category
        )

        try repository.create(item)
        items.insert(item, at: 0)
        applyFilters()

        // Add to vector index
        if ragManager.isInitialized {
            Task {
                do {
                    try await ragManager.addToIndex(item)
                    logger.info("Added item to vector index: \(item.id)", category: "Knowledge")
                } catch {
                    logger.error("Failed to add item to vector index", error: error, category: "Knowledge")
                }
            }
        }

        logger.info("Created knowledge item: \(item.id)", category: "Knowledge")
    }

    func update(_ item: KnowledgeItem) async throws {
        try repository.update(item)

        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
        }
        applyFilters()

        // Update vector index
        if ragManager.isInitialized {
            Task {
                do {
                    try await ragManager.updateIndex(item)
                    logger.info("Updated item in vector index: \(item.id)", category: "Knowledge")
                } catch {
                    logger.error("Failed to update item in vector index", error: error, category: "Knowledge")
                }
            }
        }

        logger.info("Updated knowledge item: \(item.id)", category: "Knowledge")
    }

    func delete(id: String) async throws {
        try repository.delete(id: id)
        items.removeAll { $0.id == id }
        applyFilters()

        // Remove from vector index
        if ragManager.isInitialized {
            Task {
                do {
                    try await ragManager.removeFromIndex(id)
                    logger.info("Removed item from vector index: \(id)", category: "Knowledge")
                } catch {
                    logger.error("Failed to remove item from vector index", error: error, category: "Knowledge")
                }
            }
        }

        logger.info("Deleted knowledge item: \(id)", category: "Knowledge")
    }

    func toggleFavorite(id: String) async throws {
        try repository.toggleFavorite(id: id)

        if let index = items.firstIndex(where: { $0.id == id }) {
            items[index].isFavorite.toggle()
        }
        applyFilters()
    }

    func incrementViewCount(id: String) async {
        do {
            try repository.incrementViewCount(id: id)

            if let index = items.firstIndex(where: { $0.id == id }) {
                items[index].viewCount += 1
            }
        } catch {
            logger.error("Failed to increment view count", error: error, category: "Knowledge")
        }
    }

    // MARK: - Search

    func performSearch(_ query: String) async throws {
        guard !query.isEmpty else {
            filteredItems = items
            return
        }

        logger.info("Searching: \(query)", category: "Knowledge")

        if useSemanticSearch && ragManager.isInitialized {
            // Use semantic search
            await performSemanticSearch(query)
        } else {
            // Use keyword search
            let results = try repository.search(query: query)
            filteredItems = results
        }
    }

    // MARK: - Error Handling

    private func handleError(_ error: Error) {
        logger.error("Knowledge error", error: error, category: "Knowledge")
        errorMessage = error.localizedDescription
    }
}
