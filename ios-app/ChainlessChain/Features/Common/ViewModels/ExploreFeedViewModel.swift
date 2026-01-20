import Foundation
import SwiftUI
import CoreCommon
import Combine

// MARK: - Explore Card Models

/// 内容类型筛选
enum ContentFilter: String, CaseIterable {
    case all = "全部"
    case knowledge = "知识库"
    case aiConversation = "AI对话"
    case project = "项目"

    var icon: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .knowledge: return "book.fill"
        case .aiConversation: return "message.fill"
        case .project: return "folder.fill"
        }
    }
}

/// 排序方式
enum SortOption: String, CaseIterable {
    case latest = "最新"
    case mostViewed = "最常访问"
    case favorite = "收藏"

    var icon: String {
        switch self {
        case .latest: return "clock.fill"
        case .mostViewed: return "eye.fill"
        case .favorite: return "star.fill"
        }
    }
}

/// 卡片类型
enum ExploreCardType {
    case knowledge(KnowledgeItem)
    case aiConversation(AIConversationEntity)
    case project(ProjectEntity)
}

/// 统一的卡片数据模型
struct ExploreCardModel: Identifiable {
    let id: String
    let type: ExploreCardType
    let timestamp: Date
    let title: String
    let subtitle: String?
    let preview: String?

    init(type: ExploreCardType) {
        self.type = type

        switch type {
        case .knowledge(let item):
            self.id = "knowledge-\(item.id)"
            self.timestamp = item.updatedAt
            self.title = item.title
            self.subtitle = item.category
            self.preview = item.content.prefix(100).trimmingCharacters(in: .whitespacesAndNewlines)

        case .aiConversation(let conversation):
            self.id = "ai-\(conversation.id)"
            self.timestamp = conversation.updatedAt
            self.title = conversation.title ?? "新对话"
            self.subtitle = conversation.model
            self.preview = "\(conversation.messageCount) 条消息 · \(conversation.totalTokens) tokens"

        case .project(let project):
            self.id = "project-\(project.id)"
            self.timestamp = project.updatedAt
            self.title = project.name
            self.subtitle = project.type.displayName
            self.preview = project.description
        }
    }
}

// MARK: - View Model

