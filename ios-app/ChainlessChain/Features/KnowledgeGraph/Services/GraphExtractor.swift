import Foundation
import CoreCommon

/// 知识图谱关系提取器
/// 从笔记内容中提取各种类型的关系
public class GraphExtractor {

    // MARK: - Properties

    /// 笔记查询回调
    public var getNoteByTitle: ((String) -> GraphNode?)?
    public var getNoteById: ((String) -> GraphNode?)?
    public var getAllNotes: (() -> [GraphNode])?
    public var getNoteTags: ((String) -> [String])?

    // MARK: - Initialization

    public init() {}

    // MARK: - Relation Extraction

    /// 从笔记内容中提取所有关系
    public func extractRelations(
        noteId: String,
        content: String,
        tags: [String] = []
    ) -> [GraphEdge] {
        var relations: [GraphEdge] = []

        // 1. 提取 Wiki 链接 [[笔记标题]]
        let wikiLinks = extractWikiLinks(from: content)
        for targetTitle in wikiLinks {
            if let targetNote = getNoteByTitle?(targetTitle),
               targetNote.id != noteId {
                relations.append(GraphEdge(
                    sourceId: noteId,
                    targetId: targetNote.id,
                    type: .link,
                    weight: 2.0,  // Wiki链接权重较高
                    metadata: ["link_type": "wiki", "title": targetTitle]
                ))
            }
        }

        // 2. 提取 Markdown 链接 [text](url)
        let markdownLinks = extractMarkdownLinks(from: content)
        for link in markdownLinks {
            // 检查是否是内部链接（引用其他笔记）
            if link.url.hasPrefix("#") || link.url.hasPrefix("./") || link.url.hasPrefix("../") {
                if let targetNote = getNoteByTitle?(link.text),
                   targetNote.id != noteId {
                    relations.append(GraphEdge(
                        sourceId: noteId,
                        targetId: targetNote.id,
                        type: .link,
                        weight: 1.5,
                        metadata: ["link_type": "markdown", "url": link.url]
                    ))
                }
            }
        }

        // 3. 提取 @mentions
        let mentions = extractMentions(from: content)
        for mentionedTitle in mentions {
            if let targetNote = getNoteByTitle?(mentionedTitle),
               targetNote.id != noteId {
                relations.append(GraphEdge(
                    sourceId: noteId,
                    targetId: targetNote.id,
                    type: .mention,
                    weight: 1.8,
                    metadata: ["link_type": "mention", "title": mentionedTitle]
                ))
            }
        }

        return relations
    }

    // MARK: - Link Extraction

    /// 提取 Wiki 风格链接 [[笔记标题]]
    public func extractWikiLinks(from content: String) -> [String] {
        let pattern = "\\[\\[([^\\]]+)\\]\\]"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return []
        }

        let range = NSRange(content.startIndex..., in: content)
        let matches = regex.matches(in: content, options: [], range: range)

        var titles: Set<String> = []
        for match in matches {
            if let titleRange = Range(match.range(at: 1), in: content) {
                let title = String(content[titleRange]).trimmingCharacters(in: .whitespaces)
                if !title.isEmpty {
                    titles.insert(title)
                }
            }
        }

