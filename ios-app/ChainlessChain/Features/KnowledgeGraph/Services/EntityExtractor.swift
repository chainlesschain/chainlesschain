import Foundation
import NaturalLanguage
import CoreCommon

// MARK: - Entity Types

/// 实体类型
public enum EntityType: String, Codable, CaseIterable {
    case person = "person"               // 人名
    case organization = "organization"   // 组织机构
    case location = "location"           // 地点
    case date = "date"                   // 日期
    case time = "time"                   // 时间
    case concept = "concept"             // 概念
    case technology = "technology"       // 技术
    case product = "product"             // 产品
    case event = "event"                 // 事件
    case url = "url"                     // URL
    case tag = "tag"                     // 标签

    public var displayName: String {
        switch self {
        case .person: return "人名"
        case .organization: return "组织"
        case .location: return "地点"
        case .date: return "日期"
        case .time: return "时间"
        case .concept: return "概念"
        case .technology: return "技术"
        case .product: return "产品"
        case .event: return "事件"
        case .url: return "链接"
        case .tag: return "标签"
        }
    }
}

/// 关系类型
public enum EntityRelationType: String, Codable, CaseIterable {
    case mentions = "mentions"           // 提及
    case relatedTo = "related_to"        // 相关
    case partOf = "part_of"              // 部分
    case causedBy = "caused_by"          // 因果
    case locatedIn = "located_in"        // 位于
    case worksFor = "works_for"          // 工作于
    case createdBy = "created_by"        // 创建者
    case uses = "uses"                   // 使用
    case contains = "contains"           // 包含
    case references = "references"       // 引用
}

// MARK: - Entity

/// 提取的实体
public struct ExtractedEntity: Identifiable, Codable {
    public let id: String
    public let type: EntityType
    public let value: String
    public let start: Int
    public let end: Int
    public var confidence: Double

    public init(
        id: String = UUID().uuidString,
        type: EntityType,
        value: String,
        start: Int,
        end: Int,
        confidence: Double = 1.0
    ) {
        self.id = id
        self.type = type
        self.value = value
        self.start = start
        self.end = end
        self.confidence = confidence
    }
}

/// 实体关系
public struct EntityRelation: Codable {
    public let source: String
    public let target: String
    public let type: EntityRelationType
    public var weight: Double

    public init(source: String, target: String, type: EntityRelationType, weight: Double = 1.0) {
        self.source = source
        self.target = target
        self.type = type
        self.weight = weight
    }
}

/// 关键词
public struct Keyword: Codable {
    public let word: String
    public let frequency: Int
    public let score: Double
}

/// 提取结果
public struct ExtractionResult {
    public let entities: [ExtractedEntity]
    public let relations: [EntityRelation]
    public let keywords: [Keyword]
    public let wikiLinks: [WikiLink]
    public let summary: String

    public struct WikiLink {
        public let title: String
        public let start: Int
        public let end: Int
    }
}

// MARK: - Entity Extractor

/// 实体提取器
public class EntityExtractor {

    // MARK: - Properties

    /// NLP分词器
    private let tagger: NLTagger

    /// 技术关键词
    private let techKeywords: Set<String> = [
        "JavaScript", "Python", "Java", "C++", "TypeScript", "Swift", "Kotlin",
        "React", "Vue", "Angular", "SwiftUI", "UIKit",
        "Node.js", "Express", "Django", "Flask", "Spring",
        "Docker", "Kubernetes", "AWS", "Azure", "GCP",
        "MySQL", "PostgreSQL", "MongoDB", "Redis", "SQLite",
        "Git", "GitHub", "GitLab",
        "AI", "ML", "Deep Learning", "NLP", "Computer Vision",
        "Blockchain", "Ethereum", "Bitcoin", "Smart Contract",
        "iOS", "Android", "Flutter", "React Native",
        "API", "REST", "GraphQL", "WebSocket",
        "HTTP", "HTTPS", "TCP", "UDP",
        "JSON", "XML", "YAML", "Markdown"
    ]

    /// LLM回调
    public var llmChat: (([String: Any]) async throws -> String)?

    // MARK: - Initialization

    public init() {
        tagger = NLTagger(tagSchemes: [.nameType, .lexicalClass, .tokenType])
    }

    // MARK: - Entity Extraction

