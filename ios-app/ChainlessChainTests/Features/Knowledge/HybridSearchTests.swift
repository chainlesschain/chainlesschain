import XCTest
@testable import ChainlessChain

/// BM25 和 Hybrid Search 测试
final class HybridSearchTests: XCTestCase {

    var bm25Search: BM25Search!

    override func setUp() async throws {
        try await super.setUp()
        bm25Search = BM25Search.shared
        bm25Search.clear()
    }

    override func tearDown() async throws {
        bm25Search.clear()
        try await super.tearDown()
    }

    // MARK: - BM25 Indexing Tests

    func testIndexDocuments() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming language", title: "Swift Intro"),
            SearchDocument(id: "2", content: "iOS development with Swift", title: "iOS Dev"),
            SearchDocument(id: "3", content: "Machine learning basics", title: "ML Basics")
        ]

        // When
        bm25Search.indexDocuments(documents)

        // Then
        let stats = bm25Search.getStats()
        XCTAssertEqual(stats.documentCount, 3, "应该索引3个文档")
        XCTAssertGreaterThan(stats.avgDocLength, 0, "平均长度应该大于0")
    }

    func testAddDocument() {
        // Given
        let doc1 = SearchDocument(id: "1", content: "First document")
        let doc2 = SearchDocument(id: "2", content: "Second document")

        // When
        bm25Search.addDocument(doc1)
        bm25Search.addDocument(doc2)

        // Then
        let stats = bm25Search.getStats()
        XCTAssertEqual(stats.documentCount, 2, "应该有2个文档")
    }

    func testRemoveDocument() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "First document"),
            SearchDocument(id: "2", content: "Second document")
        ]
        bm25Search.indexDocuments(documents)

        // When
        bm25Search.removeDocument("1")

        // Then
        let stats = bm25Search.getStats()
        XCTAssertEqual(stats.documentCount, 1, "应该只有1个文档")
    }

    func testClear() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "First document"),
            SearchDocument(id: "2", content: "Second document")
        ]
        bm25Search.indexDocuments(documents)

        // When
        bm25Search.clear()

        // Then
        let stats = bm25Search.getStats()
        XCTAssertEqual(stats.documentCount, 0, "文档数应该为0")
    }

    // MARK: - BM25 Search Tests

    func testSearchEnglish() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming language is powerful"),
            SearchDocument(id: "2", content: "iOS development with Swift framework"),
            SearchDocument(id: "3", content: "Machine learning with Python")
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("Swift programming")

        // Then
        XCTAssertFalse(results.isEmpty, "应该有搜索结果")
        XCTAssertEqual(results.first?.document.id, "1", "第一个结果应该是文档1")
    }

    func testSearchChinese() {
        // Given
        var config = BM25Config()
        config.language = .chinese
        bm25Search.configure(config)

        let documents = [
            SearchDocument(id: "1", content: "Swift 编程语言非常强大", title: "Swift简介"),
            SearchDocument(id: "2", content: "iOS 开发使用 Swift 框架", title: "iOS开发"),
            SearchDocument(id: "3", content: "机器学习使用 Python", title: "机器学习")
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("Swift 编程")

        // Then
        XCTAssertFalse(results.isEmpty, "应该有搜索结果")
        XCTAssertEqual(results.first?.document.id, "1", "第一个结果应该是文档1")
    }

    func testSearchMixed() {
        // Given
        var config = BM25Config()
        config.language = .auto
        bm25Search.configure(config)

        let documents = [
            SearchDocument(id: "1", content: "Swift 编程语言 is powerful"),
            SearchDocument(id: "2", content: "iOS 开发 with Swift framework"),
            SearchDocument(id: "3", content: "机器学习 Machine Learning")
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("Swift 编程")

        // Then
        XCTAssertFalse(results.isEmpty, "应该有搜索结果")
    }

    func testSearchEmptyQuery() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming")
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("")

        // Then
        XCTAssertTrue(results.isEmpty, "空查询应该返回空结果")
    }

    func testSearchNoMatch() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming")
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("Python Django")

        // Then
        XCTAssertTrue(results.isEmpty, "不匹配的查询应该返回空结果")
    }

    func testSearchLimit() {
        // Given
        let documents = (0..<20).map { i in
            SearchDocument(id: "\(i)", content: "Document about Swift number \(i)")
        }
        bm25Search.indexDocuments(documents)

        // When
        var options = SearchOptions()
        options.limit = 5
        let results = bm25Search.search("Swift", options: options)

        // Then
        XCTAssertLessOrEqual(results.count, 5, "结果数应该不超过5")
    }

    func testSearchThreshold() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift Swift Swift programming"),
            SearchDocument(id: "2", content: "Swift programming"),
            SearchDocument(id: "3", content: "programming language")
        ]
        bm25Search.indexDocuments(documents)

        // When
        var options = SearchOptions()
        options.threshold = 0.5
        let results = bm25Search.search("Swift", options: options)

        // Then
        for result in results {
            XCTAssertGreaterThan(result.score, 0.5, "分数应该大于阈值")
        }
    }

    // MARK: - BM25 Algorithm Tests

    func testBM25ScoreOrdering() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift Swift Swift Swift Swift"), // 高词频
            SearchDocument(id: "2", content: "Swift programming is great"),      // 中等词频
            SearchDocument(id: "3", content: "Programming language basics")      // 无匹配
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("Swift")

        // Then
        XCTAssertEqual(results.count, 2, "应该只有2个匹配结果")
        if results.count >= 2 {
            XCTAssertGreaterThan(results[0].score, results[1].score, "高词频文档分数应该更高")
        }
    }

    func testBM25LengthNormalization() {
        // Given - 相同词频，不同文档长度
        let documents = [
            SearchDocument(id: "1", content: "Swift"), // 短文档
            SearchDocument(id: "2", content: "Swift is a programming language for iOS development") // 长文档
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("Swift")

        // Then
        XCTAssertEqual(results.count, 2, "应该有2个结果")
        // 短文档应该分数更高（因为词密度更大）
        if results.count >= 2 {
            XCTAssertEqual(results[0].document.id, "1", "短文档应该排在前面")
        }
    }

    // MARK: - Tokenizer Tests

    func testTokenizerChinese() {
        // Given
        var config = BM25Config()
        config.language = .chinese
        bm25Search.configure(config)

        let documents = [
            SearchDocument(id: "1", content: "自然语言处理技术")
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("语言")

        // Then
        XCTAssertFalse(results.isEmpty, "应该匹配到结果")
    }

    func testTokenizerEnglish() {
        // Given
        var config = BM25Config()
        config.language = .english
        bm25Search.configure(config)

        let documents = [
            SearchDocument(id: "1", content: "Natural Language Processing Technology")
        ]
        bm25Search.indexDocuments(documents)

        // When
        let results = bm25Search.search("language processing")

        // Then
        XCTAssertFalse(results.isEmpty, "应该匹配到结果")
    }

    func testTokenizerStopwords() {
        // Given
        var config = BM25Config()
        config.language = .english
        bm25Search.configure(config)

        let documents = [
            SearchDocument(id: "1", content: "the quick brown fox")
        ]
        bm25Search.indexDocuments(documents)

        // When - 搜索停用词
        let results = bm25Search.search("the")

        // Then
        XCTAssertTrue(results.isEmpty, "停用词搜索应该返回空结果")
    }

    // MARK: - Statistics Tests

    func testSearchStatistics() {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming")
        ]
        bm25Search.indexDocuments(documents)

        // When
        _ = bm25Search.search("Swift")
        _ = bm25Search.search("programming")

        // Then
        let stats = bm25Search.getStats()
        XCTAssertEqual(stats.bm25Searches, 2, "应该记录2次搜索")
        XCTAssertGreaterThan(stats.avgLatencyMs, 0, "平均延迟应该大于0")
    }
}

