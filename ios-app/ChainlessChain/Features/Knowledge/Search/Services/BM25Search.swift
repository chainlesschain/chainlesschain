import Foundation
import CoreCommon

/// BM25 全文搜索引擎
///
/// 基于 Okapi BM25 算法实现关键词匹配搜索
/// 用于与 Vector Search 结合，提升混合搜索的召回率
///
/// BM25 算法:
/// score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgdl))
///
/// 参考:
/// - https://en.wikipedia.org/wiki/Okapi_BM25
/// - desktop-app-vue/src/main/rag/bm25-search.js
///
public class BM25Search {

    // MARK: - Singleton

    public static let shared = BM25Search()

    // MARK: - Configuration

    private var config: BM25Config

    // MARK: - Index State

    /// 文档列表
    private var documents: [SearchDocument] = []

    /// 文档索引 (id -> index)
    private var documentIndex: [String: Int] = [:]

    /// 文档索引条目
    private var indexEntries: [DocumentIndexEntry] = []

    /// 平均文档长度
    private var avgDocLength: Double = 0

    /// 逆文档频率缓存
    private var idfCache: [String: Double] = [:]

    /// 分词器
    private lazy var tokenizer: Tokenizer = {
        Tokenizer(config: config)
    }()

    // MARK: - Statistics

    private(set) var stats = SearchStats()

    // MARK: - Initialization

    private init() {
        self.config = BM25Config()
        Logger.shared.info("[BM25Search] 初始化完成 k1=\(config.k1) b=\(config.b)")
    }

    /// 配置 BM25 参数
    public func configure(_ config: BM25Config) {
        self.config = config
        self.tokenizer = Tokenizer(config: config)
        self.idfCache.removeAll()

        stats.k1 = config.k1
        stats.b = config.b

        Logger.shared.info("[BM25Search] 配置已更新 k1=\(config.k1) b=\(config.b)")
    }

    // MARK: - Indexing

    /// 索引文档列表
    /// - Parameter documents: 文档数组
    public func indexDocuments(_ documents: [SearchDocument]) {
        Logger.shared.info("[BM25Search] 开始索引 \(documents.count) 个文档")

        // 清空现有索引
        clear()

        // 添加文档
        for (idx, doc) in documents.enumerated() {
            self.documents.append(doc)
            self.documentIndex[doc.id] = idx

            // 分词并建立索引
            let tokens = tokenize(doc.content)
            let entry = DocumentIndexEntry(documentId: doc.id, tokens: tokens)
            self.indexEntries.append(entry)
        }

        // 计算平均文档长度
        if !indexEntries.isEmpty {
            let totalLength = indexEntries.reduce(0) { $0 + $1.tokenCount }
            avgDocLength = Double(totalLength) / Double(indexEntries.count)
        }

        // 更新统计
        stats.documentCount = documents.count
        stats.avgDocLength = avgDocLength

        Logger.shared.info("[BM25Search] 索引完成，文档数=\(documents.count)，平均长度=\(Int(avgDocLength))")
    }

    /// 添加单个文档
    public func addDocument(_ document: SearchDocument) {
        let idx = documents.count
        documents.append(document)
        documentIndex[document.id] = idx

        // 分词并建立索引
        let tokens = tokenize(document.content)
        let entry = DocumentIndexEntry(documentId: document.id, tokens: tokens)
        indexEntries.append(entry)

        // 重新计算平均长度
        let totalLength = indexEntries.reduce(0) { $0 + $1.tokenCount }
        avgDocLength = Double(totalLength) / Double(indexEntries.count)

        // 清除 IDF 缓存（因为文档数变了）
        idfCache.removeAll()

        stats.documentCount = documents.count
        stats.avgDocLength = avgDocLength

        Logger.shared.info("[BM25Search] 添加文档: \(document.id)")
    }

    /// 移除文档
    public func removeDocument(_ documentId: String) {
        guard let idx = documentIndex[documentId] else {
            Logger.shared.warning("[BM25Search] 文档不存在: \(documentId)")
            return
        }

        // 从数组移除
        documents.remove(at: idx)
        indexEntries.remove(at: idx)
        documentIndex.removeValue(forKey: documentId)

        // 重建索引映射
        documentIndex.removeAll()
        for (i, doc) in documents.enumerated() {
            documentIndex[doc.id] = i
        }

        // 重新计算平均长度
        if !indexEntries.isEmpty {
            let totalLength = indexEntries.reduce(0) { $0 + $1.tokenCount }
            avgDocLength = Double(totalLength) / Double(indexEntries.count)
        } else {
            avgDocLength = 0
        }

        // 清除 IDF 缓存
        idfCache.removeAll()

        stats.documentCount = documents.count
        stats.avgDocLength = avgDocLength

        Logger.shared.info("[BM25Search] 移除文档: \(documentId)")
    }