    /// 提取实体（基于规则和NLP）
    public func extractEntities(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        // 1. 使用NLP提取命名实体
        let nlpEntities = extractWithNLP(text: text)
        entities.append(contentsOf: nlpEntities)

        // 2. 提取日期
        let dates = extractDates(from: text)
        entities.append(contentsOf: dates)

        // 3. 提取时间
        let times = extractTimes(from: text)
        entities.append(contentsOf: times)

        // 4. 提取URL
        let urls = extractURLs(from: text)
        entities.append(contentsOf: urls)

        // 5. 提取标签 (#标签)
        let tags = extractTags(from: text)
        entities.append(contentsOf: tags)

        // 6. 提取技术术语
        let techTerms = extractTechTerms(from: text)
        entities.append(contentsOf: techTerms)

        // 7. 提取代码块语言
        let codeLanguages = extractCodeLanguages(from: text)
        entities.append(contentsOf: codeLanguages)

        // 8. 提取Markdown链接中的概念
        let concepts = extractMarkdownLinkConcepts(from: text)
        entities.append(contentsOf: concepts)

        // 去重（按位置）
        return deduplicateEntities(entities)
    }

    /// 使用NLP提取命名实体
    private func extractWithNLP(text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        tagger.string = text

        let range = text.startIndex..<text.endIndex

        tagger.enumerateTags(in: range, unit: .word, scheme: .nameType, options: [.omitPunctuation, .omitWhitespace]) { tag, tokenRange in
            guard let tag = tag else { return true }

            let value = String(text[tokenRange])
            let start = text.distance(from: text.startIndex, to: tokenRange.lowerBound)
            let end = text.distance(from: text.startIndex, to: tokenRange.upperBound)

            let entityType: EntityType?

            switch tag {
            case .personalName:
                entityType = .person
            case .organizationName:
                entityType = .organization
            case .placeName:
                entityType = .location
            default:
                entityType = nil
            }

            if let type = entityType {
                entities.append(ExtractedEntity(
                    type: type,
                    value: value,
                    start: start,
                    end: end,
                    confidence: 0.8
                ))
            }

            return true
        }

        return entities
    }