@MainActor
class ExploreFeedViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var cards: [ExploreCardModel] = []
    @Published var isLoading = false
    @Published var searchText = ""
    @Published var selectedFilter: ContentFilter = .all
    @Published var selectedSort: SortOption = .latest
    @Published var errorMessage: String?

    // MARK: - Private Properties

    private let knowledgeRepo = KnowledgeRepository.shared
    private let aiConversationRepo = AIConversationRepository.shared
    private let projectRepo = ProjectRepository.shared
    private let logger = Logger.shared

    private var cancellables = Set<AnyCancellable>()
    private var currentPage = 0
    private let pageSize = 20
    private var hasLoadedAll = false

    // Raw data cache
    private var allKnowledgeItems: [KnowledgeItem] = []
    private var allAIConversations: [AIConversationEntity] = []
    private var allProjects: [ProjectEntity] = []

    // MARK: - Initialization

    init() {
        setupSearchDebounce()
    }

    // MARK: - Public Methods

    /// 初始加载数据
    func loadFeed() async {
        guard !isLoading else { return }

        isLoading = true
        errorMessage = nil
        currentPage = 0
        hasLoadedAll = false

        do {
            try await loadAllData()
            applyFiltersAndSort()
        } catch {
            logger.error("Failed to load explore feed", error: error, category: "Explore")
            errorMessage = "加载失败: \(error.localizedDescription)"
        }

        isLoading = false
    }

    /// 刷新数据
    func refresh() async {
        await loadFeed()
    }

    /// 加载更多数据（分页）
    func loadMore() {
        guard !hasLoadedAll && !isLoading else { return }

        currentPage += 1
        applyFiltersAndSort()
    }

    /// 应用筛选和排序
    func applyFiltersAndSort() {
        var filteredCards: [ExploreCardModel] = []

        // 根据筛选器选择数据源
        switch selectedFilter {
        case .all:
            filteredCards = createAllCards()
        case .knowledge:
            filteredCards = allKnowledgeItems.map { ExploreCardModel(type: .knowledge($0)) }
        case .aiConversation:
            filteredCards = allAIConversations.map { ExploreCardModel(type: .aiConversation($0)) }
        case .project:
            filteredCards = allProjects.map { ExploreCardModel(type: .project($0)) }
        }

        // 应用搜索过滤
        if !searchText.isEmpty && searchText.count >= 2 {
            filteredCards = filteredCards.filter { card in
                searchMatches(card: card, query: searchText.lowercased())
            }
        }

        // 应用排序
        filteredCards = sortCards(filteredCards)

        // 应用分页
        let endIndex = min((currentPage + 1) * pageSize, filteredCards.count)
        cards = Array(filteredCards.prefix(endIndex))

        hasLoadedAll = endIndex >= filteredCards.count
    }

    // MARK: - Private Methods

    /// 从所有数据源加载数据
    private func loadAllData() async throws {
        async let knowledgeTask = loadKnowledgeItems()
        async let conversationsTask = loadAIConversations()
        async let projectsTask = loadProjects()

        _ = try await (knowledgeTask, conversationsTask, projectsTask)
    }

    /// 加载知识库数据
    private func loadKnowledgeItems() async throws {
        allKnowledgeItems = try knowledgeRepo.getAllItems(
            category: nil,
            isFavorite: selectedSort == .favorite ? true : nil,
            limit: 100,
            offset: 0
        )
    }

    /// 加载AI对话数据
    private func loadAIConversations() async throws {
        allAIConversations = try aiConversationRepo.getAllConversations(limit: 100, offset: 0)
    }

    /// 加载项目数据
    private func loadProjects() async throws {
        allProjects = try projectRepo.getAllProjects(limit: 100, offset: 0)
    }

    /// 创建所有类型的卡片
    private func createAllCards() -> [ExploreCardModel] {
        var cards: [ExploreCardModel] = []

        cards += allKnowledgeItems.map { ExploreCardModel(type: .knowledge($0)) }
        cards += allAIConversations.map { ExploreCardModel(type: .aiConversation($0)) }
        cards += allProjects.map { ExploreCardModel(type: .project($0)) }

        return cards
    }

    /// 搜索匹配
    private func searchMatches(card: ExploreCardModel, query: String) -> Bool {
        let searchableText = [
            card.title,
            card.subtitle ?? "",
            card.preview ?? ""
        ].joined(separator: " ").lowercased()

        // 支持多关键词搜索
        let keywords = query.split(separator: " ").map { String($0) }
        return keywords.allSatisfy { searchableText.contains($0) }
    }

    /// 排序卡片
    private func sortCards(_ cards: [ExploreCardModel]) -> [ExploreCardModel] {
        switch selectedSort {
        case .latest:
            return cards.sorted { $0.timestamp > $1.timestamp }

        case .mostViewed:
            return cards.sorted { card1, card2 in
                let views1 = getViewCount(for: card1)
                let views2 = getViewCount(for: card2)
                return views1 > views2
            }

        case .favorite:
            return cards.filter { isFavorite($0) }
                .sorted { $0.timestamp > $1.timestamp }
        }
    }

    /// 获取查看次数
    private func getViewCount(for card: ExploreCardModel) -> Int {
        switch card.type {
        case .knowledge(let item):
            return item.viewCount
        case .aiConversation(let conversation):
            return conversation.messageCount
        case .project(let project):
            return project.fileCount
        }
    }

    /// 检查是否收藏
    private func isFavorite(_ card: ExploreCardModel) -> Bool {
        switch card.type {
        case .knowledge(let item):
            return item.isFavorite
        case .aiConversation:
            return false // AI对话目前没有收藏功能
        case .project:
            return false // 项目目前没有收藏功能
        }
    }

    /// 设置搜索防抖
    private func setupSearchDebounce() {
        $searchText
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.applyFiltersAndSort()
            }
            .store(in: &cancellables)
    }
}

// MARK: - Statistics

extension ExploreFeedViewModel {
    /// 获取统计信息
    var statistics: ExploreStatistics {
        ExploreStatistics(
            totalKnowledge: allKnowledgeItems.count,
            totalConversations: allAIConversations.count,
            totalProjects: allProjects.count,
            favoriteKnowledge: allKnowledgeItems.filter { $0.isFavorite }.count
        )
    }
}

struct ExploreStatistics {
    let totalKnowledge: Int
    let totalConversations: Int
    let totalProjects: Int
    let favoriteKnowledge: Int

    var total: Int {
        totalKnowledge + totalConversations + totalProjects
    }
}