    /// 清空索引
    public func clear() {
        documents.removeAll()
        documentIndex.removeAll()
        indexEntries.removeAll()
        idfCache.removeAll()
        avgDocLength = 0

        stats.documentCount = 0
        stats.avgDocLength = 0

        Logger.shared.info("[BM25Search] 索引已清空")
    }

    // MARK: - Search

    /// 搜索文档
    /// - Parameters:
    ///   - query: 查询字符串
    ///   - options: 搜索选项
    /// - Returns: 搜索结果数组
    public func search(_ query: String, options: SearchOptions = SearchOptions()) -> [SearchResult] {
        let startTime = Date()

        guard !documents.isEmpty else {
            Logger.shared.warning("[BM25Search] 索引为空，无法搜索")
            return []
        }

        // 分词
        let queryTokens = tokenize(query)

        guard !queryTokens.isEmpty else {
            Logger.shared.warning("[BM25Search] 查询分词为空")
            return []
        }

        // 计算每个文档的 BM25 分数
        var results: [SearchResult] = []

        for (docIdx, entry) in indexEntries.enumerated() {
            let score = calculateBM25Score(queryTokens: queryTokens, docIdx: docIdx)

            if score > options.threshold {
                var result = SearchResult(
                    document: documents[docIdx],
                    score: score,
                    source: .bm25
                )
                result.bm25Score = score
                results.append(result)
            }
        }

        // 按分数降序排序
        results.sort { $0.score > $1.score }

        // 返回 top-k
        let finalResults = Array(results.prefix(options.limit))

        // 更新统计
        let elapsed = Date().timeIntervalSince(startTime) * 1000
        stats.bm25Searches += 1
        stats.totalSearches += 1
        stats.avgLatencyMs = (stats.avgLatencyMs * Double(stats.totalSearches - 1) + elapsed) / Double(stats.totalSearches)

        Logger.shared.info("[BM25Search] 搜索完成，耗时=\(Int(elapsed))ms，结果数=\(finalResults.count)")

        return finalResults
    }

    // MARK: - BM25 Algorithm

    /// 计算 BM25 分数
    /// - Parameters:
    ///   - queryTokens: 查询词列表
    ///   - docIdx: 文档索引
    /// - Returns: BM25 分数
    private func calculateBM25Score(queryTokens: [String], docIdx: Int) -> Double {
        let N = Double(documents.count)
        let entry = indexEntries[docIdx]
        let docLength = Double(entry.tokenCount)

        var score: Double = 0

        for term in queryTokens {
            // 词频 (TF)
            let tf = Double(entry.termFrequencies[term] ?? 0)

            // 逆文档频率 (IDF)
            let idf = getIDF(term: term, N: N)

            // BM25 公式
            let numerator = tf * (config.k1 + 1)
            let denominator = tf + config.k1 * (1 - config.b + config.b * docLength / avgDocLength)

            score += idf * (numerator / denominator)
        }

        return score
    }

    /// 获取逆文档频率 (IDF)
    /// - Parameters:
    ///   - term: 词项
    ///   - N: 文档总数
    /// - Returns: IDF 值
    private func getIDF(term: String, N: Double) -> Double {
        // 检查缓存
        if let cached = idfCache[term] {
            return cached
        }

        // 计算文档频率 (DF)
        let df = Double(getDocumentFrequency(term))

        // IDF 公式: log((N - df + 0.5) / (df + 0.5) + 1)
        let idf = log((N - df + 0.5) / (df + 0.5) + 1)

        // 缓存
        idfCache[term] = idf

        return idf
    }

    /// 获取文档频率 (包含该词的文档数)
    private func getDocumentFrequency(_ term: String) -> Int {
        var count = 0

        for entry in indexEntries {
            if entry.termFrequencies[term] != nil {
                count += 1
            }
        }

        return count
    }

    // MARK: - Tokenization

    /// 分词
    private func tokenize(_ text: String) -> [String] {
        return tokenizer.tokenize(text)
    }

    // MARK: - Statistics

    /// 获取统计信息
    public func getStats() -> SearchStats {
        return stats
    }
}

// MARK: - Tokenizer

/// 分词器
class Tokenizer {
    private let config: BM25Config

    /// 中文停用词
    private let chineseStopwords: Set<String> = [
        "的", "了", "和", "是", "就", "都", "而", "及", "与", "着",
        "或", "一个", "没有", "我们", "你们", "他们", "它们", "这个",
        "那个", "这些", "那些", "之", "以", "为", "于", "但", "等"
    ]

    /// 英文停用词
    private let englishStopwords: Set<String> = [
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to",
        "for", "of", "with", "by", "from", "is", "are", "was", "were",
        "be", "been", "being", "have", "has", "had", "do", "does", "did",
        "will", "would", "could", "should", "may", "might", "must",
        "this", "that", "these", "those", "it", "its", "i", "you", "he",
        "she", "we", "they", "my", "your", "his", "her", "our", "their"
    ]