    /// 提取日期
    private func extractDates(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        let patterns = [
            "\\d{4}年\\d{1,2}月\\d{1,2}日",
            "\\d{4}-\\d{1,2}-\\d{1,2}",
            "\\d{4}/\\d{1,2}/\\d{1,2}"
        ]

        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
                let range = NSRange(text.startIndex..., in: text)
                let matches = regex.matches(in: text, options: [], range: range)

                for match in matches {
                    if let matchRange = Range(match.range, in: text) {
                        entities.append(ExtractedEntity(
                            type: .date,
                            value: String(text[matchRange]),
                            start: match.range.location,
                            end: match.range.location + match.range.length
                        ))
                    }
                }
            }
        }

        return entities
    }

    /// 提取时间
    private func extractTimes(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        let pattern = "\\d{1,2}:\\d{2}(:\\d{2})?"
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(text.startIndex..., in: text)
            let matches = regex.matches(in: text, options: [], range: range)

            for match in matches {
                if let matchRange = Range(match.range, in: text) {
                    entities.append(ExtractedEntity(
                        type: .time,
                        value: String(text[matchRange]),
                        start: match.range.location,
                        end: match.range.location + match.range.length
                    ))
                }
            }
        }

        return entities
    }

    /// 提取URL
    private func extractURLs(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)

        detector?.enumerateMatches(in: text, options: [], range: range) { match, _, _ in
            if let match = match, let url = match.url {
                entities.append(ExtractedEntity(
                    type: .url,
                    value: url.absoluteString,
                    start: match.range.location,
                    end: match.range.location + match.range.length
                ))
            }
        }

        return entities
    }

    /// 提取标签
    private func extractTags(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        let pattern = "#([^\\s#]+)"
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(text.startIndex..., in: text)
            let matches = regex.matches(in: text, options: [], range: range)

            for match in matches {
                if let tagRange = Range(match.range(at: 1), in: text) {
                    entities.append(ExtractedEntity(
                        type: .tag,
                        value: String(text[tagRange]),
                        start: match.range.location,
                        end: match.range.location + match.range.length
                    ))
                }
            }
        }

        return entities
    }

    /// 提取技术术语
    private func extractTechTerms(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        for keyword in techKeywords {
            let escapedKeyword = NSRegularExpression.escapedPattern(for: keyword)
            let pattern = "\\b\(escapedKeyword)\\b"

            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let range = NSRange(text.startIndex..., in: text)
                let matches = regex.matches(in: text, options: [], range: range)

                for match in matches {
                    if let matchRange = Range(match.range, in: text) {
                        entities.append(ExtractedEntity(
                            type: .technology,
                            value: String(text[matchRange]),
                            start: match.range.location,
                            end: match.range.location + match.range.length
                        ))
                    }
                }
            }
        }

        return entities
    }

    /// 提取代码块语言
    private func extractCodeLanguages(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        let pattern = "```(\\w+)\\n"
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(text.startIndex..., in: text)
            let matches = regex.matches(in: text, options: [], range: range)

            for match in matches {
                if let langRange = Range(match.range(at: 1), in: text) {
                    entities.append(ExtractedEntity(
                        type: .technology,
                        value: String(text[langRange]),
                        start: match.range.location,
                        end: match.range.location + match.range.length
                    ))
                }
            }
        }

        return entities
    }

    /// 提取Markdown链接中的概念
    private func extractMarkdownLinkConcepts(from text: String) -> [ExtractedEntity] {
        var entities: [ExtractedEntity] = []

        let pattern = "\\[([^\\]]+)\\]\\([^)]+\\)"
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(text.startIndex..., in: text)
            let matches = regex.matches(in: text, options: [], range: range)

            for match in matches {
                if let textRange = Range(match.range(at: 1), in: text) {
                    entities.append(ExtractedEntity(
                        type: .concept,
                        value: String(text[textRange]),
                        start: match.range.location,
                        end: match.range.location + match.range.length
                    ))
                }
            }
        }

        return entities
    }

    /// 去重实体
    private func deduplicateEntities(_ entities: [ExtractedEntity]) -> [ExtractedEntity] {
        var unique: [ExtractedEntity] = []
        var positions = Set<String>()

        for entity in entities {
            let key = "\(entity.start)-\(entity.end)"
            if !positions.contains(key) {
                positions.insert(key)
                unique.append(entity)
            }
        }

        return unique.sorted { $0.start < $1.start }
    }

    // MARK: - LLM Extraction

    /// 使用LLM提取实体和关系
    public func extractWithLLM(text: String) async throws -> (entities: [ExtractedEntity], relations: [EntityRelation]) {
        guard let llmChat = llmChat else {
            Logger.shared.warning("[EntityExtractor] LLM未配置，使用基础提取")
            return (extractEntities(from: text), [])
        }

        let prompt = """
        请从以下文本中提取关键实体和它们之间的关系。

        文本：
        \(text)

        请以JSON格式返回结果：
        {
          "entities": [{"type": "person|organization|location|technology|concept", "value": "实体值"}],
          "relations": [{"source": "源实体", "target": "目标实体", "type": "mentions|related_to|uses|part_of"}]
        }
        """

        do {
            let response = try await llmChat(["messages": [["role": "user", "content": prompt]]])

            // 解析JSON响应
            if let jsonMatch = response.range(of: "\\{[\\s\\S]*\\}", options: .regularExpression),
               let data = String(response[jsonMatch]).data(using: .utf8) {

                let result = try JSONDecoder().decode(LLMExtractionResult.self, from: data)

                let entities = result.entities.map { entity in
                    ExtractedEntity(
                        type: EntityType(rawValue: entity.type) ?? .concept,
                        value: entity.value,
                        start: 0,
                        end: 0,
                        confidence: 0.9
                    )
                }

                let relations = result.relations.map { rel in
                    EntityRelation(
                        source: rel.source,
                        target: rel.target,
                        type: EntityRelationType(rawValue: rel.type) ?? .relatedTo
                    )
                }

                return (entities, relations)
            }
        } catch {
            Logger.shared.error("[EntityExtractor] LLM提取失败: \(error)")
        }

        return (extractEntities(from: text), [])
    }

    // MARK: - Keywords Extraction

    /// 提取关键词（TF-IDF简化版）
    public func extractKeywords(from text: String, topN: Int = 10) -> [Keyword] {
        // 清理文本
        let cleanText = text.replacingOccurrences(
            of: "[^\\p{Han}a-zA-Z0-9\\s]",
            with: " ",
            options: .regularExpression
        )

        // 分词
        let words = cleanText.components(separatedBy: .whitespaces)
            .filter { $0.count > 1 }

        // 统计词频
        var wordFreq: [String: Int] = [:]
        for word in words {
            let lowercased = word.lowercased()
            wordFreq[lowercased, default: 0] += 1
        }

        // 排序并返回topN
        let sorted = wordFreq.sorted { $0.value > $1.value }
            .prefix(topN)

        return sorted.map { word, freq in
            Keyword(
                word: word,
                frequency: freq,
                score: Double(freq) / Double(words.count)
            )
        }
    }

    // MARK: - Wiki Links

    /// 提取Wiki链接
    public func extractWikiLinks(from text: String) -> [ExtractionResult.WikiLink] {
        var links: [ExtractionResult.WikiLink] = []

        let pattern = "\\[\\[([^\\]]+)\\]\\]"
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(text.startIndex..., in: text)
            let matches = regex.matches(in: text, options: [], range: range)

            for match in matches {
                if let titleRange = Range(match.range(at: 1), in: text) {
                    links.append(ExtractionResult.WikiLink(
                        title: String(text[titleRange]),
                        start: match.range.location,
                        end: match.range.location + match.range.length
                    ))
                }
            }
        }

        return links
    }

    // MARK: - Summary

    /// 提取文本摘要
    public func extractSummary(from text: String, maxLength: Int = 200) -> String {
        // 移除Markdown格式
        var cleanText = text
        cleanText = cleanText.replacingOccurrences(of: "```[\\s\\S]*?```", with: "", options: .regularExpression)
        cleanText = cleanText.replacingOccurrences(of: "`[^`]+`", with: "", options: .regularExpression)
        cleanText = cleanText.replacingOccurrences(of: "!\\[.*?\\]\\(.*?\\)", with: "", options: .regularExpression)
        cleanText = cleanText.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]+\\)", with: "$1", options: .regularExpression)
        cleanText = cleanText.replacingOccurrences(of: "#{1,6}\\s+", with: "", options: .regularExpression)
        cleanText = cleanText.replacingOccurrences(of: "[*_~]", with: "", options: .regularExpression)
        cleanText = cleanText.trimmingCharacters(in: .whitespacesAndNewlines)

        // 提取第一段
        let paragraphs = cleanText.components(separatedBy: "\n\n")
        let firstParagraph = paragraphs.first ?? cleanText

        if firstParagraph.count <= maxLength {
            return firstParagraph
        }

        return String(firstParagraph.prefix(maxLength)) + "..."
    }

    // MARK: - Similarity

    /// 计算文本相似度（Jaccard）
    public func calculateSimilarity(text1: String, text2: String) -> Double {
        let words1 = Set(text1.lowercased().components(separatedBy: .whitespaces))
        let words2 = Set(text2.lowercased().components(separatedBy: .whitespaces))

        let intersection = words1.intersection(words2)
        let union = words1.union(words2)

        guard !union.isEmpty else { return 0 }

        return Double(intersection.count) / Double(union.count)
    }

    // MARK: - Full Extraction

    /// 完整提取
    public func extract(from text: String) -> ExtractionResult {
        let entities = extractEntities(from: text)
        let keywords = extractKeywords(from: text)
        let wikiLinks = extractWikiLinks(from: text)
        let summary = extractSummary(from: text)

        return ExtractionResult(
            entities: entities,
            relations: [],
            keywords: keywords,
            wikiLinks: wikiLinks,
            summary: summary
        )
    }

    /// 使用LLM完整提取
    public func extractWithLLM(from text: String) async throws -> ExtractionResult {
        let (entities, relations) = try await extractWithLLM(text: text)
        let keywords = extractKeywords(from: text)
        let wikiLinks = extractWikiLinks(from: text)
        let summary = extractSummary(from: text)

        return ExtractionResult(
            entities: entities,
            relations: relations,
            keywords: keywords,
            wikiLinks: wikiLinks,
            summary: summary
        )
    }
}

