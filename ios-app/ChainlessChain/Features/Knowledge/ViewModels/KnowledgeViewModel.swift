import Foundation
import SwiftUI
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
    @Published var errorMessage: String?
    @Published var statistics: KnowledgeStatistics?
    @Published var useSemanticSearch = false // Toggle for semantic search

    @Published var categories: [String] = []
    @Published var tags: [String] = []

    private let repository = KnowledgeRepository.shared
    private let logger = Logger.shared
    private let ragManager = RAGManager.shared

    init() {
        // Set repository for RAG manager
        ragManager.setKnowledgeRepository(repository)

        Task {
            await loadInitialData()
            await initializeRAG()
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
        logger.info("Loading knowledge items", category: "Knowledge")

        let items = try repository.getAll(limit: 1000)
        self.items = items
        applyFilters()

        logger.info("Loaded \(items.count) items", category: "Knowledge")
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