    init(config: BM25Config) {
        self.config = config
    }

    /// 分词
    func tokenize(_ text: String) -> [String] {
        let language = detectLanguage(text)

        switch language {
        case .chinese:
            return tokenizeChinese(text)
        case .english:
            return tokenizeEnglish(text)
        case .auto:
            // 混合分词
            return tokenizeMixed(text)
        }
    }

    /// 检测语言
    private func detectLanguage(_ text: String) -> BM25Config.Language {
        if config.language != .auto {
            return config.language
        }

        var chineseCount = 0
        var totalCount = 0

        for char in text where !char.isWhitespace && !char.isPunctuation {
            totalCount += 1
            if char.isChineseCharacter {
                chineseCount += 1
            }
        }

        guard totalCount > 0 else { return .english }

        // 如果中文字符超过 30%，使用中文分词
        return Double(chineseCount) / Double(totalCount) > 0.3 ? .chinese : .english
    }

    /// 中文分词
    private func tokenizeChinese(_ text: String) -> [String] {
        var tokens: [String] = []

        // 移除标点和特殊字符
        let cleaned = text.replacingOccurrences(
            of: "[，。！？；：""''（）《》、\\s]+",
            with: " ",
            options: .regularExpression
        )

        // 分割为单字
        for char in cleaned {
            let str = String(char)
            if str.trimmingCharacters(in: .whitespaces).isEmpty {
                continue
            }
            if !chineseStopwords.contains(str) {
                tokens.append(str)
            }
        }

        // 添加连续中文作为词组 (bigram)
        let chars = Array(cleaned.filter { !$0.isWhitespace })
        for i in 0..<(chars.count - 1) {
            let bigram = String(chars[i]) + String(chars[i + 1])
            if bigram.allSatisfy({ $0.isChineseCharacter }) {
                tokens.append(bigram)
            }
        }

        // 分割为词组 (按空格)
        let words = cleaned.components(separatedBy: .whitespaces)
            .filter { $0.count > 1 && !chineseStopwords.contains($0) }
        tokens.append(contentsOf: words)

        return Array(Set(tokens)).filter { $0.count >= config.minTokenLength }
    }

    /// 英文分词
    private func tokenizeEnglish(_ text: String) -> [String] {
        // 转小写并分割
        let lowercased = text.lowercased()

        // 移除标点，按空格分割
        let cleaned = lowercased.replacingOccurrences(
            of: "[^a-z0-9\\s]",
            with: " ",
            options: .regularExpression
        )

        let words = cleaned.components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty && !englishStopwords.contains($0) }

        return words.filter { $0.count >= config.minTokenLength }
    }

    /// 混合分词 (中英文混合)
    private func tokenizeMixed(_ text: String) -> [String] {
        var tokens: [String] = []

        // 分离中英文
        var currentChineseSegment = ""
        var currentEnglishSegment = ""

        for char in text {
            if char.isChineseCharacter {
                // 处理之前的英文段
                if !currentEnglishSegment.isEmpty {
                    tokens.append(contentsOf: tokenizeEnglish(currentEnglishSegment))
                    currentEnglishSegment = ""
                }
                currentChineseSegment.append(char)
            } else if char.isLetter || char.isNumber {
                // 处理之前的中文段
                if !currentChineseSegment.isEmpty {
                    tokens.append(contentsOf: tokenizeChinese(currentChineseSegment))
                    currentChineseSegment = ""
                }
                currentEnglishSegment.append(char)
            } else {
                // 标点或空格，处理之前的段落
                if !currentChineseSegment.isEmpty {
                    tokens.append(contentsOf: tokenizeChinese(currentChineseSegment))
                    currentChineseSegment = ""
                }
                if !currentEnglishSegment.isEmpty {
                    tokens.append(contentsOf: tokenizeEnglish(currentEnglishSegment))
                    currentEnglishSegment = ""
                }
            }
        }

        // 处理剩余部分
        if !currentChineseSegment.isEmpty {
            tokens.append(contentsOf: tokenizeChinese(currentChineseSegment))
        }
        if !currentEnglishSegment.isEmpty {
            tokens.append(contentsOf: tokenizeEnglish(currentEnglishSegment))
        }

        return Array(Set(tokens))
    }
}

// MARK: - Character Extension

private extension Character {
    /// 判断是否为中文字符
    var isChineseCharacter: Bool {
        guard let scalar = unicodeScalars.first else { return false }

        // CJK Unified Ideographs
        if (0x4E00...0x9FFF).contains(scalar.value) { return true }

        // CJK Unified Ideographs Extension A
        if (0x3400...0x4DBF).contains(scalar.value) { return true }

        // CJK Unified Ideographs Extension B
        if (0x20000...0x2A6DF).contains(scalar.value) { return true }

        return false
    }
}