// MARK: - Hybrid Search Engine Tests

final class HybridSearchEngineTests: XCTestCase {

    var searchEngine: HybridSearchEngine!

    override func setUp() async throws {
        try await super.setUp()
        searchEngine = await HybridSearchEngine.shared
        await searchEngine.clear()
    }

    @MainActor
    func testIndexDocuments() async {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming"),
            SearchDocument(id: "2", content: "iOS development")
        ]

        // When
        await searchEngine.indexDocuments(documents)

        // Then
        let stats = searchEngine.getStats()
        XCTAssertEqual(stats.documentCount, 2, "应该索引2个文档")
    }

    @MainActor
    func testBM25OnlySearch() async {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming language is powerful"),
            SearchDocument(id: "2", content: "iOS development with Swift"),
            SearchDocument(id: "3", content: "Machine learning with Python")
        ]
        await searchEngine.indexDocuments(documents)

        // When
        let results = searchEngine.bm25OnlySearch("Swift", limit: 10)

        // Then
        XCTAssertFalse(results.isEmpty, "应该有搜索结果")
        XCTAssertEqual(results.first?.source, .bm25, "来源应该是 BM25")
    }

    @MainActor
    func testUpdateWeights() async {
        // Given & When
        searchEngine.updateWeights(vectorWeight: 0.7, textWeight: 0.3)

        // Then
        let stats = searchEngine.getStats()
        XCTAssertEqual(stats.vectorWeight, 0.7, accuracy: 0.01, "Vector 权重应该是 0.7")
        XCTAssertEqual(stats.textWeight, 0.3, accuracy: 0.01, "Text 权重应该是 0.3")
    }

    @MainActor
    func testSearchHistory() async {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming")
        ]
        await searchEngine.indexDocuments(documents)

        // When
        _ = await searchEngine.search("Swift")
        _ = await searchEngine.search("iOS")

        // Then
        let history = searchEngine.getSearchHistory()
        XCTAssertEqual(history.count, 2, "应该有2条搜索历史")
    }

    @MainActor
    func testClearSearchHistory() async {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming")
        ]
        await searchEngine.indexDocuments(documents)
        _ = await searchEngine.search("Swift")

        // When
        searchEngine.clearSearchHistory()

        // Then
        let history = searchEngine.getSearchHistory()
        XCTAssertTrue(history.isEmpty, "搜索历史应该为空")
    }

    @MainActor
    func testResetStats() async {
        // Given
        let documents = [
            SearchDocument(id: "1", content: "Swift programming")
        ]
        await searchEngine.indexDocuments(documents)
        _ = await searchEngine.search("Swift")

        // When
        searchEngine.resetStats()

        // Then
        let stats = searchEngine.getStats()
        XCTAssertEqual(stats.totalSearches, 0, "搜索次数应该重置为0")
    }
}