// MARK: - LLM Result Types

private struct LLMExtractionResult: Codable {
    let entities: [LLMEntity]
    let relations: [LLMRelation]
}

private struct LLMEntity: Codable {
    let type: String
    let value: String
}

private struct LLMRelation: Codable {
    let source: String
    let target: String
    let type: String
}

// MARK: - Entity Graph Builder

/// 实体图谱构建器
public class EntityGraphBuilder {

    /// 从提取结果构建图谱
    public func buildGraph(
        from notes: [(id: String, title: String, result: ExtractionResult)]
    ) -> GraphData {
        var nodes: [GraphNode] = []
        var edges: [GraphEdge] = []
        var entityNodeIds: [String: String] = [:]

        for (noteId, title, result) in notes {
            // 添加笔记节点
            nodes.append(GraphNode(
                id: noteId,
                label: title,
                type: .note,
                metadata: ["summary": result.summary]
            ))

            // 添加实体节点
            for entity in result.entities {
                let entityId = "entity_\(entity.type.rawValue)_\(entity.value)"

                if entityNodeIds[entityId] == nil {
                    entityNodeIds[entityId] = entityId
                    nodes.append(GraphNode(
                        id: entityId,
                        label: entity.value,
                        type: .entity,
                        metadata: ["entity_type": entity.type.rawValue]
                    ))
                }

                // 添加笔记到实体的边
                edges.append(GraphEdge(
                    sourceId: noteId,
                    targetId: entityId,
                    type: .reference,
                    weight: Double(entity.confidence)
                ))
            }

            // 添加实体间关系
            for relation in result.relations {
                let sourceId = "entity_\(relation.source)"
                let targetId = "entity_\(relation.target)"

                edges.append(GraphEdge(
                    sourceId: sourceId,
                    targetId: targetId,
                    type: .semantic,
                    weight: relation.weight,
                    metadata: ["relation_type": relation.type.rawValue]
                ))
            }

            // 添加Wiki链接关系
            for link in result.wikiLinks {
                edges.append(GraphEdge(
                    sourceId: noteId,
                    targetId: link.title, // 需要解析为实际笔记ID
                    type: .link,
                    weight: 1.0
                ))
            }
        }

        return GraphData(nodes: nodes, edges: edges)
    }
}