        return Array(titles)
    }

    /// 提取 Markdown 链接 [text](url)
    public func extractMarkdownLinks(from content: String) -> [(text: String, url: String)] {
        // 匹配标准Markdown链接，排除图片 ![...]
        let pattern = "(?<!!)\\[([^\\]]+)\\]\\(([^)]+)\\)"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return []
        }

        let range = NSRange(content.startIndex..., in: content)
        let matches = regex.matches(in: content, options: [], range: range)

        var links: [(String, String)] = []
        for match in matches {
            if let textRange = Range(match.range(at: 1), in: content),
               let urlRange = Range(match.range(at: 2), in: content) {
                let text = String(content[textRange]).trimmingCharacters(in: .whitespaces)
                let url = String(content[urlRange]).trimmingCharacters(in: .whitespaces)
                if !text.isEmpty && !url.isEmpty {
                    links.append((text, url))
                }
            }
        }

        return links
    }

    /// 提取 @mentions
    public func extractMentions(from content: String) -> [String] {
        var mentions: Set<String> = []

        // 匹配 @[标题] 格式
        let pattern1 = "@\\[([^\\]]+)\\]"
        if let regex1 = try? NSRegularExpression(pattern: pattern1, options: []) {
            let range = NSRange(content.startIndex..., in: content)
            let matches = regex1.matches(in: content, options: [], range: range)

            for match in matches {
                if let titleRange = Range(match.range(at: 1), in: content) {
                    let title = String(content[titleRange]).trimmingCharacters(in: .whitespaces)
                    if !title.isEmpty {
                        mentions.insert(title)
                    }
                }
            }
        }

        // 匹配 @标题（空格或标点符号结尾）- 支持中英文
        let pattern2 = "@([\\p{Han}a-zA-Z0-9_-]+)(?=\\s|[，。！？,.!?]|$)"
        if let regex2 = try? NSRegularExpression(pattern: pattern2, options: []) {
            let range = NSRange(content.startIndex..., in: content)
            let matches = regex2.matches(in: content, options: [], range: range)

            for match in matches {
                if let titleRange = Range(match.range(at: 1), in: content) {
                    let title = String(content[titleRange]).trimmingCharacters(in: .whitespaces)
                    if !title.isEmpty {
                        mentions.insert(title)
                    }
                }
            }
        }

        return Array(mentions)
    }

    /// 提取代码块中的引用
    public func extractCodeReferences(from content: String) -> [String] {
        // 提取代码块
        let codeBlockPattern = "```[\\s\\S]*?```"
        guard let codeBlockRegex = try? NSRegularExpression(pattern: codeBlockPattern, options: []) else {
            return []
        }

        let range = NSRange(content.startIndex..., in: content)
        let codeBlockMatches = codeBlockRegex.matches(in: content, options: [], range: range)

        var references: Set<String> = []

        for match in codeBlockMatches {
            if let blockRange = Range(match.range, in: content) {
                let block = String(content[blockRange])

                // 提取 import 和 require 语句
                let importPattern = "(?:import|require)\\s*\\(?['\"]([^'\"]+)['\"]\\)?"
                if let importRegex = try? NSRegularExpression(pattern: importPattern, options: []) {
                    let blockNSRange = NSRange(block.startIndex..., in: block)
                    let importMatches = importRegex.matches(in: block, options: [], range: blockNSRange)

                    for importMatch in importMatches {
                        if let refRange = Range(importMatch.range(at: 1), in: block) {
                            references.insert(String(block[refRange]))
                        }
                    }
                }
            }
        }

        return Array(references)
    }

    // MARK: - Potential Links

    /// 查找笔记中所有未链接的潜在引用
    public func findPotentialLinks(
        noteId: String,
        content: String
    ) -> [PotentialLink] {
        guard let allNotes = getAllNotes?() else { return [] }

        var suggestions: [PotentialLink] = []

        // 移除现有链接语法，避免重复建议
        var cleanContent = content
        cleanContent = cleanContent.replacingOccurrences(
            of: "\\[\\[[^\\]]+\\]\\]",
            with: "",
            options: .regularExpression
        )
        cleanContent = cleanContent.replacingOccurrences(
            of: "\\[[^\\]]+\\]\\([^)]+\\)",
            with: "",
            options: .regularExpression
        )

        for note in allNotes {
            if note.id == noteId { continue }

            let title = note.label
            // 检查标题是否在内容中出现（至少3个字符）
            if title.count >= 3 && cleanContent.contains(title) {
                // 计算置信度（基于标题长度和出现次数）
                let pattern = NSRegularExpression.escapedPattern(for: title)
                let regex = try? NSRegularExpression(pattern: pattern, options: [])
                let range = NSRange(cleanContent.startIndex..., in: cleanContent)
                let occurrences = regex?.numberOfMatches(in: cleanContent, options: [], range: range) ?? 0

                let confidence = min(0.5 + Double(title.count) / 20.0 + Double(occurrences) * 0.2, 1.0)

                suggestions.append(PotentialLink(
                    targetId: note.id,
                    title: title,
                    confidence: confidence,
                    occurrences: occurrences
                ))
            }
        }

        // 按置信度排序
        return suggestions.sorted { $0.confidence > $1.confidence }
    }

    // MARK: - Batch Processing

    /// 处理单个笔记并生成所有关系
    public func processNote(
        noteId: String,
        content: String,
        tags: [String] = []
    ) -> [GraphEdge] {
        // 提取关系
        return extractRelations(noteId: noteId, content: content, tags: tags)
    }

    /// 批量处理所有笔记
    public func processAllNotes(
        notes: [GraphNode],
        getContent: (String) -> String?,
        getTags: (String) -> [String]
    ) -> ProcessingResult {
        var processed = 0
        var totalRelations = 0
        var allRelations: [GraphEdge] = []

        for note in notes {
            guard let content = getContent(note.id) else { continue }
            let tags = getTags(note.id)

            let relations = processNote(noteId: note.id, content: content, tags: tags)
            allRelations.append(contentsOf: relations)

            processed += 1
            totalRelations += relations.count
        }

        Logger.shared.info("[GraphExtractor] 处理完成: \(processed) 个笔记, \(totalRelations) 个关系")

        return ProcessingResult(
            processed: processed,
            linkRelations: totalRelations,
            relations: allRelations
        )
    }

    // MARK: - Tag Relations

    /// 构建标签关系
    /// 如果两个笔记共享相同的标签，则创建关系
    public func buildTagRelations(
        notes: [GraphNode],
        getTags: (String) -> [String]
    ) -> [GraphEdge] {
        var tagToNotes: [String: [String]] = [:]

        // 构建标签到笔记的映射
        for note in notes {
            let tags = getTags(note.id)
            for tag in tags {
                if tagToNotes[tag] == nil {
                    tagToNotes[tag] = []
                }
                tagToNotes[tag]?.append(note.id)
            }
        }

        var relations: [GraphEdge] = []
        var addedPairs = Set<String>()

        // 为共享标签的笔记创建关系
        for (tag, noteIds) in tagToNotes {
            if noteIds.count < 2 { continue }

            for i in 0..<noteIds.count {
                for j in (i + 1)..<noteIds.count {
                    let sourceId = noteIds[i]
                    let targetId = noteIds[j]

                    // 避免重复添加
                    let pairKey = [sourceId, targetId].sorted().joined(separator: "-")
                    if addedPairs.contains(pairKey) { continue }
                    addedPairs.insert(pairKey)

                    relations.append(GraphEdge(
                        sourceId: sourceId,
                        targetId: targetId,
                        type: .tag,
                        weight: 1.0,
                        metadata: ["shared_tag": tag]
                    ))
                }
            }
        }

        Logger.shared.info("[GraphExtractor] 构建了 \(relations.count) 个标签关系")
        return relations
    }

    /// 构建时间关系
    /// 如果两个笔记在指定时间窗口内创建，则创建关系
    public func buildTemporalRelations(
        notes: [GraphNode],
        getCreatedAt: (String) -> Date?,
        windowDays: Int = 7
    ) -> [GraphEdge] {
        var relations: [GraphEdge] = []
        var addedPairs = Set<String>()

        let windowSeconds = TimeInterval(windowDays * 24 * 60 * 60)

        // 按创建时间排序
        let sortedNotes = notes.compactMap { note -> (GraphNode, Date)? in
            if let date = getCreatedAt(note.id) {
                return (note, date)
            }
            return nil
        }.sorted { $0.1 < $1.1 }

        // 查找时间窗口内的笔记对
        for i in 0..<sortedNotes.count {
            for j in (i + 1)..<sortedNotes.count {
                let (note1, date1) = sortedNotes[i]
                let (note2, date2) = sortedNotes[j]

                let timeDiff = date2.timeIntervalSince(date1)

                // 超出时间窗口则停止
                if timeDiff > windowSeconds { break }

                // 避免重复添加
                let pairKey = [note1.id, note2.id].sorted().joined(separator: "-")
                if addedPairs.contains(pairKey) { continue }
                addedPairs.insert(pairKey)

                // 权重随时间差衰减
                let weight = 1.0 - (timeDiff / windowSeconds) * 0.5

                relations.append(GraphEdge(
                    sourceId: note1.id,
                    targetId: note2.id,
                    type: .temporal,
                    weight: weight,
                    metadata: ["time_diff_hours": String(Int(timeDiff / 3600))]
                ))
            }
        }

        Logger.shared.info("[GraphExtractor] 构建了 \(relations.count) 个时间关系")
        return relations
    }
}

// MARK: - Processing Result

/// 处理结果
public struct ProcessingResult {
    public let processed: Int
    public let linkRelations: Int
    public let relations: [GraphEdge]

    public init(processed: Int, linkRelations: Int, relations: [GraphEdge]) {
        self.processed = processed
        self.linkRelations = linkRelations
        self.relations = relations
    }
}