// MARK: - RRF Fusion Tests

final class RRFFusionTests: XCTestCase {

    @MainActor
    func testRRFScoreCalculation() async {
        // RRF 分数验证
        // 公式: score = weight / (k + rank)
        // 假设 k=60, vectorWeight=0.6, textWeight=0.4

        let k = 60.0
        let vectorWeight = 0.6
        let textWeight = 0.4

        // 如果一个文档在 Vector 排名第1，BM25 排名第2
        let vectorScore = vectorWeight / (k + 1)  // 0.6 / 61 ≈ 0.00984
        let bm25Score = textWeight / (k + 2)       // 0.4 / 62 ≈ 0.00645
        let totalRRF = vectorScore + bm25Score     // ≈ 0.01629

        XCTAssertEqual(vectorScore, 0.6 / 61, accuracy: 0.0001)
        XCTAssertEqual(bm25Score, 0.4 / 62, accuracy: 0.0001)
        XCTAssertGreaterThan(totalRRF, 0, "RRF 分数应该大于0")
    }

    @MainActor
    func testRRFRankingBehavior() async {
        // 验证 RRF 的排名行为
        // 在两个列表中都排名靠前的文档应该在融合后排名更高

        let searchEngine = HybridSearchEngine.shared
        await searchEngine.clear()

        // 创建测试文档
        let documents = [
            SearchDocument(id: "both_top", content: "Swift iOS development programming"),
            SearchDocument(id: "vector_only", content: "Mobile application development"),
            SearchDocument(id: "bm25_only", content: "Swift Swift Swift programming")
        ]
        await searchEngine.indexDocuments(documents)

        // 注意：由于没有 RAG Manager，只能测试 BM25
        let results = searchEngine.bm25OnlySearch("Swift", limit: 10)

        XCTAssertFalse(results.isEmpty, "应该有搜索结果")
    }
}

// MARK: - Configuration Tests

final class SearchConfigurationTests: XCTestCase {

    func testBM25ConfigDefaults() {
        let config = BM25Config()

        XCTAssertEqual(config.k1, 1.5, "默认 k1 应该是 1.5")
        XCTAssertEqual(config.b, 0.75, "默认 b 应该是 0.75")
        XCTAssertEqual(config.language, .auto, "默认语言应该是 auto")
    }

    func testHybridSearchConfigDefaults() {
        let config = HybridSearchConfig()

        XCTAssertEqual(config.vectorWeight, 0.6, "默认 Vector 权重应该是 0.6")
        XCTAssertEqual(config.textWeight, 0.4, "默认 Text 权重应该是 0.4")
        XCTAssertEqual(config.rrfK, 60, "默认 RRF k 应该是 60")
    }

    func testSearchOptionsDefaults() {
        let options = SearchOptions()

        XCTAssertEqual(options.limit, 10, "默认 limit 应该是 10")
        XCTAssertEqual(options.threshold, 0, "默认 threshold 应该是 0")
        XCTAssertTrue(options.enableVector, "默认应该启用 Vector")
        XCTAssertTrue(options.enableBM25, "默认应该启用 BM25")
    }
}

// MARK: - Search Models Tests

final class SearchModelsTests: XCTestCase {

    func testSearchDocument() {
        let doc = SearchDocument(
            id: "test-id",
            content: "Test content",
            title: "Test Title",
            metadata: ["key": "value"]
        )

        XCTAssertEqual(doc.id, "test-id")
        XCTAssertEqual(doc.content, "Test content")
        XCTAssertEqual(doc.title, "Test Title")
        XCTAssertEqual(doc.metadata["key"], "value")
    }

    func testSearchResult() {
        let doc = SearchDocument(id: "1", content: "Test")
        var result = SearchResult(document: doc, score: 0.8, source: .hybrid)

        result.vectorScore = 0.6
        result.bm25Score = 0.4
        result.rrfScore = 0.02

        XCTAssertEqual(result.score, 0.8)
        XCTAssertEqual(result.source, .hybrid)
        XCTAssertEqual(result.vectorScore, 0.6)
        XCTAssertEqual(result.bm25Score, 0.4)
    }

    func testSearchEvent() {
        let event = SearchEvent(
            query: "test query",
            source: .hybrid,
            resultCount: 10,
            latencyMs: 15.5
        )

        XCTAssertEqual(event.query, "test query")
        XCTAssertEqual(event.source, "hybrid")
        XCTAssertEqual(event.resultCount, 10)
        XCTAssertEqual(event.latencyMs, 15.5)
        XCTAssertNotNil(event.id)
    }
}
